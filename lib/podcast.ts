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
