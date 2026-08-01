"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/portraits", label: "Portraits" },
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
];

// Routes that open with a full-bleed hero image the navbar can float over.
// Every other route gets the solid navbar immediately — there's no image
// at the very top for transparent white text to sit on.
const HERO_ROUTES = new Set(["/", "/portraits"]);

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
