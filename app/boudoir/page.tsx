import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import AgeGate from "@/components/AgeGate";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { BOUDOIR_SERVICE } from "@/lib/services";
import type { GalleryGroup, MasonryImage } from "@/components/Gallery";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Boudoir & Fine Art Nude",
    description:
      "Fine art boudoir and nude photography in Columbia, Missouri — intimate sessions built around trust, privacy, and what you're comfortable with.",
    path: "/boudoir",
  });
}

// Only client-approved, publicly-releasable images belong here — add new
// ones with `npm run image:upload -- <file> boudoir/gallery/<file>` (real
// dimensions are printed for you to paste in) and append the {key, width,
// height} below. Uploaded to the R2 public bucket rather than committed to
// git — see lib/media.ts — since this gallery has grown to 300+ MB of
// full-res exports, which would otherwise bloat the repo permanently.
const BOUDOIR_GALLERY_PHOTOS: { key: string; width: number; height: number }[] = [
  { key: "boudoir/gallery/Andi-8968138.jpg", width: 3880, height: 5831 },
  { key: "boudoir/gallery/TRA_2561-Edit.jpg", width: 5753, height: 3828 },
  { key: "boudoir/gallery/TRA_2576-Edit.jpg", width: 6048, height: 4024 },
  { key: "boudoir/gallery/TRA_2579-Edit.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/TRA_2587-Edit.jpg", width: 3450, height: 2295 },
  { key: "boudoir/gallery/TRA_2590-Edit.jpg", width: 3718, height: 2474 },
  { key: "boudoir/gallery/TRA_2602-Edit.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-27571.jpg", width: 5693, height: 3788 },
  { key: "boudoir/gallery/anon-28741.jpg", width: 4912, height: 3268 },
  { key: "boudoir/gallery/anon-29111.jpg", width: 5309, height: 3532 },
  { key: "boudoir/gallery/anon-44911.jpg", width: 5186, height: 3450 },
  { key: "boudoir/gallery/anon-45931.jpg", width: 3807, height: 5722 },
  { key: "boudoir/gallery/anon-46001.jpg", width: 5762, height: 3834 },
  { key: "boudoir/gallery/anon-46661.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-47071.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-47161.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon-47291.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon1.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon10.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon11.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon13.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon15.jpg", width: 1587, height: 2380 },
  { key: "boudoir/gallery/anon2.jpg", width: 6048, height: 4024 },
  { key: "boudoir/gallery/anon3.jpg", width: 5380, height: 3580 },
  { key: "boudoir/gallery/anon4.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon5.jpg", width: 6048, height: 4024 },
  { key: "boudoir/gallery/anon6.jpg", width: 3884, height: 5838 },
  { key: "boudoir/gallery/anon7.jpg", width: 4024, height: 6048 },
  { key: "boudoir/gallery/anon9.jpg", width: 3092, height: 4647 },
];

// Filenames come in per-session batches (e.g. "Andi-8968138.jpg",
// "anon-27571.jpg", "anon13.jpg") — stripping the extension and any
// trailing digits groups files back into their original shoot, which in
// practice means one subject per group.
function sessionKey(key: string): string {
  return key.replace(/\.\w+$/, "").replace(/\d+$/, "");
}

// Round-robins across session groups so consecutive images in the
// masonry grid come from different shoots/subjects instead of one
// session's photos all landing next to each other.
function interleaveBySession<T extends { key: string }>(photos: T[]): T[] {
  const groups = new Map<string, T[]>();
  for (const photo of photos) {
    const sKey = sessionKey(photo.key);
    const group = groups.get(sKey);
    if (group) group.push(photo);
    else groups.set(sKey, [photo]);
  }

  const queues = Array.from(groups.values());
  const result: T[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    for (const queue of queues) {
      const next = queue.shift();
      if (next !== undefined) {
        result.push(next);
        remaining = true;
      }
    }
  }
  return result;
}

// Alt text is intentionally generic (no client names or identifying
// detail), same as every other boudoir touchpoint on this site — the
// vision model also declines to describe boudoir/nude content in any more
// specific terms, so a real per-photo description isn't an option anyway.
function loadBoudoirGallery(): GalleryGroup | null {
  if (BOUDOIR_GALLERY_PHOTOS.length === 0) return null;

  const items: MasonryImage[] = interleaveBySession(BOUDOIR_GALLERY_PHOTOS).map(
    (photo, i) => ({
      src: publicImageUrl(photo.key),
      width: photo.width,
      height: photo.height,
      alt: `Fine art boudoir photography session in Columbia, Missouri — image ${i + 1}`,
    }),
  );

  return {
    title: "Selected Work",
    description:
      "A selection of client-approved sessions. Every image here was shared with explicit permission — most work stays private.",
    blocks: [{ type: "masonry", items }],
  };
}

export default function BoudoirPage() {
  const extraGallery = loadBoudoirGallery();
  return (
    <>
      <AgeGate />
      <ServiceLandingPage service={BOUDOIR_SERVICE} extraGallery={extraGallery} />
    </>
  );
}
