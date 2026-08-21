import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import Gallery, {
  type GalleryGroup,
  type GalleryImage,
} from "@/components/Gallery";
import {
  HEADSHOTS_GALLERY,
  CREATIVE_PORTRAITS_GALLERY,
  MUSIC_GALLERY,
} from "@/lib/services";

const TITLE = "Photography Gallery";
const DESCRIPTION =
  "Browse portrait, headshot, boudoir, concert, and fine art photography from a Columbia, Missouri photographer serving clients throughout Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/photos",
  });
}

// Alt text below is placeholder copy targeting local SEO keywords —
// replace with real per-image descriptions once final photos are added.
const editorialImages: GalleryImage[] = [
  {
    seed: "nocturne-portrait-06",
    index: 6,
    alt: "Editorial fine art photography shot in Columbia, Missouri",
  },
  {
    seed: "nocturne-portrait-07",
    index: 7,
    alt: "Narrative fine art portrait session in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-08",
    index: 8,
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

// HEADSHOTS_GALLERY/CREATIVE_PORTRAITS_GALLERY/MUSIC_GALLERY are shared with
// their own standalone pages, where each gallery numbers its own captions
// starting at 1. On this page every group shares one continuous sequence,
// so their captions are renumbered here at render time — the shared
// lib/services.ts data itself is never mutated (spread copies only), so the
// standalone pages are unaffected.
function renumberGroup(group: GalleryGroup, startIndex: number): GalleryGroup {
  let counter = startIndex;
  return {
    ...group,
    blocks: group.blocks.map((block) =>
      block.type === "single"
        ? { type: "single" as const, items: [{ ...block.items[0], index: counter++ }] as [GalleryImage] }
        : {
            type: "pair" as const,
            items: [
              { ...block.items[0], index: counter++ },
              { ...block.items[1], index: counter++ },
            ] as [GalleryImage, GalleryImage],
          },
    ),
  };
}

const headshotsGroup: GalleryGroup = {
  ...renumberGroup(HEADSHOTS_GALLERY, 1),
  link: { href: "/headshots", label: "View Headshots →" },
};

const creativePortraitsGroup: GalleryGroup = {
  ...renumberGroup(CREATIVE_PORTRAITS_GALLERY, 3),
  link: { href: "/creative-portraits", label: "View Creative Portraits →" },
};

// Placed after editorialGroup (whose indices 6-8 are hand-written above,
// not dynamically renumbered) so editorialGroup's own numbering never has
// to shift.
const musicGroup: GalleryGroup = {
  ...renumberGroup(MUSIC_GALLERY, 9),
  link: { href: "/music", label: "View Music →" },
};

export default function PhotosPage() {
  return (
    <div className="flex flex-col">
      {/* Opening */}
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src="https://picsum.photos/seed/nocturne-portrait-00/1800/1200"
          alt="Columbia, Missouri portrait, concert, and creative photography — Zach K. Johnson"
          fill
          priority
          quality={90}
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
        A collection of stills shot in and around Columbia, Missouri &mdash;
        headshots, individual portraits, collaborative creative work, and
        live concert and performance photography. Each session is built
        around what&rsquo;s in front of the camera, not a formula. Below is a
        look at the range: clean and professional when that&rsquo;s the
        goal, textured and cinematic when it&rsquo;s not, and full of raw
        energy on stage.
      </p>

      {/* Gallery */}
      <Gallery groups={[headshotsGroup, creativePortraitsGroup, editorialGroup, musicGroup]} />

      <div className="mx-auto -mt-12 mb-24 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/contact#booking"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book a Session
        </Link>
      </div>
    </div>
  );
}
