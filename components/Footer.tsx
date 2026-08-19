import Link from "next/link";
import { BUSINESS, SOCIALS } from "@/lib/seo";

// lucide-react has no brand/logo icons at all (confirmed against the
// installed package — it's a generic icon set, not a brand-icon library
// like Simple Icons). Every platform here falls back to a text link.
const SOCIAL_LINKS: Array<{ label: string; href: string }> = [
  { label: "Instagram", href: SOCIALS.instagram },
  { label: "YouTube", href: SOCIALS.youtube },
  { label: "Apple Music", href: SOCIALS.appleMusic },
  { label: "Facebook", href: SOCIALS.facebook },
  { label: "Vimeo", href: SOCIALS.vimeo },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-6xl px-6 sm:px-10">
        {/* Top bar */}
        <div className="flex flex-col items-center gap-6 border-b border-border py-8 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="font-serif text-2xl italic text-foreground transition-colors hover:text-accent"
          >
            Zach K. Johnson
          </Link>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:gap-6">
            <span className="text-[11px] uppercase tracking-[0.3em] text-muted">
              Follow Me
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
              {SOCIAL_LINKS.map(({ label, href }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] uppercase tracking-[0.15em] text-muted transition-colors hover:text-accent"
                >
                  {label}
                </a>
              ))}
            </div>
          </div>
        </div>

        {/* Three columns */}
        <div className="grid grid-cols-1 gap-12 py-14 sm:grid-cols-3 sm:gap-10">
          <div>
            <p className="text-sm leading-relaxed text-muted">
              <Link
                href="/"
                className="font-semibold text-foreground transition-colors hover:text-accent"
              >
                Zach K. Johnson
              </Link>{" "}
              is a portrait, boudoir, and fine art{" "}
              <em className="font-serif italic text-foreground">
                photographer
              </em>{" "}
              based in Columbia, Missouri, offering creative portrait
              sessions, headshots, boudoir photography, and fine
              art/editorial work for clients across Mid-Missouri.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">
              Columbia Missouri Photography Studio
            </p>
            <div className="mt-4 space-y-2 text-sm">
              <a
                href="https://www.google.com/maps/dir/?api=1&destination=2101+W+Broadway+Ave+Suite+208+Columbia+MO+65203"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
              >
                2101 W Broadway Ave, Suite 208, Columbia, MO 65203
              </a>
              <a
                href={`mailto:${BUSINESS.email}`}
                className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
              >
                {BUSINESS.email}
              </a>
              <a
                href={`tel:${BUSINESS.telephone.replace(/[^0-9+]/g, "")}`}
                className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
              >
                (901) 483-2391
              </a>
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-muted">
              Studio Hours
            </p>
            <p className="mt-4 text-sm text-foreground">
              Friday&ndash;Sunday, 10 AM&ndash;5 PM (every other week)
            </p>

            <p className="mt-6 text-xs uppercase tracking-[0.3em] text-muted">
              Booking
            </p>
            <Link
              href="/book"
              className="mt-3 inline-block text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
            >
              Click Here to View Availability &amp; Book
            </Link>
            <Link
              href="/faq"
              className="mt-2 block text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
            >
              Frequently Asked Questions
            </Link>
          </div>
        </div>

        {/* Bottom */}
        <p className="border-t border-border py-8 text-center text-[11px] uppercase tracking-[0.3em] text-muted">
          &copy;{" "}
          <Link href="/" className="transition-colors hover:text-accent">
            Zach K. Johnson
          </Link>{" "}
          {year}
        </p>
      </div>
    </footer>
  );
}
