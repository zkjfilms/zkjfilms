import type { NextConfig } from "next";
import { PUBLIC_IMAGES_BASE_URL } from "./lib/media";

const nextConfig: NextConfig = {
  images: {
    // Next.js 16 requires listing every quality value used via the
    // `quality` prop on next/image — an unlisted value silently falls back
    // to the nearest allowed one (75 is the only default) instead of
    // erroring, which is what made components/ServiceLandingPage.tsx's
    // (and others') quality={90} appear to have no effect in production.
    qualities: [75, 90],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "fastly.picsum.photos",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: new URL(PUBLIC_IMAGES_BASE_URL).hostname,
        port: "",
        pathname: "/**",
        search: "",
      },
    ],
  },
};

export default nextConfig;
