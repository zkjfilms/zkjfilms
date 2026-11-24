// Single source of truth for every public, indexable page's SEO title,
// description, and sitemap hints. Titles (except home, which is absolute)
// get " | Zach K. Johnson" appended by the root layout's title template, so
// keep them ≤ 42 chars. tests/pages.test.ts enforces the limits.
export type RouteKey =
  | "home" | "book" | "contact" | "about" | "faq" | "headshots"
  | "creativePortraits" | "boudoir" | "music" | "films" | "podcast";

export type RouteInfo = {
  path: string;
  title: string;
  description: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  absoluteTitle?: boolean;
};

export const ROUTES: Record<RouteKey, RouteInfo> = {
  home: {
    path: "",
    title: "Columbia MO Portrait & Boudoir Photography | Zach K. Johnson",
    absoluteTitle: true,
    description:
      "Columbia, Missouri portrait and boudoir photographer offering natural-light portrait, boudoir, and fine art photography sessions throughout Mid-Missouri.",
    changeFrequency: "monthly",
    priority: 1,
  },
  book: {
    path: "/book",
    title: "Book a Photo Session in Columbia, MO",
    description:
      "Book a portrait, headshot, boudoir, or music/performance photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  contact: {
    path: "/contact",
    title: "Contact a Columbia, MO Photographer",
    description:
      "Book a portrait, headshot, or boudoir photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    changeFrequency: "yearly",
    priority: 0.8,
  },
  about: {
    path: "/about",
    title: "About the Photographer",
    description:
      "Meet Zach K. Johnson, a Columbia, Missouri portrait, boudoir, and fine art photographer serving Mid-Missouri.",
    changeFrequency: "yearly",
    priority: 0.6,
  },
  faq: {
    path: "/faq",
    title: "Photography FAQ",
    description:
      "Answers to common questions about booking a portrait, headshot, boudoir, music, or fine art photography session in Columbia, Missouri.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  headshots: {
    path: "/headshots",
    title: "Headshots in Columbia, MO",
    description:
      "Professional headshot photography in Columbia, Missouri — polished portraits for LinkedIn, business branding, and professional profiles.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  creativePortraits: {
    path: "/creative-portraits",
    title: "Creative Portrait Photography, Columbia MO",
    description:
      "Art-directed creative portrait photography sessions in Columbia, Missouri, built around concept, lighting, and styling.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  boudoir: {
    path: "/boudoir",
    title: "Boudoir Photography in Columbia, MO",
    description:
      "Fine art boudoir and nude photography in Columbia, Missouri — intimate sessions built around trust, privacy, and what you're comfortable with.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  music: {
    path: "/music",
    title: "Concert & Band Photography, Columbia MO",
    description:
      "Concert and live performance photography in Columbia, Missouri and beyond — booked by artists, venues, and labels for promo and press.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  films: {
    path: "/films",
    title: "Films & Video, Columbia MO",
    description:
      "Cinematic video work from Zach K. Johnson — highlight reels and film pieces from Columbia, Missouri.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  podcast: {
    path: "/podcast",
    title: "What Comes Next — Podcast",
    description:
      "What Comes Next is a series by filmmaker Zach K. Johnson featuring guests speaking in their own words about how life has shaped who they are today.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
};
