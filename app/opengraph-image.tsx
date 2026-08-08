import { ImageResponse } from "next/og";
import { BUSINESS, DEFAULT_OG_IMAGE } from "@/lib/seo";

export const alt = DEFAULT_OG_IMAGE.alt;
export const size = {
  width: DEFAULT_OG_IMAGE.width,
  height: DEFAULT_OG_IMAGE.height,
};
export const contentType = "image/png";

// Satori (the renderer behind ImageResponse) can only parse TrueType/
// OpenType/WOFF font data, not WOFF2 — and next/font/google only exposes
// fonts as CSS, not raw bytes. Google Fonts' CSS2 API serves WOFF2 to
// modern User-Agents but plain WOFF to old-browser ones that predate
// woff2 support, which @vercel/og can decode. This generates once at
// build time (this route is statically optimized), not per request.
async function loadGoogleFontWoff(cssFamilyQuery: string): Promise<ArrayBuffer> {
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=${cssFamilyQuery}&display=swap`,
    {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2",
      },
    },
  ).then((res) => res.text());

  const fontUrl = css.match(/src: url\((.+?)\) format\('woff'\)/)?.[1];
  if (!fontUrl) {
    throw new Error(
      `Could not find a .woff URL in the Google Fonts CSS response for "${cssFamilyQuery}".`,
    );
  }

  const fontResponse = await fetch(fontUrl);
  return fontResponse.arrayBuffer();
}

export default async function Image() {
  const [playfairDisplayItalic, jostMedium] = await Promise.all([
    loadGoogleFontWoff("Playfair+Display:ital,wght@1,700"),
    loadGoogleFontWoff("Jost:wght@500"),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#faf6f0",
        }}
      >
        <div
          style={{
            fontFamily: "Playfair Display",
            fontStyle: "italic",
            fontWeight: 700,
            fontSize: 88,
            color: "#2b2621",
          }}
        >
          {BUSINESS.name}
        </div>
        <div
          style={{
            fontFamily: "Jost",
            marginTop: 28,
            fontSize: 22,
            letterSpacing: 6,
            textTransform: "uppercase",
            color: "#a8613f",
          }}
        >
          Portrait and Boudoir Photography — Columbia, Missouri
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Playfair Display",
          data: playfairDisplayItalic,
          style: "italic",
          weight: 700,
        },
        {
          name: "Jost",
          data: jostMedium,
          style: "normal",
          weight: 500,
        },
      ],
    },
  );
}
