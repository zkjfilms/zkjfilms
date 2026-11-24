# zkjfilms.com SEO pass — design

**Date:** 2026-11-24 · **Branch:** `seo-pass` · **Status:** approved by owner

## Context

On 2026-11-24 the owner ran a live audit of the 11 public pages on zkjfilms.com. The results:

- Lighthouse gives SEO 100 and Best Practices 100.
- Accessibility is 96, failing only on low-contrast muted text.
- Mobile LCP is about 0.6 s and CLS is 0.
- Every page has exactly one h1, and every image has an alt attribute.
- Canonicals, robots and the sitemap are wired up.

The remaining gaps are relevance and coverage, not breakage:

1. Page titles lack service and location terms ("About", "Films", "Contact & Booking"). The home title is 62 characters.
2. Structured data exists only on home (LocalBusiness), FAQ (FAQPage) and podcast (PodcastSeries). There is no Service, BreadcrumbList, Person or VideoObject markup.
3. `www.zkjfilms.com` serves a full 200 duplicate. Canonicals point to the apex domain. This is fixed in the Vercel domain settings, which is an owner action outside the code.
4. `/films` is empty ("New film work is on the way") but listed in the sitemap at priority 0.8.
5. All 30 boudoir gallery alts are "Fine art boudoir photography session in Columbia, Missouri — image N". The boudoir hero alt is generic too.
6. Every page shares one OG image.
7. The muted text color `#8c7f6f` on `#faf6f0` is 3.62:1. Lighthouse flags 27 nodes on home, and the token is used sitewide.
8. Smaller items:
   - The sitemap `lastModified` is the build time for every URL.
   - The FAQ description is 163 characters.
   - There is a `keywords` meta tag, which search engines ignore.
   - No tests guard any of this.

Scope: all code fixes for items 1–2 and 4–8, plus a local-SEO checklist doc. The owner chose this over "search fixes only" and "top four only".

## Approach

Mirror the Oak & Emerald site's SEO architecture so both codebases work the same way:

- One route registry that holds titles and descriptions.
- Pure JSON-LD builder functions with a `<JsonLd>` component.
- Vitest tests that enforce the limits.

The alternative, editing each page in place, was rejected because nothing would stop regressions.

## Design

### 1. Route registry: `content/pages.ts`

`ROUTES: Record<RouteKey, { path; title; description; changeFrequency; priority }>` covers every public, indexable page:

- home
- book
- contact
- about
- faq
- headshots
- creativePortraits
- boudoir
- music
- films
- podcast

`lib/seo.ts` gains:

- `buildPageMetadata({ title, description, path, image?, absoluteTitle? })`. With `absoluteTitle`, `title` becomes `{ absolute }`. With `image`, it overrides the default OG image.
- `pageMetadata(key, image?)`. Home uses `absoluteTitle`.

All 11 pages switch to `pageMetadata`. The root layout's `keywords` array is removed. Its default title becomes the home title.

Titles: each page title is at most 42 characters, so that title + " | Zach K. Johnson" stays at or under 60. Home is absolute and at most 60.

| Key | Title | Notes |
|---|---|---|
| home | Columbia MO Portrait & Boudoir Photography \| Zach K. Johnson | absolute, 60 |
| headshots | Headshots in Columbia, MO | |
| creativePortraits | Creative Portrait Photography, Columbia MO | |
| boudoir | Boudoir Photography in Columbia, MO | |
| music | Concert & Band Photography, Columbia MO | |
| films | Films & Video, Columbia MO | |
| about | About the Photographer | |
| contact | Contact a Columbia, MO Photographer | |
| book | Book a Photo Session in Columbia, MO | |
| faq | Photography FAQ | |
| podcast | What Comes Next — Podcast | unchanged |

Descriptions are 50–155 characters. Existing copy is kept where it is in range. The FAQ description is trimmed to at most 155.

### 2. Structured data: `lib/jsonLd.ts` and `components/JsonLd.tsx`

The builders are pure functions that return plain objects, using only facts already on the site:

- `businessJsonLd(priceRange?)`: the existing home LocalBusiness/ProfessionalService object, moved unchanged. It keeps `@id` `${SITE_URL}/#business`.
- `breadcrumbJsonLd(items)`: used on every non-home public page (Home → Page).
- `serviceJsonLd({ name, description, path, image, startingPriceCents? })`:
  - `provider` is `{ "@id": business }`.
  - `areaServed` comes from `BUSINESS.areaServed`.
  - When a price is known, it adds `offers: { "@type": "Offer", price, priceCurrency: "USD" }`.
  - The starting price is the lowest `price_cents` among active, paid appointment types matching the service. This is the same rule the home page's `startingPrice` uses, which moves to `lib/pricing.ts` and is shared.
- `personJsonLd()`: Zach K. Johnson, `jobTitle` "Photographer", `worksFor` the business `@id`, `sameAs` the socials, and the About portrait image. Used on /about.
- `faqJsonLd(items)` and `podcastJsonLd(show)`: moved from the FAQ and podcast pages, with unchanged output.
- `videoJsonLd(video)`: VideoObject with:
  - `name`, `description` (falls back to the title)
  - `thumbnailUrl` (poster)
  - `contentUrl` (R2)
  - `uploadDate` (the row's `created_at`)

`<JsonLd data>` renders `<script type="application/ld+json">` with `<` escaped, and renders nothing for null.

Service pages (`headshots`, `creative-portraits`, `boudoir`, `music`) become async. They fetch active appointment types with `revalidate = 300`, the same pattern as home, FAQ and book. A failed fetch omits `offers` and never fails the page.

### 3. Films indexing

`/films` sets `robots: { index: false, follow: true }` while the `videos` table returns no rows. The sitemap omits `/films` under the same condition, via a shared `hasFilms()` in `lib/films.ts`. Indexing flips on automatically when the first video is added. When videos exist, the page emits one VideoObject per video. The select adds `created_at`.

### 4. Sitemap

- Built from `ROUTES`.
- Static pages carry no `lastModified`, because a fake build-time date teaches Google to ignore the field.
- `/podcast` carries the newest episode's `pubDate` when the feed loads.
- `/films` is included only when films exist, with the newest `created_at`.
- `robots.ts` is unchanged.

### 5. Per-page OG images

`buildPageMetadata`'s `image` is used by:

- headshots: hero
- creative-portraits: hero
- music: hero
- about: portrait

Boudoir deliberately keeps the default brand OG image, so nude imagery never appears in social link previews. Other pages keep the default.

### 6. Boudoir alt text

The 30 gallery photos and the boudoir hero each get an individual alt:

- Written by viewing each image.
- Short (at most about 160 characters), tasteful and non-explicit.
- Describes light, pose, setting, palette and mood.
- No identifying details (no tattoos, distinctive marks or faces described identifiably).
- The phrase "fine art boudoir" appears in some alts, not all, to avoid keyword stuffing.

Alts are stored per entry in `BOUDOIR_MASONRY_PHOTOS`, matching the other galleries. The owner reviews all 31 before merge.

### 7. Readability

The `--muted` token is darkened to the lightest value that reaches at least 4.5:1 on both `--background` (`#faf6f0`) and `--surface` (`#f2ebe0`), staying in the same warm hue. `lib/contrast.ts` (`contrastRatio`) and `tests/contrast.test.ts` lock this in. The visual change is slight; the owner accepted it.

### 8. Tests and docs

Vitest is added, using the same configuration as O&E: `npm test`, and `build` runs `vitest run && next build`. Tests cover:

- **Routes:** every title is at most 42 characters (home at most 60 absolute), descriptions are 50–155, paths are unique, and every route has a page file.
- **JSON-LD builders:** shape, escaping, null handling, and offers present or absent.
- **Gallery alts:** every `MasonryPhoto` in all four galleries has a non-empty alt, and alts are unique within each gallery. This catches the "image N" pattern.
- **Contrast:** the muted token against background and surface.
- **Sitemap:** uses ROUTES, excludes films when empty, and has no static `lastModified`.

`docs/seo-local-checklist.md` is the owner-facing checklist. It covers:

- Redirecting `www` to the apex domain in Vercel Domains.
- Google Business Profile: categories, services, photos, posts, and the review link, which also unblocks the paused post-shoot review feature.
- Review asks.
- NAP consistency across citations: Yelp, Bing Places, Apple Business Connect and local directories.
- Search Console: sitemap submission, the Rich Results Test on home, a service page, FAQ and about, and monitoring.

## Out of scope

- New keyword landing pages.
- Content and blog strategy.
- Off-site work beyond the checklist.
- Performance work (already good).
- Navbar and visual redesign.
- The www redirect itself (owner, in Vercel).

## Risks

- **SMS worktree conflict.** The paused `worktree-sms-session-reminder` branched from `main`, and this pass edits `lib/seo.ts` and page metadata, so that branch may need a small conflict resolution later.
- **Ranking churn.** Title changes can cause short-term ranking churn. The new titles keep "Columbia, MO" and the service terms, so the net effect is expected to be positive.
- **Search Console after deploy.** Run the Rich Results Test and resubmit the sitemap after deploy.
