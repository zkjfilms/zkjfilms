# Mobile navigation

## Context

`components/Navbar.tsx` has never had a responsive collapse — its 5 links
(Home, Portraits, About, Book, Contact) render as a single horizontal row
at every viewport width, with no `md:hidden`/hamburger anywhere in the
codebase. This is the fourth of five site-improvement items from the
original full-site review (placeholder data, FAQ, and service landing
pages are done; custom error/loading pages remain after this).

## Decisions made with the user

- **Nav scope stays at 5 links** — Home, Portraits, About, Book, Contact.
  `/faq` and the three service pages (`/headshots`, `/creative-portraits`,
  `/boudoir`) were deliberately kept off the navbar when they were built
  (specifically because mobile nav didn't exist yet); now that it does,
  the owner chose to keep the nav as-is rather than grow it to 8-9 links.
  `/portraits` remains the umbrella entry point to the service pages;
  `/faq` remains reachable from the footer and the `/book` teaser.
- **Menu pattern:** full-screen overlay. Tapping the toggle covers the
  full viewport with the 5 links, large and centered — matches the site's
  spare editorial aesthetic better than a dropdown panel or a slide-in
  drawer, and is the simplest to build (no slide/transform animation).
- **Toggle button:** a minimal inline SVG hamburger icon (three lines),
  morphing to an × when open. The site has zero icons anywhere else
  (purely typographic design), but a hamburger icon is a near-universal
  convention that doesn't need a new dependency (no icon library is
  installed in this project — confirmed via `package.json` and
  `node_modules`, despite an existing comment in `Footer.tsx` implying
  `lucide-react` was checked at some point; it isn't a dependency).
- **Breakpoint:** `md` (768px) — matches Tailwind's conventional
  mobile-nav collapse point and is already the codebase's most-used
  breakpoint alongside `sm`. Below `md`: hamburger toggle. At `md` and
  above: today's unchanged horizontal link row.
- **No new files, no new dependencies.** Everything stays in the existing
  `components/Navbar.tsx`.

## Architecture

All changes are contained in `components/Navbar.tsx`:

- A new `mobileMenuOpen` boolean state (`useState`), toggled by a button
  that only renders below `md` (`className="md:hidden"` on the button;
  the existing `<nav>` link row gets `hidden md:flex` added so it's
  hidden below `md` and shown at `md`+ exactly as today).
- The toggle button is an inline SVG (not a new icon dependency) that
  swaps between a three-line hamburger glyph and an × glyph based on
  `mobileMenuOpen`, using the same `scrolled`-driven color classes
  (`text-foreground` vs `text-white`) the logo and links already use, so
  it never looks out of place against a hero image or the solid header.
- When `mobileMenuOpen` is true, a full-screen overlay renders (fixed,
  covers the viewport, `bg-background`) at a z-index BELOW the header's
  existing `z-50` (e.g. `z-40`) — the header itself (logo + toggle button)
  keeps rendering on top of the overlay, unobscured, so the toggle stays
  visible and clickable to close the menu (via its × state) without
  needing a separate close control inside the overlay. The overlay shows
  the same 5 `links` array already defined in this file, large and
  centered; tapping any link closes the overlay (via the pathname-change
  effect below) in addition to navigating.
- Two `useEffect`s, both keyed off `usePathname()` (already imported and
  used for the hero-route logic):
  - Closes the overlay whenever the pathname changes — covers direct link
    taps, back/forward navigation, and any other route change, not just
    a manual click handler on each link.
  - Locks `document.body` scroll (`overflow: hidden`) while the overlay
    is open, restoring it on close/unmount — a standard full-screen
    overlay pattern, prevents the page from scrolling behind the menu.
- No changes to `HERO_ROUTES`, the `scrolled` calculation, or the
  scroll-listener effect that already exists — this is purely additive
  to the render output and one new piece of state.

## Testing

- Visual check at a mobile viewport width (e.g. browser devtools
  responsive mode, ~375px): hamburger icon visible, link row hidden, tap
  opens the full-screen overlay with all 5 links legible and tappable.
- Visual check: tapping a link in the overlay navigates AND closes the
  overlay (confirms the pathname-driven close effect works, not just a
  same-page no-op).
- Visual check: opening the overlay prevents background scroll; closing
  it restores normal scroll.
- Visual check at `md`+ width (e.g. ~1024px): hamburger never appears,
  link row renders exactly as it does today (no regression to desktop nav).
- Visual check: toggle button color still correctly switches between
  white (on a hero route, unscrolled) and dark (scrolled, or on a
  non-hero route) — same logic the logo/links already use.
