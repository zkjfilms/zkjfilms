# Podcast page redesign: full episode index + shared audio player

## Purpose

Redesign `/podcast` (shipped 2026-08-22/23, see
`docs/superpowers/specs/2026-08-22-podcast-page-design.md`) from a simple
stacked list of episode cards into a podcast-app-style page: a show header,
Episodes/About tabs, a season-grouped episode index, and a single
persistent audio player shared across every episode — matching a reference
mockup the user provided, translated into this site's existing visual
language (no new colors/type introduced; the mockup's dark-purple/gradient
identity is replaced with the site's cream/terracotta/serif-italic system).

## Visual translation from the reference mockup

The mockup is *not* followed for color or type — those come from this
site's existing tokens (`globals.css`) and established page conventions
(`app/films/page.tsx`, `components/Footer.tsx`, `components/Navbar.tsx`,
the "Book This Session" button in `components/ServiceLandingPage.tsx`).
Only the mockup's **structure** (hero, tabs, row layout, sticky player) is
followed.

| Mockup element | This site's equivalent |
|---|---|
| Dark purple background | `bg-background` (cream) |
| Row/card background | `bg-surface` |
| White text | `text-foreground` |
| Grey secondary text | `text-muted` |
| Orange→pink gradient (underline, play button) | Solid `--accent` (`#a8613f`, terracotta) — this site has no gradients anywhere; introducing one here would be inconsistent with `/music`, `/films`, etc. |
| Bold sans headings | `font-serif italic` (Playfair Display) — matches every other page's `<h1>` |
| Body/label sans text | Jost (the site's existing body face) |
| Outlined pill buttons | The existing outlined-button style (`border border-foreground ... hover:bg-foreground hover:text-background`, already used for "Book This Session") |
| ~13 UI icons (RSS, heart-hand, globe, share, calendar, clock, rewind-15, skip-back, play, skip-forward, forward-30, volume, expand) | Hand-drawn inline SVGs, thin-stroke style matching `Navbar.tsx`'s `MenuIcon`/`CaretIcon` — no icon library is installed in this repo |

## Scope decisions (confirmed with user)

- **Video embeds are dropped from episode rows.** Each row is album art +
  info + a play button (audio only), matching the mockup exactly. Video
  stays reachable via the "Listen on" dropdown's YouTube entry (see
  below) — `YouTubeEmbedFacade` and its per-episode video pairing in
  `lib/podcast.ts` (`videoId`/`videoThumbnailUrl`, the title-matching
  logic) are **no longer rendered anywhere on this page** but are left
  in place in `lib/podcast.ts` (not deleted — YAGNI cuts against
  speculative future use, but this is working, tested, recently-reviewed
  code with no cost to leaving unused for now; a future revisit can
  decide whether to remove it or re-surface it elsewhere).
- **Real Episodes/About tabs**, not a single scrolling page — client-side
  tab switching, underline indicator in the accent color.
- **Custom minimal audio player**, not native `<audio controls>` — see
  "Audio player" below.
- **Season grouping**, using `episode.season` (already parsed).
- **"Website" button is dropped** — redundant on the site's own page.
- **"Listen on" is a dropdown** (Apple Podcasts / Spotify / RSS feed —
  replacing today's flat text-link row) and **"Share"** uses the Web
  Share API (`navigator.share`) with a "copy link" fallback where
  unsupported.
- **"Support the Show"** links to the feed's `podcast:funding` URL
  (`https://www.patreon.com/c/ZachKJohnson`).
- Category tags ("Documentary", "Relationships") come from the feed's
  nested `itunes:category` elements.

## New data: `lib/podcast.ts`

Two new fields on `PodcastShow` (episodes' shape is unchanged):

```ts
export type PodcastShow = {
  title: string;
  description: string;
  imageUrl: string;
  categories: string[]; // e.g. ["Documentary", "Relationships"]
  fundingUrl: string | null;
  episodes: PodcastEpisode[];
};
```

Parsing, in `fetchRssShow()`:

- `categories`: the feed nests sub-categories inside a top-level
  `<itunes:category text="Society &amp; Culture">`:
  ```xml
  <itunes:category text="Society &amp; Culture">
    <itunes:category text="Documentary"/>
    <itunes:category text="Relationships"/>
  </itunes:category>
  ```
  Extract the **sub-category** `@_text` values (not the top-level one —
  the mockup shows "Documentary"/"Relationships", not "Society &
  Culture"). With fast-xml-parser's `ignoreAttributes: false`, this
  parses as `channel["itunes:category"]["itunes:category"]`, itself
  either a single object or an array depending on count — reuse the
  existing `toArray()` helper. Empty array if the feed ever has no
  sub-categories.
- `fundingUrl`: `channel["podcast:funding"]?.["@_url"] ?? null`.

## Component architecture

The interactive parts (tabs, shared player) need client-side state that
spans the whole page — the page itself stays a server component for ISR
and SEO, but wraps its interactive body in a client component tree.

- **`app/podcast/page.tsx`** (server, unchanged responsibilities) — fetches
  `getPodcastShow()`, renders the JSON-LD script tag, and renders
  `<PodcastExperience show={show} />`, passing the fetched data down.
  `generateMetadata`/`revalidate = 300` unchanged from the current
  implementation.
- **`components/podcast/PodcastExperience.tsx`** (`"use client"`) — the
  top-level client component. Owns:
  - `activeTab: "episodes" | "about"` state (tab switching)
  - Renders the hero header (art, title, byline, category tags, action
    button row: Listen on / Support the Show / Share), the tab nav, the
    Episodes panel (season-grouped `EpisodeRow` list) or About panel
    (show notes) depending on `activeTab`, and wraps everything in
    `<PodcastPlayerProvider episodes={show.episodes}>`, rendering
    `<PlayerBar />` last (sticky to the viewport bottom).
  - If `show` is `null` (RSS fetch failed): renders a minimal static
    fallback header + "Couldn't load episodes right now." — same
    fallback contract as today, just re-skinned.
- **`components/podcast/PodcastPlayerContext.tsx`** (`"use client"`) — a
  React Context + provider owning all playback state and the single
  underlying `<audio>` element (rendered once, hidden, `controls={false}`,
  no native UI). Exports:
  ```ts
  type PlayerState = {
    currentEpisode: PodcastEpisode | null;
    isPlaying: boolean;
    currentTime: number;
    duration: number;
  };
  type PlayerActions = {
    playEpisode: (episode: PodcastEpisode) => void; // starts a new episode, or toggles play/pause if it's already current
    togglePlay: () => void;
    seek: (time: number) => void;
    skip: (seconds: number) => void; // +15/-15, +30 forward, negative to rewind
    next: () => void;
    prev: () => void;
  };
  export function PodcastPlayerProvider(props: { episodes: PodcastEpisode[]; children: React.ReactNode }): JSX.Element;
  export function usePodcastPlayer(): PlayerState & PlayerActions;
  ```
  `next`/`prev` operate on the `episodes` array order (the same
  newest-first order the list renders in). Internally uses a `ref` to the
  `<audio>` element and standard media events (`timeupdate`,
  `loadedmetadata`, `ended` → auto-advance via `next()`) to keep state in
  sync — no polling.
- **`components/podcast/PlayerBar.tsx`** (`"use client"`) — the sticky
  bottom bar UI. Consumes `usePodcastPlayer()`. Renders `null` (nothing,
  no reserved space) when `currentEpisode` is `null` (before a visitor
  has pressed play on anything) — appears once playback starts and
  persists across tab switches and scrolling. Shows: episode art
  thumbnail, `S{season} E{episode} - {title}` + `{show.title} by Zach K.
  Johnson`, transport controls (rewind-15, prev-episode, play/pause,
  next-episode, forward-30), a seek bar (native `<input type="range">`
  styled to match, not a custom drag implementation — simpler, accessible
  by default, keyboard-operable), elapsed/duration time, and a
  volume control. No fullscreen control (there's no video to
  fullscreen on this page now that embeds are dropped from rows — cut
  from the mockup's reference for that reason).
- **`components/podcast/EpisodeRow.tsx`** — the season-grouped list row
  (art, title, Explicit badge, description, `S{season} · E{episode}` +
  date + duration). Not itself a client component — only its play button
  is:
- **`components/podcast/EpisodePlayButton.tsx`** (`"use client"`) — small
  button consuming `usePodcastPlayer()`, calling `playEpisode(episode)` on
  click, rendering a pause icon instead of play when this episode is the
  current one and playing.
- **`components/podcast/ListenOnMenu.tsx`** (`"use client"`) — small
  dropdown (click-to-open, close on outside click/Escape — same pattern
  already established in `Navbar.tsx`'s `photosDropdownOpen` handling)
  listing Apple Podcasts / Spotify / RSS feed as links.

## Download prevention

The player never renders a native `<audio controls>` element, so there is
no built-in browser download button and no native right-click "Save Audio
As" *on a visible control* — the underlying `<audio>` element gets
`onContextMenu={(e) => e.preventDefault()}` to block the context menu on
it directly, and `controls` is never set to `true` anywhere in this
codebase. This is a UX-level deterrent, not a security guarantee: audio
has to reach the browser as playable bytes, so a visitor inspecting
network requests in devtools can still find the direct MP3 URL. No part
of this design should claim or attempt to make the file literally
unfetchable — that's out of scope and not achievable client-side. This
caveat should be stated to the user in any communication about this
feature, not just documented here.

## Out of scope (YAGNI)

- No fullscreen control (no video on this page anymore).
- No playback-speed control, sleep timer, queue/playlist beyond
  next/prev-in-list, or download-for-offline (the mockup doesn't show
  these either).
- No removal of the now-unused `videoId`/`videoThumbnailUrl` pairing
  logic in `lib/podcast.ts` — left in place, unused by the UI.
- No persistence of playback position across page reloads (no
  localStorage "resume where you left off" — not shown in the mockup,
  not requested).
- No autoplay of the first episode on page load — the player only
  appears once a visitor presses play.
