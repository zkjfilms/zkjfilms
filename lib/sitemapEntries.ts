import type { MetadataRoute } from "next";
import { ROUTES, type RouteKey } from "@/content/pages";
import { SITE_URL } from "@/lib/seo";

// Static pages carry no lastModified: a build-time date on every URL
// teaches Google to ignore the field. Only pages with a real content date
// (films, podcast) report one. /films is omitted while it has no films.
export function buildSitemap(input: {
  // "none": table genuinely empty (omit /films). "unknown": query failed
  // (keep /films, no date). "some": filmsLastModified is the newest created_at.
  filmsState: "none" | "some" | "unknown";
  filmsLastModified: string | null;
  podcastLastModified: string | null;
}): MetadataRoute.Sitemap {
  return (Object.keys(ROUTES) as RouteKey[])
    .filter((key) => key !== "films" || input.filmsState !== "none")
    .map((key) => {
      const r = ROUTES[key];
      const lastModified =
        key === "films" ? input.filmsLastModified : key === "podcast" ? input.podcastLastModified : null;
      return {
        url: `${SITE_URL}${r.path || "/"}`,
        changeFrequency: r.changeFrequency,
        priority: r.priority,
        ...(lastModified ? { lastModified } : {}),
      };
    });
}
