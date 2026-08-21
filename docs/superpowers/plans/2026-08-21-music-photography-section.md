# Music & Performance Photography Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Music & Performance photography as a fourth fully bookable service (own route, `ServiceLandingPage`, masonry gallery, FAQ coverage), and rename the `/portraits` nav dropdown/overview page to `/photos` so Headshots, Creative Portraits, Boudoir, and Music are all centralized under one broader, accurate label.

**Architecture:** Reuses every existing pattern rather than introducing new ones — a new `Service` entry (`lib/services.ts`) rendered through the existing `ServiceLandingPage`/`MasonryGallery` components, a new `GalleryGroup` for the renamed overview page, two new `FaqItem`s, and mechanical route/nav renames (`app/portraits` → `app/photos`, `components/Navbar.tsx`, `next.config.ts` redirect, `app/sitemap.ts`).

**Tech Stack:** Next.js (App Router), existing `lib/services.ts`/`lib/faq.ts`/`lib/masonryPhotos.ts` data layer, no new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-21-music-photography-section-design.md`.
- No automated test suite exists in this repo. Verification is `tsc --noEmit`, `npm run lint`, `npm run build`, and manual browser checks — same pattern as every prior plan here.
- **No code changes to the booking pipeline itself** (Stripe, availability, admin appointment-types UI) — it's already fully DB-driven. Setting Music's real price/duration is the site owner's task after this ships.
- **No new FAQ category** — the two new FAQ items use the existing `Logistics`/`Pricing` categories.
- Every placeholder photo continues the existing `picsum.photos` convention (already an allowed `next/image` remote host) with varied real-feeling width/height pairs — never all one shape.
- `quality={90}` on any new `next/image` usage — matches this project's convention and is already an allowed value in `next.config.ts`'s `qualities` list.
- Tagline/description/FAQ copy in this plan is first-draft content, same as any other placeholder text in this repo — flag it for the site owner's review in your final report, don't treat it as unchangeable.
- `git checkout -- AGENTS.md` after any `npm run dev`/`npm run build` if it gets regenerated — discard before staging/committing.

---

## Task 1: `lib/masonryPhotos.ts` — Music placeholder photos

**Files:**
- Modify: `lib/masonryPhotos.ts`

**Interfaces:**
- Consumes: `MasonryPhoto` type (already defined in this file).
- Produces: `MUSIC_MASONRY_PHOTOS: MasonryPhoto[]`, consumed by Task 3's `lib/services.ts`.

- [ ] **Step 1: Add the new constant**

Read the file first. Add this new export at the end of the file, after `CREATIVE_PORTRAITS_MASONRY_PHOTOS`:

```ts
export const MUSIC_MASONRY_PHOTOS: MasonryPhoto[] = [
  {
    key: "music-placeholder-01",
    width: 1800,
    height: 1200,
    alt: "Concert and live performance photography, wide stage shot",
    src: "https://picsum.photos/seed/music-placeholder-01/1800/1200",
  },
  {
    key: "music-placeholder-02",
    width: 1067,
    height: 1600,
    alt: "Live music performance photography, vertical stage shot",
    src: "https://picsum.photos/seed/music-placeholder-02/1067/1600",
  },
  {
    key: "music-placeholder-03",
    width: 1600,
    height: 1067,
    alt: "Concert photography capturing a live band performance",
    src: "https://picsum.photos/seed/music-placeholder-03/1600/1067",
  },
  {
    key: "music-placeholder-04",
    width: 1400,
    height: 1400,
    alt: "Live performance photography, close crowd and stage lighting",
    src: "https://picsum.photos/seed/music-placeholder-04/1400/1400",
  },
  {
    key: "music-placeholder-05",
    width: 1200,
    height: 1800,
    alt: "Concert photography, vertical shot of a solo performer",
    src: "https://picsum.photos/seed/music-placeholder-05/1200/1800",
  },
  {
    key: "music-placeholder-06",
    width: 1800,
    height: 1200,
    alt: "Live music photography, wide shot of stage lighting and performer",
    src: "https://picsum.photos/seed/music-placeholder-06/1800/1200",
  },
];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/masonryPhotos.ts
git commit -m "Add Music masonry placeholder photos"
```

---

## Task 2: `lib/faq.ts` — Music FAQ items + optional pricing clause

**Files:**
- Modify: `lib/faq.ts`

**Interfaces:**
- Produces: two new `FaqItem`s with ids `"music-venue-access"` and `"music-usage-rights"`, consumed by Task 3's `MUSIC_SERVICE.faqIds`. `buildSessionCostAnswer` gains an optional fourth clause — no signature change (still `(types: AppointmentTypeRow[]) => string | null`).

- [ ] **Step 1: Add the two new FAQ items**

Read the file first. In the `FAQ_ITEMS` array, add these two entries right after the existing `"booking-window-reschedule"` item (still inside the array, before the closing `];`):

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

- [ ] **Step 2: Add the optional Music clause to `buildSessionCostAnswer`**

Find this function:

```ts
function buildSessionCostAnswer(types: AppointmentTypeRow[]): string | null {
  const find = (keyword: string) =>
    types.find((t) => t.name.toLowerCase().includes(keyword));

  const headshots = find("headshot");
  const creative = find("creative");
  const boudoir = find("boudoir");
  if (!headshots || !creative || !boudoir) return null;

  return (
    `Professional Headshots start at ${formatWholeDollars(headshots.price_cents)} (${formatDuration(headshots.duration_minutes)}); ` +
    `Creative Portraits sessions start at ${formatWholeDollars(creative.price_cents)} (${formatDuration(creative.duration_minutes)}); ` +
    `Fine Art Boudoir & Nude sessions start at ${formatWholeDollars(boudoir.price_cents)} (${formatDuration(boudoir.duration_minutes)}). ` +
    "Full payment is collected at booking to confirm your session. Looking for something longer — a full-day creative shoot or event/video production? Reach out directly for a custom quote."
  );
}
```

Replace it with this version — `music` is looked up but never required, so this sentence still returns correctly whether or not a "Music" appointment type exists yet:

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

(The static `FAQ_ITEMS` fallback answer for `"session-cost"`, used only if the live Supabase query fails entirely, is intentionally left unchanged — it already generically covers "event/video production" and shouldn't quote a Music price that may not exist yet.)

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Manual verification against live Supabase data**

Start the dev server (`npm run dev`). Visit `/faq` — confirm the two new questions ("Do you need photo pit or backstage access?" under Logistics, "Can I use the photos for press or promotional purposes?" under Pricing) render correctly. Visit `/book` — confirm the "How much do sessions cost?" teaser answer still reads correctly (3 services, no Music clause, since no "Music" appointment type exists in Supabase yet — this confirms the optional clause doesn't break anything before the owner configures pricing). Stop the dev server.

- [ ] **Step 5: Commit**

```bash
git add lib/faq.ts
git commit -m "Add Music FAQ items and optional pricing clause"
```

---

## Task 3: `lib/services.ts` — `MUSIC_GALLERY` and `MUSIC_SERVICE`

**Files:**
- Modify: `lib/services.ts`

**Interfaces:**
- Consumes: `MUSIC_MASONRY_PHOTOS` from `lib/masonryPhotos.ts` (Task 1); `"music-venue-access"`/`"music-usage-rights"` FAQ ids from `lib/faq.ts` (Task 2, referenced as plain strings — no import needed, `ServiceLandingPage` looks them up at render time).
- Produces: `MUSIC_GALLERY: GalleryGroup`, consumed by Task 5's `app/photos/page.tsx`. `MUSIC_SERVICE: Service` and its addition to the `SERVICES` array, consumed by Task 4's `app/music/page.tsx` and automatically by every other service page's "Other Sessions" footer (via `ServiceLandingPage.tsx`'s existing `SERVICES.filter(...)` logic — no changes needed there).

- [ ] **Step 1: Update the `lib/masonryPhotos` import**

Read the file first. Change:

```ts
import { HEADSHOTS_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS } from "@/lib/masonryPhotos";
```

to:

```ts
import { HEADSHOTS_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS, MUSIC_MASONRY_PHOTOS } from "@/lib/masonryPhotos";
```

- [ ] **Step 2: Add `MUSIC_GALLERY`**

Add this new export directly after `CREATIVE_PORTRAITS_GALLERY` (before `HEADSHOTS_SERVICE`):

```ts
export const MUSIC_GALLERY: GalleryGroup = {
  title: "Music & Performance",
  description:
    "Concert and live-performance photography — bands, solo artists, and venues, captured in the moment.",
  blocks: [
    {
      type: "single",
      items: [
        {
          seed: "nocturne-music-01",
          index: 1,
          alt: "Concert photography, live band performance, Columbia, Missouri",
        },
      ],
    },
    {
      type: "single",
      items: [
        {
          seed: "nocturne-music-02",
          index: 2,
          alt: "Live performance photography, solo artist on stage",
        },
      ],
    },
  ],
};
```

- [ ] **Step 3: Add `MUSIC_SERVICE`**

Add this new export directly after `BOUDOIR_SERVICE` (before the `SERVICES` array):

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

- [ ] **Step 4: Add `MUSIC_SERVICE` to the `SERVICES` array**

Change:

```ts
export const SERVICES: Service[] = [
  HEADSHOTS_SERVICE,
  CREATIVE_PORTRAITS_SERVICE,
  BOUDOIR_SERVICE,
];
```

to:

```ts
export const SERVICES: Service[] = [
  HEADSHOTS_SERVICE,
  CREATIVE_PORTRAITS_SERVICE,
  BOUDOIR_SERVICE,
  MUSIC_SERVICE,
];
```

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/services.ts
git commit -m "Add MUSIC_GALLERY and MUSIC_SERVICE"
```

---

## Task 4: `app/music/page.tsx` — new route

**Files:**
- Create: `app/music/page.tsx`

**Interfaces:**
- Consumes: `MUSIC_SERVICE` from `lib/services.ts` (Task 3); `ServiceLandingPage` from `components/ServiceLandingPage.tsx` (unmodified — already branches on `masonryPhotos`/`gallery`/`faqIds` generically).
- Produces: the `/music` route, consumed by Task 5's `MUSIC_GALLERY` link target and Task 7's Navbar sublink.

- [ ] **Step 1: Create the file**

This mirrors `app/headshots/page.tsx` exactly, swapping in `MUSIC_SERVICE`:

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

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors. `git checkout -- AGENTS.md` afterward if it was regenerated.

- [ ] **Step 3: Manual browser verification**

Start the dev server. Visit `/music` directly (it isn't linked from anywhere yet — that's Tasks 5 and 7) and confirm:

- Hero section renders with the tagline "Live energy, captured from the pit." and heading "Music & Performance Photography".
- The masonry gallery renders the 6 placeholder photos from Task 1 in a mixed layout.
- The FAQ section shows exactly 3 items in this order: "How long does a session take?", "Do you need photo pit or backstage access?", "Can I use the photos for press or promotional purposes?".
- "Book This Session" links to `/book`.
- "Other Sessions" footer lists Headshots, Creative Portraits, and Boudoir (not Music itself), plus an "All Portraits" link (this becomes "All Photos" in Task 6 — expected to still say "All Portraits" and point to `/portraits` at this point in the plan).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/music/page.tsx
git commit -m "Add /music route"
```

---

## Task 5: Rename `/portraits` → `/photos`, add Music preview block

**Files:**
- Move: `app/portraits/page.tsx` → `app/photos/page.tsx`

**Interfaces:**
- Consumes: `MUSIC_GALLERY` from `lib/services.ts` (Task 3); `/music` route existing (Task 4, as a link target only).
- Produces: the `/photos` route. Task 6 repoints other in-app links to it; Task 7's Navbar repoints its main link and updates `HERO_ROUTES`.

- [ ] **Step 1: Move the file**

```bash
git mv app/portraits app/photos
```

- [ ] **Step 2: Replace the file's contents**

Read the moved file first (it's unchanged content at this point, just relocated). Replace its entire contents with:

```tsx
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import Gallery, {
  type GalleryGroup,
  type GalleryImage,
} from "@/components/Gallery";
import {
  HEADSHOTS_GALLERY,
  CREATIVE_PORTRAITS_GALLERY,
  MUSIC_GALLERY,
} from "@/lib/services";

const TITLE = "Photography Gallery";
const DESCRIPTION =
  "Browse portrait, headshot, boudoir, concert, and fine art photography from a Columbia, Missouri photographer serving clients throughout Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/photos",
  });
}

// Alt text below is placeholder copy targeting local SEO keywords —
// replace with real per-image descriptions once final photos are added.
const editorialImages: GalleryImage[] = [
  {
    seed: "nocturne-portrait-06",
    index: 6,
    alt: "Editorial fine art photography shot in Columbia, Missouri",
  },
  {
    seed: "nocturne-portrait-07",
    index: 7,
    alt: "Narrative fine art portrait session in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-08",
    index: 8,
    alt: "Painterly fine art photography by Zach K. Johnson, Columbia, MO",
  },
];

const editorialGroup: GalleryGroup = {
  title: "Editorial & Fine Art",
  description:
    "Selected work from ongoing personal and collaborative projects, shot with a narrative or painterly sensibility.",
  blocks: [
    { type: "pair", items: [editorialImages[0], editorialImages[1]] },
    { type: "single", items: [editorialImages[2]] },
  ],
};

// HEADSHOTS_GALLERY/CREATIVE_PORTRAITS_GALLERY/MUSIC_GALLERY are shared with
// their own standalone pages, where each gallery numbers its own captions
// starting at 1. On this page every group shares one continuous sequence,
// so their captions are renumbered here at render time — the shared
// lib/services.ts data itself is never mutated (spread copies only), so the
// standalone pages are unaffected.
function renumberGroup(group: GalleryGroup, startIndex: number): GalleryGroup {
  let counter = startIndex;
  return {
    ...group,
    blocks: group.blocks.map((block) =>
      block.type === "single"
        ? { type: "single" as const, items: [{ ...block.items[0], index: counter++ }] as [GalleryImage] }
        : {
            type: "pair" as const,
            items: [
              { ...block.items[0], index: counter++ },
              { ...block.items[1], index: counter++ },
            ] as [GalleryImage, GalleryImage],
          },
    ),
  };
}

const headshotsGroup: GalleryGroup = {
  ...renumberGroup(HEADSHOTS_GALLERY, 1),
  link: { href: "/headshots", label: "View Headshots →" },
};

const creativePortraitsGroup: GalleryGroup = {
  ...renumberGroup(CREATIVE_PORTRAITS_GALLERY, 3),
  link: { href: "/creative-portraits", label: "View Creative Portraits →" },
};

// Placed after editorialGroup (whose indices 6-8 are hand-written above,
// not dynamically renumbered) so editorialGroup's own numbering never has
// to shift.
const musicGroup: GalleryGroup = {
  ...renumberGroup(MUSIC_GALLERY, 9),
  link: { href: "/music", label: "View Music →" },
};

export default function PhotosPage() {
  return (
    <div className="flex flex-col">
      {/* Opening */}
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src="https://picsum.photos/seed/nocturne-portrait-00/1800/1200"
          alt="Columbia, Missouri portrait, concert, and creative photography — Zach K. Johnson"
          fill
          priority
          quality={90}
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            Selected Work
          </p>
          <h1 className="max-w-xl font-serif text-4xl italic leading-tight text-white sm:text-5xl md:text-6xl">
            The work
          </h1>
        </div>
      </section>

      <p className="mx-auto max-w-2xl px-6 py-16 text-center text-muted sm:px-10">
        A collection of stills shot in and around Columbia, Missouri &mdash;
        headshots, individual portraits, collaborative creative work, and
        live concert and performance photography. Each session is built
        around what&rsquo;s in front of the camera, not a formula. Below is a
        look at the range: clean and professional when that&rsquo;s the
        goal, textured and cinematic when it&rsquo;s not, and full of raw
        energy on stage.
      </p>

      {/* Gallery */}
      <Gallery groups={[headshotsGroup, creativePortraitsGroup, editorialGroup, musicGroup]} />

      <div className="mx-auto -mt-12 mb-24 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/contact#booking"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book a Session
        </Link>
      </div>
    </div>
  );
}
```

Boudoir stays deliberately unfeatured here (matching its current privacy-motivated omission — do not add a `boudoirGroup`).

- [ ] **Step 2: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed. Note that other files still linking to `/portraits` (`app/page.tsx`, `app/not-found.tsx`, `components/ServiceLandingPage.tsx`, `app/sitemap.ts`, and `components/Navbar.tsx`) will now point at a route that no longer exists — this is expected and fixed in Tasks 6 and 7, not this one. `git checkout -- AGENTS.md` if regenerated.

- [ ] **Step 3: Manual browser verification**

Start the dev server. Visit `/photos` directly and confirm:

- Title/hero renders ("The work").
- Four gallery groups appear in order: Headshots (2 photos, "View Headshots →"), Creative Portraits (3 photos, "View Creative Portraits →"), Editorial & Fine Art (3 photos, no link), Music & Performance (2 photos, "View Music →").
- Click "View Music →" — confirm it navigates to `/music`.
- The intro paragraph mentions concert/performance work.
- The old `/portraits` URL now 404s (expected — the redirect isn't added until Task 6).

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add app/photos
git commit -m "Rename /portraits to /photos, add Music preview block"
```

(`git mv` in Step 1 already staged the `app/portraits` deletion side of the rename — `app/portraits` no longer exists on disk, so don't `git add` that path too, it'll error. `git add app/photos` here only needs to stage Step 2's content changes on top of the already-staged move.)

---

## Task 6: Fix remaining `/portraits` links, sitemap, and redirect

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/not-found.tsx`
- Modify: `components/ServiceLandingPage.tsx`
- Modify: `app/sitemap.ts`
- Modify: `next.config.ts`

**Interfaces:**
- Consumes: `/photos` route (Task 5), `/music` route (Task 4).
- No new interfaces produced — this is a pure link/config cleanup task.

- [ ] **Step 1: `app/page.tsx`**

Read the file first, find:

```tsx
          <Link
            href="/portraits"
            className="mt-2 border-b border-white/50 pb-1 text-xs uppercase tracking-[0.2em] text-white transition-colors hover:border-white"
          >
            View Portfolio →
          </Link>
```

Change `href="/portraits"` to `href="/photos"`. No other change on this line block.

- [ ] **Step 2: `app/not-found.tsx`**

Read the file first, find:

```tsx
        <Link
          href="/portraits"
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
        >
          Browse the Portfolio
        </Link>
```

Change `href="/portraits"` to `href="/photos"`. No other change on this line block.

- [ ] **Step 3: `components/ServiceLandingPage.tsx`**

Read the file first, find:

```tsx
          <Link
            href="/portraits"
            className="text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
          >
            All Portraits
          </Link>
```

Change to:

```tsx
          <Link
            href="/photos"
            className="text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
          >
            All Photos
          </Link>
```

- [ ] **Step 4: `app/sitemap.ts`**

Read the file first, find:

```ts
  { path: "/portraits", changeFrequency: "weekly", priority: 0.9 },
```

Change to:

```ts
  { path: "/photos", changeFrequency: "weekly", priority: 0.9 },
```

Then add a new entry after the existing `{ path: "/boudoir", ... }` line:

```ts
  { path: "/music", changeFrequency: "monthly", priority: 0.8 },
```

- [ ] **Step 5: `next.config.ts` — add the redirect**

Read the file first. Add a `redirects` async function to the exported `nextConfig` object, alongside the existing `images` and `headers` keys:

```ts
  async redirects() {
    return [
      { source: "/portraits", destination: "/photos", permanent: true },
    ];
  },
```

Place it after the `headers()` function, before the closing `};` of `nextConfig`.

- [ ] **Step 6: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors. `git checkout -- AGENTS.md` if regenerated.

- [ ] **Step 7: Manual browser verification**

Start the dev server (redirects configured via `next.config.ts` work in dev, not just production builds). Confirm:

- Visiting `/portraits` redirects to `/photos` (check the browser's final URL, or use `curl -sI http://localhost:3000/portraits | grep -i location` and confirm a 308 with `location: /photos`).
- Homepage (`/`) — the "View Portfolio →" link at the bottom of the "The Work" section points to `/photos` and navigates there correctly.
- The 404 page (visit any nonexistent path, e.g. `/this-does-not-exist`) — "Browse the Portfolio" points to `/photos`.
- On `/headshots`, `/creative-portraits`, `/boudoir`, and `/music`, the "Other Sessions" footer's "All Photos" link (previously "All Portraits") navigates to `/photos`.
- Fetch the sitemap: `curl -s http://localhost:3000/sitemap.xml | grep -E "photos|music|portraits"` — confirm `/photos` and `/music` both appear, and `/portraits` does not.

Stop the dev server.

- [ ] **Step 8: Commit**

```bash
git add app/page.tsx app/not-found.tsx components/ServiceLandingPage.tsx app/sitemap.ts next.config.ts
git commit -m "Repoint /portraits links to /photos, add redirect and sitemap entries"
```

---

## Task 7: `components/Navbar.tsx` — Photos label/route, Music sublink

**Files:**
- Modify: `components/Navbar.tsx`

**Interfaces:**
- Consumes: `/photos` route (Task 5), `/music` route (Task 4).
- No new interfaces produced — this is the plan's final consumer, making the nav actually link to everything built in Tasks 4–6.

- [ ] **Step 1: Replace the file's contents**

Read the current file first. Replace its entire contents with:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/", label: "Home" },
  { href: "/photos", label: "Photos" },
  { href: "/films", label: "Films" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];

const PHOTOS_SUBLINKS = [
  { href: "/headshots", label: "Headshots" },
  { href: "/creative-portraits", label: "Creative Portraits" },
  { href: "/boudoir", label: "Boudoir" },
  { href: "/music", label: "Music" },
];

// Routes that open with a full-bleed hero image the navbar can float over.
// Every other route gets the solid navbar immediately — there's no image
// at the very top for transparent white text to sit on.
const HERO_ROUTES = new Set([
  "/",
  "/photos",
  "/headshots",
  "/creative-portraits",
  "/boudoir",
  "/music",
]);

function MenuIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg
        width="20"
        height="20"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <line x1="3" y1="3" x2="17" y2="17" />
        <line x1="17" y1="3" x2="3" y2="17" />
      </svg>
    );
  }
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <line x1="2" y1="5" x2="18" y2="5" />
      <line x1="2" y1="10" x2="18" y2="10" />
      <line x1="2" y1="15" x2="18" y2="15" />
    </svg>
  );
}

function CaretIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
      className={`transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <polyline points="1.5,3 5,6.5 8.5,3" />
    </svg>
  );
}

export default function Navbar() {
  const pathname = usePathname();
  const hasHero = HERO_ROUTES.has(pathname);
  const [scrolledPastHero, setScrolledPastHero] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [photosDropdownOpen, setPhotosDropdownOpen] = useState(false);
  const photosRef = useRef<HTMLDivElement>(null);
  const [mobileAccordionOpen, setMobileAccordionOpen] = useState(false);
  const scrolled = !hasHero || scrolledPastHero;

  // Close the mobile menu on any route change — covers direct link taps
  // as well as back/forward navigation. Adjusting state during render
  // (rather than in an effect) avoids the extra post-navigation paint
  // where the stale menu would otherwise still be visible.
  // See: https://react.dev/reference/react/useState#storing-information-from-previous-renders
  const [prevPathname, setPrevPathname] = useState(pathname);
  if (pathname !== prevPathname) {
    setPrevPathname(pathname);
    setMobileMenuOpen(false);
    setPhotosDropdownOpen(false);
  }
  // The overlay always renders on the light `bg-background`, so the header
  // content needs the dark/foreground treatment whenever it's open — even
  // on an unscrolled hero route where the header itself stays transparent.
  const solidHeader = scrolled || mobileMenuOpen;

  useEffect(() => {
    if (!hasHero) return;

    function onScroll() {
      setScrolledPastHero(window.scrollY > 40);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasHero]);

  // Lock background scroll while the full-screen overlay is open, and let
  // Escape close it as a defense-in-depth affordance.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setMobileMenuOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mobileMenuOpen]);

  // The desktop dropdown gets its own Escape/outside-click handling,
  // independent of the mobile menu's — it doesn't need a scroll lock.
  useEffect(() => {
    if (!photosDropdownOpen) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setPhotosDropdownOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (photosRef.current && !photosRef.current.contains(e.target as Node)) {
        setPhotosDropdownOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [photosDropdownOpen]);

  // The overlay is hidden at md+ purely via CSS (`md:hidden`); if the
  // viewport crosses that breakpoint while it's open (e.g. rotating a
  // phone, or resizing a desktop window), reset the state so the scroll
  // lock above doesn't get stuck on with no visible control left to undo it.
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const mq = window.matchMedia("(min-width: 768px)");
    function onChange() {
      if (mq.matches) setMobileMenuOpen(false);
    }
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mobileMenuOpen]);

  // Reset the accordion every time the mobile menu itself closes, so
  // reopening it never shows a stale expanded state.
  const [prevMobileMenuOpen, setPrevMobileMenuOpen] = useState(mobileMenuOpen);
  if (mobileMenuOpen !== prevMobileMenuOpen) {
    setPrevMobileMenuOpen(mobileMenuOpen);
    if (!mobileMenuOpen) setMobileAccordionOpen(false);
  }

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-colors duration-500 ${
          scrolled
            ? "border-b border-border bg-background/90 backdrop-blur-md"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6 sm:px-10">
          <Link
            href="/"
            className={`font-serif text-xl italic tracking-wide transition-colors duration-500 ${
              solidHeader ? "text-foreground" : "text-white"
            }`}
          >
            Zach K. Johnson
          </Link>
          <nav className="hidden items-center gap-8 sm:gap-10 md:flex">
            {links.map((link) => {
              const linkClass = `text-[11px] uppercase tracking-[0.2em] transition-colors duration-500 ${
                scrolled
                  ? "text-muted hover:text-foreground"
                  : "text-white/80 hover:text-white"
              }`;

              if (link.href !== "/photos") {
                return (
                  <Link key={link.href} href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                );
              }

              return (
                <div
                  key={link.href}
                  ref={photosRef}
                  className="relative flex items-center gap-1.5"
                  onMouseEnter={() => {
                    if (window.matchMedia("(hover: hover)").matches) {
                      setPhotosDropdownOpen(true);
                    }
                  }}
                  onMouseLeave={() => setPhotosDropdownOpen(false)}
                >
                  <Link href={link.href} className={linkClass}>
                    {link.label}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setPhotosDropdownOpen((open) => !open)}
                    aria-expanded={photosDropdownOpen}
                    aria-label="Show photo categories"
                    className={`${linkClass} p-2 -my-2 -mr-2`}
                  >
                    <CaretIcon open={photosDropdownOpen} />
                  </button>
                  {photosDropdownOpen && (
                    <div className="absolute top-full left-0 pt-2">
                      <div className="min-w-[180px] border border-border bg-background/95 py-2 backdrop-blur-md">
                        {PHOTOS_SUBLINKS.map((sub) => (
                          <Link
                            key={sub.href}
                            href={sub.href}
                            className="block px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
                          >
                            {sub.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            className={`p-2 -m-2 transition-colors duration-500 md:hidden ${
              solidHeader ? "text-foreground" : "text-white"
            }`}
          >
            <MenuIcon open={mobileMenuOpen} />
          </button>
        </div>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-8 bg-background md:hidden">
          {links.map((link) => {
            if (link.href !== "/photos") {
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
                >
                  {link.label}
                </Link>
              );
            }

            return (
              <div key={link.href} className="flex flex-col items-center gap-6">
                <div className="flex items-center gap-2">
                  <Link
                    href={link.href}
                    className="text-lg uppercase tracking-[0.2em] text-foreground transition-colors hover:text-accent"
                  >
                    {link.label}
                  </Link>
                  <button
                    type="button"
                    onClick={() => setMobileAccordionOpen((open) => !open)}
                    aria-expanded={mobileAccordionOpen}
                    aria-label="Show photo categories"
                    className="text-foreground p-3 -my-3 -mr-3"
                  >
                    <CaretIcon open={mobileAccordionOpen} />
                  </button>
                </div>
                {mobileAccordionOpen && (
                  <div className="flex flex-col items-center gap-5">
                    {PHOTOS_SUBLINKS.map((sub) => (
                      <Link
                        key={sub.href}
                        href={sub.href}
                        className="text-sm uppercase tracking-[0.2em] text-muted transition-colors hover:text-accent"
                      >
                        {sub.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Lint and type-check**

```bash
npm run lint
npx tsc --noEmit
```

Expected: no errors from either.

- [ ] **Step 3: Manual browser verification**

Start the dev server. Confirm:

- Desktop nav shows "Home / Photos / Films / About / Book / Contact" (no more "Portraits").
- Hovering "Photos" (or clicking its caret button) opens a dropdown with exactly four entries in order: Headshots, Creative Portraits, Boudoir, Music.
- Clicking each of the four dropdown entries navigates to its correct route (`/headshots`, `/creative-portraits`, `/boudoir`, `/music`) and each renders with a transparent-over-hero navbar that solidifies on scroll (confirming `HERO_ROUTES` includes all of them).
- `/photos` itself also renders with the hero-navbar behavior.
- Resize to mobile width, open the hamburger menu, confirm "Photos" appears with a working accordion caret that expands to the same four sublinks, and tapping any of them closes the mobile menu (confirming the pathname-change reset still works with the renamed state).
- Click outside an open dropdown, and press `Escape` while it's open — both still close it.

Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add components/Navbar.tsx
git commit -m "Rename Portraits nav to Photos, add Music sublink"
```

---

## Final verification (after all 7 tasks)

- [ ] Run the full check sequence once more end-to-end:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: all three succeed with no errors.

- [ ] In your final report to the site owner, flag every piece of first-draft copy for their review: `MUSIC_SERVICE`'s tagline/description/hero alt text (`lib/services.ts`), the two new FAQ answers (`lib/faq.ts`), and `app/photos/page.tsx`'s updated intro paragraph — same as any other placeholder content in this repo, these are meant to be read and adjusted, not treated as final.
- [ ] Remind the owner that Music's real price/duration still needs to be set via the existing admin UI (`/admin/appointment-types`) before it's actually bookable — the site will build and run correctly without it (the "Book This Session" link on `/music` works today, listing whatever appointment types exist), it just won't show a price anywhere until that row exists.
