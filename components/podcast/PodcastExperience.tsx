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
