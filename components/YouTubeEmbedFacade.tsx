"use client";

import { useState } from "react";
import Image from "next/image";

// Renders a thumbnail + play button until clicked, then swaps in the real
// YouTube iframe. Prevents every episode card from loading its own YouTube
// player/JS on initial page load — only the one(s) a visitor actually
// clicks ever load.
export default function YouTubeEmbedFacade({
  videoId,
  thumbnailUrl,
  title,
}: {
  videoId: string;
  thumbnailUrl: string;
  title: string;
}) {
  const [loaded, setLoaded] = useState(false);

  if (loaded) {
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-surface">
        <iframe
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1`}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="h-full w-full"
        />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setLoaded(true)}
      aria-label={`Play video: ${title}`}
      className="group relative block aspect-video w-full overflow-hidden bg-surface"
    >
      {thumbnailUrl && (
        <Image
          src={thumbnailUrl}
          alt=""
          fill
          className="object-cover"
          sizes="(min-width: 640px) 640px, 100vw"
        />
      )}
      <span className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors group-hover:bg-black/35">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-foreground">
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M4 2.5v13l12-6.5-12-6.5z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
