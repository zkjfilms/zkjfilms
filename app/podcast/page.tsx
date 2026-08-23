import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { getPodcastShow, PODCAST_LINKS } from "@/lib/podcast";
import PodcastExperience from "@/components/podcast/PodcastExperience";

// Sourced from an external RSS feed + YouTube playlist that change
// out-of-band (new episodes, edited playlist) — revalidate periodically so
// they show up without a redeploy. Matches app/films/page.tsx / app/faq.
export const revalidate = 300;

const TITLE = "What Comes Next — Podcast";
const DESCRIPTION =
  "What Comes Next is a series by filmmaker Zach K. Johnson featuring guests speaking in their own words about how life has shaped who they are today.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/podcast",
  });
}

export default async function PodcastPage() {
  const show = await getPodcastShow();

  const jsonLd = show
    ? {
        "@context": "https://schema.org",
        "@type": "PodcastSeries",
        name: show.title,
        description: show.description,
        image: show.imageUrl || undefined,
        url: "https://zkjfilms.com/podcast",
        webFeed: PODCAST_LINKS.rss,
        author: { "@type": "Person", name: "Zach K. Johnson" },
        hasPart: show.episodes.map((episode) => ({
          "@type": "PodcastEpisode",
          name: episode.title,
          datePublished: episode.pubDate,
          url: episode.link || PODCAST_LINKS.rss,
          associatedMedia: {
            "@type": "MediaObject",
            contentUrl: episode.audioUrl,
          },
        })),
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <PodcastExperience show={show} />
    </>
  );
}
