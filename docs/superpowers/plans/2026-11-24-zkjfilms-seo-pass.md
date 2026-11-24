# zkjfilms SEO Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps found in the 2026-11-24 audit of zkjfilms.com: keyword-bearing titles, full structured data, films indexing, per-page OG images, descriptive boudoir alts, readable muted text, honest sitemap dates, plus tests and a local-SEO checklist.

**Architecture:** This mirrors the Oak & Emerald SEO architecture:
- `content/pages.ts` is the single route registry for titles, descriptions and sitemap.
- `lib/seo.ts` builds metadata from it.
- `lib/jsonLd.ts` holds pure JSON-LD builders, rendered through `components/JsonLd.tsx`.
- Vitest enforces the limits.

Existing page structure and visuals are unchanged, apart from the darker `--muted` token.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-24-zkjfilms-seo-pass-design.md`

## Global Constraints

- **Read the Next.js 16 docs first.** Per `AGENTS.md`, this Next.js has breaking changes. Read the relevant guide under `node_modules/next/dist/docs/` before writing metadata, sitemap or route code. Do not add `middleware.ts`.
- **Branch:** `seo-pass` in `~/Projects/portfolio-site`. Do not push. Do not touch the `.claude/worktrees/sms-session-reminder` worktree.
- **Commit trailer** on every commit: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Use exactly this model name, whichever model executes the task.
- **Title length:** each page title is ≤ 42 chars, so that title + " | Zach K. Johnson" stays ≤ 60. The home title is absolute and ≤ 60.
- **Description length:** 50–155 chars.
- **No invented facts.** Never fabricate reviews, ratings, prices, awards or facts. Structured data uses only facts already on the site or live from Supabase.
- **Boudoir OG image:** boudoir keeps the default brand OG image. Never use nude imagery in link previews.
- **Boudoir alts:** tasteful and non-explicit, with no identifying details (tattoos, distinctive marks, identifiable faces). Each is ≤ 160 chars.
- **Muted color:** `--muted` becomes `#74695c`. This gives 4.98:1 on `#faf6f0` and 4.53:1 on `#f2ebe0`.
- **Live services:** no `.env.local` changes. Tests use synthetic data only and never hit Supabase or the network.
- **Unrelated features:** keep booking, galleries, admin, podcast and invoices behavior unchanged.

---

## File Structure

```
content/pages.ts          ROUTES registry (new)
lib/seo.ts                + image/absoluteTitle in buildPageMetadata, pageMetadata(key, image?); keywords removed from layout
lib/jsonLd.ts             JSON-LD builders (new)
lib/pricing.ts            startingPriceCents() shared by home + service pages (new)
lib/films.ts              getFilms() (new)
lib/sitemapEntries.ts     buildSitemap() pure function (new)
lib/contrast.ts           contrastRatio() (new)
components/JsonLd.tsx     <JsonLd data> (new)
app/sitemap.ts            uses buildSitemap
app/**/page.tsx           pageMetadata + JsonLd
lib/masonryPhotos.ts      per-photo boudoir alts
lib/services.ts           boudoir hero alt
app/globals.css           --muted
docs/seo-local-checklist.md (new)
tests/*.test.ts, vitest.config.ts (new)
```

---

### Task 1: Vitest, contrast helper, readable muted color

**Files:**
- Modify: `package.json`, `app/globals.css:7`
- Create: `vitest.config.ts`, `lib/contrast.ts`, `tests/contrast.test.ts`

**Interfaces:**
- Produces:
  - `npm test`
  - `contrastRatio(hexA: string, hexB: string): number` from `lib/contrast.ts`

- [ ] **Step 1: Install and configure Vitest**

```bash
cd ~/Projects/portfolio-site
npm install -D vitest@^3
```

Add these to `package.json` `"scripts"`, replacing the existing `build`:

```json
"test": "vitest run",
"test:watch": "vitest",
"build": "vitest run && next build",
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
```

- [ ] **Step 2: Failing test `tests/contrast.test.ts`**

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "@/lib/contrast";

const css = readFileSync(path.resolve(__dirname, "../app/globals.css"), "utf8");
const token = (name: string) => {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`token --${name} not found`);
  return m[1];
};

describe("contrastRatio", () => {
  it("is 21 for black on white and symmetric", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
  });
});

describe("muted text token", () => {
  it.each(["background", "surface"])("meets WCAG AA (4.5:1) on --%s", (bg) => {
    expect(contrastRatio(token("muted"), token(bg))).toBeGreaterThanOrEqual(4.5);
  });
});
```

- [ ] **Step 3: Run it.** `npm test` should FAIL because `@/lib/contrast` can't be resolved.

- [ ] **Step 4: Create `lib/contrast.ts`**

```ts
// WCAG 2.x relative-luminance contrast ratio between two #RRGGBB colors.
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(hexA: string, hexB: string): number {
  const [hi, lo] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
```

- [ ] **Step 5: Run it again.** `npm test` should now pass the ratio test and FAIL the muted test, because `#8c7f6f` is 3.63:1.

- [ ] **Step 6: Darken the token.** In `app/globals.css`, change `--muted: #8c7f6f;` to `--muted: #74695c;`. Leave every other token alone.

- [ ] **Step 7: Verify.** `npm test` should PASS. Run `npm run lint` and expect it to be clean.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/contrast.ts tests/contrast.test.ts app/globals.css
git commit -m "Add Vitest; darken muted text to meet WCAG AA contrast

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Route registry, keyword titles, per-page OG images

**Files:**
- Create: `content/pages.ts`, `tests/pages.test.ts`
- Modify:
  - `lib/seo.ts` (`buildPageMetadata`, add `pageMetadata`)
  - `app/layout.tsx` (drop `keywords`; default title from ROUTES)
  - The `generateMetadata` in each of these pages:
    - `app/page.tsx`
    - `app/book/page.tsx`
    - `app/contact/page.tsx`
    - `app/about/page.tsx`
    - `app/faq/page.tsx`
    - `app/headshots/page.tsx`
    - `app/creative-portraits/page.tsx`
    - `app/boudoir/page.tsx`
    - `app/music/page.tsx`
    - `app/films/page.tsx`
    - `app/podcast/page.tsx`

**Interfaces:**
- Produces:
  - `type RouteKey = "home" | "book" | "contact" | "about" | "faq" | "headshots" | "creativePortraits" | "boudoir" | "music" | "films" | "podcast"`
  - `ROUTES: Record<RouteKey, RouteInfo>`, where `RouteInfo = { path: string; title: string; description: string; changeFrequency: "daily" | "weekly" | "monthly" | "yearly"; priority: number; absoluteTitle?: boolean }`
  - `type OgImage = { url: string; width: number; height: number; alt: string }`, exported from `lib/seo.ts`
  - `buildPageMetadata({ title, description, path?, image?, absoluteTitle? }): Metadata`
  - `pageMetadata(key: RouteKey, image?: OgImage): Metadata`
  - `fullTitle(key: RouteKey): string`

- [ ] **Step 1: Failing test `tests/pages.test.ts`**

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTES, type RouteKey } from "@/content/pages";
import { buildPageMetadata, fullTitle, pageMetadata, SITE_URL } from "@/lib/seo";

const entries = Object.entries(ROUTES) as [RouteKey, (typeof ROUTES)[RouteKey]][];

describe("ROUTES", () => {
  it.each(entries)("%s title fits in 60 chars with the site suffix", (key) => {
    expect(fullTitle(key).length).toBeLessThanOrEqual(60);
  });
  it.each(entries)("%s non-home title is ≤ 42 chars", (key, r) => {
    if (!r.absoluteTitle) expect(r.title.length).toBeLessThanOrEqual(42);
  });
  it.each(entries)("%s description is 50–155 chars", (_k, r) => {
    expect(r.description.length).toBeGreaterThanOrEqual(50);
    expect(r.description.length).toBeLessThanOrEqual(155);
  });
  it("paths are unique and each has a page file", () => {
    const paths = entries.map(([, r]) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
    for (const p of paths) {
      const file = path.resolve(__dirname, "../app", `.${p}`, "page.tsx");
      expect(existsSync(file), file).toBe(true);
    }
  });
});

describe("metadata", () => {
  it("home uses an absolute title and canonical root", () => {
    const m = pageMetadata("home");
    expect(m.title).toEqual({ absolute: ROUTES.home.title });
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/`);
  });
  it("non-home pages get canonical + OG url and the full title in OG", () => {
    const m = pageMetadata("headshots");
    expect(m.alternates?.canonical).toBe(`${SITE_URL}/headshots`);
    expect((m.openGraph as { url: string }).url).toBe(`${SITE_URL}/headshots`);
    expect((m.openGraph as { title: string }).title).toBe(fullTitle("headshots"));
  });
  it("an explicit image overrides the default OG image", () => {
    const img = { url: "https://img.example/a.jpg", width: 10, height: 10, alt: "A test image" };
    const m = buildPageMetadata({ title: "T", description: "D", path: "/x", image: img });
    expect((m.openGraph as { images: unknown[] }).images[0]).toEqual(img);
    expect((m.twitter as { images: string[] }).images[0]).toBe(img.url);
  });
});
```

- [ ] **Step 2: Run it.** `npm test` should FAIL because `@/content/pages` is missing.

- [ ] **Step 3: Create `content/pages.ts`**

```ts
// Single source of truth for every public, indexable page's SEO title,
// description, and sitemap hints. Titles (except home, which is absolute)
// get " | Zach K. Johnson" appended by the root layout's title template, so
// keep them ≤ 42 chars. tests/pages.test.ts enforces the limits.
export type RouteKey =
  | "home" | "book" | "contact" | "about" | "faq" | "headshots"
  | "creativePortraits" | "boudoir" | "music" | "films" | "podcast";

export type RouteInfo = {
  path: string;
  title: string;
  description: string;
  changeFrequency: "daily" | "weekly" | "monthly" | "yearly";
  priority: number;
  absoluteTitle?: boolean;
};

export const ROUTES: Record<RouteKey, RouteInfo> = {
  home: {
    path: "",
    title: "Columbia MO Portrait & Boudoir Photography | Zach K. Johnson",
    absoluteTitle: true,
    description:
      "Columbia, Missouri portrait and boudoir photographer offering natural-light portrait, boudoir, and fine art photography sessions throughout Mid-Missouri.",
    changeFrequency: "monthly",
    priority: 1,
  },
  book: {
    path: "/book",
    title: "Book a Photo Session in Columbia, MO",
    description:
      "Book a portrait, headshot, boudoir, or music/performance photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
  contact: {
    path: "/contact",
    title: "Contact a Columbia, MO Photographer",
    description:
      "Book a portrait, headshot, or boudoir photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    changeFrequency: "yearly",
    priority: 0.8,
  },
  about: {
    path: "/about",
    title: "About the Photographer",
    description:
      "Meet Zach K. Johnson, a Columbia, Missouri portrait, boudoir, and fine art photographer serving Mid-Missouri.",
    changeFrequency: "yearly",
    priority: 0.6,
  },
  faq: {
    path: "/faq",
    title: "Photography FAQ",
    description:
      "Answers to common questions about booking a portrait, headshot, boudoir, music, or fine art photography session in Columbia, Missouri.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  headshots: {
    path: "/headshots",
    title: "Headshots in Columbia, MO",
    description:
      "Professional headshot photography in Columbia, Missouri — polished portraits for LinkedIn, business branding, and professional profiles.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  creativePortraits: {
    path: "/creative-portraits",
    title: "Creative Portrait Photography, Columbia MO",
    description:
      "Art-directed creative portrait photography sessions in Columbia, Missouri, built around concept, lighting, and styling.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  boudoir: {
    path: "/boudoir",
    title: "Boudoir Photography in Columbia, MO",
    description:
      "Fine art boudoir and nude photography in Columbia, Missouri — intimate sessions built around trust, privacy, and what you're comfortable with.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  music: {
    path: "/music",
    title: "Concert & Band Photography, Columbia MO",
    description:
      "Concert and live performance photography in Columbia, Missouri and beyond — booked by artists, venues, and labels for promo and press.",
    changeFrequency: "monthly",
    priority: 0.8,
  },
  films: {
    path: "/films",
    title: "Films & Video, Columbia MO",
    description:
      "Cinematic video work from Zach K. Johnson — highlight reels and film pieces from Columbia, Missouri.",
    changeFrequency: "monthly",
    priority: 0.7,
  },
  podcast: {
    path: "/podcast",
    title: "What Comes Next — Podcast",
    description:
      "What Comes Next is a series by filmmaker Zach K. Johnson featuring guests speaking in their own words about how life has shaped who they are today.",
    changeFrequency: "weekly",
    priority: 0.8,
  },
};
```

- [ ] **Step 4: Update `lib/seo.ts`.**
  - Add `import { ROUTES, type RouteKey } from "@/content/pages";`.
  - Export `OgImage`.
  - Replace `buildPageMetadata` with the version below, and add `fullTitle` and `pageMetadata`.
  - Leave every other export (`SITE_URL`, `SOCIALS`, `BUSINESS`, `STUDIO_ADDRESS`, …) unchanged.

```ts
export type OgImage = { url: string; width: number; height: number; alt: string };

// Per-page metadata must build its own full `openGraph`/`twitter` objects —
// Next.js REPLACES (not merges) those nested objects wholesale whenever a
// page defines them, so omitting the image/card fields here would silently
// drop the root layout's OG image and card type on every page that uses it.
export function buildPageMetadata({
  title,
  description,
  path = "",
  image = DEFAULT_OG_IMAGE,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path?: string;
  image?: OgImage;
  absoluteTitle?: boolean;
}): Metadata {
  const url = `${SITE_URL}${path || "/"}`;
  const shareTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    openGraph: {
      title: shareTitle,
      description,
      url,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [image],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description,
      images: [image.url],
    },
    alternates: { canonical: url },
  };
}

export function fullTitle(key: RouteKey): string {
  const r = ROUTES[key];
  return r.absoluteTitle ? r.title : `${r.title} | ${SITE_NAME}`;
}

export function pageMetadata(key: RouteKey, image?: OgImage): Metadata {
  const r = ROUTES[key];
  return buildPageMetadata({
    title: r.title,
    description: r.description,
    path: r.path,
    image,
    absoluteTitle: r.absoluteTitle,
  });
}
```

Note that the canonical for home changes from `https://zkjfilms.com` to `https://zkjfilms.com/`. The two are equivalent, and the trailing slash matches what Next serves.

- [ ] **Step 5: `app/layout.tsx`.**
  - Delete the `keywords: [...]` array.
  - Set `title.default` to `ROUTES.home.title`, importing `ROUTES` from `@/content/pages`.
  - Keep `template: \`%s | ${SITE_NAME}\``.
  - Leave everything else unchanged.

- [ ] **Step 6: Switch each page to `pageMetadata`.** In each page, delete the local `TITLE`/`DESCRIPTION` constants (where they are only used for metadata) and replace the `generateMetadata` body with:

| File | New `generateMetadata` return |
|---|---|
| `app/page.tsx` | `pageMetadata("home")` |
| `app/book/page.tsx` | `pageMetadata("book")` |
| `app/contact/page.tsx` | `pageMetadata("contact")` |
| `app/faq/page.tsx` | `pageMetadata("faq")` |
| `app/films/page.tsx` | `pageMetadata("films")` (Task 4 extends this) |
| `app/podcast/page.tsx` | `pageMetadata("podcast")` |
| `app/boudoir/page.tsx` | `pageMetadata("boudoir")`, with no image, deliberately (see Global Constraints) |
| `app/about/page.tsx` | `pageMetadata("about", { url: publicImageUrl("zach-medium.jpg"), width: 1200, height: 1800, alt: "Black-and-white portrait of Zach K. Johnson in profile" })` |
| `app/headshots/page.tsx` | `pageMetadata("headshots", serviceOgImage(HEADSHOTS_SERVICE))` |
| `app/creative-portraits/page.tsx` | `pageMetadata("creativePortraits", serviceOgImage(CREATIVE_PORTRAITS_SERVICE))` |
| `app/music/page.tsx` | `pageMetadata("music", serviceOgImage(MUSIC_SERVICE))` |

Add `serviceOgImage` to `lib/services.ts`. The 1200×630 size is what the OG card requests; social platforms crop the hero themselves, so width and height are declared, not resized:

```ts
import type { OgImage } from "@/lib/seo";

// Hero photo as the page's social-share image. Never used for boudoir
// (nude imagery must not appear in link previews — see the SEO spec).
export function serviceOgImage(service: Service): OgImage {
  return { url: service.heroImageUrl, width: 1200, height: 630, alt: service.heroImageAlt };
}
```

If importing `@/lib/seo` from `lib/services.ts` creates a cycle (`lib/seo.ts` must not import `lib/services.ts`), check with `npx tsc --noEmit` and `npm run build`. Confirm `lib/seo.ts` only imports `content/pages.ts`.

If a page's `TITLE`/`DESCRIPTION` constant is also used in visible page content, keep the visible text unchanged and only stop using it for metadata.

- [ ] **Step 7: Verify.** Run `npm test` and expect PASS. Run `npx tsc --noEmit` and `npm run lint` and expect both to be clean. Then run `npm run build`; it needs `.env.local` for the Supabase-backed pages, which already exists in this repo, so the build should succeed. If it fails only for a missing env var, report it.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "SEO: route registry, keyword titles, per-page OG images, drop meta keywords

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Structured data (business, breadcrumbs, services, person, FAQ, podcast)

**Files:**
- Create: `lib/jsonLd.ts`, `lib/pricing.ts`, `lib/servicePricing.ts`, `components/JsonLd.tsx`, `tests/jsonLd.test.ts`, `tests/pricing.test.ts`
- Modify:
  - `app/page.tsx` (use `businessJsonLd` + `startingPriceCents`)
  - `app/faq/page.tsx`, `app/podcast/page.tsx` (use the builders, with identical output)
  - `app/about/page.tsx` (Person + breadcrumb)
  - `app/book/page.tsx`, `app/contact/page.tsx` (breadcrumb)
  - `app/headshots/page.tsx`, `app/creative-portraits/page.tsx`, `app/boudoir/page.tsx`, `app/music/page.tsx` (Service + breadcrumb; pages become async with `revalidate = 300`)

**Interfaces:**
- Consumes: `ROUTES`, `RouteKey` (Task 2), `BUSINESS`, `SITE_URL`, `SOCIALS`, `DEFAULT_OG_IMAGE` (`lib/seo.ts`), `AppointmentTypeRow`, `fetchActiveAppointmentTypes` (`lib/availabilityQuery.ts`), `formatPrice` (`lib/format.ts`), `FaqItem` (`lib/faq.ts`), `PodcastShow`, `PODCAST_LINKS` (`lib/podcast.ts`), and `Service` plus the four `*_SERVICE` constants (`lib/services.ts`).
- Produces:
  - `startingPriceCents(types: AppointmentTypeRow[], match: (name: string) => boolean): number | null`
  - `BUSINESS_ID = \`${SITE_URL}/#business\``
  - `businessJsonLd(priceRange?: string | null): object`
  - `breadcrumbJsonLd(key: RouteKey): object`
  - `serviceJsonLd(s: { name: string; description: string; path: string; image: string; startingPriceCents: number | null }): object`
  - `personJsonLd(): object`
  - `faqJsonLd(items: { question: string; answer: string }[]): object`
  - `podcastJsonLd(show: PodcastShow): object`
  - `videoJsonLd(v: { title: string; description: string | null; posterUrl: string; contentUrl: string; uploadDate: string }): object`
  - `<JsonLd data={object | (object | null)[] | null} />`

- [ ] **Step 1: Failing tests**

`tests/pricing.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { startingPriceCents } from "@/lib/pricing";
import type { AppointmentTypeRow } from "@/lib/availabilityQuery";

const t = (name: string, price_cents: number, requires_payment = true) =>
  ({ name, price_cents, requires_payment } as AppointmentTypeRow);

describe("startingPriceCents", () => {
  it("returns the lowest paid matching price", () => {
    const types = [t("Headshots", 20000), t("Headshots", 15000), t("Headshots", 5000, false), t("Boudoir", 1000)];
    expect(startingPriceCents(types, (n) => n === "Headshots")).toBe(15000);
  });
  it("returns null when nothing matches", () => {
    expect(startingPriceCents([t("Boudoir", 1000)], (n) => n === "Headshots")).toBeNull();
  });
});
```

`tests/jsonLd.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  BUSINESS_ID, breadcrumbJsonLd, businessJsonLd, faqJsonLd, personJsonLd, serviceJsonLd, videoJsonLd,
} from "@/lib/jsonLd";
import { SITE_URL } from "@/lib/seo";

describe("jsonLd", () => {
  it("business keeps its @id and omits priceRange when unknown", () => {
    const b = businessJsonLd(null) as Record<string, unknown>;
    expect(b["@id"]).toBe(BUSINESS_ID);
    expect(b).not.toHaveProperty("priceRange");
    expect((businessJsonLd("$150–$500") as Record<string, unknown>).priceRange).toBe("$150–$500");
  });
  it("breadcrumb is Home → page with absolute URLs", () => {
    const b = breadcrumbJsonLd("headshots") as { itemListElement: { position: number; name: string; item: string }[] };
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Headshots in Columbia, MO", item: `${SITE_URL}/headshots` },
    ]);
  });
  it("service links its provider and adds an offer only with a price", () => {
    const base = { name: "Headshots", description: "Desc", path: "/headshots", image: "https://img.example/h.jpg" };
    const without = serviceJsonLd({ ...base, startingPriceCents: null }) as Record<string, unknown>;
    expect(without.provider).toEqual({ "@id": BUSINESS_ID });
    expect(without).not.toHaveProperty("offers");
    const withPrice = serviceJsonLd({ ...base, startingPriceCents: 15000 }) as { offers: Record<string, unknown> };
    expect(withPrice.offers).toMatchObject({ "@type": "Offer", price: "150.00", priceCurrency: "USD" });
  });
  it("person works for the business", () => {
    expect(personJsonLd()).toMatchObject({ "@type": "Person", name: "Zach K. Johnson", worksFor: { "@id": BUSINESS_ID } });
  });
  it("faq maps questions to answers", () => {
    expect(faqJsonLd([{ question: "Q?", answer: "A." }])).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }],
    });
  });
  it("video falls back to the title for description", () => {
    const v = videoJsonLd({ title: "Reel", description: null, posterUrl: "https://img.example/p.jpg", contentUrl: "https://img.example/v.mp4", uploadDate: "2026-01-01T00:00:00Z" });
    expect(v).toMatchObject({ "@type": "VideoObject", name: "Reel", description: "Reel", thumbnailUrl: ["https://img.example/p.jpg"] });
  });
});
```

- [ ] **Step 2: Run them.** `npm test` should FAIL because the modules are missing.

- [ ] **Step 3: `lib/pricing.ts`.** This moves the home page's `startingPrice` rule here, returning cents:

```ts
import type { AppointmentTypeRow } from "@/lib/availabilityQuery";

// Lowest price among paid, active appointment types matching a service.
// Shared by the homepage cards and the service pages' Offer schema so the
// two can't disagree.
export function startingPriceCents(
  types: AppointmentTypeRow[],
  match: (name: string) => boolean,
): number | null {
  const prices = types.filter((t) => t.requires_payment && match(t.name)).map((t) => t.price_cents);
  return prices.length ? Math.min(...prices) : null;
}
```

In `app/page.tsx`, replace the local `startingPrice` body with:

```ts
function startingPrice(types: AppointmentTypeRow[], match: (name: string) => boolean): string | null {
  const cents = startingPriceCents(types, match);
  return cents === null ? null : `From ${formatPrice(cents)}`;
}
```

- [ ] **Step 4: `lib/jsonLd.ts`**

```ts
import { ROUTES, type RouteKey } from "@/content/pages";
import { BUSINESS, DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL, SOCIALS } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import { PODCAST_LINKS } from "@/lib/podcastLinks";
import type { PodcastShow } from "@/lib/podcast";

const CTX = "https://schema.org";
export const BUSINESS_ID = `${SITE_URL}/#business`;
const PERSON_ID = `${SITE_URL}/#zach`;

export function businessJsonLd(priceRange?: string | null): object {
  return {
    "@context": CTX,
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": BUSINESS_ID,
    name: BUSINESS.name,
    description: BUSINESS.description,
    url: SITE_URL,
    telephone: BUSINESS.telephone,
    email: BUSINESS.email,
    image: DEFAULT_OG_IMAGE.url,
    address: { "@type": "PostalAddress", ...BUSINESS.address },
    geo: { "@type": "GeoCoordinates", ...BUSINESS.geo },
    areaServed: BUSINESS.areaServed,
    sameAs: BUSINESS.sameAs,
    founder: { "@id": PERSON_ID },
    openingHoursSpecification: { "@type": "OpeningHoursSpecification", ...BUSINESS.hours },
    ...(priceRange ? { priceRange } : {}),
  };
}

export function breadcrumbJsonLd(key: RouteKey): object {
  const r = ROUTES[key];
  return {
    "@context": CTX,
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: r.title, item: `${SITE_URL}${r.path}` },
    ],
  };
}

export function serviceJsonLd(s: {
  name: string; description: string; path: string; image: string; startingPriceCents: number | null;
}): object {
  return {
    "@context": CTX,
    "@type": "Service",
    name: s.name,
    serviceType: s.name,
    description: s.description,
    url: `${SITE_URL}${s.path}`,
    image: s.image,
    provider: { "@id": BUSINESS_ID },
    areaServed: BUSINESS.areaServed,
    ...(s.startingPriceCents !== null
      ? { offers: { "@type": "Offer", price: (s.startingPriceCents / 100).toFixed(2), priceCurrency: "USD", url: `${SITE_URL}/book` } }
      : {}),
  };
}

export function personJsonLd(): object {
  return {
    "@context": CTX,
    "@type": "Person",
    "@id": PERSON_ID,
    name: SITE_NAME,
    jobTitle: "Photographer",
    url: `${SITE_URL}/about`,
    image: publicImageUrl("zach-medium.jpg"),
    worksFor: { "@id": BUSINESS_ID },
    sameAs: Object.values(SOCIALS),
    address: { "@type": "PostalAddress", addressLocality: BUSINESS.address.addressLocality, addressRegion: BUSINESS.address.addressRegion, addressCountry: BUSINESS.address.addressCountry },
  };
}

export function faqJsonLd(items: { question: string; answer: string }[]): object {
  return {
    "@context": CTX,
    "@type": "FAQPage",
    mainEntity: items.map((i) => ({
      "@type": "Question",
      name: i.question,
      acceptedAnswer: { "@type": "Answer", text: i.answer },
    })),
  };
}

export function podcastJsonLd(show: PodcastShow): object {
  return {
    "@context": CTX,
    "@type": "PodcastSeries",
    name: show.title,
    description: show.description,
    image: show.imageUrl || undefined,
    url: `${SITE_URL}/podcast`,
    webFeed: PODCAST_LINKS.rss,
    author: { "@id": PERSON_ID, "@type": "Person", name: SITE_NAME },
    hasPart: show.episodes.map((episode) => ({
      "@type": "PodcastEpisode",
      name: episode.title,
      datePublished: episode.pubDate,
      url: episode.link || PODCAST_LINKS.rss,
      associatedMedia: { "@type": "MediaObject", contentUrl: episode.audioUrl },
    })),
  };
}

export function videoJsonLd(v: {
  title: string; description: string | null; posterUrl: string; contentUrl: string; uploadDate: string;
}): object {
  return {
    "@context": CTX,
    "@type": "VideoObject",
    name: v.title,
    description: v.description || v.title,
    thumbnailUrl: [v.posterUrl],
    contentUrl: v.contentUrl,
    uploadDate: v.uploadDate,
    publisher: { "@id": BUSINESS_ID },
  };
}
```

Before writing this, read the existing JSON-LD objects in `app/page.tsx`, `app/faq/page.tsx` and `app/podcast/page.tsx`, and make sure the moved builders emit the same fields. The only intended additions are `founder` on the business and the Person `@id` on the podcast author. Check that `BUSINESS.hours` and `BUSINESS.geo` hold exactly the keys spread above. `PodcastShow` is imported type-only and `PODCAST_LINKS` comes from `lib/podcastLinks.ts`, so tests don't load `googleapis`; check that `lib/podcastLinks.ts` exports `PODCAST_LINKS`.

- [ ] **Step 5: `components/JsonLd.tsx`**

```tsx
// Renders one or more JSON-LD objects. `<` is escaped so a value containing
// "</script>" can't break out of the tag.
export default function JsonLd({ data }: { data: object | (object | null)[] | null }) {
  const items = (Array.isArray(data) ? data : [data]).filter((d): d is object => d !== null);
  return (
    <>
      {items.map((d, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(d).replace(/</g, "\\u003c") }}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 6: Wire up the pages**
  - `app/page.tsx`: replace the inline `jsonLd` object and its `<script>` with `<JsonLd data={businessJsonLd(priceRange)} />`.
  - `app/faq/page.tsx`: `<JsonLd data={[faqJsonLd(faqItems), breadcrumbJsonLd("faq")]} />`.
  - `app/podcast/page.tsx`: `<JsonLd data={[show ? podcastJsonLd(show) : null, breadcrumbJsonLd("podcast")]} />`.
  - `app/about/page.tsx`: `<JsonLd data={[personJsonLd(), breadcrumbJsonLd("about")]} />` as the first child of the returned root element.
  - `app/book/page.tsx` and `app/contact/page.tsx`: `<JsonLd data={breadcrumbJsonLd("book")} />` and `<JsonLd data={breadcrumbJsonLd("contact")} />` respectively.
  - Service pages: make each page component async and add `export const revalidate = 300;`. For example, `app/headshots/page.tsx`:

```tsx
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, serviceJsonLd } from "@/lib/jsonLd";
import { fetchActiveAppointmentTypes } from "@/lib/availabilityQuery";
import { startingPriceCents } from "@/lib/pricing";
import { ROUTES } from "@/content/pages";

// Live "from" price for the Offer schema — same appointment_types data as
// /book. Revalidate so admin price changes appear without a redeploy.
export const revalidate = 300;

async function servicePrice(appointmentTypeName: string): Promise<number | null> {
  try {
    return startingPriceCents(await fetchActiveAppointmentTypes(), (n) => n === appointmentTypeName);
  } catch (err) {
    console.error("Failed to load live pricing for service schema:", err);
    return null;
  }
}

export default async function HeadshotsPage() {
  const s = HEADSHOTS_SERVICE;
  const price = await servicePrice(s.appointmentTypeName);
  return (
    <>
      <JsonLd data={[serviceJsonLd({ name: s.appointmentTypeName, description: s.description, path: ROUTES.headshots.path, image: s.heroImageUrl, startingPriceCents: price }), breadcrumbJsonLd("headshots")]} />
      <ServiceLandingPage service={s} />
    </>
  );
}
```

Put `servicePrice` in its own file, `lib/servicePricing.ts`, as `export async function servicePrice(appointmentTypeName: string): Promise<number | null>`, so all four pages share it. Keep it out of `lib/pricing.ts`, so `tests/pricing.test.ts` never imports the Supabase-backed module; `lib/pricing.ts` imports `AppointmentTypeRow` type-only. The service pages import `servicePrice` from `@/lib/servicePricing`.

Apply the same pattern to creative-portraits (`CREATIVE_PORTRAITS_SERVICE`, `"creativePortraits"`), music (`MUSIC_SERVICE`, `"music"`) and boudoir (`BOUDOIR_SERVICE`, `"boudoir"`). In boudoir, keep `<AgeGate />`. Its Service `image` must be `DEFAULT_OG_IMAGE.url`, not the hero: no nude imagery in machine-readable previews either.

- [ ] **Step 7: Verify.**
  - `npm test` should PASS, and `npx tsc --noEmit` and `npm run lint` should be clean.
  - Run `npm run build`. The four service pages should now show as ISR (revalidate 300) rather than fully static.
  - Run `npm start` and fetch `/`, `/headshots`, `/boudoir`, `/about`, `/faq` and `/podcast`. Parse every `application/ld+json` block with `JSON.parse` and list the `@type`s for each page in your report. Stop the server afterwards.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "SEO: shared JSON-LD builders; Service, Person and breadcrumb schema

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Films indexing + honest sitemap

**Files:**
- Create: `lib/films.ts`, `lib/sitemapEntries.ts`, `tests/sitemap.test.ts`
- Modify: `app/films/page.tsx`, `app/sitemap.ts`

**Interfaces:**
- Consumes: `ROUTES` (Task 2), `videoJsonLd`, `breadcrumbJsonLd`, `JsonLd` (Task 3), `getPodcastShow` (`lib/podcast.ts`), `getSupabaseClient`, `publicImageUrl`.
- Produces:
  - `type FilmRow = { slug: string; title: string; description: string | null; video_key: string; poster_key: string; created_at: string }`
  - `getFilms(): Promise<{ films: FilmRow[]; error: boolean }>`
  - `buildSitemap(input: { filmsLastModified: string | null; podcastLastModified: string | null }): MetadataRoute.Sitemap`

- [ ] **Step 1: Failing test `tests/sitemap.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { buildSitemap } from "@/lib/sitemapEntries";
import { ROUTES } from "@/content/pages";
import { SITE_URL } from "@/lib/seo";

describe("buildSitemap", () => {
  it("omits /films when there are no films and has no fake static lastModified", () => {
    const s = buildSitemap({ filmsLastModified: null, podcastLastModified: null });
    expect(s.map((e) => e.url)).not.toContain(`${SITE_URL}/films`);
    expect(s.every((e) => e.lastModified === undefined)).toBe(true);
    expect(s).toHaveLength(Object.keys(ROUTES).length - 1);
  });
  it("includes /films and podcast with their real dates when known", () => {
    const s = buildSitemap({ filmsLastModified: "2026-10-01T00:00:00Z", podcastLastModified: "2026-11-01T00:00:00Z" });
    expect(s.find((e) => e.url === `${SITE_URL}/films`)?.lastModified).toBe("2026-10-01T00:00:00Z");
    expect(s.find((e) => e.url === `${SITE_URL}/podcast`)?.lastModified).toBe("2026-11-01T00:00:00Z");
  });
  it("uses absolute URLs with the home page at the root", () => {
    const s = buildSitemap({ filmsLastModified: null, podcastLastModified: null });
    expect(s[0].url).toBe(`${SITE_URL}/`);
    expect(s.every((e) => e.url.startsWith(SITE_URL))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it.** `npm test` should FAIL because `@/lib/sitemapEntries` is missing.

- [ ] **Step 3: `lib/sitemapEntries.ts`**

```ts
import type { MetadataRoute } from "next";
import { ROUTES, type RouteKey } from "@/content/pages";
import { SITE_URL } from "@/lib/seo";

// Static pages carry no lastModified: a build-time date on every URL
// teaches Google to ignore the field. Only pages with a real content date
// (films, podcast) report one. /films is omitted while it has no films.
export function buildSitemap(input: {
  filmsLastModified: string | null;
  podcastLastModified: string | null;
}): MetadataRoute.Sitemap {
  return (Object.keys(ROUTES) as RouteKey[])
    .filter((key) => key !== "films" || input.filmsLastModified !== null)
    .map((key) => {
      const r = ROUTES[key];
      const lastModified =
        key === "films" ? input.filmsLastModified : key === "podcast" ? input.podcastLastModified : null;
      return {
        url: `${SITE_URL}${r.path || "/"}`,
        changeFrequency: r.changeFrequency,
        priority: r.priority,
        ...(lastModified ? { lastModified } : {}),
      };
    });
}
```

- [ ] **Step 4: `lib/films.ts`.** This moves the query out of `app/films/page.tsx`:

```ts
import { getSupabaseClient } from "@/lib/supabase";

export type FilmRow = {
  slug: string;
  title: string;
  description: string | null;
  video_key: string;
  poster_key: string;
  created_at: string;
};

// Video rows are managed out-of-band via the video:* CLI (scripts/video.mjs).
export async function getFilms(): Promise<{ films: FilmRow[]; error: boolean }> {
  const { data, error } = await getSupabaseClient()
    .from("videos")
    .select("slug, title, description, video_key, poster_key, created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) console.error("Supabase videos fetch failed:", error);
  return { films: (data as FilmRow[] | null) ?? [], error: Boolean(error) };
}
```

- [ ] **Step 5: `app/films/page.tsx`**
  - Use `getFilms()`.
  - Make `generateMetadata` async. It should return `pageMetadata("films")`, plus `robots: { index: false, follow: true }` when `films.length === 0`. Use `{ ...pageMetadata("films"), ...(films.length ? {} : { robots: { index: false, follow: true } }) }`.
  - Render `<JsonLd data={[breadcrumbJsonLd("films"), ...films.map((f) => videoJsonLd({ title: f.title, description: f.description, posterUrl: publicImageUrl(f.poster_key), contentUrl: publicImageUrl(f.video_key), uploadDate: f.created_at }))]} />` before the header.
  - Keep `revalidate = 300` and all visible markup unchanged.
  - Delete the local `VideoRow` type.

- [ ] **Step 6: `app/sitemap.ts`**

```ts
import type { MetadataRoute } from "next";
import { buildSitemap } from "@/lib/sitemapEntries";
import { getFilms } from "@/lib/films";
import { getPodcastShow } from "@/lib/podcast";

// Revalidate so a newly added film/episode reaches the sitemap without a deploy.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [{ films }, show] = await Promise.all([
    getFilms().catch(() => ({ films: [], error: true })),
    getPodcastShow().catch(() => null),
  ]);
  const newestFilm = films.map((f) => f.created_at).sort().at(-1) ?? null;
  const newestEpisode = show?.episodes.map((e) => e.pubDate).sort().at(-1) ?? null;
  return buildSitemap({ filmsLastModified: newestFilm, podcastLastModified: newestEpisode });
}
```

Before writing this, read the sitemap docs under `node_modules/next/dist/docs/` to confirm that `revalidate` and async `sitemap()` are supported as written in Next 16. Adjust to the documented API if they differ.

- [ ] **Step 7: Verify.**
  - `npm test` should PASS, and `npx tsc --noEmit`, `npm run lint` and `npm run build` should all be clean.
  - Run `npm start`.
  - `curl -s localhost:3000/sitemap.xml` should show no `/films` while the videos table is empty, and should not repeat the same `lastmod` on every URL.
  - `curl -s localhost:3000/films | grep -o '<meta name="robots"[^>]*>'` should show `noindex` while the table is empty.
  - Paste the output into your report, then stop the server.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "SEO: noindex empty films page, VideoObject schema, sitemap with real dates only

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Descriptive boudoir alt text + gallery alt guard

**Files:**
- Modify: `lib/masonryPhotos.ts` (`BOUDOIR_MASONRY_PHOTOS`, lines ~215–249), `lib/services.ts` (`BOUDOIR_SERVICE.heroImageAlt`)
- Create: `tests/galleryAlts.test.ts`

**Interfaces:**
- Consumes: `HEADSHOTS_MASONRY_PHOTOS`, `CREATIVE_PORTRAITS_MASONRY_PHOTOS`, `BOUDOIR_MASONRY_PHOTOS`, `MUSIC_MASONRY_PHOTOS`, `BOUDOIR_SERVICE`.

- [ ] **Step 1: Failing test `tests/galleryAlts.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  BOUDOIR_MASONRY_PHOTOS, CREATIVE_PORTRAITS_MASONRY_PHOTOS, HEADSHOTS_MASONRY_PHOTOS, MUSIC_MASONRY_PHOTOS,
} from "@/lib/masonryPhotos";
import { BOUDOIR_SERVICE } from "@/lib/services";

const galleries = {
  headshots: HEADSHOTS_MASONRY_PHOTOS,
  creativePortraits: CREATIVE_PORTRAITS_MASONRY_PHOTOS,
  boudoir: BOUDOIR_MASONRY_PHOTOS,
  music: MUSIC_MASONRY_PHOTOS,
};

describe("gallery alt text", () => {
  it.each(Object.entries(galleries))("%s: every photo has a unique, descriptive alt", (_name, photos) => {
    const alts = photos.map((p) => p.alt.trim());
    alts.forEach((a) => {
      expect(a.length).toBeGreaterThan(20);
      expect(a).not.toMatch(/image \d+$/i);
    });
    expect(new Set(alts).size).toBe(alts.length);
  });
  it("boudoir alts stay concise", () => {
    BOUDOIR_MASONRY_PHOTOS.forEach((p) => expect(p.alt.length).toBeLessThanOrEqual(160));
    expect(BOUDOIR_SERVICE.heroImageAlt.length).toBeLessThanOrEqual(160);
    expect(BOUDOIR_SERVICE.heroImageAlt).not.toBe("Fine art boudoir photography session in Columbia, Missouri.");
  });
});
```

- [ ] **Step 2: Run it.** `npm test` should FAIL on boudoir only, with the "image N" alts. If headshots, creative-portraits or music also fail (for example on duplicate alts), STOP and report which entries fail. Do not edit those galleries in this task.

- [ ] **Step 3: View each boudoir photo.** Download each image into the session scratchpad directory, not the repo:
  - all 30 `BOUDOIR_MASONRY_PHOTOS` keys
  - the hero `boudoir/AnonBanner.jpg`

Build each URL with the same base as `publicImageUrl` in `lib/media.ts`, using the public R2 URL; read `lib/media.ts` for the base. Fetch a downscaled version through `/_next/image` only if a local server is running; otherwise fetch the original and view it with the Read tool. Never commit the downloads, and delete them afterwards.

- [ ] **Step 4: Write the alts.** Give each entry in `BOUDOIR_MASONRY_PHOTOS` its own `alt` field, and change the trailing `.map` so it no longer overwrites alt:

```ts
].map((photo) => ({ ...photo, src: publicImageUrl(photo.key) }));
```

The entry type before `.map` must now include `alt`, as the other galleries do. Rules for each alt:
- 60–160 characters.
- Describe light, pose, setting, palette and mood.
- Tasteful and non-explicit. Describe nudity, if present, only in general art terms such as "nude figure study" or "bare shoulders", never anatomical detail.
- No identifying details: no tattoos, scars, birthmarks, piercings, hair color plus face combinations, or anything that could identify a client.
- Use "fine art boudoir" in no more than about one in four alts.

Also replace `BOUDOIR_SERVICE.heroImageAlt` in `lib/services.ts` under the same rules.

- [ ] **Step 5: Verify.** `npm test` should PASS, and `npx tsc --noEmit` and `npm run lint` should be clean. In your report, list all 31 alts (key → alt) so the owner can review them before merge.

- [ ] **Step 6: Commit**

```bash
git add lib/masonryPhotos.ts lib/services.ts tests/galleryAlts.test.ts
git commit -m "SEO: individual, descriptive boudoir alt text; guard gallery alts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Local SEO checklist

**Files:**
- Create: `docs/seo-local-checklist.md`

- [ ] **Step 1: Write the checklist.** It is owner-facing, so use plain language and checkboxes. Use these sections and items:
  1. **Domain**
     - In Vercel → Project → Settings → Domains, set `www.zkjfilms.com` to redirect (308) to `zkjfilms.com`. Today it serves a duplicate copy.
     - Verify with `curl -sI https://www.zkjfilms.com/`, which should show a 308 to the apex.
  2. **Google Search Console**
     - Verify the `zkjfilms.com` domain property.
     - Submit `https://zkjfilms.com/sitemap.xml`.
     - Run the Rich Results Test on `/`, `/headshots`, `/faq`, `/about` and `/podcast`. Expect LocalBusiness, Service, Breadcrumb, FAQ, Person and Podcast.
     - Use URL Inspection → Request indexing on the changed pages.
     - Watch Page indexing and Performance for 4–6 weeks after the title changes.
  3. **Google Business Profile**
     - Primary category: Photographer. Secondary: Portrait studio, Boudoir photographer (if offered), Videographer.
     - Services list matches the site: Headshots, Creative Portraits, Boudoir & Fine Art Nude, Music & Performance, Films.
     - Hours match the site (Fri–Sun 10–5, alternating weeks; note this in the description).
     - Add 20+ photos. Never use boudoir images on GBP.
     - Post monthly.
     - Copy the review link (Get more reviews → share). It unblocks the paused post-shoot review-request feature in this repo.
  4. **Reviews**
     - Ask every client within a week of delivery.
     - Reply to every review.
     - Never offer incentives.
  5. **Citations (NAP consistency)**
     - Use the exact name, address and phone from `lib/seo.ts` `BUSINESS` on Bing Places, Apple Business Connect, Yelp, Facebook, Instagram bio, the Columbia Chamber / CoMo directories, and The Knot / WeddingWire, the latter only if you list portrait work.
     - Make sure every listing links to `https://zkjfilms.com`.
  6. **Ongoing**
     - Keep each page's title and description in `content/pages.ts`. `npm test` enforces the limits.
     - Every new gallery photo needs a unique, descriptive alt. `npm test` enforces this.
     - Films appear in Google automatically once the first video is added with `npm run video:create`.

- [ ] **Step 2: Verify the references.** Every file path, script and env reference in the doc must exist. Check with grep, e.g. `video:create` in `package.json`.

- [ ] **Step 3: Final verification.** Run `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build`. All should be clean. Report the exact counts.

- [ ] **Step 4: Commit**

```bash
git add docs/seo-local-checklist.md
git commit -m "Docs: local SEO checklist

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
