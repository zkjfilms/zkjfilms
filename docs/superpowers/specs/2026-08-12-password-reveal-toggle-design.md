# Sitewide Password Reveal Toggle

## Problem

Three separate screens each render their own copy of a masked password `<label>`/`<input type="password">` block: `app/gallery/[slug]/GalleryGate.tsx` (client gallery unlock), `app/admin/AdminGate.tsx` (admin sign-in), and `app/gated/GateScreen.tsx` (age-gated boudoir section). None of them let the person typing check what they entered before submitting — a mistyped gallery password or admin password just bounces back as "Incorrect password" with no way to see what was actually typed.

## Goal

Add a reveal toggle to all three password inputs so a person can confirm what they typed before submitting, without the password being visible by default or persisting visibility across screens.

## Design

### `components/PasswordField.tsx` (new)

A `"use client"` component replacing the duplicated label/input markup in all three files:

```tsx
type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variant: "dark" | "light";
};
```

- Renders the existing "Password" label, the input, and an eye-icon toggle button absolutely positioned inside the input's wrapper (right-aligned, vertically centered), matching the site's existing bottom-border-only input style (no boxed border).
- `variant="dark"` reproduces the exact classes currently used by `GalleryGate` and `GateScreen` (both full-screen overlays on `bg-foreground`): label `text-background/50`, input `border-background/20 text-background`, focus `border-accent`.
- `variant="light"` reproduces `AdminGate`'s classes (light page background): label `text-muted`, input `border-border text-foreground`, focus `border-accent`.
- `autoComplete="off"` is baked into the component (all three callers already passed the same value).
- Local `useState<boolean>` tracks reveal state, toggling the input's `type` between `"password"` and `"text"` on click of the eye button. State lives only inside `PasswordField`, so it resets to hidden whenever the component remounts (fresh page load, or the gate unmounting after a successful unlock) — no explicit reset logic needed.
- The toggle button: `type="button"` (never submits the form), `aria-label` switching between `"Show password"` / `"Hide password"`, `aria-pressed={revealed}`. Icon is an inline SVG matching the site's existing thin-stroke style (`strokeWidth="1.5"`, no fill — same family as the nav's caret/hamburger icons): an open-eye glyph when hidden, an eye-with-slash glyph when revealed.

### Integration

Each of the three files drops its existing `<div><label>...</label><input type="password" .../></div>` block and replaces it with:

```tsx
<PasswordField
  id="password"
  value={password}
  onChange={(v) => { setPassword(v); setError(""); }}
  variant="dark" // "light" in AdminGate.tsx
/>
```

`value`/`onChange` wiring is otherwise unchanged — each file keeps its own `useState<string>` for the password and its own submit handler. No change to any API route (`/api/gallery-access`, `/api/admin-access`, `/api/gated-access`), error handling, or submit-button behavior.

### Out of scope

- The PIN-based access feature mentioned separately — a distinct follow-up project, not part of this change.
- A "copy password" button — not requested.
- Any change to non-password inputs (there are no other password-type or password-adjacent fields sitewide).
- Persisting reveal state across page loads or between the three screens — each screen's toggle is independent and always starts hidden.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- Manual, in-browser, on each of the three screens (`/gallery/<slug>` while locked, `/admin` while signed out, `/gated`):
  - Confirm the password is masked by default.
  - Type a password, click the eye icon, confirm the typed text becomes visible and the icon swaps to the "hide" state.
  - Click again, confirm it re-masks.
  - Confirm clicking the icon does not submit the form (no navigation/loading state triggered).
  - Confirm the existing submit flow (correct password unlocks, incorrect password shows the existing error message) is unchanged.
  - Confirm each screen's colors are pixel-consistent with before this change (no variant mismatch — `AdminGate` uses `variant="light"`, the other two use `variant="dark"`).
  - Confirm keyboard-only use: tabbing to the eye button and pressing Enter/Space toggles it, same as a click.
