# Custom error and loading pages

## Context

The site currently falls back to Next.js's bare default UI for 404s,
runtime errors, and loading states — no `not-found.tsx`, `error.tsx`, or
`loading.tsx` exist anywhere in `app/`. This is the fifth and final item
from the original full-site review (placeholder data, FAQ, service
landing pages, and mobile nav are all done).

This Next.js version (16.2.12) has real breaking changes from what
training data typically assumes, confirmed by reading
`node_modules/next/dist/docs/` before designing this:

- `app/not-found.tsx` and `app/error.tsx` both render **inside** the
  existing root layout (`app/layout.tsx`) — the `Navbar`/`Footer` render
  automatically around them, exactly like a normal page. This is
  different from treating them as fully bare, standalone documents.
- `error.tsx` is a **Client Component boundary** (required by React error
  boundaries) and receives an `unstable_retry()` function as its
  recommended recovery API — not the `reset()` prop from older Next.js
  versions (which still exists but the docs now say to prefer
  `unstable_retry()`).
- A **separate** `global-error.tsx` exists specifically to catch errors
  thrown by the root layout itself (e.g. `Navbar.tsx`/`Footer.tsx`
  crashing) — it must define its own bare `<html>`/`<body>` and does NOT
  inherit global styles/fonts automatically. The owner explicitly chose
  not to build this (see below) — root-layout crashes are rare, and it
  would need bespoke bare-bones styling that doesn't reuse the site's
  normal setup.
- 404s handled by `not-found.tsx` automatically get a `noindex` meta tag
  injected by Next.js — no manual SEO handling needed.

## Decisions made with the user

- **Scope: exactly 3 files** — `not-found.tsx`, `error.tsx`,
  `loading.tsx`. No `global-error.tsx` (see above).
- **404 tone: on-brand and a little playful**, matching the site's
  existing editorial voice (e.g. the homepage's "Portraits, uncovered.").
- **Error page tone: reassuring, not playful** — deliberately a different
  register from the 404. A broken page is a different experience than a
  missing one, and this could be hit mid-booking/mid-payment, so it stays
  calm and straightforward rather than cute.
- **Loading state: minimal, no spinner graphic** — matches the site's
  existing icon-free design language (confirmed during the mobile-nav
  work: zero icons/graphics anywhere on the site, purely typographic).
  Just centered pulsing text. No per-route skeleton screens — this is a
  single general-purpose fallback, not bespoke loading UI per page.
- **No new error-tracking service** — `error.tsx` logs via
  `console.error` only (captured in Vercel's existing function logs),
  matching this project's current scope (no Sentry or similar anywhere
  else in the codebase).

## Content

All copy below is final.

### `app/not-found.tsx`

- Small uppercase label: "404"
- H1 (serif italic, matching every other page's header pattern): "Out of
  frame."
- Body: "The page you're looking for doesn't exist — maybe it moved,
  maybe it was never there. Let's get you back to something real."
- Primary CTA (button, matches the existing `border-foreground` button
  style used on `/book`, `/faq`, etc.): "Back to Home" → `/`
- Secondary CTA (text link): "Browse the Portfolio" → `/portraits`

### `app/error.tsx`

- H1 (serif italic): "Something went wrong."
- Body: "That wasn't supposed to happen. Try again, or reach out directly
  if it keeps happening."
- Primary CTA (button): "Try Again" → calls `unstable_retry()`
- Secondary CTA (text link): "Contact" → `/contact`
- `console.error(error)` inside a `useEffect`, matching the Next.js docs'
  own example pattern for this file.

### `app/loading.tsx`

- Centered, small uppercase-tracked text reading "Loading" with Tailwind's
  built-in `animate-pulse` utility (no custom animation/CSS needed).

## Architecture

- All three files live directly at `app/not-found.tsx`, `app/error.tsx`,
  `app/loading.tsx` — no new components, no new directories. Each is
  small enough to be fully self-contained (matching the plain-page
  pattern already used by e.g. `app/book/page.tsx`).
- `not-found.tsx` is a Server Component (the default) using
  `buildPageMetadata()` from `lib/seo.ts` for its `<title>`/description,
  exactly like every other page in this codebase. It does NOT need to
  manually add `noindex` — Next.js injects that automatically for any
  response that resolves to a 404.
- `error.tsx` must start with `"use client"` (React error boundary
  requirement) and therefore cannot export `metadata`/`generateMetadata` —
  this is a Next.js/React constraint, not an oversight. It receives
  `{ error, unstable_retry }` as props (typed `error: Error & { digest?:
  string }`, `unstable_retry: () => void`), per the current Next.js API.
- `loading.tsx` is a Server Component, no props, no metadata (it's a
  transient Suspense fallback, not a real page).
- All three reuse the exact same Tailwind design tokens and typographic
  patterns already established across the site (`font-serif italic` for
  headings, `text-muted` for body copy, `border-foreground` buttons,
  `text-accent` hover states, the `text-xs uppercase tracking-[0.3em]
  text-muted` label style used on every other page's header) — no new
  visual patterns introduced.
- Content area for `not-found.tsx` and `error.tsx` is vertically centered
  within the space between the fixed navbar and the footer (e.g. a
  `min-h-[60vh]` flex container), since unlike normal pages these have no
  natural top-anchored content to fill the viewport with.

## Out of scope

- `global-error.tsx` (explicitly deferred, see Decisions above).
- Any error-tracking/reporting service integration.
- Per-route loading skeletons (only one general `app/loading.tsx`).
- Any change to existing pages' own error handling (e.g. the booking
  flow's existing inline error states in `SlotList.tsx` etc. are
  untouched — this is about the Next.js file-convention fallbacks only).

## Testing

- Visual check: navigate to a nonexistent URL (e.g. `/this-does-not-exist`)
  and confirm the 404 page renders with the Navbar/Footer intact, correct
  copy, and both CTAs working.
- Visual check: confirm the 404 response includes a `noindex` meta tag
  (via view-source or a `curl` + `grep` check).
- Visual check: temporarily trigger a thrown error in a test page (or use
  React DevTools' error-boundary toggle) to confirm `error.tsx` renders
  with the Navbar/Footer intact, and that clicking "Try Again" attempts
  recovery without a full page reload.
- Visual check: throttle network speed and navigate to a dynamic route
  (e.g. `/gallery/[slug]` or an admin page) to confirm `loading.tsx`
  renders as the Suspense fallback during the transition.
- `npm run build` succeeds with no new route/type errors.
