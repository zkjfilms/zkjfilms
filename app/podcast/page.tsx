import type { Metadata } from "next";
import Image from "next/image";
import { buildPageMetadata } from "@/lib/seo";
import { formatDate, formatDuration } from "@/lib/format";
import { getPodcastShow, PODCAST_LINKS } from "@/lib/podcast";
import YouTubeEmbedFacade from "@/components/YouTubeEmbedFacade";

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

const SUBSCRIBE_LINKS: Array<{ label: string; href: string }> = [
  { label: "Apple Podcasts", href: PODCAST_LINKS.apple },
  { label: "Spotify", href: PODCAST_LINKS.spotify },
  { label: "RSS", href: PODCAST_LINKS.rss },
  { label: "YouTube", href: PODCAST_LINKS.youtube },
];

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
    <div className="flex flex-col">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
      )}

      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        {show?.imageUrl ? (
          <Image
            src={show.imageUrl}
            alt={`${show.title} cover art`}
            fill
            priority
            quality={90}
            className="object-cover"
            sizes="100vw"
          />
        ) : (
          <div className="absolute inset-0 bg-surface" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            Podcast
          </p>
          <h1 className="max-w-xl font-serif text-4xl italic leading-tight text-white sm:text-5xl md:text-6xl">
            {show?.title ?? "What Comes Next"}
          </h1>
        </div>
      </section>

      <p className="mx-auto max-w-2xl px-6 py-16 text-center text-muted sm:px-10">
        {show?.description ?? DESCRIPTION}
      </p>

      <div className="mx-auto mb-16 flex w-full max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 sm:px-10">
        {SUBSCRIBE_LINKS.map(({ label, href }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] uppercase tracking-[0.15em] text-muted transition-colors hover:text-accent"
          >
            {label}
          </a>
        ))}
      </div>

      <section className="mx-auto w-full max-w-3xl px-6 pb-24 sm:px-10">
        <h2 className="mb-10 text-center font-serif text-2xl italic text-foreground">
          Episodes
        </h2>

        {!show ? (
          <p className="text-center text-muted">
            Couldn&apos;t load episodes right now.
          </p>
        ) : show.episodes.length === 0 ? (
          <p className="text-center text-muted">
            New episodes are on the way — check back soon.
          </p>
        ) : (
          <div className="flex flex-col gap-16">
            {show.episodes.map((episode) => (
              <article key={episode.guid}>
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs uppercase tracking-[0.2em] text-muted">
                  <span>{formatDate(episode.pubDate)}</span>
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

                <h3 className="mb-4 font-serif text-2xl italic text-foreground">
                  {episode.title}
                </h3>

                {episode.videoId ? (
                  <div className="mb-5">
                    <YouTubeEmbedFacade
                      videoId={episode.videoId}
                      thumbnailUrl={episode.videoThumbnailUrl ?? episode.imageUrl}
                      title={episode.title}
                    />
                  </div>
                ) : (
                  episode.imageUrl && (
                    <div className="relative mb-5 aspect-video w-full overflow-hidden bg-surface">
                      <Image
                        src={episode.imageUrl}
                        alt=""
                        fill
                        className="object-cover"
                        sizes="(min-width: 640px) 640px, 100vw"
                      />
                    </div>
                  )
                )}

                <p className="mb-4 text-sm text-muted">{episode.description}</p>

                {episode.audioUrl && (
                  <audio
                    controls
                    preload="none"
                    className="w-full"
                    aria-label={`Listen to ${episode.title}`}
                  >
                    <source src={episode.audioUrl} type="audio/mpeg" />
                  </audio>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
