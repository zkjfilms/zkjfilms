import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import { getFilms } from "@/lib/films";
import { breadcrumbJsonLd, videoJsonLd } from "@/lib/jsonLd";
import JsonLd from "@/components/JsonLd";

// Video rows are managed out-of-band via the video:* CLI (scripts/video.mjs),
// so revalidate periodically — otherwise a newly uploaded film wouldn't
// appear until the next deploy. Matches app/page.tsx / app/faq / app/book.
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { films, error } = await getFilms();
  return {
    ...pageMetadata("films"),
    ...(error || films.length ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function FilmsPage() {
  const { films: videos, error } = await getFilms();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-10">
      <JsonLd
        data={[
          breadcrumbJsonLd("films"),
          ...videos.map((f) =>
            videoJsonLd({
              title: f.title,
              description: f.description,
              posterUrl: publicImageUrl(f.poster_key),
              contentUrl: publicImageUrl(f.video_key),
              uploadDate: f.created_at,
            }),
          ),
        ]}
      />
      <header className="mb-16 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Motion
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Films
        </h1>
      </header>

      {videos.length === 0 ? (
        <p className="text-center text-muted">
          {error
            ? "Couldn't load videos right now."
            : "New film work is on the way — check back soon."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
          {videos.map((video) => (
            <div key={video.slug}>
              <div className="relative aspect-video w-full overflow-hidden bg-surface">
                <video
                  controls
                  preload="none"
                  poster={publicImageUrl(video.poster_key)}
                  className="h-full w-full object-cover"
                >
                  <source src={publicImageUrl(video.video_key)} type="video/mp4" />
                </video>
              </div>
              <h2 className="mt-4 font-serif text-xl italic text-foreground">
                {video.title}
              </h2>
              {video.description && (
                <p className="mt-1 text-sm text-muted">{video.description}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
