"use client";

import { useEffect, useRef, useState } from "react";
import type { GalleryMedia } from "@/lib/r2";
import GalleryLightbox from "./GalleryLightbox";

// Triggers a native browser download for one image via a throwaway
// anchor — downloadUrl carries a Content-Disposition: attachment header
// from the server so this reliably saves a file rather than navigating.
function triggerDownload(image: GalleryMedia) {
  const link = document.createElement("a");
  link.href = image.downloadUrl;
  link.download = image.filename;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Browsers throttle/block bursts of programmatic downloads fired in a
// tight loop — spacing them out keeps each one going through cleanly
// (though the browser may still show a one-time "allow multiple
// downloads" prompt for the first batch).
async function triggerDownloads(images: GalleryMedia[]) {
  for (const image of images) {
    triggerDownload(image);
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      aria-hidden="true"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
    >
      <path d="M12 21s-6.7-4.35-9.3-8.28C.86 10.06 1.51 6.9 4.1 5.3c2-1.24 4.5-.7 5.9 1L12 8.6l2-2.3c1.4-1.7 3.9-2.24 5.9-1 2.6 1.6 3.24 4.76 1.4 7.42C18.7 16.65 12 21 12 21z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className="h-6 w-6 text-white"
      aria-hidden="true"
    >
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

// Off-screen video tiles don't start fetching until they scroll near the
// viewport — preload="metadata" alone has no lazy equivalent the way
// <img loading="lazy"> does, and a gallery with a few dozen clips would
// otherwise fire that many concurrent metadata fetches at once, which
// mobile Safari's limit on simultaneous <video> elements can choke on.
function LazyVideoThumbnail({
  src,
  className,
}: {
  src: string;
  className: string;
}) {
  const [isVisible, setIsVisible] = useState(false);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      // The #t=0.001 fragment nudges iOS Safari to actually paint the
      // first frame instead of a black box — harmless on browsers that
      // don't need it (Chrome/Firefox ignore it and behave the same).
      src={isVisible ? `${src}#t=0.001` : undefined}
      preload="metadata"
      muted
      playsInline
      className={className}
    />
  );
}

export default function GalleryPhotoGrid({
  title,
  images,
  favoritedKeys,
  onToggleFavorite,
}: {
  title: string;
  images: GalleryMedia[];
  favoritedKeys: Set<string>;
  onToggleFavorite?: (key: string, favorited: boolean) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs uppercase tracking-[0.15em]">
        <button
          type="button"
          onClick={() => triggerDownloads(images)}
          className="border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Download all ({images.length})
        </button>
        <button
          type="button"
          disabled={favoritedKeys.size === 0}
          onClick={() =>
            triggerDownloads(images.filter((i) => favoritedKeys.has(i.key)))
          }
          className="border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
        >
          Download favorites ({favoritedKeys.size})
        </button>
      </div>
      <p className="mb-8 text-center text-xs text-muted">
        Downloading several photos at once may prompt your browser to allow
        multiple downloads.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
        {images.map((media, i) => {
          const isFavorited = favoritedKeys.has(media.key);
          return (
            <div
              key={media.key}
              role="button"
              tabIndex={0}
              onClick={() => setLightboxIndex(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLightboxIndex(i);
                }
              }}
              className="group relative aspect-square cursor-pointer overflow-hidden bg-surface"
            >
              {media.isVideo ? (
                <LazyVideoThumbnail
                  src={media.url}
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a static/optimizable asset
                <img
                  src={media.url}
                  alt={`${title} photo`}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
              )}

              {media.isVideo && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm">
                    <PlayIcon />
                  </div>
                </div>
              )}

              {onToggleFavorite ? (
                <button
                  type="button"
                  aria-pressed={isFavorited}
                  aria-label={
                    isFavorited
                      ? `Remove this ${media.isVideo ? "video" : "photo"} from favorites`
                      : `Add this ${media.isVideo ? "video" : "photo"} to favorites`
                  }
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite(media.key, !isFavorited);
                  }}
                  className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur-sm transition-colors hover:text-accent"
                >
                  <HeartIcon filled={isFavorited} />
                </button>
              ) : (
                <span
                  aria-hidden="true"
                  className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur-sm"
                >
                  <HeartIcon filled={isFavorited} />
                </span>
              )}

              <a
                href={media.downloadUrl}
                download={media.filename}
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-2 right-2 z-10 rounded bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
              >
                Download
              </a>
            </div>
          );
        })}
      </div>

      {lightboxIndex !== null && (
        <GalleryLightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      )}
    </>
  );
}
