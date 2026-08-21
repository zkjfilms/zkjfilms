import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { MUSIC_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Music & Performance Photography",
    description:
      "Concert and live performance photography in Columbia, Missouri and beyond — booked by artists, venues, and labels for promo and press.",
    path: "/music",
  });
}

export default function MusicPage() {
  return <ServiceLandingPage service={MUSIC_SERVICE} />;
}
