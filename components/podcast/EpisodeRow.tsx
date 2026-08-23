import Image from "next/image";
import type { PodcastEpisode } from "@/lib/podcast";
import { formatBusinessDate, formatDuration } from "@/lib/format";
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
            {formatBusinessDate(episode.pubDate)}
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
