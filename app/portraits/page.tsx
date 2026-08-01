import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

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

type GalleryImage = { seed: string; index: number; alt: string };

// Alt text below is placeholder copy targeting local SEO keywords —
// replace with real per-image descriptions once final photos are added.
const images: GalleryImage[] = [
  {
    seed: "nocturne-portrait-01",
    index: 1,
    alt: "Professional headshot session in Columbia, Missouri",
  },
  {
    seed: "nocturne-portrait-02",
    index: 2,
    alt: "Business branding portrait photographed in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-03",
    index: 3,
    alt: "Art-directed creative portrait session in Columbia, MO",
  },
  {
    seed: "nocturne-portrait-04",
    index: 4,
    alt: "Styled creative portrait photography in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-05",
    index: 5,
    alt: "Concept-driven portrait session by a Columbia, Missouri photographer",
  },
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

type Block =
  | { type: "single"; items: [GalleryImage] }
  | { type: "pair"; items: [GalleryImage, GalleryImage] };

type Group = {
  title: string;
  description: string;
  blocks: Block[];
};

const groups: Group[] = [
  {
    title: "Headshots & Branding",
    description:
      "Professional portraits for people who need to show up polished: LinkedIn, business branding, personal websites, and professional profiles.",
    blocks: [
      { type: "single", items: [images[0]] },
      { type: "single", items: [images[1]] },
    ],
  },
  {
    title: "Creative Portraits",
    description:
      "More personal, more art-directed. Lighting, styling, and concept-driven sessions for people who want something beyond a standard portrait.",
    blocks: [
      { type: "pair", items: [images[2], images[3]] },
      { type: "single", items: [images[4]] },
    ],
  },
  {
    title: "Editorial & Fine Art",
    description:
      "Selected work from ongoing personal and collaborative projects, shot with a narrative or painterly sensibility.",
    blocks: [
      { type: "pair", items: [images[5], images[6]] },
      { type: "single", items: [images[7]] },
    ],
  },
];

function Caption({ index }: { index: number }) {
  return (
    <span className="absolute bottom-6 left-6 text-[11px] uppercase tracking-[0.3em] text-white/80 sm:left-10">
      {String(index).padStart(2, "0")}
    </span>
  );
}

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
      <div className="flex flex-col pb-24">
        {groups.map((group) => (
          <div key={group.title} className="flex flex-col gap-3 pb-3">
            <div className="mx-auto w-full max-w-2xl px-6 py-10 text-center sm:px-10">
              <h2 className="font-serif text-2xl italic text-foreground sm:text-3xl">
                {group.title}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
                {group.description}
              </p>
            </div>

            {group.blocks.map((block, blockIndex) =>
              block.type === "single" ? (
                <div
                  key={blockIndex}
                  className="group relative h-[80vh] w-full overflow-hidden bg-surface"
                >
                  <Image
                    src={`https://picsum.photos/seed/${block.items[0].seed}/1600/1400`}
                    alt={block.items[0].alt}
                    fill
                    className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    sizes="100vw"
                  />
                  <Caption index={block.items[0].index} />
                </div>
              ) : (
                <div
                  key={blockIndex}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                >
                  {block.items.map((item) => (
                    <div
                      key={item.seed}
                      className="group relative h-[60vh] overflow-hidden bg-surface sm:h-[70vh]"
                    >
                      <Image
                        src={`https://picsum.photos/seed/${item.seed}/1200/1400`}
                        alt={item.alt}
                        fill
                        className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                        sizes="(min-width: 640px) 50vw, 100vw"
                      />
                      <Caption index={item.index} />
                    </div>
                  ))}
                </div>
              ),
            )}
          </div>
        ))}
      </div>

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
