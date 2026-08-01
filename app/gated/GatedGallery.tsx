import Gallery, { type GalleryGroup } from "@/components/Gallery";

// Placeholder seeds/copy only — swap the images below for real work once
// it's ready. Structure mirrors the public /portraits gallery via the
// shared Gallery component.
const groups: GalleryGroup[] = [
  {
    title: "Private Collection",
    description:
      "This gallery is being prepared. Real images will replace these placeholders.",
    blocks: [
      {
        type: "single",
        items: [
          {
            seed: "gated-preview-01",
            index: 1,
            alt: "Placeholder image — private gallery",
          },
        ],
      },
      {
        type: "pair",
        items: [
          {
            seed: "gated-preview-02",
            index: 2,
            alt: "Placeholder image — private gallery",
          },
          {
            seed: "gated-preview-03",
            index: 3,
            alt: "Placeholder image — private gallery",
          },
        ],
      },
      {
        type: "single",
        items: [
          {
            seed: "gated-preview-04",
            index: 4,
            alt: "Placeholder image — private gallery",
          },
        ],
      },
    ],
  },
];

export default function GatedGallery() {
  return (
    <div className="flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 pb-4 pt-20 text-center sm:px-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Private Gallery
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          Thank you.
        </h1>
        <p className="mt-4 text-sm text-muted">
          You&rsquo;re in. This is placeholder content — real images will
          replace these once the gallery is ready.
        </p>
      </div>

      <Gallery groups={groups} />
    </div>
  );
}
