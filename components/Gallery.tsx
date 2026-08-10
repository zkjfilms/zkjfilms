import Image from "next/image";
import Link from "next/link";

// src is optional: when set (a real uploaded photo, see lib/media.ts), it's
// used instead of the picsum.photos placeholder built from seed. seed stays
// required either way — it's also the React key for pair blocks below.
export type GalleryImage = { seed: string; index: number; alt: string; src?: string };

export type GalleryBlock =
  | { type: "single"; items: [GalleryImage] }
  | { type: "pair"; items: [GalleryImage, GalleryImage] };

export type GalleryGroup = {
  title: string;
  description: string;
  link?: { href: string; label: string };
  blocks: GalleryBlock[];
};

function Caption({ index }: { index: number }) {
  return (
    <span className="absolute bottom-6 left-6 text-[11px] uppercase tracking-[0.3em] text-white/80 sm:left-10">
      {String(index).padStart(2, "0")}
    </span>
  );
}

export default function Gallery({ groups }: { groups: GalleryGroup[] }) {
  return (
    <div className="flex flex-col pb-24">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-3 pb-3">
          <div className="mx-auto w-full max-w-2xl px-6 py-10 text-center sm:px-10">
            <h2 className="font-serif text-2xl italic text-foreground sm:text-3xl">
              {group.title}
            </h2>
            {group.description && (
              <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted">
                {group.description}
              </p>
            )}
            {group.link && (
              <p className="mt-4">
                <Link
                  href={group.link.href}
                  className="text-xs uppercase tracking-[0.2em] text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
                >
                  {group.link.label}
                </Link>
              </p>
            )}
          </div>

          {group.blocks.map((block, blockIndex) =>
            block.type === "single" ? (
              <div
                key={blockIndex}
                className="group relative h-[80vh] w-full overflow-hidden bg-surface"
              >
                <Image
                  src={block.items[0].src ?? `https://picsum.photos/seed/${block.items[0].seed}/1600/1400`}
                  alt={block.items[0].alt}
                  fill
                  quality={90}
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
                      src={item.src ?? `https://picsum.photos/seed/${item.seed}/1200/1400`}
                      alt={item.alt}
                      fill
                      quality={90}
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
  );
}
