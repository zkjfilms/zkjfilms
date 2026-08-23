# Podcast page: "What Comes Next"

## Purpose

Give the podcast "What Comes Next" its own page on zkjfilms.com at `/podcast`,
featuring the show's YouTube playlist (video) and its RSS feed (audio
episodes), plus outbound subscribe links. Top-level nav item, same tier as
Films/Photos/About.

## Sources

- YouTube playlist: `https://www.youtube.com/playlist?list=PL_TKznejt1qTg-spopGgooR2EB08AnQ2K`
  (playlist ID: `PL_TKznejt1qTg-spopGgooR2EB08AnQ2K`)
- Podcast RSS feed: `https://media.rss.com/what-comes-next/feed.xml`
  (standard RSS 2.0 with the `itunes`/`podcast` namespaces; currently 1
  episode, expected to grow)
- Apple Podcasts: `https://podcasts.apple.com/us/podcast/what-comes-next/id1836518475`
- Spotify: `https://open.spotify.com/show/2J7dRHRjd5uivNVMq8N68Z`
  (store without the `si`/`utm_source` tracking query params)

## Data flow

`app/podcast/page.tsx` is a server component. On each request (subject to
ISR), it calls `getPodcastShow()`, which fetches two sources in parallel:

1. **RSS feed** — parsed via `fast-xml-parser`. Reads channel-level fields
   (show title, description, cover art from `itunes:image`) and per-item
   fields (title, description, `pubDate`, `itunes:duration`, `itunes:image`,
   the `enclosure` audio URL, season/episode numbers, `itunes:explicit`).
2. **YouTube playlist items** — `youtube.playlistItems.list` (via the
   `googleapis` package, already a dependency for Google Calendar) with
   `part: "snippet"`, `playlistId`, `maxResults: 50`, authenticated with a
   plain API key (`YOUTUBE_API_KEY` env var — read-only public data, no
   OAuth/consent flow needed, unlike the Calendar integration's OAuth2
   client). Returns each video's ID, title, thumbnail, and position in the
   playlist.

The two lists are then **paired by publish order** (both newest/oldest-first
after sorting each independently) — zipped index-for-index into a single
`PodcastEpisode[]`, since the show publishes video and audio together per
episode. If the two lists have different lengths (a video without a matching
RSS item, or vice versa), only the paired positions get a `videoId`; extras
are dropped from the pairing but the RSS item still renders audio-only.
This is a heuristic, not a guaranteed-correct mapping — acceptable given the
show publishes in lockstep today; if that ever proves unreliable, the fix is
adding an explicit per-episode video ID field, not revisiting this design.

Sorts episodes newest-first by `pubDate` and passes everything to the page
for rendering.

`export const revalidate = 300` — matches `/films`' cadence, so a newly
published episode (or an edited YouTube playlist) appears without a
redeploy.

**Parsing approach:** add `fast-xml-parser` as a dependency (zero
dependencies of its own, ~30kb, standard choice for RSS/Atom). The codebase
has no XML parser today, and hand-rolled regex extraction over RSS +
CDATA is fragile — a real parser correctly handles CDATA, attribute
namespaces (`itunes:`, `podcast:`), and malformed/missing fields.

**Failure handling:** the RSS fetch and the YouTube fetch fail
independently (`Promise.allSettled`, not `Promise.all`) — a YouTube API
outage or quota error shouldn't take down the audio episode list, and vice
versa. Each failure is logged server-side (`console.error`, matching
`/films`' Supabase-error handling). If RSS fails entirely, the episode list
area shows "Couldn't load episodes right now." instead of throwing. If only
the YouTube call fails, episodes still render with their audio player, just
without a video embed for that render.

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
  explicit: boolean;
  videoId: string | null; // null if pairing failed or YouTube fetch errored
  videoThumbnailUrl: string | null;
};

export type PodcastShow = {
  title: string;
  description: string;
  imageUrl: string;
  episodes: PodcastEpisode[];
};

export async function getPodcastShow(): Promise<PodcastShow | null>;
```

`getPodcastShow` fetches the RSS feed URL and calls the YouTube
`playlistItems.list` endpoint (both hardcoded constants in this module —
feed URL and playlist ID — same pattern as other lib modules hardcoding
their own external endpoints) via `Promise.allSettled`, parses the RSS
body, strips HTML tags from the CDATA description fields for plain-text
display, pairs episodes with videos by order (see Data flow above), and
returns `null` only if the RSS fetch/parse itself fails (the page treats
`null` as the full-page error-fallback case below). A YouTube-only failure
is reflected per-episode via `videoId: null`, not a top-level `null`.

## Page layout (`app/podcast/page.tsx`)

Top to bottom:

1. **Header** — the podcast's cover art as a hero banner (added to
   `HERO_ROUTES` in `Navbar.tsx` so the navbar floats over it like
   `/`, `/photos`, `/music`, etc.), show title "What Comes Next," and the
   channel description from the feed. If the feed fetch fails, this falls
   back to a static title + tagline (no cover art) so the page never has an
   empty header.
2. **Subscribe row** — inline-SVG icon links (matching the icon style
   already used in `Navbar.tsx`) to Apple Podcasts, Spotify, the raw RSS
   feed URL (labeled "RSS"), and the full YouTube playlist (labeled
   "YouTube") — the last one matters now that individual episodes only
   embed one video each; this is where someone goes to browse everything
   on YouTube directly. Plain `<a>` tags, `target="_blank"`,
   `rel="noopener noreferrer"`.
3. **Episodes section** — heading ("Episodes"), then a single list,
   newest-first, merging what would otherwise be separate "Watch" and
   "Listen" sections. Each episode card renders:
   - Cover art / video thumbnail, title, formatted date + duration
     (`lib/format.ts` conventions), an "Explicit" badge when
     `episode.explicit` is true (small text badge, styled like a tag —
     matching the site's existing understated label conventions, not the
     heavier `/boudoir` age-gate treatment, since this is an informational
     flag rather than a content barrier), and the plain-text description.
   - **Video embed**, only when `episode.videoId` is present: rendered via
     a new `<YouTubeEmbedFacade>` client component (see below) — a
     click-to-load facade, not an eagerly-loaded iframe.
   - **Audio player**: a native `<audio controls preload="none">` pointing
     at the enclosure MP3 — no custom player UI (YAGNI: the platform
     already gives scrubbing, speed control, etc. for free). Always
     rendered, independent of whether the video paired successfully.
   - Empty/error state: "Couldn't load episodes right now." (RSS
     fetch/parse failure — `getPodcastShow()` returned `null`) or "New
     episodes are on the way — check back soon." (feed loaded but zero
     items), mirroring `/films`' empty-state copy.

## Structured data

`app/podcast/page.tsx` includes a `PodcastSeries` JSON-LD block (with
nested `PodcastEpisode` entries), following the exact inline-`<script>`
pattern already used in `app/page.tsx`/`app/faq/page.tsx`:
`dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }}`.
Built inline in the page (not a `lib/seo.ts` helper) since it's the only
page needing this shape, matching how `app/faq/page.tsx` builds its own
`FAQPage` JSON-LD today.

## Component boundaries

- `app/podcast/page.tsx` — server component; calls `getPodcastShow()`,
  renders header/subscribe row/episodes sections + JSON-LD. No
  page-level client interactivity needed — interactivity is scoped to the
  small facade component below — so no `"use client"` directive on the
  page itself, same as `/films`.
- `lib/podcast.ts` — fetch (RSS + YouTube) + parse + pairing + typing,
  isolated and independently testable.
- `components/YouTubeEmbedFacade.tsx` — new small client component
  (`"use client"`), the only interactive piece on the page. Props:
  `videoId`, `thumbnailUrl`, `title`. Renders a thumbnail `<img>` with a
  play-button overlay; on click, swaps in
  `<iframe src="https://www.youtube.com/embed/{videoId}">` (`aspect-video`,
  `allowFullScreen`). Keeps YouTube's iframe/player JS from loading for
  every episode on initial page load — only the clicked one loads.
- `Navbar.tsx` — add `{ href: "/podcast", label: "Podcast" }` to the `links`
  array between Films and About, and add `/podcast` to `HERO_ROUTES`.
- `app/sitemap.ts` — add `{ path: "/podcast", changeFrequency: "weekly",
  priority: 0.8 }` to the `routes` array (weekly, matching `/photos`, since
  new episodes are expected regularly; same priority tier as the other
  content sections).
- `lib/seo.ts`'s `buildPageMetadata` — used for the page's metadata, same
  as every other route.

## Environment variables

- `YOUTUBE_API_KEY` — new. A plain Google Cloud API key (YouTube Data API
  v3 enabled), not OAuth — read-only access to public playlist data needs
  no user consent flow, unlike the existing `GOOGLE_OAUTH_*` vars used for
  Calendar. Needs to be created in the Google Cloud project and added to
  Vercel's environment variables before this ships.

## Out of scope (YAGNI)

- No individual episode detail pages/routes — one page lists everything.
- No custom audio player UI beyond the native `<audio>` element.
- No database mirroring/caching of the RSS feed or playlist data — fetched
  fresh each request, subject to the 300s ISR revalidation window, same
  trust model as `/films`' Supabase query.
- No pagination for episodes — the feed currently has 1 episode; revisit if
  the list grows large enough to matter.
- No manual video/episode override field — the order-based pairing is
  trusted as-is; revisit only if it actually mismatches in practice.
