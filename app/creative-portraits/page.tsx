import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { CREATIVE_PORTRAITS_SERVICE, serviceOgImage } from "@/lib/services";

export function generateMetadata(): Metadata {
  return pageMetadata("creativePortraits", serviceOgImage(CREATIVE_PORTRAITS_SERVICE));
}

export default function CreativePortraitsPage() {
  return <ServiceLandingPage service={CREATIVE_PORTRAITS_SERVICE} />;
}
