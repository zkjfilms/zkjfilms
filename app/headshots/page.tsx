import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { HEADSHOTS_SERVICE, serviceOgImage } from "@/lib/services";

export function generateMetadata(): Metadata {
  return pageMetadata("headshots", serviceOgImage(HEADSHOTS_SERVICE));
}

export default function HeadshotsPage() {
  return <ServiceLandingPage service={HEADSHOTS_SERVICE} />;
}
