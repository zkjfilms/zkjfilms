# Music & Performance Photography Section — Design

**Goal:** Add concert/performance photography as a fourth bookable service, on equal footing with Headshots, Creative Portraits, and Boudoir — full `ServiceLandingPage` treatment, live booking pipeline, FAQ coverage. Rename the `/portraits` nav dropdown and its overview page to `/photos`, so all "stills" categories (Headshots, Creative Portraits, Boudoir, Music) are centralized under one umbrella that's explicitly broader than "portraits," while each keeps its own distinct page.

## Why this shape

Two things were confirmed with the site owner before design, since they change scope significantly:

1. **Music is a full bookable service, not a portfolio-only showcase** (like `/films`). This means it needs its own Supabase `appointment_type` (created by the owner via the existing admin UI after this ships — no code required there, since that pipeline is already fully DB-driven), its own `Service` entry, and FAQ pricing coverage — not just a new route with a photo grid.
2. **Nav placement:** under the existing dropdown (not top-level next to Films), with the dropdown's own label/URL renamed from "Portraits"/`/portraits` to "Photos"/`/photos`, since "Music" doesn't read naturally as a portrait style but does belong under a broader "stills" umbrella.

Existing patterns are reused as directly as possible rather than introduced fresh:

- `ServiceLandingPage` + `Service` type (`lib/services.ts`) — the exact mechanism already powering Headshots/Creative Portraits/Boudoir.
- `MasonryGallery`/`MasonryPhoto` (`lib/masonryPhotos.ts`) — same placeholder-then-real-photo workflow already in place for Headshots/Creative Portraits.
- `GalleryGroup` (`components/Gallery.tsx`) — same shape `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY` use for their `/photos` overview-page preview blocks.

No new component or data shape is introduced anywhere in this design.

## Routing & navigation

| Change | Detail |
|---|---|
| New route | `app/music/page.tsx` — thin wrapper, identical shape to `app/headshots/page.tsx` (`ServiceLandingPage` + `generateMetadata`). |
| Renamed route | `app/portraits/page.tsx` → `app/photos/page.tsx` (file move, not a new page — same overview-gallery mechanism, updated content per below). |
| Redirect | `next.config.ts` gets a permanent redirect: `/portraits` → `/photos`, so existing bookmarks/backlinks/SEO aren't broken. |
| `components/Navbar.tsx` | Main link: `{ href: "/portraits", label: "Portraits" }` → `{ href: "/photos", label: "Photos" }`. `PORTRAITS_SUBLINKS` renamed `PHOTOS_SUBLINKS`, gains a fourth entry: `{ href: "/music", label: "Music" }`. `HERO_ROUTES` swaps `/portraits` for `/photos` and adds `/music`. The three `if (link.href !== "/portraits")` checks update to `"/photos"`. |
| `app/sitemap.ts` | `/portraits` entry → `/photos`; new `/music` entry (`monthly`, priority `0.8`, matching the other three service pages). |
| Other `/portraits` links | `app/page.tsx` (homepage "View Portfolio →") and `app/not-found.tsx` ("Browse the Portfolio") both already use generic copy — only their `href` changes to `/photos`, no copy change. `components/ServiceLandingPage.tsx`'s footer link (`href="/portraits"`, label "All Portraits") → `href="/photos"`, label "All Photos". |

## New bookable service: Music

**`lib/services.ts`** — new export, added to the `SERVICES` array (which automatically makes it appear in every other service page's "Other Sessions" cross-link footer, and in `ServiceLandingPage`'s "Other Sessions" list for Music itself, no extra wiring needed):

```ts
export const MUSIC_SERVICE: Service = {
  slug: "music",
  name: "Music & Performance",
  appointmentTypeName: "Music & Performance Photography",
  tagline: "Live energy, captured from the pit.",
  description:
    "Concert and live-performance photography — bands, solo artists, and venues, shot in the moment. Booked directly by artists, venues, or labels for promo, press, and archival use.",
  heroImageSeed: "nocturne-music-hero",
  heroImageAlt: "Concert and live performance photography session.",
  gallery: null,
  masonryPhotos: MUSIC_MASONRY_PHOTOS,
  faqIds: ["session-length", "music-venue-access", "music-usage-rights"],
};
```

(Tagline/description above are a first draft — flagged for the owner's review/edit, same as any other placeholder copy in this repo.)

**`lib/masonryPhotos.ts`** — new `MUSIC_MASONRY_PHOTOS` constant, same picsum-placeholder pattern (varied real-feeling dimensions) as `HEADSHOTS_MASONRY_PHOTOS`/`CREATIVE_PORTRAITS_MASONRY_PHOTOS`, ready to be replaced entry-by-entry via `npm run image:upload`'s printed snippet.

**`app/music/page.tsx`**:

```tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { MUSIC_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Music & Performance Photography",
    description:
      "Concert and live performance photography in Columbia, Missouri and beyond — booked by artists, venues, and labels for promo and press.",
    path: "/music",
  });
}

export default function MusicPage() {
  return <ServiceLandingPage service={MUSIC_SERVICE} />;
}
```

**Booking pipeline:** no code changes. `BookingFlow` reads active `appointment_types` rows live from Supabase — the owner adds "Music & Performance Photography" (price, duration) via the existing admin UI (`app/admin/appointment-types`) after this ships, same as any other type. The "Book This Session" link on every `ServiceLandingPage` (including Music's) is a plain, un-parameterized link to `/book` today — it doesn't pre-select a type for any of the four services, so Music matches existing behavior exactly, not a new capability.

## FAQ content

Two new items, both placeholder copy flagged for owner review, added to `lib/faq.ts`'s `FAQ_ITEMS`:

```ts
{
  id: "music-venue-access",
  category: "Logistics",
  question: "Do you need photo pit or backstage access?",
  answer:
    "For ticketed venue shows, photo pit or backstage access is typically arranged through the venue or artist's management ahead of time — let me know your venue and I can coordinate whatever credentials are needed.",
},
{
  id: "music-usage-rights",
  category: "Pricing",
  question: "Can I use the photos for press or promotional purposes?",
  answer:
    "Yes — sessions booked for press, promo, or archival use include a usage license for that purpose. Reach out if you need something broader (album art, paid advertising, etc.) and we can work out terms.",
},
```

**Dynamic pricing sentence** (`buildSessionCostAnswer` in `lib/faq.ts`) gets a fourth, *optional* clause rather than a fourth *required* match — today the function returns `null` (falling back to the static 3-service answer) unless headshots/creative/boudoir **all** match. Music should not block that sentence before the owner has actually set its price:

```ts
function buildSessionCostAnswer(types: AppointmentTypeRow[]): string | null {
  const find = (keyword: string) =>
    types.find((t) => t.name.toLowerCase().includes(keyword));

  const headshots = find("headshot");
  const creative = find("creative");
  const boudoir = find("boudoir");
  if (!headshots || !creative || !boudoir) return null;

  const music = find("music");
  const musicClause = music
    ? ` Music & Performance Photography sessions start at ${formatWholeDollars(music.price_cents)} (${formatDuration(music.duration_minutes)}).`
    : "";

  return (
    `Professional Headshots start at ${formatWholeDollars(headshots.price_cents)} (${formatDuration(headshots.duration_minutes)}); ` +
    `Creative Portraits sessions start at ${formatWholeDollars(creative.price_cents)} (${formatDuration(creative.duration_minutes)}); ` +
    `Fine Art Boudoir & Nude sessions start at ${formatWholeDollars(boudoir.price_cents)} (${formatDuration(boudoir.duration_minutes)}).` +
    musicClause +
    " Full payment is collected at booking to confirm your session. Looking for something longer — a full-day creative shoot or event/video production? Reach out directly for a custom quote."
  );
}
```

The static `FAQ_ITEMS` fallback answer (used only if the dynamic query fails entirely) is left unchanged — it already generically covers "event/video production" via its closing sentence, and doesn't need to name a Music price that may not exist yet.

`"session-length"`'s existing answer is reused as-is for `MUSIC_SERVICE.faqIds` — it already says "full-day rates are available for event or creative video production," which covers performance work without edits.

## `/photos` overview page (renamed from `/portraits`)

- `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY` are untouched; a new `MUSIC_GALLERY: GalleryGroup` is added to `lib/services.ts` with two placeholder images as two `single` blocks — matching `HEADSHOTS_GALLERY`'s exact shape.
- On `app/photos/page.tsx`, a `musicGroup` is built the same way as `headshotsGroup`/`creativePortraitsGroup` (via `renumberGroup`), and appended to the `Gallery groups={[...]}` array **after** the existing hardcoded `editorialGroup` (whose indices 6–8 are hand-written, not dynamic) — starting at index 9 — so nothing about `editorialGroup`'s existing numbering has to change.
- Boudoir remains deliberately unfeatured on this overview page, matching its current privacy-motivated omission — no change to that precedent.
- Copy updates (title, meta description, intro paragraph) broaden from "portrait and creative photography" to explicitly name concert/performance work, so Music reads as its own distinct category rather than folded into "portraits." Exact copy drafted at implementation time, reviewed same as other placeholder text.

## Out of scope

- Setting Music's real price/duration in the admin UI — owner's task after ship.
- Uploading real concert photos — same `image:upload` / paste-into-`masonryPhotos.ts` workflow already in place, done later.
- Any change to Headshots/Creative Portraits/Boudoir content, pricing, or FAQ answers.
- Pre-selecting an appointment type from a service page's "Book This Session" link — out of scope; matches existing behavior for all four services.
- A dedicated FAQ category for music/events — the two new items fit existing `Logistics`/`Pricing` categories without needing a new one.

## Testing

No automated test suite in this repo. Verification: `tsc --noEmit`, `npm run lint`, `npm run build`; manual checks that `/music` renders correctly, `/photos` renders with the new Music preview block, `/portraits` redirects to `/photos`, the Navbar dropdown/hero-route behavior is correct on all four sublink pages, and the FAQ/`/book` pricing sentence still reads correctly both before and after a "Music & Performance Photography" appointment type exists in Supabase (i.e., confirm the optional-clause fallback doesn't break when Music isn't configured yet).
