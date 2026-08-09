# Mobile Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a responsive mobile menu to `components/Navbar.tsx` — below `md` (768px), the horizontal link row is replaced by a hamburger toggle that opens a full-screen overlay with the same 5 links; at `md` and above, nothing changes.

**Architecture:** Single-file change. New `mobileMenuOpen` state drives a conditionally-rendered full-screen overlay (a sibling of the existing `<header>`, so the return statement now needs a `Fragment` wrapper) and swaps the visible toggle icon. Two new `useEffect`s (both keyed off the already-imported `usePathname()`) close the menu on navigation and lock body scroll while it's open.

**Tech Stack:** Next.js 16 App Router, React, TypeScript, Tailwind v4 — no new dependencies (no icon library exists in this project; the toggle is a plain inline SVG).

## Global Constraints

- Nav scope stays at exactly the current 5 links (Home, Portraits, About, Book, Contact) — this plan does not add `/faq` or the service pages to the nav.
- Breakpoint is `md` (768px), matching Tailwind's `md:` prefix already used elsewhere in this codebase.
- No new dependencies — the hamburger/× icon is a plain inline SVG using `stroke="currentColor"` so it inherits the button's existing color classes.
- "Morphing to an ×" means a plain conditional swap between two SVG glyphs (hamburger vs. X) based on state — not a CSS-animated icon transform. This codebase has no existing icon-animation precedent; a swap is sufficient and matches the site's `transition-colors`-only animation vocabulary.
- The overlay must include its own `md:hidden` (in addition to the toggle button's `md:hidden`) — this is a safety net for the edge case where a user opens the menu on mobile, then resizes/rotates to `md`+ width without a page reload (React state persists across the resize; without this, the overlay would keep covering the screen even though the desktop nav row is now visible underneath).
- No new ARIA dialog pattern (focus trapping, etc.) — out of scope, matches this codebase's existing accessibility effort level (basic semantic HTML, no existing dialog patterns to follow). Only `aria-label` and `aria-expanded` on the toggle button.
- This project has no test framework. Verification for this task requires actual browser interaction (clicking the toggle, resizing the viewport) — `curl` alone cannot verify client-side toggle behavior, since the initial server-rendered HTML doesn't reflect post-hydration state changes. Use the `claude-in-chrome` or `chrome-devtools` browser tools (or a real browser) for the interactive checks.

---

### Task 1: Add mobile menu state, toggle, and overlay to `Navbar.tsx`

**Files:**
- Modify: `components/Navbar.tsx` (whole file — shown in full below)

**Interfaces:**
- None — this is a self-contained UI change to a single component with no exports consumed elsewhere beyond the existing default export, which keeps the same signature (`export default function Navbar()`, no props).

- [ ] **Step 1: Replace `components/Navbar.tsx` in full**

Find (the entire current file):

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];

// Routes that open with a full-bleed hero image the navbar can float over.
// Every other route gets the solid navbar immediately — there's no image
// at the very top for transparent white text to sit on.
const HERO_ROUTES = new Set([
  "/",
  "/portraits",
  "/headshots",
  "/creative-portraits",
  "/boudoir",
]);

export default function Navbar() {
  const pathname = usePathname();
  const hasHero = HERO_ROUTES.has(pathname);
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const scrolled = !hasHero || scrolledPastHero;

  useEffect(() => {
    if (!hasHero) return;

    function onScroll() {
      setScrolledPastHero(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasHero]);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
        scrolled
          ? "border-b border-border bg-background/90 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
        <Link
          href="/"
          className={`font-serif text-xl italic tracking-wide transition-colors duration-500 ${
            scrolled ? "text-foreground" : "text-white"
          }`}
        >
          Zach K. Johnson
        </Link>
        <nav className="flex items-center gap-8 sm:gap-10">
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
      </div>
    </header>
  );
}
```

Replace with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];

// Routes that open with a full-bleed hero image the navbar can float over.
// Every other route gets the solid navbar immediately — there's no image
// at the very top for transparent white text to sit on.
const HERO_ROUTES = new Set([
  "/",
  "/portraits",
  "/headshots",
  "/creative-portraits",
  "/boudoir",
]);

function MenuIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <line x1="3" y1="3" x2="17" y2="17" />
        <line x1="17" y1="3" x2="3" y2="17" />
      </svg>
    );
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <line x1="2" y1="5" x2="18" y2="5" />
      <line x1="2" y1="10" x2="18" y2="10" />
      <line x1="2" y1="15" x2="18" y2="15" />
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const hasHero = HERO_ROUTES.has(pathname);
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const scrolled = !hasHero || scrolledPastHero;

  useEffect(() => {
    if (!hasHero) return;

    function onScroll() {
      setScrolledPastHero(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasHero]);

  // Close the mobile menu on any route change — covers direct link taps
  // as well as back/forward navigation.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Lock background scroll while the full-screen overlay is open.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
          scrolled
            ? "border-b border-border bg-background/90 backdrop-blur-md"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
          <Link
            href="/"
            className={`font-serif text-xl italic tracking-wide transition-colors duration-500 ${
              scrolled ? "text-foreground" : "text-white"
            }`}
          >
            Zach K. Johnson
          </Link>
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
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className={`transition-colors duration-500 md:hidden ${
              scrolled ? "text-foreground" : "text-white"
            }`}
          >
            <MenuIcon open={mobileMenuOpen} />
          </button>
        </div>
      </header>

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
    </>
  );
}
```

- [ ] **Step 2: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors or warnings.

- [ ] **Step 3: Interactive verification in a real browser**

Use the `claude-in-chrome` or `chrome-devtools` browser tools (load them via `ToolSearch` if deferred). Navigate to `http://localhost:3000/` (start `npm run dev` first if not already running), then:

1. Resize the viewport to a mobile width (e.g. 375px wide). Confirm: the horizontal link row is gone, a hamburger icon (☰) is visible in its place, top-right of the header.
2. Click/tap the hamburger icon. Confirm: it changes to an × icon, and a full-screen overlay appears showing all 5 links (Home, Portraits, About, Book, Contact), large and centered, on the site's cream background.
3. With the overlay open, try scrolling the page. Confirm: the background does not scroll (body scroll is locked).
4. Click one of the links in the overlay (e.g. "About"). Confirm: the browser navigates to that page AND the overlay closes automatically (you should land on `/about` with the overlay gone, hamburger icon showing again, not the × — since the effect resets state after the route change).
5. Click the hamburger icon again to open the overlay, then click the icon again (now showing ×) to close it without navigating. Confirm: the overlay closes and background scrolling is restored.
6. Resize the viewport back to a desktop width (e.g. 1280px wide). Confirm: the hamburger icon is gone, the original horizontal link row is visible and unchanged, and (if the overlay happened to still be open from a prior step) no full-screen overlay is showing at this width.
7. Scroll down on the homepage (`/`, a hero route) at a mobile viewport width and confirm the hamburger icon's color switches from white (over the hero image) to dark (once scrolled past it, matching the existing logo/link color-switch behavior).

Report what you observed for each of the 7 checks — do not just say "verified," describe what actually rendered/happened at each step.

- [ ] **Step 4: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add components/Navbar.tsx
git commit -m "Add mobile navigation: hamburger toggle + full-screen overlay below md"
```

---

## Final verification

- [ ] `npm run build` succeeds from a clean state.
- [ ] All 7 interactive checks from Task 1 Step 3 pass as described.
- [ ] Visual spot-check on 2-3 other pages (e.g. `/about`, `/contact`, `/faq`) at a mobile viewport width to confirm the hamburger/overlay behavior is consistent site-wide, not just on the homepage.
