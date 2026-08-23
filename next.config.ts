import type { NextConfig } from "next";
import { PUBLIC_IMAGES_BASE_URL } from "./lib/media";

const r2PublicHost = new URL(PUBLIC_IMAGES_BASE_URL).hostname;

// Static (no nonces) CSP — the nonce-based alternative Next.js supports
// requires every page to render dynamically per request, which would
// disable the static generation and 5-minute ISR revalidation this site
// relies on (/, /films, /faq, /book). script-src/style-src need
// 'unsafe-inline' as the tradeoff: Next/React inject inline hydration
// data, and several pages render inline JSON-LD structured data
// (app/page.tsx, app/faq/page.tsx) with DB-driven content that can't be
// hash-pinned at build time.
//
// Note: Vercel's preview-deployment toolbar (vercel.live) will show CSP
// violations in the console on *preview* URLs specifically — expected,
// not a bug; Vercel doesn't inject that toolbar into production. Don't
// widen this policy to accommodate a preview-only tool.
function buildCspHeader(isDev: boolean): string {
  return [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    // Client galleries and /films load photos/videos directly from R2 via
    // plain <img>/<video> tags (signed or public URLs), not through
    // next/image's same-origin proxy — bare 'self' wouldn't cover these.
    // The private bucket's account-ID subdomain isn't a secret (it's
    // already visible in every signed URL a gallery viewer's browser
    // requests), so a wildcard is used rather than hardcoding it.
    `img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    // /podcast's <audio> elements point directly at RSS.com's CDN for the
    // episode MP3s — not proxied through our own origin (there's no
    // next/image-style proxy for audio), so media-src needs it explicitly,
    // same reasoning as the R2 hosts above. content.rss.com 307-redirects
    // to Triton Digital's podcast delivery network (a signed, expiring
    // URL) to actually serve the file — Chrome enforces media-src against
    // each redirect hop, not just the initial request, so both hosts are
    // required or playback silently fails with no visible error beyond
    // a console CSP violation.
    `media-src 'self' https://*.r2.cloudflarestorage.com https://${r2PublicHost} https://content.rss.com https://rsscom.pdn.tritondigital.com`,
    // app/about/page.tsx embeds the studio location as a Google Maps
    // iframe; without this the map silently fails to load (falls back to
    // default-src 'self') with no visible error beyond the console.
    // /podcast embeds individual YouTube videos (YouTubeEmbedFacade) —
    // without youtube.com here those iframes fail the same way.
    `frame-src 'self' https://www.google.com https://challenges.cloudflare.com https://www.youtube.com`,
    `font-src 'self'`,
    // lib/supabaseBrowser.ts connects directly from the browser for
    // Realtime Broadcast (live booking-availability updates) — the only
    // client-side Supabase usage in the app.
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

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
        hostname: r2PublicHost,
        port: "",
        pathname: "/**",
        // No `search` restriction (unlike the picsum patterns above) —
        // publicImageUrl()'s optional cache-bust `?v=...` param (see
        // lib/media.ts) needs to pass through for fixed-name keys like
        // hero.jpg that get their content swapped in place.
      },
      // /podcast's cover art (RSS.com's CDN) and YouTube video thumbnails —
      // both rendered via next/image, which proxies through our own origin
      // (`/_next/image?url=...`), so (unlike the <audio> src above) these
      // don't need a CSP img-src addition, only this allowlist entry.
      {
        protocol: "https",
        hostname: "media.rss.com",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
        port: "",
        pathname: "/**",
        search: "",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildCspHeader(process.env.NODE_ENV === "development"),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/portraits", destination: "/photos", permanent: true },
    ];
  },
};

export default nextConfig;
