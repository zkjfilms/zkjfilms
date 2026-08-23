# Podcast page: "What Comes Next"

## Purpose

Give the podcast "What Comes Next" its own page on zkjfilms.com at `/podcast`,
featuring the show's YouTube playlist (video) and its RSS feed (audio
episodes), plus outbound subscribe links. Top-level nav item, same tier as
Films/Photos/About.

## Sources

- YouTube playlist: `https://www.youtube.com/playlist?list=PL_TKznejt1qTg-spopGgooR2EB08AnQ2K`
- Podcast RSS feed: `https://media.rss.com/what-comes-next/feed.xml`
  (standard RSS 2.0 with the `itunes`/`podcast` namespaces; currently 1
  episode, expected to grow)
- Apple Podcasts: `https://podcasts.apple.com/us/podcast/what-comes-next/id1836518475`
- Spotify: `https://open.spotify.com/show/2J7dRHRjd5uivNVMq8N68Z`
  (store without the `si`/`utm_source` tracking query params)

## Data flow

`app/podcast/page.tsx` is a server component. On each request (subject to
ISR), it:

1. Fetches and parses the RSS feed via a new `lib/podcast.ts` module.
2. Reads channel-level fields: show title, description, cover art
   (`itunes:image`).
3. Reads per-item fields: title, description, `pubDate`, `itunes:duration`,
   `itunes:image` (falls back to the channel image if absent), the
   `enclosure` audio URL, and season/episode numbers.
4. Sorts episodes newest-first by `pubDate` and passes everything to the
   page for rendering.

`export const revalidate = 300` — matches `/films`' cadence, so a newly
published episode (or an edited YouTube playlist) appears without a
redeploy.

**Parsing approach:** add `fast-xml-parser` as a dependency (zero
dependencies of its own, ~30kb, standard choice for RSS/Atom). The codebase
has no XML parser today, and hand-rolled regex extraction over RSS +
CDATA is fragile — a real parser correctly handles CDATA, attribute
namespaces (`itunes:`, `podcast:`), and malformed/missing fields.

**Failure handling:** if the fetch or parse fails, log the error
server-side (`console.error`, matching `/films`' Supabase-error handling)
and still render the page — the YouTube section renders unconditionally
since it doesn't depend on the feed; the episode list area shows "Couldn't
load episodes right now." instead of throwing.

## `lib/podcast.ts`

New module, mirroring the shape of `lib/masonryPhotos.ts`/`lib/media.ts` as
a small, typed data helper:

```ts
export type PodcastEpisode = {
  guid: string;
  title: string;
  description: string; // plain text, HTML stripped
  pubDate: string; // ISO 8601
  durationSeconds: number | null;
  imageUrl: string;
  audioUrl: string;
  season: number | null;
  episode: number | null;
};

export type PodcastShow = {
  title: string;
  description: string;
  imageUrl: string;
  episodes: PodcastEpisode[];
};

export async function getPodcastShow(): Promise<PodcastShow | null>;
```

`getPodcastShow` fetches the feed URL (hardcoded constant in this module,
same pattern as other lib modules hardcoding their own external
endpoints), parses it, strips HTML tags from the CDATA description fields
for plain-text display, and returns `null` on any fetch/parse failure
(the page treats `null` as the error-fallback case above).

## Page layout (`app/podcast/page.tsx`)

Top to bottom:

1. **Header** — the podcast's cover art as a hero banner (added to
   `HERO_ROUTES` in `Navbar.tsx` so the navbar floats over it like
   `/`, `/photos`, `/music`, etc.), show title "What Comes Next," and the
   channel description from the feed. If the feed fetch fails, this falls
   back to a static title + tagline (no cover art) so the page never has an
   empty header.
2. **Subscribe row** — inline-SVG icon links (matching the icon style
   already used in `Navbar.tsx`) to Apple Podcasts, Spotify, and the raw
   RSS feed URL (labeled "RSS"). Plain `<a>` tags, `target="_blank"`,
   `rel="noopener noreferrer"`.
3. **Watch section** — heading ("Watch"), then the YouTube playlist embedded
   via
   `<iframe src="https://www.youtube.com/embed/videoseries?list=PL_TKznejt1qTg-spopGgooR2EB08AnQ2K">`,
   wrapped in an `aspect-video` container (same crop convention as
   `/films`' `<video>` elements), `loading="lazy"`, `allowFullScreen`.
   Requires no YouTube API key — playlist iframes are public embeds.
4. **Listen section** — heading ("Listen"), then the episode list,
   newest-first. Each episode renders: cover art thumbnail, title,
   formatted date + duration (`lib/format.ts` conventions), plain-text
   description, and a native `<audio controls preload="none">` pointing at
   the enclosure MP3 — no custom player UI (YAGNI: the platform already
   gives scrubbing, speed control, etc. for free).
   - Empty/error state: "Couldn't load episodes right now." (feed
     failure) or "New episodes are on the way — check back soon." (feed
     loaded but zero items), mirroring `/films`' empty-state copy.

## Component boundaries

- `app/podcast/page.tsx` — server component; calls `getPodcastShow()`,
  renders header/subscribe row/watch/listen sections. No client
  interactivity needed (native `<audio>`/`<iframe>` handle their own
  state), so no `"use client"` directive — same as `/films`.
- `lib/podcast.ts` — fetch + parse + typing, isolated and independently
  testable (pure function of the feed URL's response body).
- `Navbar.tsx` — add `{ href: "/podcast", label: "Podcast" }` to the `links`
  array between Films and About, and add `/podcast` to `HERO_ROUTES`.
- `lib/seo.ts`'s `buildPageMetadata` — used for the page's metadata, same
  as every other route.

## Out of scope (YAGNI)

- No individual episode detail pages/routes — one page lists everything.
- No YouTube Data API integration — the playlist iframe covers "browse all
  videos" without needing an API key or quota.
- No custom audio player UI beyond the native `<audio>` element.
- No database mirroring/caching of the RSS feed — fetched fresh each
  request, subject to the 300s ISR revalidation window, same trust model
  as `/films`' Supabase query.
- No pagination for episodes — the feed currently has 1 episode; revisit if
  the list grows large enough to matter.
