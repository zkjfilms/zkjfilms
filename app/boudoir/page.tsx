import { readdir } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { imageSizeFromFile } from "image-size/fromFile";
import { buildPageMetadata } from "@/lib/seo";
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

const IMAGE_DIR = path.join(process.cwd(), "public/images/boudoir");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

// Filenames come in per-session batches (e.g. "Andi-8968138.jpg",
// "anon-27571.jpg", "anon13.jpg") — stripping the extension and any
// trailing digits groups files back into their original shoot, which in
// practice means one subject per group.
function sessionKey(file: string): string {
  return file.replace(/\.\w+$/, "").replace(/\d+$/, "");
}

// Round-robins across session groups so consecutive images in the
// masonry grid come from different shoots/subjects instead of one
// session's photos all landing next to each other.
function interleaveBySession(files: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const file of files) {
    const key = sessionKey(file);
    const group = groups.get(key);
    if (group) group.push(file);
    else groups.set(key, [file]);
  }

  const queues = Array.from(groups.values());
  const result: string[] = [];
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

// Only client-approved, publicly-releasable images belong in
// public/images/boudoir/ — drop files there to have them appear here.
// Alt text is intentionally generic (no client names or identifying
// detail) even though filenames aren't scrubbed for you.
async function loadBoudoirGallery(): Promise<GalleryGroup | null> {
  let entries: string[];
  try {
    entries = await readdir(IMAGE_DIR);
  } catch {
    return null;
  }

  const sorted = entries
    .filter((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()))
    .sort();
  const files = interleaveBySession(sorted);

  if (files.length === 0) return null;

  const items: MasonryImage[] = await Promise.all(
    files.map(async (file, i) => {
      const { width, height } = await imageSizeFromFile(
        path.join(IMAGE_DIR, file),
      );
      return {
        src: `/images/boudoir/${file}`,
        width: width ?? 1200,
        height: height ?? 1500,
        alt: `Fine art boudoir photography session in Columbia, Missouri — image ${i + 1}`,
      };
    }),
  );

  return {
    title: "Selected Work",
    description:
      "A selection of client-approved sessions. Every image here was shared with explicit permission — most work stays private.",
    blocks: [{ type: "masonry", items }],
  };
}

export default async function BoudoirPage() {
  const extraGallery = await loadBoudoirGallery();
  return (
    <>
      <AgeGate />
      <ServiceLandingPage service={BOUDOIR_SERVICE} extraGallery={extraGallery} />
    </>
  );
}
