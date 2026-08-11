# Portraits Nav Dropdown

## Problem

`/portraits` is a combined gallery (headshots + creative portraits + editorial/fine art) that links out to the standalone `/headshots` and `/creative-portraits` pages via small "View Headshots →" / "View Creative Portraits →" links buried inside its gallery groups. `/boudoir` exists as a standalone page too (no gallery — intentionally, given the privacy handling called out in the FAQ) but isn't linked from `/portraits` at all. None of these three category pages are discoverable from the site-wide nav — a visitor has to land on `/portraits` and scroll through the whole combined gallery to find them.

## Goal

Add a dropdown under "Portraits" in the site-wide `Navbar` linking directly to Headshots, Creative Portraits, and Boudoir, so visitors can jump to a category from any page. No new gallery pages — all three destinations already exist.

## Design

### Data

A dedicated constant in `components/Navbar.tsx`, not a generalized multi-level nav data shape (only one nav item needs children):

```ts
const PORTRAITS_SUBLINKS = [
  { href: "/headshots", label: "Headshots" },
  { href: "/creative-portraits", label: "Creative Portraits" },
  { href: "/boudoir", label: "Boudoir" },
];
```

The existing `links` array (Home, Portraits, About, Book, Contact) and its `.map()` rendering are untouched for every entry except "Portraits", which is special-cased in both the desktop `<nav>` and the mobile overlay.

### Desktop behavior

"Portraits" keeps its existing `<Link href="/portraits">` — clicking the word still navigates to the combined gallery, unchanged. A small caret button sits next to it inside a `relative`-positioned wrapper `<div>`:

- **Hover** over the wrapper opens the dropdown (`onMouseEnter`/`onMouseLeave`).
- **Click** on the caret toggles it open/closed — covers touch and keyboard users, who can't hover.
- The dropdown panel is `absolute top-full left-0 mt-2`, styled `bg-background/95 backdrop-blur-md border border-border`, containing the three `PORTRAITS_SUBLINKS` stacked vertically, styled identically to the top-level nav links (`text-[11px] uppercase tracking-[0.2em]`).

New state: `portraitsDropdownOpen`. Closes on:
- **Route change** — extend the existing `useEffect(() => setMobileMenuOpen(false), [pathname])` to also reset this.
- **Escape key** — extend the existing keydown handler (currently only active while `mobileMenuOpen`; the new listener condition covers either menu being open).
- **Click outside** — new behavior (the mobile menu is full-screen and doesn't need this today). Standard `ref` + `document` click-listener pattern, checking whether the click target is outside the wrapper `div`.

The caret button gets `aria-expanded={portraitsDropdownOpen}` and `aria-label="Show portrait categories"` — a disclosure-widget pattern, matching how the existing mobile hamburger button is already done. No ARIA `menu`/`menuitem` roles; those are for roving-tabindex app menus, which this isn't.

### Mobile behavior

Inside the full-screen overlay, the "Portraits" entry grows the same caret button next to its `<Link>`. Tapping it expands the three sublinks inline underneath (accordion-style), reusing the overlay's existing centered vertical stack — sublinks rendered smaller/muted (`text-sm text-muted`) than the top-level links (`text-lg text-foreground`) to show hierarchy.

New state: `mobileAccordionOpen`. Resets to closed whenever `mobileMenuOpen` transitions to `false` (a small `useEffect` watching `mobileMenuOpen`) — so reopening the mobile menu never shows a stale expanded accordion. Tapping a sublink navigates and closes the whole mobile menu via the existing route-change-close effect, same as every other mobile nav link today.

### Styling notes

Caret icon reuses the existing thin-stroke (`strokeWidth="1.5"`, no fill) SVG style already established by `MenuIcon`, sized to sit comfortably next to the 11px-tracked nav text. It rotates 180° via a CSS transition when open, matching the transform-based feel already used elsewhere on the site (the mobile hamburger swaps to an X rather than rotating, but a simple rotate is the more standard affordance for a disclosure caret and doesn't need to match that specific icon's behavior).

### Out of scope

- No new gallery pages — Headshots, Creative Portraits, and Boudoir already exist as standalone routes.
- No change to `HERO_ROUTES` — `/headshots`, `/creative-portraits`, `/boudoir` are already in that set, so the navbar's transparent-over-hero treatment already applies correctly when visitors land on them via the dropdown.
- No change to the "Editorial & Fine Art" section of `/portraits` — it stays as a section within the combined gallery only, not a dropdown entry (explicitly decided during brainstorming).
- No changes to `/portraits`'s existing in-page "View Headshots →" / "View Creative Portraits →" links — the dropdown is additive, not a replacement for those.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- Desktop (browser, real viewport, not just DOM inspection): hovering "Portraits" opens the dropdown; clicking the caret toggles it; clicking a sublink navigates to the right page and the dropdown is gone on arrival; clicking elsewhere on the page closes it; Escape closes it while open.
- Mobile (390px emulated viewport): open the hamburger menu, tap the "Portraits" caret to expand the accordion, confirm all three sublinks are visible and correctly styled, tap one and confirm it navigates and the full mobile menu closes.
- Confirm Home/About/Book/Contact links are visually and functionally unchanged on both breakpoints.
- Confirm the navbar's transparent-over-hero treatment still applies correctly on `/headshots`, `/creative-portraits`, and `/boudoir` when reached via the new dropdown.
