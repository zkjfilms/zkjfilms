// Central place for site-wide SEO/business constants used by metadata,
// JSON-LD structured data, robots.ts, and sitemap.ts.

import type { Metadata } from "next";

export const SITE_URL = "https://zkjfilms.com";

export const SITE_NAME = "Zach K. Johnson";

export const DEFAULT_OG_IMAGE = {
  url: `${SITE_URL}/opengraph-image`,
  width: 1200,
  height: 630,
  alt: "Zach K. Johnson — Columbia, Missouri portrait and boudoir photographer",
};

export const SOCIALS = {
  instagram: "https://www.instagram.com/zach_k_johnson",
  youtube: "https://www.youtube.com/@zkjfilms",
  appleMusic: "https://music.apple.com/profile/zkjfilms",
  facebook: "https://www.facebook.com/profile.php?id=61586214680266",
  vimeo: "https://vimeo.com/user172241052",
};

export const BUSINESS = {
  name: SITE_NAME,
  description:
    "Zach K. Johnson is a portrait, boudoir, and fine art photographer based in Columbia, Missouri, serving clients throughout Mid-Missouri.",
  telephone: "+1-901-483-2391",
  email: "zach@zkjfilms.com",
  address: {
    streetAddress: "2101 W Broadway Ave, Suite 208",
    addressLocality: "Columbia",
    addressRegion: "MO",
    postalCode: "65203",
    addressCountry: "US",
  },
  geo: {
    latitude: 38.9549265,
    longitude: -92.3733838,
  },
  areaServed: [
    "Columbia, MO",
    "Jefferson City, MO",
    "Ashland, MO",
    "Fulton, MO",
    "Boonville, MO",
    "Mid-Missouri",
  ],
  sameAs: Object.values(SOCIALS),
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
