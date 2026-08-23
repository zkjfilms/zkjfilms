# Podcast Player Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/podcast` from a stacked list of episode cards into a podcast-app-style page — show header with category tags and action buttons, Episodes/About tabs, a season-grouped episode index, and a single persistent audio player shared across every episode — using this site's existing visual language (no new colors/type/icon library).

**Architecture:** `app/podcast/page.tsx` stays a server component (ISR, JSON-LD, metadata) but now renders one client component tree, `PodcastExperience`, which owns tab state and wraps a React Context (`PodcastPlayerProvider`) that holds the single `<audio>` element and all playback state/actions. Episode rows and the sticky bottom bar both consume that context, so pressing play anywhere starts (or toggles) playback in the one shared player.

**Tech Stack:** Next.js App Router (server + client components), React Context, TypeScript (strict), Tailwind CSS v4 (existing design tokens), native `<input type="range">` for seek/volume (no new dependency).

**Spec:** `docs/superpowers/specs/2026-08-23-podcast-player-redesign-design.md`

## Global Constraints

- No new colors or typefaces — only `bg-background`, `bg-surface`, `text-foreground`, `text-muted`, `text-accent`/`bg-accent`, `border-border`/`border-foreground` (from `globals.css`), `font-serif italic` for headings, the site's body sans face by default.
- No gradients anywhere (the mockup's orange→pink gradient becomes solid `--accent` everywhere).
- No icon library is installed — every icon is a hand-drawn inline SVG, in one shared file `components/podcast/icons.tsx`.
- New component directory: `components/podcast/`.
- The player's underlying `<audio>` element must never have `controls` set to `true`, and must have `onContextMenu` prevented — this is the one required piece of the "disallow downloads" requirement. State this caveat exactly once, in the final task's verification notes: this blocks the casual/native download path, not a determined user reading the network tab.
- `lib/podcast.ts`'s existing `videoId`/`videoThumbnailUrl` fields and the title-matching pairing logic (`titleKey`, `fetchPlaylistVideos`) stay in place, unused by the new UI — do not delete them.
- `components/YouTubeEmbedFacade.tsx` is no longer imported by `/podcast` after this plan — leave the file in place (do not delete).
- `YOUTUBE_API_KEY` is already configured (Vercel + `.env.local`) — no new env var needed for this plan.
- No test framework exists in this repo (no jest/vitest, no `*.test.*`/`*.spec.*` files). Verification throughout is `npm run lint`, `npm run build`, and manual dev-server/browser checks — not unit tests.
- `formatDate`/`formatDuration` (`lib/format.ts`) and `PODCAST_LINKS` (`lib/podcast.ts`) already exist — reuse them, don't recreate.

---

## File Structure

- **Modify** `lib/podcast.ts` — add `categories: string[]` and `fundingUrl: string | null` to `PodcastShow`, parsed from the feed's `itunes:category`/`podcast:funding` elements.
- **Create** `components/podcast/icons.tsx` — every hand-drawn SVG icon this redesign needs, in one file.
- **Create** `components/podcast/PodcastPlayerContext.tsx` — the shared playback state/Context/provider and the single `<audio>` element.
- **Create** `components/podcast/PlayerBar.tsx` — the sticky bottom "now playing" bar.
- **Create** `components/podcast/EpisodePlayButton.tsx` — per-row play/pause button, consumes the context.
- **Create** `components/podcast/EpisodeRow.tsx` — one episode's list row (art, title, badge, description, meta, play button).
- **Create** `components/podcast/ListenOnMenu.tsx` — the "Listen On" platform-picker dropdown.
- **Create** `components/podcast/PodcastExperience.tsx` — top-level client composition: header, tabs, season-grouped list / About panel, wraps everything in the player provider + bar.
- **Modify** `app/podcast/page.tsx` — simplify to fetch + JSON-LD + render `<PodcastExperience>`.
- **Modify** `components/Navbar.tsx` — remove `/podcast` from `HERO_ROUTES` (the page no longer opens with a full-bleed hero image).

---

### Task 1: `lib/podcast.ts` — parse categories and funding URL

**Files:**
- Modify: `lib/podcast.ts`

**Interfaces:**
- Produces: `PodcastShow` gains `categories: string[]` and `fundingUrl: string | null`. `PodcastEpisode` is unchanged. `getPodcastShow()`'s signature is unchanged.
- Consumed by: Task 7 (`PodcastExperience.tsx`).

- [ ] **Step 1: Add the two fields to the type and parse them**

In `lib/podcast.ts`, find:

```ts
export type PodcastShow = {
  title: string;
  description: string;
  imageUrl: string;
  episodes: PodcastEpisode[];
};
```

Replace with:

```ts
export type PodcastShow = {
  title: string;
  description: string;
  imageUrl: string;
  categories: string[];
  fundingUrl: string | null;
  episodes: PodcastEpisode[];
};
```

Then find, inside `fetchRssShow()`:

```ts
  const channelImage = channel["itunes:image"] as { "@_href"?: string } | undefined;
  const channelImageUrl = channelImage?.["@_href"] ?? "";
```

Replace with:

```ts
  const channelImage = channel["itunes:image"] as { "@_href"?: string } | undefined;
  const channelImageUrl = channelImage?.["@_href"] ?? "";

  // The feed nests sub-categories inside a top-level category, e.g.
  // <itunes:category text="Society &amp; Culture">
  //   <itunes:category text="Documentary"/>
  //   <itunes:category text="Relationships"/>
  // </itunes:category>
  // Only the sub-categories are shown on the page (not the top-level one).
  const rawCategory = channel["itunes:category"] as
    | { "itunes:category"?: unknown }
    | undefined;
  const categories = toArray(
    rawCategory?.["itunes:category"] as
      | { "@_text"?: string }
      | { "@_text"?: string }[]
      | undefined,
  )
    .map((c) => c["@_text"])
    .filter((t): t is string => Boolean(t));

  const funding = channel["podcast:funding"] as { "@_url"?: string } | undefined;
  const fundingUrl = funding?.["@_url"] ?? null;
```

Then find the function's return statement:

```ts
  return {
    title: textOf(channel.title),
    description: stripHtml(textOf(channel.description)),
    imageUrl: channelImageUrl,
    episodes,
  };
```

Replace with:

```ts
  return {
    title: textOf(channel.title),
    description: stripHtml(textOf(channel.description)),
    imageUrl: channelImageUrl,
    categories,
    fundingUrl,
    episodes,
  };
```

(No change is needed in `getPodcastShow()` itself — it already spreads
`...show` from `fetchRssShow()`'s result, which now includes the two new
fields automatically.)

- [ ] **Step 2: Verify against the real live feed**

Create a temporary debug route to exercise this against the live feed
(same approach as the original build — there's no test runner in this
repo):

Create `app/api/debug-podcast/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getPodcastShow } from "@/lib/podcast";

export async function GET() {
  const show = await getPodcastShow();
  return NextResponse.json(show);
}
```

Run: `npm run dev`, then:
```bash
curl -s http://localhost:3000/api/debug-podcast | python3 -m json.tool
```

Expected: `categories` is `["Documentary", "Relationships"]` and
`fundingUrl` is `"https://www.patreon.com/c/ZachKJohnson"`.

- [ ] **Step 3: Remove the temporary debug route**

```bash
rm app/api/debug-podcast/route.ts
rmdir app/api/debug-podcast 2>/dev/null || true
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors, no `any` usage.

- [ ] **Step 5: Commit**

```bash
git add lib/podcast.ts
git commit -m "Parse podcast categories and funding URL from RSS feed"
```

---

### Task 2: `components/podcast/icons.tsx`

**Files:**
- Create: `components/podcast/icons.tsx`

**Interfaces:**
- Produces: named exports `RssIcon`, `HeartIcon`, `ShareIcon`, `CalendarIcon`,
  `ClockIcon`, `PlayIcon`, `PauseIcon`, `SkipBackIcon`, `SkipForwardIcon`,
  `SkipArc` (props `{ direction: "back" | "forward"; seconds: number }`),
  `VolumeIcon`, `VolumeMuteIcon`, `CaretIcon` (props `{ open: boolean }`) —
  all functions returning JSX, no props except where noted, each an
  `<svg>` sized to fit inline with text (`width`/`height` around 16-20).
- Consumed by: Tasks 4, 5, 6, 7.

- [ ] **Step 1: Write the icon set**

Create `components/podcast/icons.tsx`:

```tsx
// Hand-drawn inline SVG icons for the podcast player UI — this repo has
// no icon library installed (confirmed: not in package.json), matching
// the existing pattern of local icon components in components/Navbar.tsx.

export function RssIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="5" cy="15" r="1.5" fill="currentColor" stroke="none" />
      <path d="M3 9.5a7.5 7.5 0 0 1 7.5 7.5" strokeLinecap="round" />
      <path d="M3 4.5a12.5 12.5 0 0 1 12.5 12.5" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path
        d="M10 17s-6-3.7-6-8.2C4 6 5.8 4.5 8 4.5c1 0 2 .5 2 1.8 0-1.3 1-1.8 2-1.8 2.2 0 4 1.5 4 4.3 0 4.5-6 8.2-6 8.2z"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShareIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10 13V4M6.5 7.5 10 4l3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 12v3.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CalendarIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="3" y="4.5" width="14" height="12" rx="1.5" />
      <path d="M3 8h14M7 2.5v3M13 2.5v3" strokeLinecap="round" />
    </svg>
  );
}

export function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="10" cy="10" r="7" />
      <path d="M10 6v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M6 4.5v11l9-5.5z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="6" y="4.5" width="3" height="11" rx="0.5" fill="currentColor" />
      <rect x="11" y="4.5" width="3" height="11" rx="0.5" fill="currentColor" />
    </svg>
  );
}

export function SkipBackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M5 5v10" strokeLinecap="round" />
      <path d="M15 5 6 10l9 5z" fill="currentColor" stroke="none" strokeLinejoin="round" />
    </svg>
  );
}

export function SkipForwardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M15 5v10" strokeLinecap="round" />
      <path d="M5 5l9 5-9 5z" fill="currentColor" stroke="none" strokeLinejoin="round" />
    </svg>
  );
}

// Rewind-15 / forward-30: a partial circular arrow with the seconds count
// in the middle. `direction="back"` mirrors the arrow horizontally.
export function SkipArc({ direction, seconds }: { direction: "back" | "forward"; seconds: number }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <g transform={direction === "back" ? "scale(-1,1) translate(-20,0)" : undefined}>
        <path d="M4 8a6.5 6.5 0 1 1 .8 5" strokeLinecap="round" />
        <path d="M2.5 5.5 4 8.5l3-1" strokeLinecap="round" strokeLinejoin="round" />
      </g>
      <text x="10" y="12.5" textAnchor="middle" fontSize="6.5" fill="currentColor" stroke="none">
        {seconds}
      </text>
    </svg>
  );
}

export function VolumeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 8v4h3l4 3V5L7 8z" fill="currentColor" stroke="none" strokeLinejoin="round" />
      <path d="M13.5 7a4 4 0 0 1 0 6" strokeLinecap="round" />
    </svg>
  );
}

export function VolumeMuteIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 8v4h3l4 3V5L7 8z" fill="currentColor" stroke="none" strokeLinejoin="round" />
      <path d="M13 8l3.5 4M16.5 8 13 12" strokeLinecap="round" />
    </svg>
  );
}

export function CaretIcon({ open }: { open: boolean }) {
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
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/podcast/icons.tsx
git commit -m "Add hand-drawn icon set for the podcast player redesign"
```

---

### Task 3: `components/podcast/PodcastPlayerContext.tsx`

**Files:**
- Create: `components/podcast/PodcastPlayerContext.tsx`

**Interfaces:**
- Consumes: `PodcastEpisode` type from `lib/podcast.ts` (existing).
- Produces:
  ```ts
  export function PodcastPlayerProvider(props: {
    episodes: PodcastEpisode[];
    children: React.ReactNode;
  }): JSX.Element;

  export function usePodcastPlayer(): {
    currentEpisode: PodcastEpisode | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
    playEpisode: (episode: PodcastEpisode) => void;
    togglePlay: () => void;
    seek: (time: number) => void;
    skip: (seconds: number) => void;
    next: () => void;
    prev: () => void;
    setVolume: (volume: number) => void;
    toggleMute: () => void;
  };
  ```
  Used by: Tasks 4 (`PlayerBar`), 5 (`EpisodePlayButton`), 7 (`PodcastExperience`, which renders the provider).

This is the highest-risk piece of this plan — it owns the single `<audio>`
element and all playback state. Get this right in isolation before
anything renders against it.

- [ ] **Step 1: Write the provider and hook**

Create `components/podcast/PodcastPlayerContext.tsx`:

```tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PodcastEpisode } from "@/lib/podcast";

type PlayerState = {
  currentEpisode: PodcastEpisode | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
};

type PlayerActions = {
  playEpisode: (episode: PodcastEpisode) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skip: (seconds: number) => void;
  next: () => void;
  prev: () => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
};

type PodcastPlayerValue = PlayerState & PlayerActions;

const PodcastPlayerContext = createContext<PodcastPlayerValue | null>(null);

export function PodcastPlayerProvider({
  episodes,
  children,
}: {
  episodes: PodcastEpisode[];
  children: React.ReactNode;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentEpisode, setCurrentEpisode] = useState<PodcastEpisode | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);

  const currentIndex = currentEpisode
    ? episodes.findIndex((e) => e.guid === currentEpisode.guid)
    : -1;

  const playEpisode = useCallback(
    (episode: PodcastEpisode) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (currentEpisode?.guid === episode.guid) {
        if (audio.paused) {
          audio.play();
        } else {
          audio.pause();
        }
        return;
      }
      setCurrentEpisode(episode);
      setCurrentTime(0);
      setDuration(0);
    },
    [currentEpisode],
  );

  // Loads and plays the new episode once React has committed
  // currentEpisode — audio.src must be set before play() means anything,
  // and doing both directly inside playEpisode would race the <audio>
  // ref on the very first play (before the element has ever mounted).
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) return;
    audio.src = currentEpisode.audioUrl;
    audio.play().catch(() => {
      // Autoplay can be blocked by the browser without a prior user
      // gesture — isPlaying stays correct via the audio element's own
      // "play"/"pause" events, so no extra handling is needed here.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEpisode?.guid]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) return;
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }, [currentEpisode]);

  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = time;
    setCurrentTime(time);
  }, []);

  const skip = useCallback((seconds: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    const max = audio.duration || Infinity;
    audio.currentTime = Math.max(0, Math.min(max, audio.currentTime + seconds));
  }, []);

  const next = useCallback(() => {
    if (currentIndex === -1 || currentIndex >= episodes.length - 1) return;
    playEpisode(episodes[currentIndex + 1]);
  }, [currentIndex, episodes, playEpisode]);

  const prev = useCallback(() => {
    if (currentIndex <= 0) return;
    playEpisode(episodes[currentIndex - 1]);
  }, [currentIndex, episodes, playEpisode]);

  const setVolume = useCallback((v: number) => {
    const audio = audioRef.current;
    if (audio) audio.volume = v;
    setVolumeState(v);
    if (v > 0) setMuted(false);
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);

  const value = useMemo<PodcastPlayerValue>(
    () => ({
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
    }),
    [
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
    ],
  );

  return (
    <PodcastPlayerContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onEnded={next}
        onContextMenu={(e) => e.preventDefault()}
        preload="metadata"
        className="hidden"
      />
    </PodcastPlayerContext.Provider>
  );
}

export function usePodcastPlayer(): PodcastPlayerValue {
  const ctx = useContext(PodcastPlayerContext);
  if (!ctx) {
    throw new Error("usePodcastPlayer must be used within a PodcastPlayerProvider");
  }
  return ctx;
}
```

Note the `<audio>` element never receives a `controls` attribute (it's
simply absent — React/HTML default is no native controls) and has
`onContextMenu` prevented — this is the download-prevention requirement
from the spec, satisfied here and nowhere else needs to touch it.

- [ ] **Step 2: Verify with a manual browser check**

There's no test runner in this repo, and this component has no visible UI
of its own — write a temporary throwaway test page to exercise it:

Create `app/podcast-player-test/page.tsx` (temporary, deleted before
committing):

```tsx
"use client";

import { PodcastPlayerProvider, usePodcastPlayer } from "@/components/podcast/PodcastPlayerContext";
import type { PodcastEpisode } from "@/lib/podcast";

const testEpisodes: PodcastEpisode[] = [
  {
    guid: "1",
    title: "Test Episode 1",
    description: "",
    pubDate: new Date().toISOString(),
    durationSeconds: 30,
    imageUrl: "",
    audioUrl: "https://media.rss.com/what-comes-next/feed.xml", // any reachable URL is fine for this manual check — see note below
    link: "",
    season: 1,
    episode: 1,
    explicit: false,
    videoId: null,
    videoThumbnailUrl: null,
  },
];

function Inner() {
  const p = usePodcastPlayer();
  return (
    <div style={{ padding: 20 }}>
      <button onClick={() => p.playEpisode(testEpisodes[0])}>Play</button>
      <button onClick={p.togglePlay}>Toggle</button>
      <button onClick={() => p.skip(15)}>+15s</button>
      <p>isPlaying: {String(p.isPlaying)}</p>
      <p>currentTime: {p.currentTime}</p>
      <p>duration: {p.duration}</p>
    </div>
  );
}

export default function TestPage() {
  return (
    <PodcastPlayerProvider episodes={testEpisodes}>
      <Inner />
    </PodcastPlayerProvider>
  );
}
```

Use the REAL episode's actual MP3 URL instead of the placeholder above —
fetch it from the live feed first:
```bash
curl -s https://media.rss.com/what-comes-next/feed.xml | grep -o 'enclosure url="[^"]*"'
```
Put that URL in as `audioUrl` so playback is real, not a 404.

Run `npm run dev`, open `http://localhost:3000/podcast-player-test`,
click Play, and confirm: `isPlaying` becomes `true`, `currentTime`
increases, `duration` populates once metadata loads, `+15s` jumps the
time forward, clicking Toggle pauses/resumes. Right-click the page (there's
no visible `<audio>` control to right-click directly, but confirm no
console errors appear from the `onContextMenu` handler).

- [ ] **Step 3: Remove the temporary test page**

```bash
rm app/podcast-player-test/page.tsx
rmdir app/podcast-player-test 2>/dev/null || true
```

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors. The `react-hooks/exhaustive-deps` disable comment is
intentional (documented inline) — confirm eslint doesn't flag it as an
error (it's a lint rule that respects the disable comment).

- [ ] **Step 5: Commit**

```bash
git add components/podcast/PodcastPlayerContext.tsx
git commit -m "Add PodcastPlayerContext: shared audio playback state"
```

---

### Task 4: `components/podcast/PlayerBar.tsx`

**Files:**
- Create: `components/podcast/PlayerBar.tsx`

**Interfaces:**
- Consumes: `usePodcastPlayer()` (Task 3), icons from `components/podcast/icons.tsx` (Task 2: `PlayIcon`, `PauseIcon`, `SkipBackIcon`, `SkipForwardIcon`, `SkipArc`, `VolumeIcon`, `VolumeMuteIcon`), `formatDuration` from `lib/format.ts` (existing).
- Produces: `export default function PlayerBar(): JSX.Element | null` — renders `null` when no episode has been played yet.
- Used by: Task 7 (`PodcastExperience`).

- [ ] **Step 1: Write the component**

Create `components/podcast/PlayerBar.tsx`:

```tsx
"use client";

import Image from "next/image";
import { usePodcastPlayer } from "./PodcastPlayerContext";
import { formatDuration } from "@/lib/format";
import {
  PlayIcon,
  PauseIcon,
  SkipBackIcon,
  SkipForwardIcon,
  SkipArc,
  VolumeIcon,
  VolumeMuteIcon,
} from "./icons";

export default function PlayerBar() {
  const {
    currentEpisode,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    togglePlay,
    seek,
    skip,
    next,
    prev,
    setVolume,
    toggleMute,
  } = usePodcastPlayer();

  if (!currentEpisode) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-4">
          <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden bg-background">
            {currentEpisode.imageUrl && (
              <Image
                src={currentEpisode.imageUrl}
                alt=""
                fill
                className="object-cover"
                sizes="48px"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">
              {currentEpisode.season !== null && currentEpisode.episode !== null
                ? `S${currentEpisode.season} E${String(currentEpisode.episode).padStart(2, "0")} — `
                : ""}
              {currentEpisode.title}
            </p>
            <p className="truncate text-xs text-muted">What Comes Next by Zach K. Johnson</p>
          </div>

          <div className="flex items-center gap-3 text-foreground">
            <button type="button" onClick={prev} aria-label="Previous episode" className="p-1 hover:text-accent">
              <SkipBackIcon />
            </button>
            <button type="button" onClick={() => skip(-15)} aria-label="Rewind 15 seconds" className="p-1 hover:text-accent">
              <SkipArc direction="back" seconds={15} />
            </button>
            <button
              type="button"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-background hover:opacity-90"
            >
              {isPlaying ? <PauseIcon /> : <PlayIcon />}
            </button>
            <button type="button" onClick={() => skip(30)} aria-label="Forward 30 seconds" className="p-1 hover:text-accent">
              <SkipArc direction="forward" seconds={30} />
            </button>
            <button type="button" onClick={next} aria-label="Next episode" className="p-1 hover:text-accent">
              <SkipForwardIcon />
            </button>
          </div>

          <div className="hidden items-center gap-2 sm:flex">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
              className="p-1 text-foreground hover:text-accent"
            >
              {muted || volume === 0 ? <VolumeMuteIcon /> : <VolumeIcon />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="w-16 accent-accent"
            />
          </div>
        </div>

        <div className="flex items-center gap-2 text-[11px] text-muted">
          <span className="w-9 text-right tabular-nums">{formatDuration(Math.floor(currentTime))}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={1}
            value={Math.min(currentTime, duration || 0)}
            onChange={(e) => seek(Number(e.target.value))}
            aria-label="Seek"
            className="flex-1 accent-accent"
          />
          <span className="w-9 tabular-nums">
            {duration ? formatDuration(Math.floor(duration)) : "--:--"}
          </span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/podcast/PlayerBar.tsx
git commit -m "Add PlayerBar: sticky bottom now-playing bar"
```

---

### Task 5: `components/podcast/EpisodePlayButton.tsx` + `EpisodeRow.tsx`

**Files:**
- Create: `components/podcast/EpisodePlayButton.tsx`
- Create: `components/podcast/EpisodeRow.tsx`

**Interfaces:**
- Consumes: `usePodcastPlayer()` (Task 3), `PlayIcon`/`PauseIcon`/`CalendarIcon`/`ClockIcon` (Task 2), `PodcastEpisode` type, `formatDate`/`formatDuration`.
- Produces: `export default function EpisodePlayButton(props: { episode: PodcastEpisode }): JSX.Element` and `export default function EpisodeRow(props: { episode: PodcastEpisode }): JSX.Element`.
- Used by: Task 7 (`PodcastExperience`).

- [ ] **Step 1: Write `EpisodePlayButton.tsx`**

Create `components/podcast/EpisodePlayButton.tsx`:

```tsx
"use client";

import { usePodcastPlayer } from "./PodcastPlayerContext";
import { PlayIcon, PauseIcon } from "./icons";
import type { PodcastEpisode } from "@/lib/podcast";

export default function EpisodePlayButton({ episode }: { episode: PodcastEpisode }) {
  const { currentEpisode, isPlaying, playEpisode } = usePodcastPlayer();
  const isCurrent = currentEpisode?.guid === episode.guid;
  const showPause = isCurrent && isPlaying;

  return (
    <button
      type="button"
      onClick={() => playEpisode(episode)}
      aria-label={showPause ? `Pause ${episode.title}` : `Play ${episode.title}`}
      className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-accent text-background transition-opacity hover:opacity-90"
    >
      {showPause ? <PauseIcon /> : <PlayIcon />}
    </button>
  );
}
```

- [ ] **Step 2: Write `EpisodeRow.tsx`**

Create `components/podcast/EpisodeRow.tsx`:

```tsx
import Image from "next/image";
import type { PodcastEpisode } from "@/lib/podcast";
import { formatDate, formatDuration } from "@/lib/format";
import EpisodePlayButton from "./EpisodePlayButton";
import { CalendarIcon, ClockIcon } from "./icons";

export default function EpisodeRow({ episode }: { episode: PodcastEpisode }) {
  return (
    <div className="flex items-start gap-4 border-b border-border py-6 sm:gap-6">
      <div className="relative h-20 w-20 flex-shrink-0 overflow-hidden bg-surface sm:h-24 sm:w-24">
        {episode.imageUrl && (
          <Image src={episode.imageUrl} alt="" fill className="object-cover" sizes="96px" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-serif text-lg italic text-foreground sm:text-xl">
            {episode.title}
          </h3>
          {episode.explicit && (
            <span className="flex-shrink-0 border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.15em] text-muted">
              Explicit
            </span>
          )}
        </div>

        <p className="mt-2 line-clamp-2 text-sm text-muted">{episode.description}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {episode.season !== null && episode.episode !== null && (
            <span>
              S{episode.season} · E{episode.episode}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <CalendarIcon />
            {formatDate(episode.pubDate)}
          </span>
          {episode.durationSeconds !== null && (
            <span className="flex items-center gap-1.5">
              <ClockIcon />
              {formatDuration(episode.durationSeconds)}
            </span>
          )}
        </div>
      </div>

      <div className="flex-shrink-0 self-center">
        <EpisodePlayButton episode={episode} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/podcast/EpisodePlayButton.tsx components/podcast/EpisodeRow.tsx
git commit -m "Add EpisodeRow and EpisodePlayButton"
```

---

### Task 6: `components/podcast/ListenOnMenu.tsx`

**Files:**
- Create: `components/podcast/ListenOnMenu.tsx`

**Interfaces:**
- Consumes: `PODCAST_LINKS` from `lib/podcast.ts` (existing), `CaretIcon` (Task 2).
- Produces: `export default function ListenOnMenu(): JSX.Element`.
- Used by: Task 7 (`PodcastExperience`).

- [ ] **Step 1: Write the component**

Create `components/podcast/ListenOnMenu.tsx`. This mirrors the
open/close, outside-click, and Escape-key handling already established in
`components/Navbar.tsx`'s `photosDropdownOpen` state:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { PODCAST_LINKS } from "@/lib/podcast";
import { CaretIcon } from "./icons";

const PLATFORMS: Array<{ label: string; href: string }> = [
  { label: "Apple Podcasts", href: PODCAST_LINKS.apple },
  { label: "Spotify", href: PODCAST_LINKS.spotify },
  { label: "RSS Feed", href: PODCAST_LINKS.rss },
];

export default function ListenOnMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-2 border border-foreground px-5 py-2.5 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
      >
        Listen On
        <CaretIcon open={open} />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-10 mt-2 min-w-[180px] border border-border bg-background py-2 shadow-sm">
          {PLATFORMS.map((p) => (
            <a
              key={p.label}
              href={p.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className="block px-4 py-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
            >
              {p.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Manual check**

Run `npm run dev`. This component has no page rendering it yet (Task 7
wires it in) — visually verify it in isolation isn't practical yet; defer
full interaction verification to Task 7's manual check, but confirm here
that it compiles with no type errors: `npm run lint` catches type issues
via `eslint-config-next/typescript` in this repo.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add components/podcast/ListenOnMenu.tsx
git commit -m "Add ListenOnMenu platform-picker dropdown"
```

---

### Task 7: `components/podcast/PodcastExperience.tsx`

**Files:**
- Create: `components/podcast/PodcastExperience.tsx`

**Interfaces:**
- Consumes: `PodcastShow`/`PodcastEpisode` types (Task 1), `PodcastPlayerProvider` (Task 3), `PlayerBar` (Task 4), `EpisodeRow` (Task 5), `ListenOnMenu` (Task 6), `RssIcon`/`HeartIcon`/`ShareIcon` (Task 2).
- Produces: `export default function PodcastExperience(props: { show: PodcastShow | null }): JSX.Element`.
- Used by: Task 8 (`app/podcast/page.tsx`).

- [ ] **Step 1: Write the component**

Create `components/podcast/PodcastExperience.tsx`:

```tsx
"use client";

import { useState } from "react";
import Image from "next/image";
import type { PodcastEpisode, PodcastShow } from "@/lib/podcast";
import { PodcastPlayerProvider } from "./PodcastPlayerContext";
import PlayerBar from "./PlayerBar";
import EpisodeRow from "./EpisodeRow";
import ListenOnMenu from "./ListenOnMenu";
import { HeartIcon, ShareIcon } from "./icons";

const FALLBACK_DESCRIPTION =
  "What Comes Next is a series by filmmaker Zach K. Johnson featuring guests speaking in their own words about how life has shaped who they are today.";

// Groups episodes by season, newest season first (nulls last), preserving
// each season's existing newest-first episode order. Uses a Map (not a
// plain object) so iteration order is never disturbed by JS's automatic
// ascending-numeric-key reordering, which would otherwise silently put
// Season 1 before Season 2.
function groupBySeason(
  episodes: PodcastEpisode[],
): Array<{ season: number | null; episodes: PodcastEpisode[] }> {
  const map = new Map<number | null, PodcastEpisode[]>();
  for (const episode of episodes) {
    const group = map.get(episode.season);
    if (group) {
      group.push(episode);
    } else {
      map.set(episode.season, [episode]);
    }
  }
  return [...map.entries()]
    .map(([season, seasonEpisodes]) => ({ season, episodes: seasonEpisodes }))
    .sort((a, b) => {
      if (a.season === null) return 1;
      if (b.season === null) return -1;
      return b.season - a.season;
    });
}

export default function PodcastExperience({ show }: { show: PodcastShow | null }) {
  const [activeTab, setActiveTab] = useState<"episodes" | "about">("episodes");

  async function handleShare() {
    const shareData = { title: "What Comes Next", url: "https://zkjfilms.com/podcast" };
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share(shareData);
      } catch {
        // User cancelled the share sheet — no action needed.
      }
      return;
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(shareData.url);
    }
  }

  const seasonGroups = groupBySeason(show?.episodes ?? []);

  return (
    <PodcastPlayerProvider episodes={show?.episodes ?? []}>
      <div className="mx-auto w-full max-w-5xl px-6 pb-32 pt-16 sm:px-10">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-start">
          <div className="relative h-40 w-40 flex-shrink-0 overflow-hidden bg-surface sm:h-48 sm:w-48">
            {show?.imageUrl && (
              <Image
                src={show.imageUrl}
                alt={`${show.title} cover art`}
                fill
                priority
                className="object-cover"
                sizes="192px"
              />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-4xl italic text-foreground sm:text-5xl">
              {show?.title ?? "What Comes Next"}
            </h1>
            <p className="mt-2 text-muted">by Zach K. Johnson</p>

            {show && show.categories.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {show.categories.map((c) => (
                  <span
                    key={c}
                    className="border border-border bg-surface px-3 py-1 text-xs uppercase tracking-[0.1em] text-muted"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <ListenOnMenu />
              {show?.fundingUrl && (
                <a
                  href={show.fundingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 border border-foreground px-5 py-2.5 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
                >
                  <HeartIcon />
                  Support the Show
                </a>
              )}
              <button
                type="button"
                onClick={handleShare}
                className="flex items-center gap-2 border border-foreground px-5 py-2.5 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
              >
                <ShareIcon />
                Share
              </button>
            </div>
          </div>
        </div>

        <div className="mt-12 flex gap-8 border-b border-border">
          {(["episodes", "about"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`relative pb-3 text-sm uppercase tracking-[0.15em] transition-colors ${
                activeTab === tab ? "text-foreground" : "text-muted hover:text-foreground"
              }`}
            >
              {tab === "episodes" ? "Episodes" : "About"}
              {activeTab === tab && <span className="absolute inset-x-0 -bottom-px h-0.5 bg-accent" />}
            </button>
          ))}
        </div>

        {activeTab === "episodes" ? (
          <div className="mt-10">
            {!show ? (
              <p className="text-center text-muted">Couldn&apos;t load episodes right now.</p>
            ) : show.episodes.length === 0 ? (
              <p className="text-center text-muted">
                New episodes are on the way — check back soon.
              </p>
            ) : (
              seasonGroups.map(({ season, episodes }) => (
                <div key={season ?? "none"}>
                  <p className="mb-4 mt-8 text-xs uppercase tracking-[0.3em] text-muted first:mt-0">
                    {season === null ? "Episodes" : `Season ${season}`}
                  </p>
                  {episodes.map((episode) => (
                    <EpisodeRow key={episode.guid} episode={episode} />
                  ))}
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="mt-10 max-w-2xl">
            <p className="mb-4 text-xs uppercase tracking-[0.3em] text-muted">Show Notes</p>
            <p className="whitespace-pre-line text-muted">
              {show?.description ?? FALLBACK_DESCRIPTION}
            </p>
          </div>
        )}
      </div>

      <PlayerBar />
    </PodcastPlayerProvider>
  );
}
```

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add components/podcast/PodcastExperience.tsx
git commit -m "Add PodcastExperience: header, tabs, season-grouped episode list"
```

---

### Task 8: Wire up `app/podcast/page.tsx` and drop the hero route

**Files:**
- Modify: `app/podcast/page.tsx`
- Modify: `components/Navbar.tsx`

**Interfaces:**
- Consumes: `PodcastExperience` (Task 7), `getPodcastShow`/`PODCAST_LINKS` (existing, Task 1 additions flow through automatically).

- [ ] **Step 1: Replace `app/podcast/page.tsx`**

Replace the entire contents of `app/podcast/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { getPodcastShow, PODCAST_LINKS } from "@/lib/podcast";
import PodcastExperience from "@/components/podcast/PodcastExperience";

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
        hasPart: show.episodes.map((episode) => ({
          "@type": "PodcastEpisode",
          name: episode.title,
          datePublished: episode.pubDate,
          url: episode.link || PODCAST_LINKS.rss,
          associatedMedia: {
            "@type": "MediaObject",
            contentUrl: episode.audioUrl,
          },
        })),
      }
    : null;

  return (
    <>
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}
      <PodcastExperience show={show} />
    </>
  );
}
```

(The JSON-LD block is unchanged from the current implementation — only
the visible markup below it is replaced by `PodcastExperience`.)

- [ ] **Step 2: Remove `/podcast` from `Navbar.tsx`'s `HERO_ROUTES`**

The redesigned page no longer opens with a full-bleed hero image (the
header is now a compact inline layout, like `/faq` or `/contact`), so it
should get the solid navbar immediately rather than the floating
over-a-hero-image treatment.

In `components/Navbar.tsx`, find:

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

Replace with:

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

- [ ] **Step 3: Manual check**

Run `npm run dev`, open `http://localhost:3000/podcast`, and confirm:
- The navbar is solid (not transparent/floating) immediately on load.
- The header shows cover art, title, byline, category tags ("Documentary",
  "Relationships"), and the Listen On / Support the Show / Share buttons.
- The Episodes tab shows a "Season 1" header and the Dennis episode row.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add app/podcast/page.tsx components/Navbar.tsx
git commit -m "Wire PodcastExperience into /podcast, drop hero-route treatment"
```

---

### Task 9: Full interaction verification

**Files:** none (verification only)

**Interfaces:** none.

This task has no code changes — it's the end-to-end manual QA pass for
everything the previous 8 tasks built together, since no single task's
review can exercise the full cross-component interaction (playing an
episode from a row, then controlling it from the bar; switching tabs
while playing; etc.).

- [ ] **Step 1: Full manual browser check**

Run `npm run dev`, open `http://localhost:3000/podcast`, and verify each
of the following (note pass/fail for each in the report if executed by a
subagent):

1. Click the play button on the Dennis episode row. Confirm: the bottom
   `PlayerBar` appears (it was not visible before this), shows the
   correct episode art/title, and audio is audibly playing.
2. Click that same row's play button again. Confirm it now shows a pause
   icon and audio stops (toggling the same episode, not restarting it).
3. In the `PlayerBar`, click rewind-15 and forward-30. Confirm the seek
   position visibly jumps by roughly that amount.
4. Drag the `PlayerBar`'s seek slider. Confirm playback jumps to that
   position.
5. Adjust the volume slider and click the mute button. Confirm both
   affect actual audio output.
6. Switch to the "About" tab while audio is playing. Confirm playback
   continues uninterrupted and the `PlayerBar` stays visible.
7. Switch back to "Episodes". Confirm the season grouping and row list
   still render correctly.
8. Click "Listen On". Confirm the dropdown opens with Apple
   Podcasts/Spotify/RSS Feed links, each opening the correct URL in a new
   tab; confirm it closes on outside click and on Escape.
9. Click "Support the Show". Confirm it opens
   `https://www.patreon.com/c/ZachKJohnson` in a new tab.
10. Click "Share". Confirm either the native share sheet opens (if the
    test browser/OS supports `navigator.share`) or the URL is copied to
    the clipboard (paste somewhere to confirm).
11. Open browser devtools' Elements panel and confirm the `<audio>`
    element has no `controls` attribute present at all.
12. Right-click directly on the `PlayerBar`'s track-info area (over
    where the hidden `<audio>` element conceptually lives, i.e.
    anywhere in the player bar). Confirm no native "Save Audio As"
    context menu specific to the audio element appears. State plainly in
    the report: this blocks the casual/native download path only — a
    visitor reading the Network tab in devtools can still find the
    direct MP3 URL, and no client-side technique can prevent that for
    audio that must be delivered as playable bytes.

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: succeeds, `/podcast` prerenders with `5m` revalidate (same as
today).

- [ ] **Step 3: Report**

Summarize pass/fail for each of the 12 checks above. Any failure here
should be fixed (resume the relevant earlier task's work) before this
plan is considered complete — do not mark this task done with an open
failure.
