# Portraits Nav Dropdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dropdown under "Portraits" in the site-wide `Navbar` linking to Headshots, Creative Portraits, and Boudoir — desktop hover+click, mobile accordion.

**Architecture:** Single-file change to `components/Navbar.tsx`. A small `PORTRAITS_SUBLINKS` constant plus a shared `CaretIcon` component; the existing `links.map()` in both the desktop `<nav>` and the mobile full-screen overlay special-cases the "Portraits" entry to render the dropdown/accordion instead of a plain link. Two new pieces of state (`portraitsDropdownOpen`, `mobileAccordionOpen`) extend the existing close-on-route-change / close-on-Escape effect patterns already built for the mobile menu.

**Tech Stack:** Next.js 16 App Router, React, Tailwind CSS (inline utility classes, no CSS modules), TypeScript.

## Global Constraints

- This project has no automated test framework (confirmed: no `jest`/`vitest`/`playwright`/`@testing-library` in `package.json`). Verification is `npx tsc --noEmit`, `npm run build`, and manual browser checks — follow this project's existing convention, don't introduce a test framework.
- Follow `components/Navbar.tsx`'s existing style exactly: inline Tailwind utility classes, no CSS modules, no new dependencies.
- Do not modify `HERO_ROUTES`, the `links` array's existing four non-Portraits entries, or any file other than `components/Navbar.tsx`.

---

### Task 1: Desktop dropdown

**Files:**
- Modify: `components/Navbar.tsx:1-13` (imports, `links` array)
- Modify: `components/Navbar.tsx:26-58` (add `CaretIcon` after `MenuIcon`)
- Modify: `components/Navbar.tsx:60-119` (add state, ref, effects inside `Navbar()`)
- Modify: `components/Navbar.tsx:139-153` (desktop `<nav>` rendering)

**Interfaces:**
- Produces: `PORTRAITS_SUBLINKS: { href: string; label: string }[]` — consumed by Task 2.
- Produces: `function CaretIcon({ open }: { open: boolean })` — consumed by Task 2.
- Produces: `portraitsRef` (a `useRef<HTMLDivElement>`), `portraitsDropdownOpen`/`setPortraitsDropdownOpen` — local to this task, not consumed elsewhere.

- [ ] **Step 1: Add the `useRef` import and `PORTRAITS_SUBLINKS` constant**

In `components/Navbar.tsx`, change the react import on line 5:

```tsx
import { useEffect, useRef, useState } from "react";
```

Add immediately after the existing `links` array (after line 13):

```tsx
const PORTRAITS_SUBLINKS = [
  { href: "/headshots", label: "Headshots" },
  { href: "/creative-portraits", label: "Creative Portraits" },
  { href: "/boudoir", label: "Boudoir" },
];
```

- [ ] **Step 2: Add the `CaretIcon` component**

Add immediately after the `MenuIcon` function's closing brace (after line 58):

```tsx
function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="1.5,3 5,6.5 8.5,3" />
    </svg>
  );
}
```

- [ ] **Step 3: Add dropdown state and a ref, next to the existing state**

In `Navbar()`, immediately after the existing line `const [mobileMenuOpen, setMobileMenuOpen] = useState(false);`, add:

```tsx
const [portraitsDropdownOpen, setPortraitsDropdownOpen] = useState(false);
const portraitsRef = useRef<HTMLDivElement>(null);
```

- [ ] **Step 4: Extend the route-change-close effect**

Find the existing effect:

```tsx
useEffect(() => {
  function closeMenu() {
    setMobileMenuOpen(false);
  }
  closeMenu();
}, [pathname]);
```

Replace it with:

```tsx
useEffect(() => {
  setMobileMenuOpen(false);
  setPortraitsDropdownOpen(false);
}, [pathname]);
```

- [ ] **Step 5: Add a new effect for Escape-to-close and click-outside-to-close**

Add this new effect immediately after the existing scroll-lock/Escape effect that's scoped to `mobileMenuOpen` (the one that sets `document.body.style.overflow`), and before the viewport-resize effect:

```tsx
// The desktop dropdown gets its own Escape/outside-click handling,
// independent of the mobile menu's — it doesn't need a scroll lock.
useEffect(() => {
  if (!portraitsDropdownOpen) return;
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") setPortraitsDropdownOpen(false);
  }
  function onClickOutside(e: MouseEvent) {
    if (portraitsRef.current && !portraitsRef.current.contains(e.target as Node)) {
      setPortraitsDropdownOpen(false);
    }
  }
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("mousedown", onClickOutside);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("mousedown", onClickOutside);
  };
}, [portraitsDropdownOpen]);
```

- [ ] **Step 6: Special-case "Portraits" in the desktop `<nav>` render**

Replace the existing desktop nav block:

```tsx
<nav className="hidden items-center gap-8 sm:gap-10 md:flex">
  {links.map((link) => (
    <Link
      key={link.href}
      href={link.href}
      className={`text-[11px] uppercase tracking-[0.2em] transition-colors duration-500 ${
        scrolled
          ? "text-muted hover:text-foreground"
          : "text-white/80 hover:text-white"
      }`}
    >
      {link.label}
    </Link>
  ))}
</nav>
```

with:

```tsx
<nav className="hidden items-center gap-8 sm:gap-10 md:flex">
  {links.map((link) => {
    const linkClass = `text-[11px] uppercase tracking-[0.2em] transition-colors duration-500 ${
      scrolled
        ? "text-muted hover:text-foreground"
        : "text-white/80 hover:text-white"
    }`;

    if (link.href !== "/portraits") {
      return (
        <Link key={link.href} href={link.href} className={linkClass}>
          {link.label}
        </Link>
      );
    }

    return (
      <div
        key={link.href}
        ref={portraitsRef}
        className="relative flex items-center gap-1.5"
        onMouseEnter={() => setPortraitsDropdownOpen(true)}
        onMouseLeave={() => setPortraitsDropdownOpen(false)}
      >
        <Link href={link.href} className={linkClass}>
          {link.label}
        </Link>
        <button
          type="button"
          onClick={() => setPortraitsDropdownOpen((open) => !open)}
          aria-expanded={portraitsDropdownOpen}
          aria-label="Show portrait categories"
          className={linkClass}
        >
          <CaretIcon open={portraitsDropdownOpen} />
        </button>
        {portraitsDropdownOpen && (
          <div className="absolute top-full left-0 mt-2 min-w-[180px] border border-border bg-background/95 py-2 backdrop-blur-md">
            {PORTRAITS_SUBLINKS.map((sub) => (
              <Link
                key={sub.href}
                href={sub.href}
                className="block px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
              >
                {sub.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  })}
</nav>
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (no errors).

- [ ] **Step 8: Manual browser verification (desktop)**

Run `npm run dev`, then using the chrome-devtools MCP tools (or equivalent): navigate to `http://localhost:3000/`, and at a desktop-width viewport confirm:
- Hovering the "Portraits" nav item reveals a dropdown panel with "Headshots", "Creative Portraits", "Boudoir".
- Clicking the caret button toggles the dropdown open/closed (test with the mouse away from the hover area so hover isn't also keeping it open).
- Clicking a sublink navigates to the right URL (`/headshots`, `/creative-portraits`, `/boudoir`) and the dropdown is closed on arrival.
- Clicking elsewhere on the page (outside the dropdown) closes it while it's open.
- Pressing Escape while it's open closes it.
- The "Portraits" link itself still navigates to `/portraits` when clicked directly (not on the caret).
- Home/About/Book/Contact links are visually unchanged.

Stop the dev server when done (`pkill -f "next dev"` or equivalent).

- [ ] **Step 9: Commit**

```bash
git add components/Navbar.tsx
git commit -m "$(cat <<'EOF'
Add desktop Portraits nav dropdown

Hover or click the caret next to "Portraits" to reveal Headshots,
Creative Portraits, and Boudoir. Clicking "Portraits" itself still
navigates to the combined gallery, unchanged. Closes on Escape,
outside click, or route change.
EOF
)"
```

---

### Task 2: Mobile accordion

**Files:**
- Modify: `components/Navbar.tsx` (add state + reset effect inside `Navbar()`; modify the mobile overlay render block)

**Interfaces:**
- Consumes: `PORTRAITS_SUBLINKS` and `CaretIcon` from Task 1.
- Consumes: `mobileMenuOpen`/`setMobileMenuOpen` (already existed before this plan).

- [ ] **Step 1: Add mobile accordion state**

In `Navbar()`, immediately after the `portraitsDropdownOpen`/`portraitsRef` lines added in Task 1, add:

```tsx
const [mobileAccordionOpen, setMobileAccordionOpen] = useState(false);
```

- [ ] **Step 2: Add a reset effect so the accordion never opens pre-expanded**

Add this effect immediately after the viewport-resize effect (the one that watches `window.matchMedia("(min-width: 768px)")`):

```tsx
// Reset the accordion every time the mobile menu itself closes, so
// reopening it never shows a stale expanded state.
useEffect(() => {
  if (!mobileMenuOpen) setMobileAccordionOpen(false);
}, [mobileMenuOpen]);
```

- [ ] **Step 3: Special-case "Portraits" in the mobile overlay render**

Replace the existing mobile overlay block:

```tsx
{mobileMenuOpen && (
  <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-background md:hidden">
    {links.map((link) => (
      <Link
        key={link.href}
        href={link.href}
        className="text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
      >
        {link.label}
      </Link>
    ))}
  </div>
)}
```

with:

```tsx
{mobileMenuOpen && (
  <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-background md:hidden">
    {links.map((link) => {
      if (link.href !== "/portraits") {
        return (
          <Link
            key={link.href}
            href={link.href}
            className="text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
          >
            {link.label}
          </Link>
        );
      }

      return (
        <div key={link.href} className="flex flex-col items-center gap-6">
          <div className="flex items-center gap-2">
            <Link
              href={link.href}
              className="text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
            >
              {link.label}
            </Link>
            <button
              type="button"
              onClick={() => setMobileAccordionOpen((open) => !open)}
              aria-expanded={mobileAccordionOpen}
              aria-label="Show portrait categories"
              className="text-foreground"
            >
              <CaretIcon open={mobileAccordionOpen} />
            </button>
          </div>
          {mobileAccordionOpen && (
            <div className="flex flex-col items-center gap-5">
              {PORTRAITS_SUBLINKS.map((sub) => (
                <Link
                  key={sub.href}
                  href={sub.href}
                  className="text-sm uppercase tracking-[0.2em] text-muted transition-colors hover:text-accent"
                >
                  {sub.label}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no output (no errors).

- [ ] **Step 5: Manual browser verification (mobile)**

Run `npm run dev`, then using the chrome-devtools MCP tools, emulate a 390px-wide viewport and navigate to `http://localhost:3000/`. Confirm:
- Tapping the hamburger icon opens the full-screen mobile menu.
- The "Portraits" entry shows a caret next to it.
- Tapping the caret expands "Headshots", "Creative Portraits", "Boudoir" beneath it, smaller and muted compared to the top-level links.
- Tapping a sublink navigates to the right URL and the entire mobile menu closes.
- Reopening the hamburger menu afterward shows the accordion collapsed again (not still expanded from before).
- Home/About/Book/Contact entries are visually unchanged.

Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add components/Navbar.tsx
git commit -m "$(cat <<'EOF'
Add mobile Portraits accordion to the nav overlay

Tapping the caret next to "Portraits" in the full-screen mobile menu
expands Headshots, Creative Portraits, and Boudoir inline. Resets
closed whenever the mobile menu itself closes.
EOF
)"
```

---

### Task 3: Full verification pass and deploy

**Files:** None (verification only).

**Interfaces:** None — this task consumes the finished feature from Tasks 1 and 2 as a whole.

- [ ] **Step 1: Full production build**

Run: `SUPABASE_URL=https://placeholder.supabase.co SUPABASE_SERVICE_ROLE_KEY=placeholder npm run build`
Expected: build completes with no errors (the placeholder Supabase env vars are expected to produce caught/logged fetch errors for server-fetched data elsewhere in the app — that's normal and unrelated to this change; see any prior build in this repo's history for the expected pattern).

- [ ] **Step 2: Cross-cutting browser regression pass**

Using the chrome-devtools MCP tools against `npm run dev`, at both desktop and 390px-mobile viewports:
- Confirm the navbar's transparent-over-hero treatment still applies correctly when arriving at `/headshots`, `/creative-portraits`, and `/boudoir` via the new dropdown/accordion (these routes are already in `HERO_ROUTES` — this step confirms nothing in this change broke that).
- Confirm `/portraits` itself still renders its full combined gallery unchanged, including its existing in-page "View Headshots →" / "View Creative Portraits →" links.
- Confirm no console errors on any of the four routes touched (`/`, `/headshots`, `/creative-portraits`, `/boudoir`).

Stop the dev server when done.

- [ ] **Step 3: Push and verify production deploy**

```bash
git push
```

Poll `https://zkjfilms.com` until the new deployment is aliased (e.g. `vercel inspect https://zkjfilms.com --json` and compare `createdAt`/deployment id against the two commits just pushed), then confirm on the live site:
- The dropdown/accordion behaves as verified locally in Tasks 1 and 2.
- `vercel ls` shows the latest deployment as `Ready`, not `Error` (if it errors, check `vercel inspect <url> --logs` — see this repo's history for the kind of transient Google Fonts build failures that warrant a plain retry via `vercel deploy --prod` versus a real code issue).
