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
