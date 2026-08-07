# Fix Placeholder Business Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every fake placeholder value in the site's business/SEO data (`lib/seo.ts`) with real values — phone number, geocoded address coordinates, a generated branded OG image — and surface the phone number in the footer.

**Architecture:** All business constants live in `lib/seo.ts` and are consumed by `app/layout.tsx` (default metadata), `app/page.tsx` (JSON-LD), every page's `buildPageMetadata()` call, and `components/Footer.tsx`. This plan edits `lib/seo.ts` in two passes (grouped with whichever consumer must change in lockstep to keep `npm run build` green at every step), adds one new file (`app/opengraph-image.tsx`) that Next.js's `next/og` renders to a PNG at build time, and makes a small edit to `components/Footer.tsx`. No new dependencies, no new abstractions — this is a data-correctness fix, not a refactor.

**Tech Stack:** Next.js 16 App Router, TypeScript, `next/og` (`ImageResponse`), Tailwind v4 (existing design tokens in `app/globals.css`).

## Global Constraints

- Real phone number: `901-483-2391`. Schema/`tel:` value: `+1-901-483-2391` (matches the existing placeholder's `+1-XXX-XXX-XXXX` format).
- Real geocoded coordinates for 2101 W Broadway Ave, Columbia, MO 65203: `latitude: 38.9549265, longitude: -92.3733838` (via OpenStreetMap Nominatim against the real street address — do not re-derive, use these exact values).
- `BUSINESS.priceRange` is removed, not replaced with a different value.
- OG image is a generated branded text card (no photo) — colors/fonts must match `app/globals.css` tokens: background `#faf6f0`, foreground `#2b2621`, accent `#a8613f`, font Playfair Display italic.
- This project has no test framework (`grep` confirms no jest/vitest/testing-library and no `*.test.*` files exist). The verification gate for every task is `npm run build` (type-checks via `next build`) plus targeted `curl`/`grep` checks — do not introduce a test framework as part of this plan.
- Every task must end with a working `npm run build`. `BUSINESS.priceRange` has exactly one consumer (`app/page.tsx`) — removing the field and removing its consumer must happen in the same task, or `next build`'s type-check breaks between tasks.

---

### Task 1: Fix phone/geo, remove `priceRange` (source + its one consumer)

**Files:**
- Modify: `lib/seo.ts` (telephone, geo, remove the `priceRange` field — leave `DEFAULT_OG_IMAGE` and its placeholder comment untouched, that's Task 2)
- Modify: `app/page.tsx:22-49` (the `jsonLd` object and its preceding comment)

**Interfaces:**
- Produces: `BUSINESS.telephone: string` (now `"+1-901-483-2391"`), `BUSINESS.geo: { latitude: number; longitude: number }` (now real coordinates), `BUSINESS` no longer has a `priceRange` field. Consumed by Task 3 (`components/Footer.tsx` reads `BUSINESS.telephone`).

- [ ] **Step 1: Edit `lib/seo.ts`**

Find:

```ts
// Central place for site-wide SEO/business constants used by metadata,
// JSON-LD structured data, robots.ts, and sitemap.ts.
//
// TODO: every value marked PLACEHOLDER below is fake and must be replaced
// with real business details before launch.

import type { Metadata } from "next";

export const SITE_URL = "https://zkjfilms.com";

export const SITE_NAME = "Zach K. Johnson";

export const DEFAULT_OG_IMAGE = {
  url: "https://picsum.photos/seed/nocturne-og/1200/630", // PLACEHOLDER — swap for a real branded image
  width: 1200,
  height: 630,
  alt: "Zach K. Johnson — Columbia, Missouri portrait and boudoir photographer",
};
```

Replace with:

```ts
// Central place for site-wide SEO/business constants used by metadata,
// JSON-LD structured data, robots.ts, and sitemap.ts.
//
// TODO: DEFAULT_OG_IMAGE below is still a placeholder — see
// app/opengraph-image.tsx once it exists.

import type { Metadata } from "next";

export const SITE_URL = "https://zkjfilms.com";

export const SITE_NAME = "Zach K. Johnson";

export const DEFAULT_OG_IMAGE = {
  url: "https://picsum.photos/seed/nocturne-og/1200/630", // PLACEHOLDER — swap for a real branded image
  width: 1200,
  height: 630,
  alt: "Zach K. Johnson — Columbia, Missouri portrait and boudoir photographer",
};
```

(Only the top comment block changes here — `DEFAULT_OG_IMAGE` itself is untouched in this task.)

Then find:

```ts
  telephone: "+1-573-000-0000", // PLACEHOLDER
  email: "zach@zkjfilms.com",
  address: {
    streetAddress: "2101 W Broadway Ave, Suite 208",
    addressLocality: "Columbia",
    addressRegion: "MO",
    postalCode: "65203",
    addressCountry: "US",
  },
  geo: {
    latitude: 38.9517, // PLACEHOLDER — approximate Columbia, MO coordinates
    longitude: -92.3341, // PLACEHOLDER
  },
  areaServed: [
    "Columbia, MO",
    "Jefferson City, MO",
    "Ashland, MO",
    "Fulton, MO",
    "Boonville, MO",
    "Mid-Missouri",
  ],
  sameAs: Object.values(SOCIALS),
  priceRange: "$$", // PLACEHOLDER
};
```

Replace with:

```ts
  telephone: "+1-901-483-2391",
  email: "zach@zkjfilms.com",
  address: {
    streetAddress: "2101 W Broadway Ave, Suite 208",
    addressLocality: "Columbia",
    addressRegion: "MO",
    postalCode: "65203",
    addressCountry: "US",
  },
  geo: {
    latitude: 38.9549265,
    longitude: -92.3733838,
  },
  areaServed: [
    "Columbia, MO",
    "Jefferson City, MO",
    "Ashland, MO",
    "Fulton, MO",
    "Boonville, MO",
    "Mid-Missouri",
  ],
  sameAs: Object.values(SOCIALS),
};
```

- [ ] **Step 2: Edit `app/page.tsx`**

Find:

```tsx
// Placeholder LocalBusiness structured data — replace the placeholder
// fields in lib/seo.ts (address, phone, geo, sameAs) with real details.
const jsonLd = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "ProfessionalService"],
  "@id": `${SITE_URL}/#business`,
  name: BUSINESS.name,
  description: BUSINESS.description,
  url: SITE_URL,
  telephone: BUSINESS.telephone,
  email: BUSINESS.email,
  priceRange: BUSINESS.priceRange,
  address: {
```

Replace with:

```tsx
const jsonLd = {
  "@context": "https://schema.org",
  "@type": ["LocalBusiness", "ProfessionalService"],
  "@id": `${SITE_URL}/#business`,
  name: BUSINESS.name,
  description: BUSINESS.description,
  url: SITE_URL,
  telephone: BUSINESS.telephone,
  email: BUSINESS.email,
  address: {
```

(Everything from `address: {` through the closing `};` of `jsonLd` stays exactly as-is.)

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: succeeds with no type errors (this is what confirms `priceRange`'s removal and its consumer's removal landed together correctly).

Run: `grep -rn "priceRange" app lib components`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add lib/seo.ts app/page.tsx
git commit -m "$(cat <<'EOF'
Replace placeholder phone/geo with real values, drop guessed priceRange

telephone was a fake +1-573-000-0000; geo was an approximate downtown
Columbia centroid ~3.5km from the real 2101 W Broadway Ave address
(re-geocoded via Nominatim against the real address). priceRange was a
guessed "$$" — removed rather than replaced since $250-350+ sessions
don't summarize into one Google price tier and /book already shows
exact pricing per session type.
EOF
)"
```

---

### Task 2: Generated branded OG image, replacing the picsum placeholder

**Files:**
- Create: `app/opengraph-image.tsx`
- Modify: `lib/seo.ts` (`DEFAULT_OG_IMAGE.url`, and remove the now-resolved placeholder comments left in place by Task 1)

**Interfaces:**
- Consumes: `BUSINESS.name` and `DEFAULT_OG_IMAGE.{width,height,alt}` (read inside `app/opengraph-image.tsx` from the `lib/seo.ts` values as they exist *before* this task's `lib/seo.ts` edit — i.e. write the component first using the current `width`/`height`/`alt`, then update `url` last so the values it reads don't change out from under it mid-task).
- Produces: the `/opengraph-image` route. `DEFAULT_OG_IMAGE.url` becomes `` `${SITE_URL}/opengraph-image` ``, consumed by `app/layout.tsx` and every page via `buildPageMetadata()` (no changes needed there — they already reference `DEFAULT_OG_IMAGE`).

**Background on the font-loading approach** (do not deviate — verified against this repo's installed `next/dist/compiled/@vercel/og` bundle before writing this plan):
`next/og`'s `ImageResponse` (Satori under the hood) can parse TrueType/OpenType and WOFF font data, but *not* WOFF2. `next/font/google` (used elsewhere in this app) only exposes fonts as CSS, not raw bytes, so it can't be reused here. Google Fonts' CSS2 API serves WOFF2 by default to modern User-Agents, but serves plain `.woff` (not woff2) to old-browser User-Agents that predate woff2 support — confirmed working via direct curl during planning:
`curl -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_6_8) AppleWebKit/534.57.2 (KHTML, like Gecko) Version/5.1.7 Safari/534.57.2" "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&display=swap"` returns a `.woff` URL. The `@vercel/og` bundle can decode `.woff` (it contains `wOFF`-magic-byte detection and zlib inflate).

- [ ] **Step 1: Create `app/opengraph-image.tsx`**

```tsx
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
async function loadPlayfairDisplayItalic(): Promise<ArrayBuffer> {
  const css = await fetch(
    "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@1,700&display=swap",
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
      "Could not find a Playfair Display italic .woff URL in the Google Fonts CSS response.",
    );
  }

  const fontResponse = await fetch(fontUrl);
  return fontResponse.arrayBuffer();
}

export default async function Image() {
  const playfairDisplayItalic = await loadPlayfairDisplayItalic();

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
      ],
    },
  );
}
```

- [ ] **Step 2: Build and confirm the route generates successfully**

Run: `npm run build`
Expected: build succeeds with no errors. Look for `/opengraph-image` in the route output (Next.js lists generated image routes in the build summary).

- [ ] **Step 3: Visually verify the generated image**

Run:
```bash
npm run dev &
sleep 3
curl -s -o /tmp/og-check.png -w "HTTP %{http_code}, content-type: %{content_type}\n" http://localhost:3000/opengraph-image
file /tmp/og-check.png
kill %1
```
Expected: `HTTP 200, content-type: image/png` and `file` reports a valid PNG image roughly 1200x630. Open `/tmp/og-check.png` (e.g. `open /tmp/og-check.png` on macOS) and confirm it shows "Zach K. Johnson" in italic serif on a cream background with the rust-colored tagline beneath it — no garbled text (garbled text means the font fetch/parse silently produced a fallback font; if so, stop and re-check the `loadPlayfairDisplayItalic` regex against the current Google Fonts CSS response before proceeding).

- [ ] **Step 4: Edit `lib/seo.ts` to point at the new image**

Find:

```ts
// Central place for site-wide SEO/business constants used by metadata,
// JSON-LD structured data, robots.ts, and sitemap.ts.
//
// TODO: DEFAULT_OG_IMAGE below is still a placeholder — see
// app/opengraph-image.tsx once it exists.

import type { Metadata } from "next";

export const SITE_URL = "https://zkjfilms.com";

export const SITE_NAME = "Zach K. Johnson";

export const DEFAULT_OG_IMAGE = {
  url: "https://picsum.photos/seed/nocturne-og/1200/630", // PLACEHOLDER — swap for a real branded image
  width: 1200,
  height: 630,
  alt: "Zach K. Johnson — Columbia, Missouri portrait and boudoir photographer",
};
```

Replace with:

```ts
// Central place for site-wide SEO/business constants used by metadata,
// JSON-LD structured data, robots.ts, and sitemap.ts.

import type { Metadata } from "next";

export const SITE_URL = "https://zkjfilms.com";

export const SITE_NAME = "Zach K. Johnson";

export const DEFAULT_OG_IMAGE = {
  url: `${SITE_URL}/opengraph-image`,
  width: 1200,
  height: 630,
  alt: "Zach K. Johnson — Columbia, Missouri portrait and boudoir photographer",
};
```

- [ ] **Step 5: Build and verify the pointer**

Run: `npm run build`
Expected: succeeds.

Run:
```bash
npm run dev &
sleep 3
curl -s http://localhost:3000/ | grep -o 'og:image" content="[^"]*"'
kill %1
```
Expected: the URL contains `/opengraph-image`, not `picsum.photos`.

- [ ] **Step 6: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add app/opengraph-image.tsx lib/seo.ts
git commit -m "Add generated branded OG image, replacing the picsum stock placeholder"
```

---

### Task 3: Add visible phone link to `components/Footer.tsx`

**Files:**
- Modify: `components/Footer.tsx:63-83` (the address/email column)

**Interfaces:**
- Consumes: `BUSINESS.telephone` (`"+1-901-483-2391"`, from Task 1) via the already-imported `BUSINESS` from `@/lib/seo` (Footer.tsx already has `import { BUSINESS, SOCIALS } from "@/lib/seo";` at the top — no import change needed).

- [ ] **Step 1: Edit `components/Footer.tsx`**

Find:

```tsx
              <a
                href={`mailto:${BUSINESS.email}`}
                className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
              >
                {BUSINESS.email}
              </a>
            </div>
          </div>
```

Replace with:

```tsx
              <a
                href={`mailto:${BUSINESS.email}`}
                className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
              >
                {BUSINESS.email}
              </a>
              <a
                href={`tel:${BUSINESS.telephone.replace(/[^0-9+]/g, "")}`}
                className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
              >
                (901) 483-2391
              </a>
            </div>
          </div>
```

(The display text is hardcoded rather than derived from `BUSINESS.telephone`, matching this same block's existing convention of hardcoding the address display string rather than deriving it from `BUSINESS.address`'s individual fields. The `href` derives from `BUSINESS.telephone` via a digit/plus filter so the `tel:` link never drifts out of sync with the schema value.)

- [ ] **Step 2: Build and lint**

Run: `npm run build && npm run lint`
Expected: both succeed with no errors or warnings.

- [ ] **Step 3: Visually verify in the browser**

Run:
```bash
npm run dev &
sleep 3
curl -s http://localhost:3000/ | grep -o 'tel:[^"]*'
kill %1
```
Expected: prints `tel:+19014832391`. Then load `http://localhost:3000/` in a browser, scroll to the footer, and confirm `(901) 483-2391` appears as a clickable link next to the email, styled consistently with the address/email links above it.

- [ ] **Step 4: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add components/Footer.tsx
git commit -m "Show the real phone number in the footer, linked as tel:"
```

---

## Final verification (after all 3 tasks)

- [ ] Run `npm run build` one more time from a clean state — confirm it succeeds end to end.
- [ ] `curl -s http://localhost:3000/` (with `npm run dev` running) and grep for `"telephone":"+1-901-483-2391"`, `"latitude":38.9549265`, and confirm `"priceRange"` does NOT appear in the JSON-LD script tag.
- [ ] Confirm the `og:image` meta tag on a page load points at `/opengraph-image`, not `picsum.photos`.
- [ ] Confirm the footer shows `(901) 483-2391` as a working `tel:` link.
