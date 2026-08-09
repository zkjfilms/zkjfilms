# Custom Error and Loading Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Next.js's bare default UI for 404s, runtime errors, and loading states with three branded pages matching the site's existing design: `app/not-found.tsx`, `app/error.tsx`, `app/loading.tsx`.

**Architecture:** Three small, fully independent files at the app root — no shared component, no cross-file dependencies. Each reuses the site's existing Tailwind tokens and typographic patterns already established on every other page.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4 (existing design tokens) — no new dependencies.

## Global Constraints

- All copy is final — reproduce exactly as given in each task below.
- `not-found.tsx` and `error.tsx` both render INSIDE the existing root layout (`app/layout.tsx`) in this Next.js version — the `Navbar`/`Footer` show automatically. Do not attempt to build a standalone `<html>`/`<body>` document for either of these two files (that's only for `global-error.tsx`, explicitly out of scope for this plan).
- `error.tsx` must start with `"use client"` and receives `{ error, unstable_retry }` as props — typed `error: Error & { digest?: string }`, `unstable_retry: () => void`. Use `unstable_retry()` for the "Try Again" action (the current Next.js 16 recommended API), not `reset()`.
- `error.tsx` cannot export `metadata`/`generateMetadata` (Client Component + React error boundary constraint) — don't attempt to add one.
- `loading.tsx` has no props and no metadata — it's a transient Suspense fallback, not a real page.
- No new dependencies. No icon/spinner graphics — `loading.tsx` uses Tailwind's built-in `animate-pulse` utility on text only.
- This project has no test framework. Verification is `npm run build` plus manual/browser checks — for `error.tsx` and `loading.tsx` specifically, `curl` alone cannot trigger their rendering (they require an actual thrown error / an actual Suspense-triggering delay respectively), so each of those two tasks includes creating a **temporary, throwaway test page** to force the condition, verifying visually, then **deleting that temporary page** before committing — the temporary page must never be part of the final commit.

---

### Task 1: `app/not-found.tsx`

**Files:**
- Create: `app/not-found.tsx`

**Interfaces:**
- Consumes: `buildPageMetadata` from `@/lib/seo` (existing).
- Produces: nothing consumed by other files — this is a Next.js file-convention page, addressed automatically by the framework (both explicit `notFound()` calls anywhere in the app, and any genuinely unmatched URL).

- [ ] **Step 1: Create `app/not-found.tsx`**

```tsx
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Page Not Found",
    description: "The page you're looking for doesn't exist.",
  });
}

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        404
      </p>
      <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
        Out of <span className="text-accent">frame</span>.
      </h1>
      <p className="mt-5 text-muted">
        The page you&apos;re looking for doesn&apos;t exist &mdash; maybe it
        moved, maybe it was never there. Let&apos;s get you back to
        something real.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Back to Home
        </Link>
        <Link
          href="/portraits"
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
        >
          Browse the Portfolio
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Verify the 404 page renders correctly**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
npm run dev &
sleep 3
curl -s http://localhost:3000/this-does-not-exist | grep -o 'Out of'
curl -s http://localhost:3000/this-does-not-exist | grep -o 'Back to Home'
curl -s http://localhost:3000/this-does-not-exist | grep -o 'Browse the Portfolio'
curl -s http://localhost:3000/this-does-not-exist | grep -o '<a[^>]*href="/"'
curl -s http://localhost:3000/this-does-not-exist | grep -o 'name="robots" content="noindex"'
curl -s http://localhost:3000/this-does-not-exist | grep -o 'Zach K. Johnson'
kill %1
```
Expected: all greps match (the "Out of"/CTA text confirms the new page rendered; the `noindex` meta tag confirms Next.js's automatic 404 handling; "Zach K. Johnson" appearing confirms the Navbar/Footer — which both render that text — are present around the 404 content, proving it renders inside the root layout as expected).

- [ ] **Step 4: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add app/not-found.tsx
git commit -m "Add custom 404 page (app/not-found.tsx)"
```

---

### Task 2: `app/error.tsx`

**Files:**
- Create: `app/error.tsx`

**Interfaces:**
- None — this is a Next.js file-convention error boundary, receives `{ error, unstable_retry }` from the framework automatically when a descendant of the root layout throws during rendering.

- [ ] **Step 1: Create `app/error.tsx`**

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center sm:px-10">
      <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
        Something went wrong.
      </h1>
      <p className="mt-5 text-muted">
        That wasn&apos;t supposed to happen. Try again, or reach out
        directly if it keeps happening.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <button
          type="button"
          onClick={() => unstable_retry()}
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Try Again
        </button>
        <Link
          href="/contact"
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
        >
          Contact
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Force a real render via a temporary throwaway test page**

`curl` cannot trigger an error boundary (it requires an actual thrown error during React rendering). Create a temporary page to force it:

```bash
mkdir -p /Users/zachjohnson/Projects/portfolio-site/app/tmp-error-test
cat > /Users/zachjohnson/Projects/portfolio-site/app/tmp-error-test/page.tsx << 'EOF'
export default function TmpErrorTest() {
  throw new Error("Deliberate test error for verifying app/error.tsx");
}
EOF
```

Then:
```bash
cd /Users/zachjohnson/Projects/portfolio-site
npm run dev &
sleep 3
curl -s http://localhost:3000/tmp-error-test | grep -o 'Something went wrong'
curl -s http://localhost:3000/tmp-error-test | grep -o 'Try Again'
curl -s http://localhost:3000/tmp-error-test | grep -o 'Zach K. Johnson'
kill %1
```
Expected: all three greps match — confirms `error.tsx` renders with the correct copy, and that the Navbar/Footer ("Zach K. Johnson" appears in both) render around it, proving the error boundary is nested inside the root layout rather than replacing it.

Also do a quick visual check in a real browser if the `claude-in-chrome` or `chrome-devtools` tools are available (load via `ToolSearch` with query `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp"` if deferred): navigate to `/tmp-error-test`, confirm the page visually matches the site's design (serif italic heading, centered layout, Navbar/Footer present), and click "Try Again" — since the test page always throws, clicking it will just show the error boundary again (that's expected and correct behavior for this deliberately-always-throwing test page), not a crash or blank screen.

**Then delete the temporary test page — it must NOT be part of the commit:**

```bash
rm -rf /Users/zachjohnson/Projects/portfolio-site/app/tmp-error-test
```

- [ ] **Step 4: Re-verify the build is clean after removing the test page**

Run: `npm run build`
Expected: succeeds, and `/tmp-error-test` is NOT listed in the route output.

- [ ] **Step 5: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git status --porcelain
```
Expected: only `app/error.tsx` shown as a new file — confirm `app/tmp-error-test/` does NOT appear before committing.

```bash
git add app/error.tsx
git commit -m "Add custom error boundary page (app/error.tsx)"
```

---

### Task 3: `app/loading.tsx`

**Files:**
- Create: `app/loading.tsx`

**Interfaces:**
- None — this is a Next.js file-convention Suspense fallback, shown automatically by the framework while a route segment's content is still loading.

- [ ] **Step 1: Create `app/loading.tsx`**

```tsx
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-6 py-20">
      <p className="animate-pulse text-xs uppercase tracking-[0.3em] text-muted">
        Loading
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds with no errors.

- [ ] **Step 3: Force a real render via a temporary throwaway test page**

`curl` against a fast page won't show a loading state (it resolves too quickly). Create a temporary page with a deliberate delay to force the Suspense fallback to appear:

```bash
mkdir -p /Users/zachjohnson/Projects/portfolio-site/app/tmp-loading-test
cat > /Users/zachjohnson/Projects/portfolio-site/app/tmp-loading-test/page.tsx << 'EOF'
export const dynamic = "force-dynamic";

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async function TmpLoadingTest() {
  await delay(3000);
  return <p>Loaded.</p>;
}
EOF
```

Then, if the `claude-in-chrome` or `chrome-devtools` browser tools are available (load via `ToolSearch` with query `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp"` if deferred): start `npm run dev`, navigate to `/tmp-loading-test`, and confirm the pulsing "Loading" text is visible for approximately 3 seconds before "Loaded." replaces it. If browser tools aren't available, run this instead and confirm the timing gap between the two greps is roughly 3 seconds:

```bash
cd /Users/zachjohnson/Projects/portfolio-site
npm run dev &
sleep 3
( curl -s http://localhost:3000/tmp-loading-test & )
sleep 1
date
kill %1 2>/dev/null
```
(This is a best-effort timing check since `curl` alone can't observe the intermediate streamed HTML the way a browser can — the browser check above is the more reliable verification when available.)

**Then delete the temporary test page — it must NOT be part of the commit:**

```bash
rm -rf /Users/zachjohnson/Projects/portfolio-site/app/tmp-loading-test
```

- [ ] **Step 4: Re-verify the build is clean after removing the test page**

Run: `npm run build`
Expected: succeeds, and `/tmp-loading-test` is NOT listed in the route output.

- [ ] **Step 5: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git status --porcelain
```
Expected: only `app/loading.tsx` shown as a new file — confirm `app/tmp-loading-test/` does NOT appear before committing.

```bash
git add app/loading.tsx
git commit -m "Add general loading fallback (app/loading.tsx)"
```

---

## Final verification (after all 3 tasks)

- [ ] Run `npm run build` one more time from a clean state — confirm it succeeds end to end, with exactly `not-found`, `error`, and `loading` special files present (check the build output notes them), and no leftover `tmp-error-test`/`tmp-loading-test` routes.
- [ ] `git log --oneline -3` shows exactly the three expected commits, each touching exactly one file.
- [ ] Visual check in a browser: `/this-does-not-exist` shows the branded 404 with working "Back to Home" and "Browse the Portfolio" links.
