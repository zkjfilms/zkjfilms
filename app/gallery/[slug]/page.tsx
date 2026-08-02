import type { Metadata } from "next";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabase";
import GalleryGate from "./GalleryGate";

// Client galleries are private — never indexed, and disallowed in
// robots.ts too, as defense in depth if a link is ever shared publicly.
export function generateMetadata(): Metadata {
  return {
    title: "Private Gallery",
    robots: {
      index: false,
      follow: false,
    },
  };
}

function isGalleryExpired(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() < Date.now();
}

function GalleryNotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Private Gallery
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        Gallery not found
      </h1>
      <p className="mt-4 text-muted">
        This link doesn&rsquo;t match an active gallery. Double-check the
        link, or get in touch if you think this is a mistake.
      </p>
      <Link
        href="/"
        className="mt-8 border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
      >
        Back to main site
      </Link>
    </div>
  );
}

function GalleryExpired({ title }: { title: string }) {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        {title}
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        Gallery has expired
      </h1>
      <p className="mt-4 text-muted">
        This gallery&rsquo;s access window has closed. Get in touch if
        you&rsquo;d like access renewed.
      </p>
      <Link
        href="/contact"
        className="mt-8 border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
      >
        Contact
      </Link>
    </div>
  );
}

export default async function GalleryPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const supabase = getSupabaseClient();
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("slug, title, expires_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
  }

  if (!gallery) {
    return <GalleryNotFound />;
  }

  if (isGalleryExpired(gallery.expires_at)) {
    return <GalleryExpired title={gallery.title} />;
  }

  return <GalleryGate slug={gallery.slug} title={gallery.title} />;
}
