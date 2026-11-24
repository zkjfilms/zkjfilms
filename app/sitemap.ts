import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/sitemapEntries";
import { getFilms } from "@/lib/films";
import { getPodcastShow } from "@/lib/podcast";

// Revalidate so a newly added film/episode reaches the sitemap without a deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ films }, show] = await Promise.all([
    getFilms().catch(() => ({ films: [], error: true })),
    getPodcastShow().catch(() => null),
  ]);
  const newestFilm = films.map((f) => f.created_at).sort().at(-1) ?? null;
  const newestEpisode = show?.episodes.map((e) => e.pubDate).sort().at(-1) ?? null;
  return buildSitemap({ filmsLastModified: newestFilm, podcastLastModified: newestEpisode });
}
