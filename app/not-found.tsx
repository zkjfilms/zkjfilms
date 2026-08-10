import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Page Not Found",
    description: "The page you're looking for doesn't exist.",
  });
}

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-20 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        404
      </p>
      <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
        Out of <span className="text-accent">frame</span>.
      </h1>
      <p className="mt-5 text-muted">
        The page you&apos;re looking for doesn&apos;t exist &mdash; maybe it
        moved, maybe it was never there. Let&apos;s get you back to
        something real.
      </p>
      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
        <Link
          href="/"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Back to Home
        </Link>
        <Link
          href="/portraits"
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
        >
          Browse the Portfolio
        </Link>
      </div>
    </div>
  );
}
