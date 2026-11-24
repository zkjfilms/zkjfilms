import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { MUSIC_SERVICE, serviceOgImage } from "@/lib/services";

export function generateMetadata(): Metadata {
  return pageMetadata("music", serviceOgImage(MUSIC_SERVICE));
}

export default function MusicPage() {
  return <ServiceLandingPage service={MUSIC_SERVICE} />;
}
