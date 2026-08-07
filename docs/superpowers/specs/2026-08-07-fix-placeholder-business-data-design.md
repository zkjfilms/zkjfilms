# Fix placeholder business data (schema, phone, geo, OG image)

## Context

`lib/seo.ts` is the central source for site-wide SEO/business constants used
by page metadata, the `LocalBusiness`/`ProfessionalService` JSON-LD on the
homepage, `robots.ts`, and `sitemap.ts`. Several values in it are fake
placeholders left over from initial scaffolding:

- `BUSINESS.telephone` is `"+1-573-000-0000"`.
- `BUSINESS.geo` is an approximate Columbia, MO centroid, not the business's
  actual address.
- `BUSINESS.priceRange` is a placeholder `"$$"`.
- `DEFAULT_OG_IMAGE.url` is a `picsum.photos` stock photo, used as the
  social-share preview image on every page via `buildPageMetadata()`.

These feed real, user-visible surfaces (Google's local business schema,
social share cards) and are unrelated to the "replace photos with real work"
task that's explicitly out of scope for now.

This is the first of five independent site-improvement pieces identified in
a full-site review (the others: testimonials/FAQ, service-specific landing
pages, mobile nav, error/loading pages), each getting its own spec.

## Decisions made with the user

- Real phone number: `901-483-2391`, formatted with the `+1` country code
  for the schema value (`+1-901-483-2391`), matching the existing placeholder's
  format convention.
- The phone number should also be visibly shown to visitors, not just
  embedded in structured data — added to the footer.
- `priceRange` is removed from the schema entirely rather than guessed at
  ($250-$350+ sessions don't summarize well into one Google price tier, and
  the `/book` flow already shows exact pricing per session type).
- OG image: replace the stock photo with a simple branded text card (name +
  tagline, no photo) rather than leaving the stock placeholder or blocking
  on a real photo.

## Changes

### 1. `lib/seo.ts`

- `BUSINESS.telephone`: `"+1-573-000-0000"` → `"+1-901-483-2391"`.
- `BUSINESS.geo`: replaced with the real geocoded coordinates for 2101 W
  Broadway Ave, Columbia, MO 65203 — `{ latitude: 38.9549265, longitude:
  -92.3733838 }` (geocoded via OpenStreetMap Nominatim against the business's
  actual street address; the old placeholder was ~3.5km off, near downtown
  rather than the real West Broadway location).
- `BUSINESS.priceRange` field removed entirely.
- `DEFAULT_OG_IMAGE.url`: `"https://picsum.photos/seed/nocturne-og/1200/630"`
  → `` `${SITE_URL}/opengraph-image` ``, pointing at the new generated image
  route (see below). `width`/`height`/`alt` stay as-is — the generated image
  is built at the same 1200x630 size.
- Remove the top-of-file `TODO: every value marked PLACEHOLDER...` banner
  comment and the inline `// PLACEHOLDER` comments on the fields above, since
  nothing will be left faked in this file after this change.

### 2. `app/page.tsx`

- Remove the now-dead `priceRange: BUSINESS.priceRange` line from the
  homepage's `jsonLd` object (the field no longer exists on `BUSINESS`).
- Remove the stale `// Placeholder LocalBusiness structured data — replace
  the placeholder fields in lib/seo.ts...` comment above it, since the
  fields it refers to are no longer placeholders.

### 3. `app/opengraph-image.tsx` (new)

A generated Open Graph image using Next's `next/og` `ImageResponse` API,
colocated at the site root so it's the default image for every route (any
future route can override it locally with its own `opengraph-image.tsx`,
e.g. per-service landing pages later).

- Size: 1200×630 (`export const size`), `contentType = 'image/png'`,
  `alt` matching `DEFAULT_OG_IMAGE.alt`.
- By default this is statically generated once at build and cached (per
  Next.js docs: static unless it uses request-time APIs) — no runtime cost
  per share.
- Visual design, matching the site's actual look (`app/globals.css` tokens
  and the homepage hero):
  - Background: `#faf6f0` (`--background`).
  - "Zach K. Johnson" wordmark in italic serif (Playfair Display), color
    `#2b2621` (`--foreground`), large.
  - Small uppercase tracked tagline beneath it — "Portrait & Boudoir
    Photography — Columbia, Missouri" — in `#a8613f` (`--accent`).
  - No photo; this is explicitly the "branded text card" option, an interim
    step until real photos replace it.
- Font handling: `next/font`'s Google Fonts loader isn't usable inside
  `ImageResponse` (Satori needs raw font bytes passed via the `fonts`
  option). Fetch the Playfair Display Italic woff/ttf bytes from Google
  Fonts' CSS2 API at generation time (same approach as the Next.js docs'
  "Using external data" example) rather than committing a font binary to
  the repo. Runs once at build since the image is statically generated.

### 4. `components/Footer.tsx`

- Add a `tel:+19014832391` link in the address/email column, displayed as
  `(901) 483-2391`, using `BUSINESS.telephone` from `lib/seo.ts` as the
  `href` source (formatted for the `tel:` link) with a separately-formatted
  display string.

## Out of scope

- Replacing the OG image with a real photo (blocked on real photography
  assets, explicitly deferred).
- Any changes to the `/book` flow's pricing display.
- The other four site-review items (testimonials/FAQ, service-specific
  landing pages, mobile nav, error/loading pages) — separate specs.

## Testing

- Visual check: load `/opengraph-image` directly in a browser to confirm
  the generated card renders correctly.
- `curl` a page and confirm the `og:image`/`twitter:image` meta tags point
  at `/opengraph-image` and the JSON-LD `telephone`/`geo` fields show the
  real values (no more `priceRange` key).
- Visual check: footer phone link renders and is a working `tel:` link.
