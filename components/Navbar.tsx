"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];

const PORTRAITS_SUBLINKS = [
  { href: "/headshots", label: "Headshots" },
  { href: "/creative-portraits", label: "Creative Portraits" },
  { href: "/boudoir", label: "Boudoir" },
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
  const [portraitsDropdownOpen, setPortraitsDropdownOpen] = useState(false);
  const portraitsRef = useRef<HTMLDivElement>(null);
  const scrolled = !hasHero || scrolledPastHero;
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

  // Close the mobile menu on any route change — covers direct link taps
  // as well as back/forward navigation.
  useEffect(() => {
    setMobileMenuOpen(false);
    setPortraitsDropdownOpen(false);
  }, [pathname]);

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
