// Client-safe podcast link constants — deliberately has ZERO imports.
// lib/podcast.ts (which imports googleapis/fast-xml-parser for its
// server-only RSS/YouTube fetching) cannot be imported by value from any
// client component: googleapis transitively pulls in Node-only built-ins
// (fs, child_process, http2, net, tls) via google-auth-library, which
// fails to bundle for the browser. This file exists so
// components/podcast/ListenOnMenu.tsx (a client component) — and any
// future client component needing these links — can import them without
// dragging in the server-only module graph.
const RSS_FEED_URL = "https://media.rss.com/what-comes-next/feed.xml";
const YOUTUBE_PLAYLIST_ID = "PL_TKznejt1qTg-spopGgooR2EB08AnQ2K";

export const PODCAST_LINKS = {
  apple: "https://podcasts.apple.com/us/podcast/what-comes-next/id1836518475",
  spotify: "https://open.spotify.com/show/2J7dRHRjd5uivNVMq8N68Z",
  rss: RSS_FEED_URL,
  youtube: `https://www.youtube.com/playlist?list=${YOUTUBE_PLAYLIST_ID}`,
};
