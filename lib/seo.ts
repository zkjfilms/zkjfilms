// Central place for site-wide SEO/business constants used by metadata,
// JSON-LD structured data, robots.ts, and sitemap.ts.
//
// TODO: every value marked PLACEHOLDER below is fake and must be replaced
// with real business details before launch.

import type { Metadata } from "next";

export const SITE_URL = "https://nocturnestudio.example"; // PLACEHOLDER domain

export const SITE_NAME = "Nocturne Studio";

export const DEFAULT_OG_IMAGE = {
  url: "https://picsum.photos/seed/nocturne-og/1200/630", // PLACEHOLDER — swap for a real branded image
  width: 1200,
  height: 630,
  alt: "Nocturne Studio — Columbia, Missouri portrait and boudoir photographer",
};

export const BUSINESS = {
  name: SITE_NAME,
  description:
    "Portrait, boudoir, and fine art photography studio based in Columbia, Missouri, serving clients throughout Mid-Missouri.",
  telephone: "+1-573-000-0000", // PLACEHOLDER
  email: "hello@nocturnestudio.example", // PLACEHOLDER
  address: {
    streetAddress: "123 Placeholder St", // PLACEHOLDER
    addressLocality: "Columbia",
    addressRegion: "MO",
    postalCode: "65201", // PLACEHOLDER
    addressCountry: "US",
  },
  geo: {
    latitude: 38.9517, // PLACEHOLDER — approximate Columbia, MO coordinates
    longitude: -92.3341, // PLACEHOLDER
  },
  areaServed: [
    "Columbia, MO",
    "Jefferson City, MO",
    "Ashland, MO",
    "Fulton, MO",
    "Boonville, MO",
    "Mid-Missouri",
  ],
  sameAs: [
    "https://www.instagram.com/nocturnestudio", // PLACEHOLDER
  ],
  priceRange: "$$", // PLACEHOLDER
};

// Per-page metadata must build its own full `openGraph`/`twitter` objects —
// Next.js REPLACES (not merges) those nested objects wholesale whenever a
// page defines them, so omitting the image/card fields here would silently
// drop the root layout's OG image and card type on every page that uses it.
export function buildPageMetadata({
  title,
  description,
  path = "",
}: {
  title: string;
  description: string;
  path?: string;
}): Metadata {
  const url = `${SITE_URL}${path}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [DEFAULT_OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [DEFAULT_OG_IMAGE.url],
    },
    alternates: { canonical: url },
  };
}
