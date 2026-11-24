import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { getPodcastShow } from "@/lib/podcast";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, podcastJsonLd } from "@/lib/jsonLd";
import PodcastExperience from "@/components/podcast/PodcastExperience";

// Sourced from an external RSS feed + YouTube playlist that change
// out-of-band (new episodes, edited playlist) — revalidate periodically so
// they show up without a redeploy. Matches app/films/page.tsx / app/faq.
export const revalidate = 300;

export function generateMetadata(): Metadata {
  return pageMetadata("podcast");
}

export default async function PodcastPage() {
  const show = await getPodcastShow();

  return (
    <>
      <JsonLd data={[show ? podcastJsonLd(show) : null, breadcrumbJsonLd("podcast")]} />

      <PodcastExperience show={show} />
    </>
  );
}
