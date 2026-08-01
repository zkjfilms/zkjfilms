import type { Metadata } from "next";
import { cookies } from "next/headers";
import GateScreen from "./GateScreen";
import GatedGallery from "./GatedGallery";
import { GATED_ACCESS_COOKIE, isValidAccessToken } from "@/lib/gatedAccess";

// This route is intentionally excluded from search — see the /robots.ts
// disallow rule and the sitemap.ts exclusion list. The noindex/nofollow
// here is defense in depth in case the page is ever linked to directly.
export function generateMetadata(): Metadata {
  return {
    title: "Private Gallery",
    robots: {
      index: false,
      follow: false,
    },
  };
}

// Access is checked here, server-side, before anything renders — the
// gallery markup below is never included in the response to a browser
// that hasn't passed the gate. See lib/gatedAccess.ts and
// app/api/gated-access/route.ts for the verification + cookie issuance.
export default async function GatedPage() {
  const cookieStore = await cookies();
  const hasAccess = isValidAccessToken(
    cookieStore.get(GATED_ACCESS_COOKIE)?.value,
  );

  if (!hasAccess) {
    return <GateScreen />;
  }

  return <GatedGallery />;
}
