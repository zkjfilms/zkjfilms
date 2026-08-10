import type { NextConfig } from "next";
import { PUBLIC_IMAGES_BASE_URL } from "./lib/media";

const nextConfig: NextConfig = {
  images: {
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
