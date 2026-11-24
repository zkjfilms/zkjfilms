import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import AgeGate from "@/components/AgeGate";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { BOUDOIR_SERVICE } from "@/lib/services";

// Deliberately no image override: boudoir keeps the default brand OG image so
// nude imagery never appears in link previews.
export function generateMetadata(): Metadata {
  return pageMetadata("boudoir");
}

export default function BoudoirPage() {
  return (
    <>
      <AgeGate />
      <ServiceLandingPage service={BOUDOIR_SERVICE} />
    </>
  );
}
