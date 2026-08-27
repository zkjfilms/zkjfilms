"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { LATE_NIGHT_LISTENING_URL } from "@/lib/seo";

const links = [
  { href: "/", label: "Home" },
  { href: "/photos", label: "Photos" },
  { href: "/films", label: "Films" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: LATE_NIGHT_LISTENING_URL, label: "Events" },
  { href: "/book", label: "Book" },
];

const PHOTOS_SUBLINKS = [
  { href: "/creative-portraits", label: "Creative Portraits" },
  { href: "/boudoir", label: "Boudoir" },
  { href: "/music", label: "Music" },
  { href: "/headshots", label: "Headshots" },
];

// Unlike Photos (which has its own overview page plus separate category
// links), Films has no content of its own beyond the dropdown — its own
// page is listed as a dropdown option alongside Podcast, so the parent nav
// item is dropdown-only (see DROPDOWN_ONLY below) rather than a direct link.
const FILMS_SUBLINKS = [
  { href: "/films", label: "Films" },
  { href: "/podcast", label: "Podcast" },
];

// Keyed by the parent link's href — any link with an entry here renders
// with a dropdown caret instead of as a plain link.
const DROPDOWNS: Record<string, { href: string; label: string }[]> = {
  "/photos": PHOTOS_SUBLINKS,
  "/films": FILMS_SUBLINKS,
};

// Parent links in this set render as a dropdown trigger only — no direct
// navigation from the top-level label, since the destination itself is one
// of the dropdown options.
const DROPDOWN_ONLY = new Set(["/films"]);

const DROPDOWN_ARIA_LABEL: Record<string, string> = {
  "/photos": "Show photo categories",
  "/films": "Show films menu",
};

// Routes that open with a full-bleed hero image the navbar can float over.
// Every other route gets the solid navbar immediately — there's no image
// at the very top for transparent white text to sit on.
const HERO_ROUTES = new Set([
  "/",
  "/photos",
  "/headshots",
  "/creative-portraits",
  "/boudoir",
  "/music",
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

export default function Navbar() {
  const pathname = usePathname();
  const hasHero = HERO_ROUTES.has(pathname);
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Which dropdown (keyed by parent link href) is currently open — only one
  // at a time, desktop and mobile share the same key space.
  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const dropdownRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [mobileAccordionOpen, setMobileAccordionOpen] = useState<string | null>(null);
  const scrolled = !hasHero || scrolledPastHero;

  // Close the mobile menu on any route change — covers direct link taps
  // as well as back/forward navigation. Adjusting state during render
  // (rather than in an effect) avoids the extra post-navigation paint
  // where the stale menu would otherwise still be visible.
  // See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
    setOpenDropdown(null);
  }
  // The overlay always renders on the light `bg-background`, so the header
  // content needs the dark/foreground treatment whenever it's open — even
  // on an unscrolled hero route where the header itself stays transparent.
  const solidHeader = scrolled || mobileMenuOpen;

  useEffect(() => {
    if (!hasHero) return;

    function onScroll() {
      setScrolledPastHero(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasHero]);

  // Lock background scroll while the full-screen overlay is open, and let
  // Escape close it as a defense-in-depth affordance.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  // The desktop dropdown gets its own Escape/outside-click handling,
  // independent of the mobile menu's — it doesn't need a scroll lock.
  useEffect(() => {
    if (!openDropdown) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenDropdown(null);
    }
    function onClickOutside(e: MouseEvent) {
      const el = openDropdown ? dropdownRefs.current[openDropdown] : null;
      if (el && !el.contains(e.target as Node)) {
        setOpenDropdown(null);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [openDropdown]);

  // The overlay is hidden at md+ purely via CSS (`md:hidden`); if the
  // viewport crosses that breakpoint while it's open (e.g. rotating a
  // phone, or resizing a desktop window), reset the state so the scroll
  // lock above doesn't get stuck on with no visible control left to undo it.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const mq = window.matchMedia("(min-width: 768px)");
    function onChange() {
      if (mq.matches) setMobileMenuOpen(false);
    }
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mobileMenuOpen]);

  // Reset the accordion every time the mobile menu itself closes, so
  // reopening it never shows a stale expanded state.
  const [prevMobileMenuOpen, setPrevMobileMenuOpen] = useState(mobileMenuOpen);
  if (mobileMenuOpen !== prevMobileMenuOpen) {
    setPrevMobileMenuOpen(mobileMenuOpen);
    if (!mobileMenuOpen) setMobileAccordionOpen(null);
  }

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
              solidHeader ? "text-foreground" : "text-white"
            }`}
          >
            Zach K. Johnson
          </Link>
          <nav className="hidden items-center gap-8 sm:gap-10 md:flex">
            {links.map((link) => {
              const linkClass = `text-[11px] uppercase tracking-[0.2em] transition-colors duration-500 ${
                scrolled
                  ? "text-muted hover:text-foreground"
                  : "text-white/80 hover:text-white"
              }`;

              if (link.href === "/book") {
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="rounded-sm bg-accent px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-white transition-colors duration-300 hover:bg-accent/90"
                  >
                    {link.label}
                  </Link>
                );
              }

              const sublinks = DROPDOWNS[link.href];
              if (!sublinks) {
                return (
                  <Link key={link.href} href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                );
              }

              const isOpen = openDropdown === link.href;
              const dropdownOnly = DROPDOWN_ONLY.has(link.href);

              return (
                <div
                  key={link.href}
                  ref={(el) => {
                    dropdownRefs.current[link.href] = el;
                  }}
                  className="relative flex items-center gap-1.5"
                  onMouseEnter={() => {
                    if (window.matchMedia("(hover: hover)").matches) {
                      setOpenDropdown(link.href);
                    }
                  }}
                  onMouseLeave={() => setOpenDropdown(null)}
                >
                  {dropdownOnly ? (
                    <button
                      type="button"
                      onClick={() => setOpenDropdown((open) => (open === link.href ? null : link.href))}
                      aria-expanded={isOpen}
                      aria-haspopup="true"
                      aria-label={DROPDOWN_ARIA_LABEL[link.href]}
                      className={`${linkClass} flex items-center gap-1.5`}
                    >
                      {link.label}
                      <CaretIcon open={isOpen} />
                    </button>
                  ) : (
                    <>
                      <Link href={link.href} className={linkClass}>
                        {link.label}
                      </Link>
                      <button
                        type="button"
                        onClick={() => setOpenDropdown((open) => (open === link.href ? null : link.href))}
                        aria-expanded={isOpen}
                        aria-label={DROPDOWN_ARIA_LABEL[link.href]}
                        className={`${linkClass} p-2 -my-2 -mr-2`}
                      >
                        <CaretIcon open={isOpen} />
                      </button>
                    </>
                  )}
                  {isOpen && (
                    <div className="absolute top-full left-0 pt-2">
                      <div className="min-w-[180px] border border-border bg-background/95 py-2 backdrop-blur-md">
                        {sublinks.map((sub) => (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            className="block px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
                          >
                            {sub.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className={`p-2 -m-2 transition-colors duration-500 md:hidden ${
              solidHeader ? "text-foreground" : "text-white"
            }`}
          >
            <MenuIcon open={mobileMenuOpen} />
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-background md:hidden">
          {links.map((link) => {
            if (link.href === "/book") {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="rounded-sm bg-accent px-6 py-3 text-lg uppercase tracking-[0.2em] text-white transition-colors hover:bg-accent/90"
                >
                  {link.label}
                </Link>
              );
            }

            const sublinks = DROPDOWNS[link.href];
            if (!sublinks) {
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

            const isOpen = mobileAccordionOpen === link.href;
            const dropdownOnly = DROPDOWN_ONLY.has(link.href);

            return (
              <div key={link.href} className="flex flex-col items-center gap-6">
                {dropdownOnly ? (
                  <button
                    type="button"
                    onClick={() => setMobileAccordionOpen((open) => (open === link.href ? null : link.href))}
                    aria-expanded={isOpen}
                    aria-haspopup="true"
                    className="flex items-center gap-2 text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
                  >
                    {link.label}
                    <CaretIcon open={isOpen} />
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <Link
                      href={link.href}
                      className="text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
                    >
                      {link.label}
                    </Link>
                    <button
                      type="button"
                      onClick={() => setMobileAccordionOpen((open) => (open === link.href ? null : link.href))}
                      aria-expanded={isOpen}
                      aria-label={DROPDOWN_ARIA_LABEL[link.href]}
                      className="text-foreground p-3 -my-3 -mr-3"
                    >
                      <CaretIcon open={isOpen} />
                    </button>
                  </div>
                )}
                {isOpen && (
                  <div className="flex flex-col items-center gap-5">
                    {sublinks.map((sub) => (
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
    </>
  );
}
