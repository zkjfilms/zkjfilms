import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { HEADSHOTS_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Professional Headshots",
    description:
      "Professional headshot photography in Columbia, Missouri — polished portraits for LinkedIn, business branding, and professional profiles.",
    path: "/headshots",
  });
}

export default function HeadshotsPage() {
  return <ServiceLandingPage service={HEADSHOTS_SERVICE} />;
}
