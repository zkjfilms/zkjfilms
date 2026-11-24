import type { Metadata } from "next";
import { DEFAULT_OG_IMAGE, pageMetadata } from "@/lib/seo";
import AgeGate from "@/components/AgeGate";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, serviceJsonLd } from "@/lib/jsonLd";
import { servicePrice } from "@/lib/servicePricing";
import { ROUTES } from "@/content/pages";
import { BOUDOIR_SERVICE } from "@/lib/services";

// Deliberately no image override: boudoir keeps the default brand OG image so
// nude imagery never appears in link previews.
export function generateMetadata(): Metadata {
  return pageMetadata("boudoir");
}

// Live "from" price for the Offer schema — same appointment_types data as
// /book. Revalidate so admin price changes appear without a redeploy.
export const revalidate = 300;

export default async function BoudoirPage() {
  const s = BOUDOIR_SERVICE;
  const price = await servicePrice(s.appointmentTypeName);
  return (
    <>
      <JsonLd data={[serviceJsonLd({ name: s.appointmentTypeName, description: s.description, path: ROUTES.boudoir.path, image: DEFAULT_OG_IMAGE.url, startingPriceCents: price }), breadcrumbJsonLd("boudoir")]} />
      <AgeGate />
      <ServiceLandingPage service={s} />
    </>
  );
}
