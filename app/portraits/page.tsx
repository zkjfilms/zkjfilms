import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import Gallery, {
  type GalleryGroup,
  type GalleryImage,
} from "@/components/Gallery";
import { HEADSHOTS_GALLERY, CREATIVE_PORTRAITS_GALLERY } from "@/lib/services";

const TITLE = "Portrait & Boudoir Gallery";
const DESCRIPTION =
  "Browse portrait, headshot, boudoir, and fine art photography from a Columbia, Missouri photographer serving clients throughout Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/portraits",
  });
}

// Alt text below is placeholder copy targeting local SEO keywords —
// replace with real per-image descriptions once final photos are added.
const editorialImages: GalleryImage[] = [
  {
    seed: "nocturne-portrait-06",
    index: 1,
    alt: "Editorial fine art photography shot in Columbia, Missouri",
  },
  {
    seed: "nocturne-portrait-07",
    index: 2,
    alt: "Narrative fine art portrait session in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-08",
    index: 3,
    alt: "Painterly fine art photography by Zach K. Johnson, Columbia, MO",
  },
];

const editorialGroup: GalleryGroup = {
  title: "Editorial & Fine Art",
  description:
    "Selected work from ongoing personal and collaborative projects, shot with a narrative or painterly sensibility.",
  blocks: [
    { type: "pair", items: [editorialImages[0], editorialImages[1]] },
    { type: "single", items: [editorialImages[2]] },
  ],
};

export default function PortraitsPage() {
  return (
    <div className="flex flex-col">
      {/* Opening */}
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src="https://picsum.photos/seed/nocturne-portrait-00/1800/1200"
          alt="Columbia, Missouri portrait and creative photography session — Zach K. Johnson"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            Selected Work
          </p>
          <h1 className="max-w-xl font-serif text-4xl italic leading-tight text-white sm:text-5xl md:text-6xl">
            The work
          </h1>
        </div>
      </section>

      <p className="mx-auto max-w-2xl px-6 py-16 text-center text-muted sm:px-10">
        A collection of portrait and creative photography sessions shot in
        and around Columbia, Missouri &mdash; headshots, individual
        portraits, and collaborative creative work. Each session is built
        around the person in front of the camera, not a formula. Below is a
        look at the range: clean and professional when that&rsquo;s the
        goal, textured and cinematic when it&rsquo;s not.
      </p>

      {/* Gallery */}
      <Gallery groups={[HEADSHOTS_GALLERY]} />
      <div className="mx-auto -mt-12 mb-12 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/headshots"
          className="text-xs uppercase tracking-[0.2em] text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
        >
          View Headshots &rarr;
        </Link>
      </div>

      <Gallery groups={[CREATIVE_PORTRAITS_GALLERY]} />
      <div className="mx-auto -mt-12 mb-12 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/creative-portraits"
          className="text-xs uppercase tracking-[0.2em] text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
        >
          View Creative Portraits &rarr;
        </Link>
      </div>

      <Gallery groups={[editorialGroup]} />

      <div className="mx-auto -mt-12 mb-24 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/contact#booking"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book a Portrait Session
        </Link>
      </div>
    </div>
  );
}
