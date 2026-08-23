import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// /gated is intentionally excluded — see app/robots.ts for the matching
// disallow rule.
const routes: Array<{
  path: string;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  priority: number;
}> = [
  { path: "", changeFrequency: "monthly", priority: 1 },
  { path: "/photos", changeFrequency: "weekly", priority: 0.9 },
  { path: "/book", changeFrequency: "daily", priority: 0.8 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.8 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/headshots", changeFrequency: "monthly", priority: 0.8 },
  { path: "/creative-portraits", changeFrequency: "monthly", priority: 0.8 },
  { path: "/boudoir", changeFrequency: "monthly", priority: 0.8 },
  { path: "/music", changeFrequency: "monthly", priority: 0.8 },
  { path: "/films", changeFrequency: "monthly", priority: 0.8 },
  { path: "/podcast", changeFrequency: "weekly", priority: 0.8 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return routes.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified: new Date(),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
