"use client";

import { useEffect, useRef, useState } from "react";
import { PODCAST_LINKS } from "@/lib/podcastLinks";
import { CaretIcon } from "./icons";

const PLATFORMS: Array<{ label: string; href: string }> = [
  { label: "Apple Podcasts", href: PODCAST_LINKS.apple },
  { label: "Spotify", href: PODCAST_LINKS.spotify },
  { label: "RSS Feed", href: PODCAST_LINKS.rss },
];

export default function ListenOnMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 border border-foreground px-5 py-2.5 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
      >
        Listen On
        <CaretIcon open={open} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-2 min-w-[180px] border border-border bg-background py-2 shadow-sm">
          {PLATFORMS.map((p) => (
            <a
              key={p.label}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
            >
              {p.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
