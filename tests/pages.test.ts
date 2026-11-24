import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, type RouteKey } from "@/content/pages";
import { buildPageMetadata, fullTitle, pageMetadata, SITE_URL } from "@/lib/seo";

const entries = Object.entries(ROUTES) as [RouteKey, (typeof ROUTES)[RouteKey]][];

describe("ROUTES", () => {
  it.each(entries)("%s title fits in 60 chars with the site suffix", (key) => {
    expect(fullTitle(key).length).toBeLessThanOrEqual(60);
  });
  it.each(entries)("%s non-home title is ≤ 42 chars", (key, r) => {
    if (!r.absoluteTitle) expect(r.title.length).toBeLessThanOrEqual(42);
  });
  it.each(entries)("%s description is 50–155 chars", (_k, r) => {
    expect(r.description.length).toBeGreaterThanOrEqual(50);
    expect(r.description.length).toBeLessThanOrEqual(155);
  });
  it("paths are unique and each has a page file", () => {
    const paths = entries.map(([, r]) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) {
      const file = path.resolve(__dirname, "../app", `.${p}`, "page.tsx");
      expect(existsSync(file), file).toBe(true);
    }
  });
});

describe("metadata", () => {
  it("home uses an absolute title and canonical root", () => {
    const m = pageMetadata("home");
    expect(m.title).toEqual({ absolute: ROUTES.home.title });
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/`);
  });
  it("non-home pages get canonical + OG url and the full title in OG", () => {
    const m = pageMetadata("headshots");
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/headshots`);
    expect((m.openGraph as { url: string }).url).toBe(`${SITE_URL}/headshots`);
    expect((m.openGraph as { title: string }).title).toBe(fullTitle("headshots"));
  });
  it("an explicit image overrides the default OG image", () => {
    const img = { url: "https://img.example/a.jpg", width: 10, height: 10, alt: "A test image" };
    const m = buildPageMetadata({ title: "T", description: "D", path: "/x", image: img });
    expect((m.openGraph as { images: unknown[] }).images[0]).toEqual(img);
    expect((m.twitter as { images: string[] }).images[0]).toBe(img.url);
  });
});
