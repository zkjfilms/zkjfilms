import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { CREATIVE_PORTRAITS_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Creative Portraits",
    description:
      "Art-directed creative portrait photography sessions in Columbia, Missouri, built around concept, lighting, and styling.",
    path: "/creative-portraits",
  });
}

export default function CreativePortraitsPage() {
  return <ServiceLandingPage service={CREATIVE_PORTRAITS_SERVICE} />;
}
