# Service-specific landing pages

## Context

A full-site review identified that every bookable service (headshots,
creative portraits, boudoir/fine art nude) is lumped into one generic
`/portraits` gallery page, even though the booking flow and marketing copy
sell them as distinct offerings — diluting each one's SEO surface instead
of letting it rank for its own search intent (e.g. "boudoir photography
Columbia MO" vs. a shared, generic portrait page). This is the third of
five site-improvement items from that review (after the placeholder-data
fix and the FAQ page; mobile nav and custom error/loading pages remain).

While scoping this, the live `appointment_types` table turned out to have
changed since earlier in this project (independently, outside this
conversation): it now has three real types, not two —

| Name | Price | Duration |
|---|---|---|
| Creative Portraits | $250 | 120 min |
| Fine Art Boudoir & Nude | $350 | 180 min |
| Professional Headshots | $150 | 20 min |

— confirmed by the site owner as the authoritative, correct current
state. This settles what was originally an open question (whether
"Boudoir" needed its own appointment type separate from "Fine Art Nude"):
it doesn't — boudoir and fine art nude are one combined bookable type.
So this spec covers **three** landing pages, not four.

## Decisions made with the user

- **Nav placement:** these pages are NOT added to the main navbar (which
  has no mobile menu yet — a separate, not-yet-done task; adding more
  top-level links now would worsen that gap). Instead, `/portraits`
  (already in the navbar) links out to them, and they link back to
  `/portraits` and to each other.
- **Boudoir/fine-art visuals:** hero image only, no gallery grid — matches
  the site's existing discretion-first posture (the `/portraits` page
  already shows zero boudoir/nude images). The existing "Editorial & Fine
  Art" gallery group on `/portraits` doesn't actually depict nudity per
  its alt text, so it isn't representative of this service anyway and
  stays on `/portraits` unchanged, unconnected to the new boudoir page.
- **Headshots and Creative Portraits visuals:** reuse the existing
  matching gallery image groups already on `/portraits` (2 images for
  Headshots & Branding, 3 for Creative Portraits) rather than sourcing new
  placeholder photos — consistent with photo replacement being out of
  scope for this whole engagement.
- **FAQ integration:** each page shows 1-2 relevant questions via the
  existing `FaqAccordion` component (built for the FAQ feature, designed
  to be reused exactly like this), addressing that service's most likely
  objection directly on the page.
- **Booking CTAs:** every page's CTA links to `/book` generically — no
  appointment-type deep-linking/pre-selection. `BookingFlow.tsx` (the live
  booking system) is not modified by this spec; visitors pick their
  session type from the existing picker once they arrive.
- **No new appointment types created** — all three already exist in the
  live database as of the table above.
- **FAQ content fix (folded into this spec):** `lib/faq.ts`'s
  `session-cost` answer predates the Headshots type and the Boudoir & Nude
  rename — it currently says "Creative Portraits sessions start at $250
  (2 hours); Fine Art Nude sessions start at $350 (3 hours)" with no
  mention of Headshots. Since these new pages surface FAQ content
  directly, this stale answer is corrected as part of this work rather
  than left to drift further.

## Architecture

Mirrors the FAQ feature's data-file + reusable-component pattern:

- **`lib/services.ts`** (new) — single source of truth: an array of
  `{ slug, name, appointmentTypeName, tagline, description, heroImageSeed,
  heroImageAlt, gallery: GalleryGroup | null, faqIds: string[] }` for the
  3 services. `gallery` is `null` for Boudoir (hero-only); for Headshots
  and Creative Portraits it holds the exact `GalleryGroup` object (title,
  description, blocks) already defined inline in
  `app/portraits/page.tsx` today, moved here so both `/portraits` and the
  new page read the identical data — no copy-pasted image lists that can
  drift apart. `faqIds` references `FaqItem.id` values from `lib/faq.ts`
  (Task 1's existing export), the same cross-file reference pattern
  `app/book/page.tsx`'s `TEASER_FAQ_IDS` already uses.
- **`components/ServiceLandingPage.tsx`** (new) — server component taking
  one service's data as props. Renders: a full-bleed hero (matching
  `/portraits`' existing hero section markup/gradient treatment), a
  title/tagline header, description copy, the gallery via the existing
  `Gallery` component (skipped entirely when `gallery` is `null`), a
  `FaqAccordion` with that service's `faqIds` resolved against
  `FAQ_ITEMS`, a booking CTA (`Link` to `/book`), and a text-link row to
  the other two services (via `lib/services.ts`'s own array, filtered to
  exclude the current page).
- **Three page files** — `app/headshots/page.tsx`,
  `app/creative-portraits/page.tsx`, `app/boudoir/page.tsx`. Each is
  metadata (`buildPageMetadata`) plus `<ServiceLandingPage service={...} />`
  with that service's entry from `lib/services.ts` — no page-specific
  logic beyond selecting which entry.
- **`app/portraits/page.tsx`** (modify) — add a text link under the
  existing "Headshots & Branding" group ("View Headshots →" to
  `/headshots`) and under "Creative Portraits" ("View Creative Portraits
  →" to `/creative-portraits`). The "Editorial & Fine Art" group is
  unchanged (no matching new page). The inline `images`/`groups` arrays
  currently defined in this file for the Headshots and Creative Portraits
  groups move to `lib/services.ts` as described above; this file imports
  them back for its own rendering rather than defining them twice.
- **`app/sitemap.ts`** (modify) — add `/headshots`, `/creative-portraits`,
  `/boudoir`.
- **`lib/faq.ts`** (modify) — rewrite the `session-cost` item's `answer`
  to include all three current services and correct names/prices.

## Content

Each service has a short `tagline` (one line, matching the homepage
hero's "Portraits, uncovered." register) and a longer `description`
paragraph. This is final copy, not draft text — reproduce exactly.

**Headshots** (`/headshots`, appointment type "Professional Headshots",
$150/20 min)
- Hero image: seed `nocturne-headshots-hero`, alt "Professional headshot photography session in Columbia, Missouri."
- Tagline: "Polished, professional, and unmistakably you."
- Description: "Professional portraits for people who need to show up
  polished — LinkedIn, business branding, personal websites, and
  professional profiles. Clean, confident, and ready for wherever you
  need to make a first impression."
- Gallery: the existing 2 images (seeds `nocturne-portrait-01`,
  `nocturne-portrait-02`) from that group.
- FAQ: `session-what-happens`, `what-to-wear`.
- Metadata: title "Professional Headshots", description "Professional headshot photography in Columbia, Missouri — polished portraits for LinkedIn, business branding, and professional profiles."

**Creative Portraits** (`/creative-portraits`, appointment type "Creative
Portraits", $250/120 min)
- Hero image: seed `nocturne-creative-hero`, alt "Art-directed creative portrait photography session in Columbia, Missouri."
- Tagline: "Art-directed portraits, built around a concept."
- Description: "More personal, more art-directed. Lighting, styling, and
  concept-driven sessions for people who want something beyond a standard
  portrait — a set of images that actually feels like you."
- Gallery: the existing 3 images (seeds `nocturne-portrait-03`,
  `nocturne-portrait-04`, `nocturne-portrait-05`).
- FAQ: `what-to-wear`, `session-what-happens`.
- Metadata: title "Creative Portraits", description "Art-directed creative portrait photography sessions in Columbia, Missouri, built around concept, lighting, and styling."

**Boudoir** (`/boudoir`, appointment type "Fine Art Boudoir & Nude",
$350/180 min)
- Tagline: "Intimate work, entirely on your terms."
- Description: "Boudoir and fine art nude photography built around trust.
  This is some of the most personal work I do — shaped entirely around
  what you're comfortable with, at whatever pace feels right. Every image
  stays private unless you decide otherwise: fully public, cropped and
  anonymous, or never shared at all."
- Hero image: seed `nocturne-boudoir-hero`, alt "Fine art boudoir photography session in Columbia, Missouri."
- Gallery: none (hero image only).
- FAQ: `privacy-boudoir`, `sign-anything`.
- Metadata: title "Boudoir & Fine Art Nude", description "Fine art boudoir and nude photography in Columbia, Missouri — intimate sessions built around trust, privacy, and what you're comfortable with."

**`lib/faq.ts` `session-cost` answer, corrected:**
"Professional Headshots start at $150 (20 minutes); Creative Portraits
sessions start at $250 (2 hours); Fine Art Boudoir & Nude sessions start
at $350 (3 hours). Full payment is collected at booking to confirm your
session. Looking for something longer — a full-day creative shoot or
event/video production? Reach out directly for a custom quote."

## Out of scope

- Adding these pages to the main navbar (blocked on the not-yet-done
  mobile nav task).
- Any change to `BookingFlow.tsx` or appointment-type deep-linking from
  these pages.
- Real photography (all imagery stays placeholder/reused, per the
  standing photo-replacement exclusion for this whole engagement).
- Creating or modifying appointment types in the database (all three
  already exist).
- Testimonials on these pages (still blocked on real client quotes, per
  the earlier-deferred testimonials spec).

## Testing

- Visual check: each of the 3 pages renders its hero, description, gallery
  (or its absence for Boudoir), FAQ accordion, booking CTA, and cross-links
  to the other two services.
- Visual check: `/portraits`' Headshots and Creative Portraits groups each
  show a working "View [X] →" link; the Editorial & Fine Art group is
  unchanged.
- `curl`/`grep` check: all 3 new paths present in `sitemap.xml`.
- `curl`/`grep` check: `lib/faq.ts`'s `session-cost` answer (rendered on
  `/faq`) mentions "Professional Headshots," "$150," and "Fine Art Boudoir
  & Nude," and no longer says "Fine Art Nude" alone.
- `npm run build` succeeds; all 3 new routes listed as static in the build
  output.
