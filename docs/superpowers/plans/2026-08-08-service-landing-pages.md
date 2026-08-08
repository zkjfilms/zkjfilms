# Service-Specific Landing Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship three dedicated service landing pages (Headshots, Creative Portraits, Boudoir & Fine Art Nude) targeting their own search intent, reusing existing gallery images and FAQ content rather than adding new placeholder assets.

**Architecture:** A single `lib/services.ts` data file holds each service's copy, hero image, gallery (reusing the exact `GalleryGroup` objects currently inlined in `app/portraits/page.tsx`), and relevant FAQ ids. One reusable `components/ServiceLandingPage.tsx` template renders any service. Three thin page files select which service to render. `app/portraits/page.tsx` is restructured to import the same gallery data (instead of duplicating it) and link out to the two pages that have a matching gallery group. `lib/faq.ts`'s `session-cost` answer is corrected to match the current three-appointment-type reality.

**Tech Stack:** Next.js 16 App Router, TypeScript, Tailwind v4 (existing design tokens), reuses `components/Gallery.tsx` and `components/FaqAccordion.tsx` (both already in the codebase) — no new dependencies.

## Global Constraints

- Three services only (not four) — the live `appointment_types` table has Headshots ($150/20min), Creative Portraits ($250/120min), and one combined Fine Art Boudoir & Nude ($350/180min). No new appointment types are created by this plan; all three already exist.
- Boudoir has NO gallery — hero image only, matching the site's existing discretion-first posture. Headshots and Creative Portraits reuse their existing `/portraits` gallery images exactly (same seeds/alt text), just moved into shared data.
- These pages are NOT added to `components/Navbar.tsx` — linked only from `/portraits` and from each other.
- Booking CTAs link to `/book` generically — no appointment-type deep-linking. `app/book/BookingFlow.tsx` is not touched by this plan.
- All copy below (taglines, descriptions, metadata) is final — reproduce exactly, do not paraphrase.
- This project has no test framework — the verification gate for every task is `npm run build` plus targeted `curl`/`grep` checks.
- Every task must end with a working `npm run build`.

---

### Task 1: Service content data (`lib/services.ts`)

**Files:**
- Create: `lib/services.ts`

**Interfaces:**
- Produces: `type Service = { slug, name, appointmentTypeName, tagline, description, heroImageSeed, heroImageAlt, gallery: GalleryGroup | null, faqIds: string[] }`; `HEADSHOTS_GALLERY`, `CREATIVE_PORTRAITS_GALLERY` (both `GalleryGroup`, exported separately so `app/portraits/page.tsx` can import them without unwrapping a `Service`); `HEADSHOTS_SERVICE`, `CREATIVE_PORTRAITS_SERVICE`, `BOUDOIR_SERVICE` (each `Service`); `SERVICES: Service[]` (all three, in that order). Consumed by Task 2 (`ServiceLandingPage`, via `SERVICES` and the `Service` type), Task 3 (each page imports its own named `*_SERVICE` constant), Task 4 (`app/portraits/page.tsx` imports `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY`).

- [ ] **Step 1: Create `lib/services.ts`**

```ts
import type { GalleryGroup } from "@/components/Gallery";

export type Service = {
  slug: string;
  name: string;
  appointmentTypeName: string;
  tagline: string;
  description: string;
  heroImageSeed: string;
  heroImageAlt: string;
  gallery: GalleryGroup | null;
  faqIds: string[];
};

export const HEADSHOTS_GALLERY: GalleryGroup = {
  title: "Headshots & Branding",
  description:
    "Professional portraits for people who need to show up polished: LinkedIn, business branding, personal websites, and professional profiles.",
  blocks: [
    {
      type: "single",
      items: [
        {
          seed: "nocturne-portrait-01",
          index: 1,
          alt: "Professional headshot session in Columbia, Missouri",
        },
      ],
    },
    {
      type: "single",
      items: [
        {
          seed: "nocturne-portrait-02",
          index: 2,
          alt: "Business branding portrait photographed in Mid-Missouri",
        },
      ],
    },
  ],
};

export const CREATIVE_PORTRAITS_GALLERY: GalleryGroup = {
  title: "Creative Portraits",
  description:
    "More personal, more art-directed. Lighting, styling, and concept-driven sessions for people who want something beyond a standard portrait.",
  blocks: [
    {
      type: "pair",
      items: [
        {
          seed: "nocturne-portrait-03",
          index: 1,
          alt: "Art-directed creative portrait session in Columbia, MO",
        },
        {
          seed: "nocturne-portrait-04",
          index: 2,
          alt: "Styled creative portrait photography in Mid-Missouri",
        },
      ],
    },
    {
      type: "single",
      items: [
        {
          seed: "nocturne-portrait-05",
          index: 3,
          alt: "Concept-driven portrait session by a Columbia, Missouri photographer",
        },
      ],
    },
  ],
};

export const HEADSHOTS_SERVICE: Service = {
  slug: "headshots",
  name: "Headshots",
  appointmentTypeName: "Professional Headshots",
  tagline: "Polished, professional, and unmistakably you.",
  description:
    "Professional portraits for people who need to show up polished — LinkedIn, business branding, personal websites, and professional profiles. Clean, confident, and ready for wherever you need to make a first impression.",
  heroImageSeed: "nocturne-headshots-hero",
  heroImageAlt:
    "Professional headshot photography session in Columbia, Missouri.",
  gallery: HEADSHOTS_GALLERY,
  faqIds: ["session-what-happens", "what-to-wear"],
};

export const CREATIVE_PORTRAITS_SERVICE: Service = {
  slug: "creative-portraits",
  name: "Creative Portraits",
  appointmentTypeName: "Creative Portraits",
  tagline: "Art-directed portraits, built around a concept.",
  description:
    "More personal, more art-directed. Lighting, styling, and concept-driven sessions for people who want something beyond a standard portrait — a set of images that actually feels like you.",
  heroImageSeed: "nocturne-creative-hero",
  heroImageAlt:
    "Art-directed creative portrait photography session in Columbia, Missouri.",
  gallery: CREATIVE_PORTRAITS_GALLERY,
  faqIds: ["what-to-wear", "session-what-happens"],
};

export const BOUDOIR_SERVICE: Service = {
  slug: "boudoir",
  name: "Boudoir & Fine Art Nude",
  appointmentTypeName: "Fine Art Boudoir & Nude",
  tagline: "Intimate work, entirely on your terms.",
  description:
    "Boudoir and fine art nude photography built around trust. This is some of the most personal work I do — shaped entirely around what you're comfortable with, at whatever pace feels right. Every image stays private unless you decide otherwise: fully public, cropped and anonymous, or never shared at all.",
  heroImageSeed: "nocturne-boudoir-hero",
  heroImageAlt: "Fine art boudoir photography session in Columbia, Missouri.",
  gallery: null,
  faqIds: ["privacy-boudoir", "sign-anything"],
};

export const SERVICES: Service[] = [
  HEADSHOTS_SERVICE,
  CREATIVE_PORTRAITS_SERVICE,
  BOUDOIR_SERVICE,
];
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds (no consumers yet — same as `lib/faq.ts` in the earlier FAQ plan, an unused-but-valid module is not a build error here).

- [ ] **Step 3: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add lib/services.ts
git commit -m "Add service content data (lib/services.ts)"
```

---

### Task 2: Reusable service page template (`components/ServiceLandingPage.tsx`)

**Files:**
- Create: `components/ServiceLandingPage.tsx`

**Interfaces:**
- Consumes: `Service`, `SERVICES` from `lib/services.ts` (Task 1); `FAQ_ITEMS`, `FaqItem` from `lib/faq.ts` (already exists); `FaqAccordion` from `components/FaqAccordion.tsx` (already exists); `Gallery` from `components/Gallery.tsx` (already exists).
- Produces: `export default function ServiceLandingPage({ service }: { service: Service })`. Consumed by Task 3 (all three page files).

- [ ] **Step 1: Create `components/ServiceLandingPage.tsx`**

```tsx
import Image from "next/image";
import Link from "next/link";
import Gallery from "@/components/Gallery";
import FaqAccordion from "@/components/FaqAccordion";
import { FAQ_ITEMS, type FaqItem } from "@/lib/faq";
import { SERVICES, type Service } from "@/lib/services";

export default function ServiceLandingPage({
  service,
}: {
  service: Service;
}) {
  const faqItems = service.faqIds
    .map((id) => FAQ_ITEMS.find((item) => item.id === id))
    .filter((item): item is FaqItem => item !== undefined);

  const otherServices = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <div className="flex flex-col">
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src={`https://picsum.photos/seed/${service.heroImageSeed}/1800/1200`}
          alt={service.heroImageAlt}
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            {service.tagline}
          </p>
          <h1 className="max-w-xl font-serif text-4xl italic leading-tight text-white sm:text-5xl md:text-6xl">
            {service.name}
          </h1>
        </div>
      </section>

      {service.gallery ? (
        <Gallery groups={[service.gallery]} />
      ) : (
        <p className="mx-auto max-w-2xl px-6 py-16 text-center text-muted sm:px-10">
          {service.description}
        </p>
      )}

      {faqItems.length > 0 && (
        <div className="mx-auto w-full max-w-2xl px-6 sm:px-10">
          <FaqAccordion items={faqItems} />
        </div>
      )}

      <div className="mx-auto mt-12 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/book"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book This Session
        </Link>
      </div>

      <div className="mx-auto mb-24 mt-10 flex w-full max-w-2xl flex-col items-center gap-3 px-6 text-center sm:px-10">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Other Sessions
        </p>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          {otherServices.map((other) => (
            <Link
              key={other.slug}
              href={`/${other.slug}`}
              className="text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
            >
              {other.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Note on the conditional at the top of the render: when `service.gallery` is set (Headshots, Creative Portraits), the gallery's own group header (`Gallery` renders `group.title`/`group.description`) is what shows the descriptive copy — `service.description` is intentionally NOT rendered inline for those two (it would duplicate `gallery.description`, which is nearly identical text). `service.description` is only rendered on the page for Boudoir, where `gallery` is `null`. This is deliberate, not a bug — don't add a second unconditional rendering of `service.description`.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds (no page consumers yet).

- [ ] **Step 3: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add components/ServiceLandingPage.tsx
git commit -m "Add reusable ServiceLandingPage template component"
```

---

### Task 3: Three service pages + sitemap entries

**Files:**
- Create: `app/headshots/page.tsx`
- Create: `app/creative-portraits/page.tsx`
- Create: `app/boudoir/page.tsx`
- Modify: `app/sitemap.ts:10-17` (the `routes` array)

**Interfaces:**
- Consumes: `HEADSHOTS_SERVICE`, `CREATIVE_PORTRAITS_SERVICE`, `BOUDOIR_SERVICE` from `lib/services.ts` (Task 1); `ServiceLandingPage` from `components/ServiceLandingPage.tsx` (Task 2); `buildPageMetadata` from `lib/seo.ts` (existing).
- Produces: the `/headshots`, `/creative-portraits`, `/boudoir` routes. No exports consumed elsewhere.

- [ ] **Step 1: Create `app/headshots/page.tsx`**

```tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { HEADSHOTS_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Professional Headshots",
    description:
      "Professional headshot photography in Columbia, Missouri — polished portraits for LinkedIn, business branding, and professional profiles.",
    path: "/headshots",
  });
}

export default function HeadshotsPage() {
  return <ServiceLandingPage service={HEADSHOTS_SERVICE} />;
}
```

- [ ] **Step 2: Create `app/creative-portraits/page.tsx`**

```tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { CREATIVE_PORTRAITS_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Creative Portraits",
    description:
      "Art-directed creative portrait photography sessions in Columbia, Missouri, built around concept, lighting, and styling.",
    path: "/creative-portraits",
  });
}

export default function CreativePortraitsPage() {
  return <ServiceLandingPage service={CREATIVE_PORTRAITS_SERVICE} />;
}
```

- [ ] **Step 3: Create `app/boudoir/page.tsx`**

```tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import ServiceLandingPage from "@/components/ServiceLandingPage";
import { BOUDOIR_SERVICE } from "@/lib/services";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Boudoir & Fine Art Nude",
    description:
      "Fine art boudoir and nude photography in Columbia, Missouri — intimate sessions built around trust, privacy, and what you're comfortable with.",
    path: "/boudoir",
  });
}

export default function BoudoirPage() {
  return <ServiceLandingPage service={BOUDOIR_SERVICE} />;
}
```

- [ ] **Step 4: Edit `app/sitemap.ts`**

Find:

```ts
  { path: "", changeFrequency: "monthly", priority: 1 },
  { path: "/portraits", changeFrequency: "weekly", priority: 0.9 },
  { path: "/book", changeFrequency: "daily", priority: 0.8 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.8 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
];
```

Replace with:

```ts
  { path: "", changeFrequency: "monthly", priority: 1 },
  { path: "/portraits", changeFrequency: "weekly", priority: 0.9 },
  { path: "/book", changeFrequency: "daily", priority: 0.8 },
  { path: "/contact", changeFrequency: "yearly", priority: 0.8 },
  { path: "/about", changeFrequency: "yearly", priority: 0.6 },
  { path: "/faq", changeFrequency: "monthly", priority: 0.7 },
  { path: "/headshots", changeFrequency: "monthly", priority: 0.8 },
  { path: "/creative-portraits", changeFrequency: "monthly", priority: 0.8 },
  { path: "/boudoir", changeFrequency: "monthly", priority: 0.8 },
];
```

- [ ] **Step 5: Build and verify**

Run: `npm run build`
Expected: succeeds; route output includes `○ /headshots`, `○ /creative-portraits`, `○ /boudoir` (all static), and `○ /sitemap.xml`.

- [ ] **Step 6: Verify each page renders its expected content**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
npm run dev &
sleep 3
curl -s http://localhost:3000/headshots | grep -o 'Polished, professional, and unmistakably you\.'
curl -s http://localhost:3000/headshots | grep -o 'Professional headshot session in Columbia, Missouri'
curl -s http://localhost:3000/creative-portraits | grep -o 'Art-directed portraits, built around a concept\.'
curl -s http://localhost:3000/boudoir | grep -o 'Intimate work, entirely on your terms\.'
curl -s http://localhost:3000/boudoir | grep -o 'Boudoir and fine art nude photography built around trust'
curl -s http://localhost:3000/boudoir | grep -c '<img'
curl -s http://localhost:3000/sitemap.xml | grep -o '<loc>[^<]*/headshots</loc>'
curl -s http://localhost:3000/sitemap.xml | grep -o '<loc>[^<]*/creative-portraits</loc>'
curl -s http://localhost:3000/sitemap.xml | grep -o '<loc>[^<]*/boudoir</loc>'
kill %1
```
Expected: each grep for tagline/description text matches once; `/headshots` shows its gallery image alt text (confirming the gallery rendered); `/boudoir`'s description paragraph is present (confirming the no-gallery branch rendered); `/boudoir`'s `<img` count is `1` (hero image only — no gallery images); all three sitemap `<loc>` entries present.

- [ ] **Step 7: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add app/headshots/page.tsx app/creative-portraits/page.tsx app/boudoir/page.tsx app/sitemap.ts
git commit -m "Add /headshots, /creative-portraits, /boudoir landing pages, list them in the sitemap"
```

---

### Task 4: Restructure `/portraits` to reuse shared gallery data and link out

**Files:**
- Modify: `app/portraits/page.tsx` (whole file — shown in full below)

**Interfaces:**
- Consumes: `HEADSHOTS_GALLERY`, `CREATIVE_PORTRAITS_GALLERY` from `lib/services.ts` (Task 1).

- [ ] **Step 1: Replace `app/portraits/page.tsx` in full**

Find (the entire current file):

```tsx
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import Gallery, {
  type GalleryGroup,
  type GalleryImage,
} from "@/components/Gallery";

const TITLE = "Portrait & Boudoir Gallery";
const DESCRIPTION =
  "Browse portrait, headshot, boudoir, and fine art photography from a Columbia, Missouri photographer serving clients throughout Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/portraits",
  });
}

// Alt text below is placeholder copy targeting local SEO keywords —
// replace with real per-image descriptions once final photos are added.
const images: GalleryImage[] = [
  {
    seed: "nocturne-portrait-01",
    index: 1,
    alt: "Professional headshot session in Columbia, Missouri",
  },
  {
    seed: "nocturne-portrait-02",
    index: 2,
    alt: "Business branding portrait photographed in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-03",
    index: 3,
    alt: "Art-directed creative portrait session in Columbia, MO",
  },
  {
    seed: "nocturne-portrait-04",
    index: 4,
    alt: "Styled creative portrait photography in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-05",
    index: 5,
    alt: "Concept-driven portrait session by a Columbia, Missouri photographer",
  },
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

const groups: GalleryGroup[] = [
  {
    title: "Headshots & Branding",
    description:
      "Professional portraits for people who need to show up polished: LinkedIn, business branding, personal websites, and professional profiles.",
    blocks: [
      { type: "single", items: [images[0]] },
      { type: "single", items: [images[1]] },
    ],
  },
  {
    title: "Creative Portraits",
    description:
      "More personal, more art-directed. Lighting, styling, and concept-driven sessions for people who want something beyond a standard portrait.",
    blocks: [
      { type: "pair", items: [images[2], images[3]] },
      { type: "single", items: [images[4]] },
    ],
  },
  {
    title: "Editorial & Fine Art",
    description:
      "Selected work from ongoing personal and collaborative projects, shot with a narrative or painterly sensibility.",
    blocks: [
      { type: "pair", items: [images[5], images[6]] },
      { type: "single", items: [images[7]] },
    ],
  },
];

export default function PortraitsPage() {
  return (
    <div className="flex flex-col">
      {/* Opening */}
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src="https://picsum.photos/seed/nocturne-portrait-00/1800/1200"
          alt="Columbia, Missouri portrait and creative photography session — Zach K. Johnson"
          fill
          priority
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
        A collection of portrait and creative photography sessions shot in
        and around Columbia, Missouri &mdash; headshots, individual
        portraits, and collaborative creative work. Each session is built
        around the person in front of the camera, not a formula. Below is a
        look at the range: clean and professional when that&rsquo;s the
        goal, textured and cinematic when it&rsquo;s not.
      </p>

      {/* Gallery */}
      <Gallery groups={groups} />

      <div className="mx-auto -mt-12 mb-24 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/contact#booking"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book a Portrait Session
        </Link>
      </div>
    </div>
  );
}
```

Replace with:

```tsx
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import Gallery, {
  type GalleryGroup,
  type GalleryImage,
} from "@/components/Gallery";
import { HEADSHOTS_GALLERY, CREATIVE_PORTRAITS_GALLERY } from "@/lib/services";

const TITLE = "Portrait & Boudoir Gallery";
const DESCRIPTION =
  "Browse portrait, headshot, boudoir, and fine art photography from a Columbia, Missouri photographer serving clients throughout Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/portraits",
  });
}

// Alt text below is placeholder copy targeting local SEO keywords —
// replace with real per-image descriptions once final photos are added.
const editorialImages: GalleryImage[] = [
  {
    seed: "nocturne-portrait-06",
    index: 1,
    alt: "Editorial fine art photography shot in Columbia, Missouri",
  },
  {
    seed: "nocturne-portrait-07",
    index: 2,
    alt: "Narrative fine art portrait session in Mid-Missouri",
  },
  {
    seed: "nocturne-portrait-08",
    index: 3,
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

export default function PortraitsPage() {
  return (
    <div className="flex flex-col">
      {/* Opening */}
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src="https://picsum.photos/seed/nocturne-portrait-00/1800/1200"
          alt="Columbia, Missouri portrait and creative photography session — Zach K. Johnson"
          fill
          priority
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
        A collection of portrait and creative photography sessions shot in
        and around Columbia, Missouri &mdash; headshots, individual
        portraits, and collaborative creative work. Each session is built
        around the person in front of the camera, not a formula. Below is a
        look at the range: clean and professional when that&rsquo;s the
        goal, textured and cinematic when it&rsquo;s not.
      </p>

      {/* Gallery */}
      <Gallery groups={[HEADSHOTS_GALLERY]} />
      <div className="mx-auto -mt-12 mb-12 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/headshots"
          className="text-xs uppercase tracking-[0.2em] text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
        >
          View Headshots &rarr;
        </Link>
      </div>

      <Gallery groups={[CREATIVE_PORTRAITS_GALLERY]} />
      <div className="mx-auto -mt-12 mb-12 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/creative-portraits"
          className="text-xs uppercase tracking-[0.2em] text-muted underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
        >
          View Creative Portraits &rarr;
        </Link>
      </div>

      <Gallery groups={[editorialGroup]} />

      <div className="mx-auto -mt-12 mb-24 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/contact#booking"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book a Portrait Session
        </Link>
      </div>
    </div>
  );
}
```

The Editorial & Fine Art group and its images stay defined locally in this file (renumbered 1-3, since they're no longer sharing a single page-wide numbering sequence with the groups that moved out) — it has no matching new landing page, so it isn't part of `lib/services.ts`.

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds; `/portraits` still listed as a static route.

- [ ] **Step 3: Verify the new links and unchanged Editorial group**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
npm run dev &
sleep 3
curl -s http://localhost:3000/portraits | grep -o 'href="/headshots"'
curl -s http://localhost:3000/portraits | grep -o 'href="/creative-portraits"'
curl -s http://localhost:3000/portraits | grep -o 'Editorial &amp; Fine Art'
curl -s http://localhost:3000/portraits | grep -o 'Editorial fine art photography shot in Columbia, Missouri'
kill %1
```
Expected: both new links present once each; "Editorial & Fine Art" group title and its first image's alt text still present (confirming that group rendered unchanged).

- [ ] **Step 4: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add app/portraits/page.tsx
git commit -m "Reuse shared gallery data on /portraits, link out to the new Headshots and Creative Portraits pages"
```

---

### Task 5: Fix the stale FAQ pricing answer (`lib/faq.ts`)

**Files:**
- Modify: `lib/faq.ts:23-34` (the `session-cost` item)

**Interfaces:**
- None — this is a content-only change to an existing exported constant (`FAQ_ITEMS`), already consumed by `/faq`, `/book`'s teaser, and (as of Task 2) `ServiceLandingPage`.

- [ ] **Step 1: Edit `lib/faq.ts`**

Find:

```ts
  {
    // Prices/durations here mirror the live, admin-editable appointment_types
    // table (price_cents/duration_minutes), managed via
    // app/admin/appointment-types/AppointmentTypeForm.tsx. If those settings
    // change, update this answer to match.
    id: "session-cost",
    category: "Pricing",
    question: "How much do sessions cost?",
    answer:
      "Creative Portraits sessions start at $250 (2 hours); Fine Art Nude sessions start at $350 (3 hours). Full payment is collected at booking to confirm your session. Looking for something longer — a full-day creative shoot or event/video production? Reach out directly for a custom quote.",
  },
```

Replace with:

```ts
  {
    // Prices/durations here mirror the live, admin-editable appointment_types
    // table (price_cents/duration_minutes), managed via
    // app/admin/appointment-types/AppointmentTypeForm.tsx. If those settings
    // change, update this answer to match.
    id: "session-cost",
    category: "Pricing",
    question: "How much do sessions cost?",
    answer:
      "Professional Headshots start at $150 (20 minutes); Creative Portraits sessions start at $250 (2 hours); Fine Art Boudoir & Nude sessions start at $350 (3 hours). Full payment is collected at booking to confirm your session. Looking for something longer — a full-day creative shoot or event/video production? Reach out directly for a custom quote.",
  },
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Verify the corrected answer on `/faq`**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
npm run dev &
sleep 3
curl -s http://localhost:3000/faq | grep -o 'Professional Headshots start at \$150'
curl -s http://localhost:3000/faq | grep -o 'Fine Art Boudoir &amp; Nude sessions start at \$350'
kill %1
```
Expected: both strings present once each.

- [ ] **Step 4: Commit**

```bash
cd /Users/zachjohnson/Projects/portfolio-site
git add lib/faq.ts
git commit -m "Fix stale FAQ pricing answer to match current appointment types"
```

---

## Final verification (after all 5 tasks)

- [ ] Run `npm run build` one more time from a clean state — confirm it succeeds end to end, all three new routes listed as static.
- [ ] Visual check in a browser: `/headshots` and `/creative-portraits` show hero, gallery, 2-item FAQ, booking CTA, and links to the other 2 services; `/boudoir` shows hero, description paragraph (no gallery), 2-item FAQ, booking CTA, and links to the other 2 services.
- [ ] Visual check: `/portraits` shows "View Headshots →" and "View Creative Portraits →" links under their respective groups, and the Editorial & Fine Art group is visually unchanged.
- [ ] `curl -s http://localhost:3000/sitemap.xml | grep -c '<loc>'` increased by exactly 3 versus before this plan.
- [ ] `/faq`'s pricing answer mentions all three current services with correct prices.
