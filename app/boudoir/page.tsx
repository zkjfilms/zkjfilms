import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import AgeGate from "@/components/AgeGate";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { BOUDOIR_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Boudoir & Fine Art Nude",
    description:
      "Fine art boudoir and nude photography in Columbia, Missouri — intimate sessions built around trust, privacy, and what you're comfortable with.",
    path: "/boudoir",
  });
}

export default function BoudoirPage() {
  return (
    <>
      <AgeGate />
      <ServiceLandingPage service={BOUDOIR_SERVICE} />
    </>
  );
}
