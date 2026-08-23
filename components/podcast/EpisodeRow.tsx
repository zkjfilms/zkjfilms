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
