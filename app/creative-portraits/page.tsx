import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, serviceJsonLd } from "@/lib/jsonLd";
import { servicePrice } from "@/lib/servicePricing";
import { ROUTES } from "@/content/pages";
import { CREATIVE_PORTRAITS_SERVICE, serviceOgImage } from "@/lib/services";

export function generateMetadata(): Metadata {
  return pageMetadata("creativePortraits", serviceOgImage(CREATIVE_PORTRAITS_SERVICE));
}

// Live "from" price for the Offer schema — same appointment_types data as
// /book. Revalidate so admin price changes appear without a redeploy.
export const revalidate = 300;

export default async function CreativePortraitsPage() {
  const s = CREATIVE_PORTRAITS_SERVICE;
  const price = await servicePrice(s.appointmentTypeName);
  return (
    <>
      <JsonLd data={[serviceJsonLd({ name: s.appointmentTypeName, description: s.description, path: ROUTES.creativePortraits.path, image: serviceOgImage(s).url, startingPriceCents: price }), breadcrumbJsonLd("creativePortraits")]} />
      <ServiceLandingPage service={s} />
    </>
  );
}
