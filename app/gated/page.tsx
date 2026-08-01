import type { Metadata } from "next";
import GateScreen from "./GateScreen";

// This route is intentionally excluded from search — see the /robots.ts
// disallow rule and the sitemap.ts exclusion list. The noindex/nofollow
// here is defense in depth in case the page is ever linked to directly.
export function generateMetadata(): Metadata {
  return {
    title: "Private Gallery",
    robots: {
      index: false,
      follow: false,
    },
  };
}

export default function GatedPage() {
  return <GateScreen />;
}
