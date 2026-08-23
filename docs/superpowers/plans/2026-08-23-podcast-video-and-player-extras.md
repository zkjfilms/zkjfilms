# Podcast Video Restore + Player Extras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the per-episode YouTube video (always visible, not the compact-row thumbnail the current shipped design uses), and add playback-speed control and resume-playback-position to the shared audio player — on top of the already-shipped `/podcast` redesign.

**Architecture:** `EpisodeRow.tsx` is rewritten from a compact horizontal row into a taller card (eyebrow line, title, full-width video/cover-art, description, season label + Listen button). `PodcastPlayerContext.tsx` gains two independent additions — `playbackRate` state/action, and `localStorage`-backed resume-position read/write — both applied at the same points the context already manages playback (the episode-load effect, the `onLoadedMetadata`/`onPause` handlers). No new components; no data-layer changes (the video pairing in `lib/podcast.ts` already exists and is already correct, just unused until now).

**Tech Stack:** Same as the rest of this feature — Next.js App Router, React Context, TypeScript strict, Tailwind CSS v4, native browser APIs (`HTMLMediaElement.playbackRate`, `localStorage`) — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-23-podcast-video-and-player-extras-design.md`

## Global Constraints

- No new colors/fonts — same tokens as the rest of `/podcast`.
- No new dependencies.
- `localStorage` access must always be wrapped in try/catch — private browsing / disabled storage must degrade silently, never throw.
- Playback speed must survive an episode switch (next/prev, or picking a different row) — it must NOT reset to 1x each time.
- Resume position must not fire for an episode already within 5 seconds of its end (don't "resume" a finished episode).
- No test framework exists in this repo (no jest/vitest, no `*.test.*`/`*.spec.*` files). Verification throughout is `npm run lint`, `npm run build`, and manual dev-server/browser checks — not unit tests.
- `EpisodePlayButton.tsx`, `YouTubeEmbedFacade.tsx`, `lib/podcast.ts`, `lib/format.ts` are unchanged by this plan — reuse them as-is.
- This is a continuation of the same feature branch as the `/podcast` redesign (no new worktree, no new merge point) — commit directly on the current branch.

---

## File Structure

- **Modify** `components/podcast/EpisodeRow.tsx` — full rewrite: taller card layout with always-visible video/cover-art, no more square thumbnail row.
- **Modify** `components/podcast/icons.tsx` — remove `CalendarIcon`/`ClockIcon` (unused after the `EpisodeRow.tsx` rewrite).
- **Modify** `components/podcast/PodcastPlayerContext.tsx` — add `playbackRate` state/action; add resume-position read/write.
- **Modify** `components/podcast/PlayerBar.tsx` — add the playback-speed cycle button; remove the leftover dead `h-24` spacer div.

---

### Task 1: Rewrite `EpisodeRow.tsx` to restore the video, remove now-unused icons

**Files:**
- Modify: `components/podcast/EpisodeRow.tsx`
- Modify: `components/podcast/icons.tsx`

**Interfaces:**
- Consumes: `YouTubeEmbedFacade` (existing, unchanged, props `{videoId, thumbnailUrl, title}`), `EpisodePlayButton` (existing, unchanged, props `{episode}`), `formatBusinessDate`/`formatDuration` (existing, unchanged).
- No interface changes for anything consuming `EpisodeRow` — its own prop shape (`{episode: PodcastEpisode}`) is unchanged, so `PodcastExperience.tsx` needs no edits.

- [ ] **Step 1: Replace `EpisodeRow.tsx` entirely**

Replace the full contents of `components/podcast/EpisodeRow.tsx` with:

```tsx
import Image from "next/image";
import type { PodcastEpisode } from "@/lib/podcast";
import { formatBusinessDate, formatDuration } from "@/lib/format";
import EpisodePlayButton from "./EpisodePlayButton";
import YouTubeEmbedFacade from "@/components/YouTubeEmbedFacade";

export default function EpisodeRow({ episode }: { episode: PodcastEpisode }) {
  return (
    <article className="border-b border-border py-10 first:pt-0">
      <div className="mb-3 flex flex-wrap items-center gap-3 text-xs uppercase tracking-[0.2em] text-muted">
        <span>{formatBusinessDate(episode.pubDate)}</span>
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

      <h3 className="mb-5 font-serif text-2xl italic text-foreground sm:text-3xl">
        {episode.title}
      </h3>

      {episode.videoId ? (
        <YouTubeEmbedFacade
          videoId={episode.videoId}
          thumbnailUrl={episode.videoThumbnailUrl ?? episode.imageUrl}
          title={episode.title}
        />
      ) : (
        episode.imageUrl && (
          <div className="relative aspect-video w-full overflow-hidden bg-surface">
            <Image
              src={episode.imageUrl}
              alt=""
              fill
              className="object-cover"
              sizes="(min-width: 768px) 700px, 100vw"
            />
          </div>
        )
      )}

      <p className="mt-5 text-sm text-muted">{episode.description}</p>

      <div className="mt-5 flex items-center justify-between gap-4">
        {episode.season !== null && episode.episode !== null ? (
          <span className="text-xs uppercase tracking-[0.2em] text-muted">
            S{episode.season} · E{episode.episode}
          </span>
        ) : (
          <span />
        )}
        <EpisodePlayButton episode={episode} />
      </div>
    </article>
  );
}
```

- [ ] **Step 2: Remove the now-unused `CalendarIcon`/`ClockIcon` from `icons.tsx`**

In `components/podcast/icons.tsx`, find:

```ts
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
```

Delete both functions entirely (remove the block). Confirm via `grep -rn "CalendarIcon\|ClockIcon" --include="*.tsx" --include="*.ts" .` (excluding `node_modules`) that no reference remains anywhere in the repo before moving on — if anything else still imports them, stop and report rather than deleting a still-used export.

- [ ] **Step 3: Verify against real live data**

Run `npm run dev`, open `http://localhost:3000/podcast` in a browser (or via whatever browser automation tool is available). Confirm:
- The Dennis episode renders as a tall card: date/duration/Explicit badge line, title, a full-width video area, description, then a bottom row with "S1 · E1" and a play button.
- The video area shows the click-to-load facade (thumbnail + play triangle) since `YOUTUBE_API_KEY` is already configured in this environment and the real feed pairs this episode with a real video — clicking it should load and play the actual YouTube video inline.
- The bottom-right play button still starts the episode in the shared `PlayerBar` (unchanged behavior from `EpisodePlayButton`, just repositioned).
- No console errors, no broken image icons.

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed, no errors, no unused-export warnings for the removed icons.

- [ ] **Step 5: Commit**

```bash
git add components/podcast/EpisodeRow.tsx components/podcast/icons.tsx
git commit -m "Restore always-visible video embed in EpisodeRow, drop unused icons"
```

---

### Task 2: Add playback speed to `PodcastPlayerContext.tsx`

**Files:**
- Modify: `components/podcast/PodcastPlayerContext.tsx`

**Interfaces:**
- Produces: `usePodcastPlayer()`'s returned shape gains `playbackRate: number` and `setPlaybackRate: (rate: number) => void`.
- Consumed by: Task 3 (`PlayerBar.tsx`).

- [ ] **Step 1: Add the state, ref, and action**

In `components/podcast/PodcastPlayerContext.tsx`, find:

```ts
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
```

Replace with:

```ts
type PlayerState = {
  currentEpisode: PodcastEpisode | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  playbackRate: number;
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
  setPlaybackRate: (rate: number) => void;
};
```

Then find:

```ts
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
```

Replace with:

```ts
  const [volume, setVolumeState] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const playbackRateRef = useRef(1);
```

Then find the episode-loading effect:

```ts
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) return;
    audio.src = currentEpisode.audioUrl;
    audio.play().catch(() => {
```

Replace with:

```ts
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentEpisode) return;
    audio.src = currentEpisode.audioUrl;
    audio.playbackRate = playbackRateRef.current;
    audio.play().catch(() => {
```

(Leave the rest of that effect — the comment, the `.catch()` body, the closing — unchanged.)

Then find the `toggleMute` function (to add `setPlaybackRate` right after it, keeping related actions grouped):

```ts
  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);
```

Replace with:

```ts
  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }, []);

  const setPlaybackRate = useCallback((rate: number) => {
    const audio = audioRef.current;
    if (audio) audio.playbackRate = rate;
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
  }, []);
```

Finally, add `playbackRate`/`setPlaybackRate` to the returned value and its memo dependency array. Find:

```ts
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
```

Replace with:

```ts
  const value = useMemo<PodcastPlayerValue>(
    () => ({
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playbackRate,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
      setPlaybackRate,
    }),
    [
      currentEpisode,
      isPlaying,
      currentTime,
      duration,
      volume,
      muted,
      playbackRate,
      playEpisode,
      togglePlay,
      seek,
      skip,
      next,
      prev,
      setVolume,
      toggleMute,
      setPlaybackRate,
    ],
  );
```

- [ ] **Step 2: Verify with a manual browser check**

There's no page rendering `playbackRate`/`setPlaybackRate` yet (Task 3 does that) — verify this task in isolation via the browser devtools console:

Run `npm run dev`, open `http://localhost:3000/podcast`, play the Dennis episode, then in the browser devtools console run:
```js
document.querySelector('audio').playbackRate
```
Expected: `1` (the default). This confirms the `<audio>` element exists and the new code compiled without breaking playback (full interactive verification of the rate-cycling UI happens in Task 3).

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 4: Commit**

```bash
git add components/podcast/PodcastPlayerContext.tsx
git commit -m "Add playbackRate state and action to PodcastPlayerContext"
```

---

### Task 3: Playback-speed button in `PlayerBar.tsx`, remove dead spacer

**Files:**
- Modify: `components/podcast/PlayerBar.tsx`

**Interfaces:**
- Consumes: `playbackRate`/`setPlaybackRate` from `usePodcastPlayer()` (Task 2).

- [ ] **Step 1: Add the cycle button and remove the dead `h-24` spacer**

In `components/podcast/PlayerBar.tsx`, find the destructured hook call:

```ts
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
```

Replace with:

```ts
  const {
    currentEpisode,
    isPlaying,
    currentTime,
    duration,
    volume,
    muted,
    playbackRate,
    togglePlay,
    seek,
    skip,
    next,
    prev,
    setVolume,
    toggleMute,
    setPlaybackRate,
  } = usePodcastPlayer();
```

Add the cycle helper near the top of the file, after the imports:

```ts
const PLAYBACK_RATES = [1, 1.25, 1.5, 1.75, 2];

function cyclePlaybackRate(current: number): number {
  const idx = PLAYBACK_RATES.indexOf(current);
  return PLAYBACK_RATES[(idx + 1) % PLAYBACK_RATES.length];
}
```

Then find the volume control group:

```tsx
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
```

Replace with:

```tsx
            <button
              type="button"
              onClick={() => setPlaybackRate(cyclePlaybackRate(playbackRate))}
              aria-label={`Playback speed: ${playbackRate}x. Click to change.`}
              className="hidden w-10 flex-shrink-0 text-xs font-medium text-foreground hover:text-accent sm:block"
            >
              {playbackRate}x
            </button>

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
```

Finally, remove the leftover dead spacer. Find:

```tsx
      <div className="h-24" aria-hidden="true" />
```

Delete that line (it's the last line before the closing `</>` at the end of the component's return — leave the rest of the file structure, including the outer `<>...</>` fragment, unchanged, just remove this one `<div>`).

- [ ] **Step 2: Verify with a manual browser check**

Run `npm run dev`, open `http://localhost:3000/podcast`, play the Dennis episode. Confirm:
- The speed button shows "1x" initially, next to the volume control (visible at `sm:` breakpoint and wider — same visibility rule as the volume group).
- Clicking it cycles: 1x → 1.25x → 1.5x → 1.75x → 2x → back to 1x.
- After changing the rate, confirm actual playback speed changed (audio audibly plays faster/slower — or check `document.querySelector('audio').playbackRate` in devtools matches the button's displayed value).
- Click "Next episode" or switch to a different episode's row — confirm the rate is NOT reset to 1x (stays at whatever was last selected). If there's only one episode in the live feed right now, verify this by re-triggering `playEpisode` on the SAME episode from its row's button after changing speed in the bar, and confirming the rate persists (since `playEpisode`'s same-guid branch doesn't touch playbackRate at all, and the episode-load effect only runs on an actual guid change — so this specific check mainly confirms the rate isn't reset by unrelated re-renders).
- Scroll to the bottom of the page with an episode playing — confirm the footer is still not covered (regression check for the now-removed spacer div — the `document.body` padding from the earlier fix is the only thing preventing overlap now).

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 4: Commit**

```bash
git add components/podcast/PlayerBar.tsx
git commit -m "Add playback speed control to PlayerBar, remove dead spacer div"
```

---

### Task 4: Resume playback position

**Files:**
- Modify: `components/podcast/PodcastPlayerContext.tsx`

**Interfaces:**
- No change to `usePodcastPlayer()`'s returned shape — this is entirely internal behavior.

- [ ] **Step 1: Add the localStorage helpers**

In `components/podcast/PodcastPlayerContext.tsx`, add near the top of the file, after the imports and before the type definitions:

```ts
const RESUME_KEY_PREFIX = "podcast-resume:";
const RESUME_SKIP_LAST_SECONDS = 5;

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

- [ ] **Step 2: Restore on load, in `onLoadedMetadata`**

Find:

```tsx
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
```

Replace with:

```tsx
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

- [ ] **Step 3: Save on pause**

Find:

```tsx
        onPause={() => setIsPlaying(false)}
```

Replace with:

```tsx
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

- [ ] **Step 4: Save periodically while playing**

Add a new effect, placed after the existing episode-loading `useEffect` (the one with the `react-hooks/exhaustive-deps` disable comment):

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

- [ ] **Step 5: Verify with a manual browser check**

Run `npm run dev`, open `http://localhost:3000/podcast`, play the Dennis episode, let it play for ~15 seconds (past the first periodic save), then pause. In devtools, run:
```js
localStorage.getItem('podcast-resume:' + /* the episode's real guid — read it from the RSS feed or from the React DevTools currentEpisode state */)
```
Expected: a numeric string roughly matching the paused position.

Then reload the page and play the SAME episode again. Confirm playback starts from roughly where it was left off (not from 0:00) — check `document.querySelector('audio').currentTime` shortly after `loadedmetadata` fires, or just observe the seek bar's initial position.

Then let an episode play to within the last 5 seconds (or manually seek there via the seek bar, then let it finish or pause there) and confirm the stored key is cleared (`localStorage.getItem(...)` returns `null` afterward) rather than "resuming" a finished episode next time.

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both succeed, no errors.

- [ ] **Step 7: Commit**

```bash
git add components/podcast/PodcastPlayerContext.tsx
git commit -m "Add resume-playback-position via localStorage"
```

---

### Task 5: Full interaction verification

**Files:** none (verification only)

**Interfaces:** none.

This has no code changes — it's the end-to-end QA pass for all three
features working together, plus a regression check against the parts of
`/podcast` this plan didn't intend to touch.

- [ ] **Step 1: Full manual browser check**

Run `npm run dev`, open `http://localhost:3000/podcast`, and verify:

1. The Dennis episode renders as a tall card with a full-width video area (not the old compact square-thumbnail row).
2. Clicking the video area loads and plays the real YouTube video inline.
3. The bottom-right "Listen" play button starts the episode in the shared `PlayerBar`, independent of whether the video has been opened.
4. Playback speed cycles correctly and audibly changes speed; persists across a same-episode toggle.
5. Resume position: play ~15s, reload the page, replay the same episode, confirm it resumes near the prior position (not from 0:00).
6. An episode played to its final few seconds does NOT try to resume from near-the-end next time (starts from 0:00 instead).
7. Scroll to the bottom of the page with an episode playing — footer is not covered by the bar (regression check now that the dead spacer div is gone).
8. Tab switching (Episodes ↔ About), the "Listen On" dropdown, "Support the Show", and "Share" all still work as before (regression check — this plan didn't touch `PodcastExperience.tsx` or `ListenOnMenu.tsx`, but confirm nothing broke).
9. Season grouping still renders correctly.
10. No console errors anywhere in the above.

- [ ] **Step 2: Full production build**

Run: `npm run build`
Expected: succeeds, `/podcast` prerenders with 5-minute ISR, unchanged from before this plan.

- [ ] **Step 3: Report**

Summarize pass/fail for each of the 10 checks above. Any failure should
be fixed (resume the relevant earlier task's work) before this plan is
considered complete.
