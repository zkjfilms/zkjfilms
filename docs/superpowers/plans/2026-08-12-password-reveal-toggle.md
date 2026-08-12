# Sitewide Password Reveal Toggle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a click-to-toggle "show password" eye-icon button to all 3 password screens on zkjfilms.com (gallery unlock, admin sign-in, age-gated boudoir section), via one shared `PasswordField` component, so a person can confirm what they typed before submitting.

**Architecture:** A single new client component, `components/PasswordField.tsx`, replaces the near-identical `<label>`/`<input type="password">` markup currently duplicated across `app/gallery/[slug]/GalleryGate.tsx`, `app/admin/AdminGate.tsx`, and `app/gated/GateScreen.tsx`. It takes a `variant: "dark" | "light"` prop to reproduce each screen's existing colors exactly, and holds its own local reveal-state so nothing else in any of the three files changes.

**Tech Stack:** React (function component, `"use state"` client component), Tailwind CSS (utility classes matching existing site conventions), inline SVG icons (no icon library dependency, matching the site's existing hand-rolled nav icons).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-12-password-reveal-toggle-design.md`.
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, a full production build (`npm run build`), and manual in-browser checks on all 3 screens — the same pattern used for prior UI work in this repo (see `docs/superpowers/specs/2026-08-11-portraits-nav-dropdown-design.md`'s Testing/Verification section).
- The reveal button must never submit the form (`type="button"`), must not change any submit/error/API logic in the 3 consumer files, and must default to hidden with no persistence across remounts.
- `variant="dark"` reproduces `GalleryGate`/`GateScreen`'s existing classes exactly: label `text-background/50`, input `border-background/20 text-background`, focus `focus:border-accent`. `variant="light"` reproduces `AdminGate`'s existing classes exactly: label `text-muted`, input `border-border text-foreground`, focus `focus:border-accent`.

---

## Task 1: `PasswordField` component and its 3 integrations

**Files:**
- Create: `components/PasswordField.tsx`
- Modify: `app/gallery/[slug]/GalleryGate.tsx:305-324` (variant `"dark"`)
- Modify: `app/gated/GateScreen.tsx:62-81` (variant `"dark"`)
- Modify: `app/admin/AdminGate.tsx:54-73` (variant `"light"`)

**Interfaces:**
- Produces: `export default function PasswordField({ id, value, onChange, variant }: { id: string; value: string; onChange: (value: string) => void; variant: "dark" | "light" }): JSX.Element` — a drop-in replacement for a `<label>`+`<input type="password">` pair, imported as `import PasswordField from "@/components/PasswordField";`.

This is one task (not split further) because `PasswordField` has no independent, browser-verifiable behavior until it's wired into at least one real screen — splitting "build the component" from "integrate it" would leave the first half unreviewable and the second half three trivial, tightly-coupled markup swaps.

- [ ] **Step 1: Create `components/PasswordField.tsx`**

```tsx
"use client";

import { useState } from "react";

type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variant: "dark" | "light";
};

const VARIANT_CLASSES = {
  dark: {
    label: "text-background/50",
    input: "border-background/20 text-background",
    icon: "text-background/50 hover:text-background",
  },
  light: {
    label: "text-muted",
    input: "border-border text-foreground",
    icon: "text-muted hover:text-foreground",
  },
} as const;

export default function PasswordField({
  id,
  value,
  onChange,
  variant,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const classes = VARIANT_CLASSES[variant];

  return (
    <div>
      <label
        htmlFor={id}
        className={`block text-xs uppercase tracking-[0.15em] ${classes.label}`}
      >
        Password
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border-b bg-transparent py-2 pr-8 outline-none transition-colors focus:border-accent ${classes.input}`}
        />
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-label={revealed ? "Hide password" : "Show password"}
          aria-pressed={revealed}
          className={`absolute right-0 top-1/2 -translate-y-1/2 transition-colors ${classes.icon}`}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
```

- [ ] **Step 2: Run `tsc --noEmit` to confirm the new file compiles standalone**

Run: `npx tsc --noEmit`
Expected: no errors referencing `components/PasswordField.tsx` (errors elsewhere in the codebase unrelated to this file, if any, are pre-existing and out of scope — note them but don't fix them).

- [ ] **Step 3: Integrate into `app/gallery/[slug]/GalleryGate.tsx`**

Add the import alongside the existing imports at the top of the file (after the `GalleryLightbox` import):

```tsx
import GalleryLightbox from "./GalleryLightbox";
import PasswordField from "@/components/PasswordField";
```

Replace this exact block (lines 306-324):

```tsx
          <div>
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-[0.15em] text-background/50"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              className="mt-2 w-full border-b border-background/20 bg-transparent py-2 text-background outline-none transition-colors focus:border-accent"
            />
          </div>
```

with:

```tsx
          <PasswordField
            id="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError("");
            }}
            variant="dark"
          />
```

- [ ] **Step 4: Integrate into `app/gated/GateScreen.tsx`**

Add the import alongside the existing imports at the top of the file (after the `useRouter` import):

```tsx
import { useRouter } from "next/navigation";
import PasswordField from "@/components/PasswordField";
```

Replace this exact block (lines 63-81):

```tsx
          <div>
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-[0.15em] text-background/50"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              className="mt-2 w-full border-b border-background/20 bg-transparent py-2 text-background outline-none transition-colors focus:border-accent"
            />
          </div>
```

with:

```tsx
          <PasswordField
            id="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError("");
            }}
            variant="dark"
          />
```

- [ ] **Step 5: Integrate into `app/admin/AdminGate.tsx`**

Add the import alongside the existing imports at the top of the file (after the `useRouter` import):

```tsx
import { useRouter } from "next/navigation";
import PasswordField from "@/components/PasswordField";
```

Replace this exact block (lines 55-73):

```tsx
        <div>
          <label
            htmlFor="password"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
          />
        </div>
```

with:

```tsx
        <PasswordField
          id="password"
          value={password}
          onChange={(value) => {
            setPassword(value);
            setError("");
          }}
          variant="light"
        />
```

- [ ] **Step 6: Run `tsc --noEmit` and a full production build**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors (pre-existing, unrelated errors/warnings elsewhere in the codebase — if any — are out of scope for this task; note them in the report but don't fix them).

- [ ] **Step 7: Manually verify in the browser on all 3 screens**

Start the dev server (`npm run dev`) and check each of:

- `/admin` (while signed out) — `variant="light"`.
- `/gated` — `variant="dark"`.
- `/gallery/<any-existing-slug>` while locked (e.g. `/gallery/andi`, or create a scratch gallery with `npm run gallery:create` if none exists, and clean it up afterward with `npm run gallery:delete -- <slug> --yes`) — `variant="dark"`.

On each screen:
- Confirm the password field renders masked by default, colors matching the screen's existing look exactly (no visible variant mismatch).
- Type a password, click the eye icon: confirm the typed text becomes visible as plain text and the icon swaps to the "hide" (eye-with-slash) state.
- Click again: confirm it re-masks and the icon swaps back.
- Confirm clicking the icon does not submit the form (no loading state, no navigation, no API call — check the network tab or the button's own `Checking…`/`Signing…` state stays untouched).
- Tab to the eye button with the keyboard and press Enter or Space: confirm it toggles the same as a click.
- Submit with the correct/incorrect password on at least one screen and confirm the existing success/error behavior is unchanged.

- [ ] **Step 8: Commit**

```bash
git add components/PasswordField.tsx app/gallery/\[slug\]/GalleryGate.tsx app/gated/GateScreen.tsx app/admin/AdminGate.tsx
git commit -m "Add click-to-reveal toggle to all 3 sitewide password fields"
```
