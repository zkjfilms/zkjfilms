import { ROUTES, type RouteKey } from "@/content/pages";
import { BUSINESS, DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL, SOCIALS } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import { PODCAST_LINKS } from "@/lib/podcastLinks";
import type { PodcastShow } from "@/lib/podcast";

const CTX = "https://schema.org";
export const BUSINESS_ID = `${SITE_URL}/#business`;
const PERSON_ID = `${SITE_URL}/#zach`;

export function businessJsonLd(priceRange?: string | null): object {
  return {
    "@context": CTX,
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": BUSINESS_ID,
    name: BUSINESS.name,
    description: BUSINESS.description,
    url: SITE_URL,
    telephone: BUSINESS.telephone,
    email: BUSINESS.email,
    image: DEFAULT_OG_IMAGE.url,
    address: { "@type": "PostalAddress", ...BUSINESS.address },
    geo: { "@type": "GeoCoordinates", ...BUSINESS.geo },
    areaServed: BUSINESS.areaServed,
    sameAs: BUSINESS.sameAs,
    founder: { "@id": PERSON_ID },
    openingHoursSpecification: { "@type": "OpeningHoursSpecification", ...BUSINESS.hours },
    ...(priceRange ? { priceRange } : {}),
  };
}

export function breadcrumbJsonLd(key: RouteKey): object {
  const r = ROUTES[key];
  return {
    "@context": CTX,
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: r.title, item: `${SITE_URL}${r.path}` },
    ],
  };
}

export function serviceJsonLd(s: {
  name: string; description: string; path: string; image: string; startingPriceCents: number | null;
}): object {
  return {
    "@context": CTX,
    "@type": "Service",
    name: s.name,
    serviceType: s.name,
    description: s.description,
    url: `${SITE_URL}${s.path}`,
    image: s.image,
    provider: { "@id": BUSINESS_ID },
    areaServed: BUSINESS.areaServed,
    ...(s.startingPriceCents !== null
      ? { offers: { "@type": "Offer", price: (s.startingPriceCents / 100).toFixed(2), priceCurrency: "USD", url: `${SITE_URL}/book` } }
      : {}),
  };
}

export function personJsonLd(): object {
  return {
    "@context": CTX,
    "@type": "Person",
    "@id": PERSON_ID,
    name: SITE_NAME,
    jobTitle: "Photographer",
    url: `${SITE_URL}/about`,
    image: publicImageUrl("zach-medium.jpg"),
    worksFor: { "@id": BUSINESS_ID },
    sameAs: Object.values(SOCIALS),
    address: { "@type": "PostalAddress", addressLocality: BUSINESS.address.addressLocality, addressRegion: BUSINESS.address.addressRegion, addressCountry: BUSINESS.address.addressCountry },
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]): object {
  return {
    "@context": CTX,
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

export function podcastJsonLd(show: PodcastShow): object {
  return {
    "@context": CTX,
    "@type": "PodcastSeries",
    name: show.title,
    description: show.description,
    image: show.imageUrl || undefined,
    url: `${SITE_URL}/podcast`,
    webFeed: PODCAST_LINKS.rss,
    author: { "@id": PERSON_ID, "@type": "Person", name: SITE_NAME },
    hasPart: show.episodes.map((episode) => ({
      "@type": "PodcastEpisode",
      name: episode.title,
      datePublished: episode.pubDate,
      url: episode.link || PODCAST_LINKS.rss,
      associatedMedia: { "@type": "MediaObject", contentUrl: episode.audioUrl },
    })),
  };
}

export function videoJsonLd(v: {
  title: string; description: string | null; posterUrl: string; contentUrl: string; uploadDate: string;
}): object {
  return {
    "@context": CTX,
    "@type": "VideoObject",
    name: v.title,
    description: v.description || v.title,
    thumbnailUrl: [v.posterUrl],
    contentUrl: v.contentUrl,
    uploadDate: v.uploadDate,
    publisher: { "@id": BUSINESS_ID },
  };
}
