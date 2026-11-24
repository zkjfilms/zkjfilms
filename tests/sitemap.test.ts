import { describe, expect, it } from "vitest";
import { buildSitemap } from "@/lib/sitemapEntries";
import { ROUTES } from "@/content/pages";
import { SITE_URL } from "@/lib/seo";

describe("buildSitemap", () => {
  it("omits /films when there are no films and has no fake static lastModified", () => {
    const s = buildSitemap({ filmsState: "none", filmsLastModified: null, podcastLastModified: null });
    expect(s.map((e) => e.url)).not.toContain(`${SITE_URL}/films`);
    expect(s.every((e) => e.lastModified === undefined)).toBe(true);
    expect(s).toHaveLength(Object.keys(ROUTES).length - 1);
  });
  it("includes /films and podcast with their real dates when known", () => {
    const s = buildSitemap({ filmsState: "some", filmsLastModified: "2026-10-01T00:00:00Z", podcastLastModified: "2026-11-01T00:00:00Z" });
    expect(s.find((e) => e.url === `${SITE_URL}/films`)?.lastModified).toBe("2026-10-01T00:00:00Z");
    expect(s.find((e) => e.url === `${SITE_URL}/podcast`)?.lastModified).toBe("2026-11-01T00:00:00Z");
  });
  it("uses absolute URLs with the home page at the root", () => {
    const s = buildSitemap({ filmsState: "none", filmsLastModified: null, podcastLastModified: null });
    expect(s[0].url).toBe(`${SITE_URL}/`);
    expect(s.every((e) => e.url.startsWith(SITE_URL))).toBe(true);
  });
  it("keeps /films without lastModified when the films query failed", () => {
    const s = buildSitemap({ filmsState: "unknown", filmsLastModified: null, podcastLastModified: null });
    const films = s.find((e) => e.url === `${SITE_URL}/films`);
    expect(films).toBeDefined();
    expect(films?.lastModified).toBeUndefined();
  });
});
