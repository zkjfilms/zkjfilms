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
    function closeMenu() {
      setMobileMenuOpen(false);
    }
    closeMenu();
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
