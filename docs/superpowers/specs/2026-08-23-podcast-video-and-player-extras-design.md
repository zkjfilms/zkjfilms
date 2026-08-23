# Podcast page: restore video embed + playback speed + resume position

## Purpose

Three additions to the just-completed `/podcast` redesign
(`docs/superpowers/specs/2026-08-23-podcast-player-redesign-design.md`),
requested by the user after seeing the shipped page:

1. Restore the per-episode YouTube video embed that the redesign
   deliberately dropped, using the pairing logic (`videoId`,
   `videoThumbnailUrl`, title-matching against the live YouTube playlist)
   that was left in place, unused, in `lib/podcast.ts` — it auto-updates
   the same way it always did, no new data-layer work needed.
2. Playback speed control on the shared audio player bar.
3. Resume-playback-position per episode, via `localStorage`.

Two other "out of scope" items from the original spec were reconsidered
and explicitly declined (see Decisions below): download-for-offline
(contradicts the site's download-prevention requirement) and autoplay-on-load
(poor practice, browsers block it anyway). Sleep timer and a queue/playlist
beyond next/prev were also declined as out of proportion to a single-show
web page.

## Decisions

- **Video placement:** an expand-in-place panel, not an always-visible
  inline embed and not a modal. Each episode row that has a paired
  `videoId` gets a small "Watch" toggle; clicking it reveals the existing
  `YouTubeEmbedFacade` (click-to-load, unchanged) directly below the row's
  description, collapsed by default. This keeps the row list's compact,
  scannable rhythm intact while making video available on demand.
  Fullscreen playback needs no custom work — `YouTubeEmbedFacade`'s
  iframe already has `allowFullScreen`, and YouTube's own embedded player
  chrome provides the fullscreen control.
- **Playback speed:** a cycle button on `PlayerBar` (not a dropdown/menu)
  stepping through `1x → 1.25x → 1.5x → 1.75x → 2x → 1x …`, displaying
  the current rate as its own label. Applies to the shared `<audio>`
  element via `HTMLMediaElement.playbackRate`, and the chosen rate
  carries over when switching to a different episode (next/prev or
  picking a different row) rather than resetting to 1x each time.
- **Resume position:** per-episode, keyed by the RSS item's `guid`, stored
  in `localStorage` under a namespaced key. Restored automatically when an
  episode starts (silently seeks to the saved position once metadata
  loads — no toast, no visible affordance, matching ordinary podcast-app
  behavior). Saved periodically while playing and on pause. Not restored
  if the saved position is within a few seconds of the episode's end
  (avoids "resuming" an episode that was already finished). All
  `localStorage` access wrapped in try/catch — private browsing or
  disabled storage must degrade to "no resume," never throw.
- **Declined:** download-for-offline (directly contradicts the
  already-shipped no-native-controls/no-download-button requirement),
  autoplay-on-load (most browsers block unmuted autoplay without a user
  gesture regardless, and it's poor practice), sleep timer and a
  playlist/queue beyond next/prev-in-list (both are more than a
  single-show web page's episode list needs today).

## 1. Restore the video embed

### `EpisodeVideoPanel.tsx` (new, client component)

A small, self-contained component that owns its own expand/collapse
state and renders nothing when the episode has no paired video:

```tsx
"use client";

import { useState } from "react";
import type { PodcastEpisode } from "@/lib/podcast";
import YouTubeEmbedFacade from "@/components/YouTubeEmbedFacade";
import { VideoIcon, CaretIcon } from "./icons";

export default function EpisodeVideoPanel({ episode }: { episode: PodcastEpisode }) {
  const [expanded, setExpanded] = useState(false);

  if (!episode.videoId) return null;

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-muted transition-colors hover:text-accent"
      >
        <VideoIcon />
        {expanded ? "Hide Video" : "Watch"}
        <CaretIcon open={expanded} />
      </button>
      {expanded && (
        <div className="mt-3">
          <YouTubeEmbedFacade
            videoId={episode.videoId}
            thumbnailUrl={episode.videoThumbnailUrl ?? episode.imageUrl}
            title={episode.title}
          />
        </div>
      )}
    </div>
  );
}
```

`icons.tsx` needs one new export, `VideoIcon` (a small play-in-frame
glyph — hand-drawn inline SVG, same convention as the rest of this set,
14-16px, `aria-hidden="true"`).

### `EpisodeRow.tsx`

Render `<EpisodeVideoPanel episode={episode} />` between the description
and the date/duration metadata row (it self-guards on `episode.videoId`,
so the call site doesn't need its own conditional).

## 2. Playback speed control

### `PodcastPlayerContext.tsx`

Add `playbackRate: number` to `PlayerState` and `setPlaybackRate:
(rate: number) => void` to `PlayerActions`. The rate must survive an
episode switch (next/prev, or picking a different row) — so it's applied
both when explicitly changed AND whenever a new episode's `src` is set:

```ts
const [playbackRate, setPlaybackRateState] = useState(1);
const playbackRateRef = useRef(1);

const setPlaybackRate = useCallback((rate: number) => {
  const audio = audioRef.current;
  if (audio) audio.playbackRate = rate;
  playbackRateRef.current = rate;
  setPlaybackRateState(rate);
}, []);
```

In the existing episode-loading `useEffect` (the one that sets `audio.src`
and calls `.play()`), also apply the current rate after setting `src`:

```ts
audio.src = currentEpisode.audioUrl;
audio.playbackRate = playbackRateRef.current;
audio.play().catch(() => { /* ...unchanged... */ });
```

Add `playbackRate`/`setPlaybackRate` to the returned context value and
its `useMemo` dependency array, matching every other field/action already
there.

### `PlayerBar.tsx`

A cycle button next to the existing transport controls:

```tsx
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];

function cyclePlaybackRate(current: number): number {
  const idx = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
}
```

```tsx
<button
  type="button"
  onClick={() => setPlaybackRate(cyclePlaybackRate(playbackRate))}
  aria-label={`Playback speed: ${playbackRate}x. Click to change.`}
  className="w-10 flex-shrink-0 text-xs font-medium text-foreground hover:text-accent"
>
  {playbackRate}x
</button>
```

Placed in the same control cluster as the volume button, visible at the
same breakpoint (the existing `hidden ... sm:flex` volume group, or its
own similarly-gated wrapper — match whichever keeps the bar's layout from
crowding on narrow screens).

While in `PlayerBar.tsx` for this change, also delete the leftover
`<div className="h-24" aria-hidden="true" />` spacer — it's dead code
from an earlier, abandoned fix for the footer-overlap bug (the real fix,
already shipped, uses `document.body` padding instead) and now only adds
redundant blank space above the footer.

## 3. Resume playback position

### `PodcastPlayerContext.tsx`

A namespaced `localStorage` key per episode, guarded throughout:

```ts
const RESUME_KEY_PREFIX = "podcast-resume:";
const RESUME_SKIP_LAST_SECONDS = 5; // don't resume an episode already basically finished

function readResumePosition(guid: string): number | null {
  try {
    const raw = localStorage.getItem(RESUME_KEY_PREFIX + guid);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writeResumePosition(guid: string, time: number): void {
  try {
    localStorage.setItem(RESUME_KEY_PREFIX + guid, String(time));
  } catch {
    // Private browsing / storage disabled — resume is a nice-to-have,
    // fail silently.
  }
}

function clearResumePosition(guid: string): void {
  try {
    localStorage.removeItem(RESUME_KEY_PREFIX + guid);
  } catch {
    // Same as above.
  }
}
```

Restore on load: in the episode-loading `useEffect`, after setting
`audio.src`, use the `loadedmetadata` moment (not immediately, since
`duration` isn't known yet) to decide whether to seek — the existing
`onLoadedMetadata` handler already fires `setDuration`; extend that same
handler (or add a one-time listener) to also check for and apply a saved
position:

```ts
onLoadedMetadata={(e) => {
  const audio = e.currentTarget;
  setDuration(audio.duration);
  if (currentEpisode) {
    const saved = readResumePosition(currentEpisode.guid);
    if (saved !== null && saved < audio.duration - RESUME_SKIP_LAST_SECONDS) {
      audio.currentTime = saved;
    }
  }
}}
```

Save periodically while playing and on pause — extend the existing
`onPause` handler, and add a `setInterval`-based save (every 10s) that
only runs while `isPlaying` is true, cleared on pause/unmount/episode
change:

```ts
useEffect(() => {
  if (!isPlaying || !currentEpisode) return;
  const id = setInterval(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.duration && audio.currentTime > audio.duration - RESUME_SKIP_LAST_SECONDS) {
      clearResumePosition(currentEpisode.guid);
    } else {
      writeResumePosition(currentEpisode.guid, audio.currentTime);
    }
  }, 10_000);
  return () => clearInterval(id);
}, [isPlaying, currentEpisode]);
```

And in the `onPause` handler, do the same immediate save-or-clear (so a
listener who pauses right before the interval would otherwise fire
doesn't lose their spot):

```ts
onPause={() => {
  setIsPlaying(false);
  const audio = audioRef.current;
  if (audio && currentEpisode) {
    if (audio.duration && audio.currentTime > audio.duration - RESUME_SKIP_LAST_SECONDS) {
      clearResumePosition(currentEpisode.guid);
    } else {
      writeResumePosition(currentEpisode.guid, audio.currentTime);
    }
  }
}}
```

No UI changes needed elsewhere — this is entirely inside
`PodcastPlayerContext.tsx`.

## Out of scope (reaffirmed)

- No download-for-offline — contradicts the shipped
  no-native-controls/no-download-button requirement.
- No autoplay on page load.
- No sleep timer.
- No queue/playlist beyond the existing next/prev-in-list.
- No UI indicator for "resuming from X:XX" — the seek happens silently.
- No cross-device sync of resume position (it's `localStorage`, per
  browser/device, same limitation as any client-only persistence).
