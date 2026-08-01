import { BUSINESS } from "@/lib/seo";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-6 py-14 text-center sm:flex-row sm:justify-between sm:px-10 sm:text-left">
        <p className="font-serif text-2xl italic text-foreground">Nocturne</p>
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted">
          &copy; {year} {BUSINESS.name}. All rights reserved.
        </p>
        <div className="flex items-center gap-6 text-[11px] uppercase tracking-[0.2em] text-muted">
          <a
            href={`mailto:${BUSINESS.email}`}
            className="transition-colors hover:text-foreground"
          >
            Email
          </a>
          <a
            href={BUSINESS.sameAs[0]}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-foreground"
          >
            Instagram
          </a>
        </div>
      </div>
    </footer>
  );
}
