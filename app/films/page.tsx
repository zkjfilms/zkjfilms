import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import { getSupabaseClient } from "@/lib/supabase";

const TITLE = "Films";
const DESCRIPTION =
  "Cinematic video work from Zach K. Johnson — highlight reels and film pieces from Columbia, Missouri.";

// Video rows are managed out-of-band via the video:* CLI (scripts/video.mjs),
// so revalidate periodically — otherwise a newly uploaded film wouldn't
// appear until the next deploy. Matches app/page.tsx / app/faq / app/book.
export const revalidate = 300;

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/films" });
}

type VideoRow = {
  slug: string;
  title: string;
  description: string | null;
  video_key: string;
  poster_key: string;
};

export default async function FilmsPage() {
  const supabase = getSupabaseClient();
  const { data: videos, error } = await supabase
    .from("videos")
    .select("slug, title, description, video_key, poster_key")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Supabase videos fetch failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-10">
      <header className="mb-16 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Motion
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Films
        </h1>
      </header>

      {!videos || videos.length === 0 ? (
        <p className="text-center text-muted">
          {error
            ? "Couldn't load videos right now."
            : "New film work is on the way — check back soon."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2">
          {(videos as VideoRow[]).map((video) => (
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
