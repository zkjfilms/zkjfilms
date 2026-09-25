import Image from "next/image";

// A real, already-hosted photo. width/height are the source file's
// intrinsic dimensions so next/image can reserve the right aspect ratio
// without cropping.
export type MasonryImage = {
  src: string;
  width: number;
  height: number;
  alt: string;
};

export type GalleryBlock = { type: "masonry"; items: MasonryImage[] };

export type GalleryGroup = {
  title: string;
  description: string;
  blocks: GalleryBlock[];
};

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
          </div>

          {group.blocks.map((block, blockIndex) => (
            <div
              key={blockIndex}
              className="columns-2 gap-3 px-3 sm:columns-3 lg:columns-4"
            >
              {block.items.map((item) => (
                <div
                  key={item.src}
                  className="group relative mb-3 break-inside-avoid overflow-hidden bg-surface"
                >
                  <Image
                    src={item.src}
                    alt={item.alt}
                    width={item.width}
                    height={item.height}
                    className="w-full transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                    sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
