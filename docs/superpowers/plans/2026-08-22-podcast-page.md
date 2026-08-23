# Podcast Page ("What Comes Next") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `/podcast`, a page for the "What Comes Next" podcast that embeds its YouTube playlist (paired per-episode) and lists episodes from its RSS feed with native audio players.

**Architecture:** A server component (`app/podcast/page.tsx`, ISR `revalidate = 300`) calls one data module (`lib/podcast.ts`) that fetches and parses the podcast's RSS feed (`fast-xml-parser`) and the YouTube playlist's videos (`googleapis`, API-key auth), pairing episodes to videos by publish order. Video embeds are click-to-load via a small client component (`YouTubeEmbedFacade`) to avoid loading N YouTube iframes on page load.

**Tech Stack:** Next.js App Router (server components, ISR), TypeScript (strict), Tailwind CSS (existing design tokens), `fast-xml-parser` (new dependency), `googleapis` (existing dependency, already used for Google Calendar).

**Spec:** `docs/superpowers/specs/2026-08-22-podcast-page-design.md`

## Global Constraints

- Route: `/podcast`, top-level nav item between Films and About.
- RSS feed URL: `https://media.rss.com/what-comes-next/feed.xml`.
- YouTube playlist ID: `PL_TKznejt1qTg-spopGgooR2EB08AnQ2K`.
- Apple Podcasts URL: `https://podcasts.apple.com/us/podcast/what-comes-next/id1836518475`.
- Spotify URL: `https://open.spotify.com/show/2J7dRHRjd5uivNVMq8N68Z` (no tracking query params).
- `export const revalidate = 300` on the page — matches `/films`, `/faq`.
- New env var: `YOUTUBE_API_KEY` (plain Google Cloud API key, not OAuth). Its absence must NOT break the page — the YouTube fetch is skipped and episodes render audio-only.
- New dependency: `fast-xml-parser`.
- **No test framework exists in this repo** (`grep` confirms zero `*.test.*`/`*.spec.*` files, no jest/vitest config). Verification in every task below is `npm run lint`, `npm run build`, and manual dev-server checks (curl / browser) — not unit tests. Do not introduce a test framework as a side effect of this feature.
- Subscribe-row links are **plain text links**, not icons — `components/Footer.tsx` documents and establishes this convention for the whole site (no brand-icon library is installed).
- Follow existing design tokens only: `bg-background`, `bg-surface`, `text-foreground`, `text-muted`, `text-accent`, `border-border` (defined in `globals.css`). Headings use `font-serif italic`; small labels use `text-xs uppercase tracking-[0.2em]`+ variants — copy the exact classes used in `/films` and `/faq` (`app/films/page.tsx`, `app/faq/page.tsx`) rather than inventing new ones.

---

## File Structure

- **Modify** `next.config.ts` — CSP (`frame-src`, `media-src`) and `images.remotePatterns` additions for the new external hosts.
- **Modify** `lib/format.ts` — add `formatDuration(totalSeconds: number): string`.
- **Create** `lib/podcast.ts` — RSS fetch/parse, YouTube playlist fetch, pairing, types, `PODCAST_LINKS` constant.
- **Create** `components/YouTubeEmbedFacade.tsx` — click-to-load video embed (client component).
- **Create** `app/podcast/page.tsx` — the page itself.
- **Modify** `components/Navbar.tsx` — add the nav link and hero route.
- **Modify** `app/sitemap.ts` — add the route entry.

---

### Task 1: Dependency + CSP + Next Image config for the new external hosts

**Files:**
- Modify: `package.json` (via `npm install`)
- Modify: `next.config.ts:30` (media-src), `next.config.ts:35` (frame-src), `next.config.ts:57-82` (remotePatterns)

**Interfaces:**
- Produces: `images.remotePatterns` entries allowing `media.rss.com` and `i.ytimg.com` for `next/image`; CSP allowing `https://content.rss.com` in `media-src` and `https://www.youtube.com` in `frame-src`.

This has to land first — every later task that renders a cover image, video thumbnail, audio player, or YouTube iframe will silently fail (image 404 via Next's optimizer, or a CSP console error blocking the `<audio>`/`<iframe>`) without it.

- [ ] **Step 1: Install `fast-xml-parser`**

Run: `npm install fast-xml-parser`

- [ ] **Step 2: Update the CSP's `media-src` and `frame-src` directives**

In `next.config.ts`, find:

```ts
    `img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    `media-src 'self' https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
```

Replace with:

```ts
    `img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    // /podcast's <audio> elements point directly at RSS.com's CDN for the
    // episode MP3s — not proxied through our own origin (there's no
    // next/image-style proxy for audio), so media-src needs it explicitly,
    // same reasoning as the R2 hosts above.
    `media-src 'self' https://*.r2.cloudflarestorage.com https://${r2PublicHost} https://content.rss.com`,
```

Then find:

```ts
    // app/about/page.tsx embeds the studio location as a Google Maps
    // iframe; without this the map silently fails to load (falls back to
    // default-src 'self') with no visible error beyond the console.
    `frame-src 'self' https://www.google.com https://challenges.cloudflare.com`,
```

Replace with:

```ts
    // app/about/page.tsx embeds the studio location as a Google Maps
    // iframe; without this the map silently fails to load (falls back to
    // default-src 'self') with no visible error beyond the console.
    // /podcast embeds individual YouTube videos (YouTubeEmbedFacade) —
    // without youtube.com here those iframes fail the same way.
    `frame-src 'self' https://www.google.com https://challenges.cloudflare.com https://www.youtube.com`,
```

- [ ] **Step 3: Add `media.rss.com` and `i.ytimg.com` to `images.remotePatterns`**

In `next.config.ts`, find the closing of the `r2PublicHost` remotePattern entry:

```ts
      {
        protocol: "https",
        hostname: r2PublicHost,
        port: "",
        pathname: "/**",
        // No `search` restriction (unlike the picsum patterns above) —
        // publicImageUrl()'s optional cache-bust `?v=...` param (see
        // lib/media.ts) needs to pass through for fixed-name keys like
        // hero.jpg that get their content swapped in place.
      },
    ],
  },
```

Replace with:

```ts
      {
        protocol: "https",
        hostname: r2PublicHost,
        port: "",
        pathname: "/**",
        // No `search` restriction (unlike the picsum patterns above) —
        // publicImageUrl()'s optional cache-bust `?v=...` param (see
        // lib/media.ts) needs to pass through for fixed-name keys like
        // hero.jpg that get their content swapped in place.
      },
      // /podcast's cover art (RSS.com's CDN) and YouTube video thumbnails —
      // both rendered via next/image, which proxies through our own origin
      // (`/_next/image?url=...`), so (unlike the <audio> src above) these
      // don't need a CSP img-src addition, only this allowlist entry.
      {
        protocol: "https",
        hostname: "media.rss.com",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
        port: "",
        pathname: "/**",
        search: "",
      },
    ],
  },
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed with no new errors (the build doesn't yet reference any of the new hosts, so this just confirms the config file itself is syntactically valid).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json next.config.ts
git commit -m "Add fast-xml-parser dep, CSP + image config for podcast media hosts"
```

---

### Task 2: `formatDuration` helper

**Files:**
- Modify: `lib/format.ts`

**Interfaces:**
- Produces: `formatDuration(totalSeconds: number): string` — `154` → `"2:34"`, `4106` → `"1:08:26"`, `65` → `"1:05"`.

- [ ] **Step 1: Add the function**

Append to `lib/format.ts`:

```ts

// Podcast episode/video runtime — e.g. 2136 -> "35:36", 4106 -> "1:08:26".
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  }
  return `${minutes}:${paddedSeconds}`;
}
```

- [ ] **Step 2: Verify with a one-off Node check**

Run:
```bash
node -e '
function formatDuration(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const paddedSeconds = String(seconds).padStart(2, "0");
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${paddedSeconds}`;
  return `${minutes}:${paddedSeconds}`;
}
console.log(formatDuration(2136), formatDuration(4106), formatDuration(65), formatDuration(9));
'
```
Expected output: `35:36 1:08:26 1:05 0:09`

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/format.ts
git commit -m "Add formatDuration for podcast episode/video runtimes"
```

---

### Task 3: `lib/podcast.ts` — RSS + YouTube fetching, parsing, pairing

**Files:**
- Create: `lib/podcast.ts`

**Interfaces:**
- Consumes: `fast-xml-parser`'s `XMLParser` (Task 1), `googleapis`'s `google.youtube` (existing dependency), `process.env.YOUTUBE_API_KEY`.
- Produces:
  ```ts
  export type PodcastEpisode = {
    guid: string;
    title: string;
    description: string;
    pubDate: string; // ISO 8601
    durationSeconds: number | null;
    imageUrl: string;
    audioUrl: string;
    season: number | null;
    episode: number | null;
    explicit: boolean;
    videoId: string | null;
    videoThumbnailUrl: string | null;
  };
  export type PodcastShow = {
    title: string;
    description: string;
    imageUrl: string;
    episodes: PodcastEpisode[];
  };
  export const PODCAST_LINKS: { apple: string; spotify: string; rss: string; youtube: string };
  export async function getPodcastShow(): Promise<PodcastShow | null>;
  ```
  Used by: `app/podcast/page.tsx` (Task 5).

- [ ] **Step 1: Write the module**

Create `lib/podcast.ts`:

```ts
import { XMLParser } from "fast-xml-parser";
import { google } from "googleapis";

const RSS_FEED_URL = "https://media.rss.com/what-comes-next/feed.xml";
const YOUTUBE_PLAYLIST_ID = "PL_TKznejt1qTg-spopGgooR2EB08AnQ2K";

export const PODCAST_LINKS = {
  apple: "https://podcasts.apple.com/us/podcast/what-comes-next/id1836518475",
  spotify: "https://open.spotify.com/show/2J7dRHRjd5uivNVMq8N68Z",
  rss: RSS_FEED_URL,
  youtube: `https://www.youtube.com/playlist?list=${YOUTUBE_PLAYLIST_ID}`,
};

export type PodcastEpisode = {
  guid: string;
  title: string;
  description: string;
  pubDate: string;
  durationSeconds: number | null;
  imageUrl: string;
  audioUrl: string;
  season: number | null;
  episode: number | null;
  explicit: boolean;
  videoId: string | null;
  videoThumbnailUrl: string | null;
};

export type PodcastShow = {
  title: string;
  description: string;
  imageUrl: string;
  episodes: PodcastEpisode[];
};

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseItunesDuration(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const str = String(raw).trim();
  if (str.includes(":")) {
    const parts = str.split(":").map(Number);
    if (parts.some((n) => Number.isNaN(n))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }
  const seconds = Number(str);
  return Number.isNaN(seconds) ? null : seconds;
}

// RSS <guid> (and a few other elements) can carry an attribute alongside
// text content, which makes fast-xml-parser return { "#text": ..., "@_...":
// ... } instead of a plain string — this normalizes either shape.
function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (node && typeof node === "object" && "#text" in node) {
    return String((node as { "#text": unknown })["#text"]);
  }
  return "";
}

// fast-xml-parser only produces an array for a repeated element when
// there's more than one of it in the source document — with the feed's
// current single episode, channel.item parses as one bare object, not a
// 1-element array. Without this, .map() would throw the moment the feed
// has exactly one item, which is true today.
function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

type RawItem = {
  title?: unknown;
  description?: unknown;
  guid?: unknown;
  pubDate?: string;
  enclosure?: { "@_url"?: string };
  "itunes:duration"?: unknown;
  "itunes:season"?: unknown;
  "itunes:episode"?: unknown;
  "itunes:explicit"?: unknown;
  "itunes:image"?: { "@_href"?: string };
};

async function fetchRssShow(): Promise<{
  title: string;
  description: string;
  imageUrl: string;
  episodes: PodcastEpisode[];
}> {
  const res = await fetch(RSS_FEED_URL, { next: { revalidate: 300 } });
  if (!res.ok) {
    throw new Error(`Podcast RSS feed returned ${res.status}`);
  }
  const xml = await res.text();

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
  });
  const parsed = parser.parse(xml) as {
    rss?: { channel?: Record<string, unknown> };
  };
  const channel = parsed.rss?.channel;
  if (!channel) {
    throw new Error("Podcast RSS feed is missing <rss><channel>");
  }

  const channelImage = channel["itunes:image"] as { "@_href"?: string } | undefined;
  const channelImageUrl = channelImage?.["@_href"] ?? "";

  const episodes: PodcastEpisode[] = toArray(channel.item as RawItem | RawItem[] | undefined).map(
    (item) => ({
      guid: textOf(item.guid),
      title: textOf(item.title),
      description: stripHtml(textOf(item.description)),
      pubDate: item.pubDate ? new Date(item.pubDate).toISOString() : new Date(0).toISOString(),
      durationSeconds: parseItunesDuration(item["itunes:duration"]),
      imageUrl: item["itunes:image"]?.["@_href"] ?? channelImageUrl,
      audioUrl: item.enclosure?.["@_url"] ?? "",
      season: item["itunes:season"] != null ? Number(item["itunes:season"]) : null,
      episode: item["itunes:episode"] != null ? Number(item["itunes:episode"]) : null,
      explicit:
        item["itunes:explicit"] === true || item["itunes:explicit"] === "true",
      videoId: null,
      videoThumbnailUrl: null,
    }),
  );

  episodes.sort(
    (a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime(),
  );

  return {
    title: textOf(channel.title),
    description: stripHtml(textOf(channel.description)),
    imageUrl: channelImageUrl,
    episodes,
  };
}

type PlaylistVideo = { videoId: string; thumbnailUrl: string; publishedAt: string };

async function fetchPlaylistVideos(): Promise<PlaylistVideo[]> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.warn(
      "YOUTUBE_API_KEY is not set — /podcast will render episodes without video embeds.",
    );
    return [];
  }

  const youtube = google.youtube({ version: "v3", auth: apiKey });
  const res = await youtube.playlistItems.list({
    part: ["snippet", "contentDetails"],
    playlistId: YOUTUBE_PLAYLIST_ID,
    maxResults: 50,
  });

  const videos: PlaylistVideo[] = (res.data.items ?? [])
    .map((item): PlaylistVideo | null => {
      const videoId = item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      const publishedAt = item.contentDetails?.videoPublishedAt ?? item.snippet?.publishedAt;
      const thumbnailUrl =
        item.snippet?.thumbnails?.high?.url ??
        item.snippet?.thumbnails?.medium?.url ??
        item.snippet?.thumbnails?.default?.url ??
        "";
      if (!videoId || !publishedAt) return null;
      return { videoId, thumbnailUrl, publishedAt };
    })
    .filter((v): v is PlaylistVideo => v !== null);

  videos.sort(
    (a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime(),
  );

  return videos;
}

// Pairs RSS episodes with YouTube videos by publish order (both sorted
// newest-first) rather than any shared ID — the show publishes video and
// audio together per episode, so position-matching is reliable today. If
// that ever stops holding, the fix is an explicit per-episode video ID
// field, not a smarter matching heuristic here.
export async function getPodcastShow(): Promise<PodcastShow | null> {
  const [rssResult, videosResult] = await Promise.allSettled([
    fetchRssShow(),
    fetchPlaylistVideos(),
  ]);

  if (rssResult.status === "rejected") {
    console.error("Podcast RSS feed fetch failed:", rssResult.reason);
    return null;
  }

  if (videosResult.status === "rejected") {
    console.error("YouTube playlist fetch failed:", videosResult.reason);
  }
  const videos = videosResult.status === "fulfilled" ? videosResult.value : [];

  const { episodes: rawEpisodes, ...show } = rssResult.value;
  const episodes = rawEpisodes.map((episode, index) => {
    const video = videos[index];
    return video
      ? { ...episode, videoId: video.videoId, videoThumbnailUrl: video.thumbnailUrl }
      : episode;
  });

  return { ...show, episodes };
}
```

- [ ] **Step 2: Verify RSS parsing against the real feed**

Create a temporary debug route to exercise the module through the real dev server (there's no test runner in this repo, and the module uses the `@/` TS path alias plus `next/`-managed env loading, so it can't be run as a bare Node script):

Create `app/api/debug-podcast/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getPodcastShow } from "@/lib/podcast";

export async function GET() {
  const show = await getPodcastShow();
  return NextResponse.json(show);
}
```

Run: `npm run dev` (in one terminal), then in another:
```bash
curl -s http://localhost:3000/api/debug-podcast | python3 -m json.tool
```

Expected: JSON with `title: "What Comes Next"`, one episode with `title` containing `"Dennis"`, `durationSeconds: 2136`, `explicit: true`, `audioUrl` starting with `https://content.rss.com/episodes/`, `imageUrl` starting with `https://media.rss.com/what-comes-next/`, and `videoId: null` (since `YOUTUBE_API_KEY` isn't set yet — confirms the graceful-skip path works).

- [ ] **Step 3: Remove the temporary debug route**

```bash
rm app/api/debug-podcast/route.ts
rmdir app/api/debug-podcast 2>/dev/null || true
```

(It was only scaffolding to exercise `lib/podcast.ts` against the live feed — the real consumer is `app/podcast/page.tsx` in Task 5.)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors. Pay attention to any `no-explicit-any` warnings — the module above uses `unknown` throughout, not `any`.

- [ ] **Step 5: Commit**

```bash
git add lib/podcast.ts
git commit -m "Add lib/podcast.ts: RSS + YouTube playlist fetching and pairing"
```

---

### Task 4: `YouTubeEmbedFacade` client component

**Files:**
- Create: `components/YouTubeEmbedFacade.tsx`

**Interfaces:**
- Consumes: nothing new (React `useState`, `next/image`).
- Produces:
  ```tsx
  export default function YouTubeEmbedFacade(props: {
    videoId: string;
    thumbnailUrl: string;
    title: string;
  }): JSX.Element;
  ```
  Used by: `app/podcast/page.tsx` (Task 5).

- [ ] **Step 1: Write the component**

Create `components/YouTubeEmbedFacade.tsx`:

```tsx
"use client";

import { useState } from "react";
import Image from "next/image";

// Renders a thumbnail + play button until clicked, then swaps in the real
// YouTube iframe. Prevents every episode card from loading its own YouTube
// player/JS on initial page load — only the one(s) a visitor actually
// clicks ever load.
export default function YouTubeEmbedFacade({
  videoId,
  thumbnailUrl,
  title,
}: {
  videoId: string;
  thumbnailUrl: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-surface">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      aria-label={`Play video: ${title}`}
      className="group relative block aspect-video w-full overflow-hidden bg-surface"
    >
      {thumbnailUrl && (
        <Image
          src={thumbnailUrl}
          alt=""
          fill
          className="object-cover"
          sizes="(min-width: 640px) 640px, 100vw"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/35">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-foreground">
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 2.5v13l12-6.5-12-6.5z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/YouTubeEmbedFacade.tsx
git commit -m "Add YouTubeEmbedFacade click-to-load video embed component"
```

---

### Task 5: `app/podcast/page.tsx`

**Files:**
- Create: `app/podcast/page.tsx`

**Interfaces:**
- Consumes: `getPodcastShow`, `PodcastShow`, `PODCAST_LINKS` (Task 3); `formatDate` (existing `lib/format.ts`), `formatDuration` (Task 2); `buildPageMetadata` (existing `lib/seo.ts`); `YouTubeEmbedFacade` (Task 4).
- Produces: the `/podcast` route.

- [ ] **Step 1: Write the page**

Create `app/podcast/page.tsx`:

```tsx
import type { Metadata } from "next";
import Image from "next/image";
import { buildPageMetadata } from "@/lib/seo";
import { formatDate, formatDuration } from "@/lib/format";
import { getPodcastShow, PODCAST_LINKS } from "@/lib/podcast";
import YouTubeEmbedFacade from "@/components/YouTubeEmbedFacade";

// Sourced from an external RSS feed + YouTube playlist that change
// out-of-band (new episodes, edited playlist) — revalidate periodically so
// they show up without a redeploy. Matches app/films/page.tsx / app/faq.
export const revalidate = 300;

const TITLE = "What Comes Next — Podcast";
const DESCRIPTION =
  "What Comes Next is a series by filmmaker Zach K. Johnson featuring guests speaking in their own words about how life has shaped who they are today.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/podcast",
  });
}

const SUBSCRIBE_LINKS: Array<{ label: string; href: string }> = [
  { label: "Apple Podcasts", href: PODCAST_LINKS.apple },
  { label: "Spotify", href: PODCAST_LINKS.spotify },
  { label: "RSS", href: PODCAST_LINKS.rss },
  { label: "YouTube", href: PODCAST_LINKS.youtube },
];

export default async function PodcastPage() {
  const show = await getPodcastShow();

  const jsonLd = show
    ? {
        "@context": "https://schema.org",
        "@type": "PodcastSeries",
        name: show.title,
        description: show.description,
        image: show.imageUrl || undefined,
        url: "https://zkjfilms.com/podcast",
        webFeed: PODCAST_LINKS.rss,
        author: { "@type": "Person", name: "Zach K. Johnson" },
        associatedMedia: show.episodes.map((episode) => ({
          "@type": "PodcastEpisode",
          name: episode.title,
          datePublished: episode.pubDate,
          url: PODCAST_LINKS.rss,
          associatedMedia: {
            "@type": "MediaObject",
            contentUrl: episode.audioUrl,
          },
        })),
      }
    : null;

  return (
    <div className="flex flex-col">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}

      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        {show?.imageUrl ? (
          <Image
            src={show.imageUrl}
            alt={`${show.title} cover art`}
            fill
            priority
            quality={90}
            className="object-cover"
            sizes="100vw"
          />
        ) : (
          <div className="absolute inset-0 bg-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            Podcast
          </p>
          <h1 className="max-w-xl font-serif text-4xl italic leading-tight text-white sm:text-5xl md:text-6xl">
            {show?.title ?? "What Comes Next"}
          </h1>
        </div>
      </section>

      <p className="mx-auto max-w-2xl px-6 py-16 text-center text-muted sm:px-10">
        {show?.description ?? DESCRIPTION}
      </p>

      <div className="mx-auto mb-16 flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 sm:px-10">
        {SUBSCRIBE_LINKS.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] uppercase tracking-[0.15em] text-muted transition-colors hover:text-accent"
          >
            {label}
          </a>
        ))}
      </div>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24 sm:px-10">
        <h2 className="mb-10 text-center font-serif text-2xl italic text-foreground">
          Episodes
        </h2>

        {!show ? (
          <p className="text-center text-muted">
            Couldn&apos;t load episodes right now.
          </p>
        ) : show.episodes.length === 0 ? (
          <p className="text-center text-muted">
            New episodes are on the way — check back soon.
          </p>
        ) : (
          <div className="flex flex-col gap-16">
            {show.episodes.map((episode) => (
              <article key={episode.guid}>
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.2em] text-muted">
                  <span>{formatDate(episode.pubDate)}</span>
                  {episode.durationSeconds !== null && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{formatDuration(episode.durationSeconds)}</span>
                    </>
                  )}
                  {episode.explicit && (
                    <span className="border border-border px-2 py-0.5 text-[10px] tracking-[0.15em] text-muted">
                      Explicit
                    </span>
                  )}
                </div>

                <h3 className="mb-4 font-serif text-2xl italic text-foreground">
                  {episode.title}
                </h3>

                {episode.videoId ? (
                  <div className="mb-5">
                    <YouTubeEmbedFacade
                      videoId={episode.videoId}
                      thumbnailUrl={episode.videoThumbnailUrl ?? episode.imageUrl}
                      title={episode.title}
                    />
                  </div>
                ) : (
                  episode.imageUrl && (
                    <div className="relative mb-5 aspect-video w-full overflow-hidden bg-surface">
                      <Image
                        src={episode.imageUrl}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="(min-width: 640px) 640px, 100vw"
                      />
                    </div>
                  )
                )}

                <p className="mb-4 text-sm text-muted">{episode.description}</p>

                {episode.audioUrl && (
                  <audio controls preload="none" className="w-full">
                    <source src={episode.audioUrl} type="audio/mpeg" />
                  </audio>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Run the dev server and check the page renders**

Run: `npm run dev`, then in another terminal:
```bash
curl -s http://localhost:3000/podcast | grep -o 'Dennis' 
```
Expected: `Dennis` (confirms the episode title rendered server-side).

Then open `http://localhost:3000/podcast` in a browser and confirm:
- The cover-art hero loads (no broken image, no CSP error in the console).
- The subscribe row shows 4 text links that open the correct URLs in new tabs.
- The episode card shows date, duration (`35:36`), an "Explicit" badge, title, description, and a working native audio player (click play — it should start streaming).
- No video embed appears yet (expected — `YOUTUBE_API_KEY` isn't set until Task 8).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/podcast/page.tsx
git commit -m "Add /podcast page: hero, subscribe links, episode list, JSON-LD"
```

---

### Task 6: Nav link + hero route

**Files:**
- Modify: `components/Navbar.tsx:7-14` (`links`), `components/Navbar.tsx:26-33` (`HERO_ROUTES`)

**Interfaces:**
- No new exports — internal constants only.

- [ ] **Step 1: Add the nav link**

In `components/Navbar.tsx`, find:

```ts
const links = [
  { href: "/", label: "Home" },
  { href: "/photos", label: "Photos" },
  { href: "/films", label: "Films" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];
```

Replace with:

```ts
const links = [
  { href: "/", label: "Home" },
  { href: "/photos", label: "Photos" },
  { href: "/films", label: "Films" },
  { href: "/podcast", label: "Podcast" },
  { href: "/about", label: "About" },
  { href: "/book", label: "Book" },
  { href: "/contact", label: "Contact" },
];
```

- [ ] **Step 2: Add `/podcast` to `HERO_ROUTES`**

Find:

```ts
const HERO_ROUTES = new Set([
  "/",
  "/photos",
  "/headshots",
  "/creative-portraits",
  "/boudoir",
  "/music",
]);
```

Replace with:

```ts
const HERO_ROUTES = new Set([
  "/",
  "/photos",
  "/headshots",
  "/creative-portraits",
  "/boudoir",
  "/music",
  "/podcast",
]);
```

- [ ] **Step 3: Manual check**

With `npm run dev` running, open `http://localhost:3000/` and confirm "Podcast" appears in the nav between Films and About (desktop and mobile menu). Click it, confirm it navigates to `/podcast` and the navbar floats transparently over the hero image at the top, turning solid on scroll (same behavior as `/music`).

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add components/Navbar.tsx
git commit -m "Add Podcast to primary nav and hero routes"
```

---

### Task 7: Sitemap entry

**Files:**
- Modify: `app/sitemap.ts:11-22`

**Interfaces:**
- No new exports.

- [ ] **Step 1: Add the route**

In `app/sitemap.ts`, find:

```ts
  { path: "/music", changeFrequency: "monthly", priority: 0.8 },
  { path: "/films", changeFrequency: "monthly", priority: 0.8 },
];
```

Replace with:

```ts
  { path: "/music", changeFrequency: "monthly", priority: 0.8 },
  { path: "/films", changeFrequency: "monthly", priority: 0.8 },
  { path: "/podcast", changeFrequency: "weekly", priority: 0.8 },
];
```

- [ ] **Step 2: Verify**

Run: `npm run dev`, then:
```bash
curl -s http://localhost:3000/sitemap.xml | grep podcast
```
Expected: a `<url>` entry containing `https://zkjfilms.com/podcast`.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/sitemap.ts
git commit -m "Add /podcast to sitemap"
```

---

### Task 8: YouTube API key setup + full end-to-end verification

**Files:** none (env var + verification only)

**Interfaces:** none.

This task requires manual action outside the codebase (creating a Google Cloud API key) — it can't be scripted end-to-end, but it's what turns on the per-episode video embeds built in Tasks 3–5.

- [ ] **Step 1: Create the API key**

In the same Google Cloud project already used for `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET` (Google Calendar integration — check `.env.local` or Vercel's env vars for the project name/console link):
1. Go to Google Cloud Console → APIs & Services → Library, enable **YouTube Data API v3** if not already enabled.
2. Go to APIs & Services → Credentials → Create Credentials → API key.
3. (Recommended) Restrict the key to the YouTube Data API v3 only, under "API restrictions."

- [ ] **Step 2: Add the key locally**

Add to `.env.local`:
```
YOUTUBE_API_KEY=<the key from step 1>
```

- [ ] **Step 3: Add the key to Vercel**

Run: `vercel env add YOUTUBE_API_KEY` (select Production, Preview, and Development when prompted), and paste the same key. This project already uses the `vercel` CLI for env management (see other `GOOGLE_*`/`STRIPE_*` vars).

- [ ] **Step 4: Verify locally with the key set**

Restart the dev server (env vars are only read at process start): stop `npm run dev`, run it again, then open `http://localhost:3000/podcast` in a browser and confirm:
- The episode card now shows a video thumbnail with a play button (not the audio-only fallback thumbnail from Task 5's check).
- Clicking it loads and plays the actual YouTube video inline, no console CSP errors.
- The audio player still works independently below it.

- [ ] **Step 5: Full production build check**

Run: `npm run build`
Expected: succeeds. This exercises `getPodcastShow()` at build time (the page prerenders once as the initial ISR cache entry) — a failure here means either feed URL is unreachable from the build environment or a parsing bug slipped through Task 3's manual check.

- [ ] **Step 6: Commit the env var documentation, if this repo tracks a `.env.example`**

Run: `ls .env.example 2>/dev/null`

If it exists, add `YOUTUBE_API_KEY=` to it and commit:
```bash
git add .env.example
git commit -m "Document YOUTUBE_API_KEY in .env.example"
```
If no `.env.example` exists in this repo, skip this step — don't introduce one as a side effect of this feature.
