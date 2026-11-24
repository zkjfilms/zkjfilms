import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, serviceJsonLd } from "@/lib/jsonLd";
import { servicePrice } from "@/lib/servicePricing";
import { ROUTES } from "@/content/pages";
import { HEADSHOTS_SERVICE, serviceOgImage } from "@/lib/services";

export function generateMetadata(): Metadata {
  return pageMetadata("headshots", serviceOgImage(HEADSHOTS_SERVICE));
}

// Live "from" price for the Offer schema — same appointment_types data as
// /book. Revalidate so admin price changes appear without a redeploy.
export const revalidate = 300;

export default async function HeadshotsPage() {
  const s = HEADSHOTS_SERVICE;
  const price = await servicePrice(s.appointmentTypeName);
  return (
    <>
      <JsonLd data={[serviceJsonLd({ name: s.appointmentTypeName, description: s.description, path: ROUTES.headshots.path, image: serviceOgImage(s).url, startingPriceCents: price }), breadcrumbJsonLd("headshots")]} />
      <ServiceLandingPage service={s} />
    </>
  );
}
