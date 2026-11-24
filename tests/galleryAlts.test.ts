import { describe, expect, it } from "vitest";
import {
  BOUDOIR_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS, HEADSHOTS_MASONRY_PHOTOS, MUSIC_MASONRY_PHOTOS,
} from "@/lib/masonryPhotos";
import { BOUDOIR_SERVICE } from "@/lib/services";

const galleries = {
  headshots: HEADSHOTS_MASONRY_PHOTOS,
  creativePortraits: CREATIVE_PORTRAITS_MASONRY_PHOTOS,
  boudoir: BOUDOIR_MASONRY_PHOTOS,
  music: MUSIC_MASONRY_PHOTOS,
};

describe("gallery alt text", () => {
  it.each(Object.entries(galleries))("%s: every photo has a unique, descriptive alt", (_name, photos) => {
    const alts = photos.map((p) => p.alt.trim());
    alts.forEach((a) => {
      expect(a.length).toBeGreaterThan(20);
      expect(a).not.toMatch(/image \d+$/i);
    });
    expect(new Set(alts).size).toBe(alts.length);
  });
  it("boudoir alts stay concise", () => {
    BOUDOIR_MASONRY_PHOTOS.forEach((p) => expect(p.alt.length).toBeLessThanOrEqual(160));
    expect(BOUDOIR_SERVICE.heroImageAlt.length).toBeLessThanOrEqual(160);
    expect(BOUDOIR_SERVICE.heroImageAlt).not.toBe("Fine art boudoir photography session in Columbia, Missouri.");
  });
});
