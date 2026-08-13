"use client";

import { useEffect } from "react";
import type { GalleryMedia } from "@/lib/r2";

export default function GalleryLightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: GalleryMedia[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const image = images[index];
  const hasMultiple = images.length > 1;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (hasMultiple && e.key === "ArrowLeft") {
        onNavigate((index - 1 + images.length) % images.length);
      }
      if (hasMultiple && e.key === "ArrowRight") {
        onNavigate((index + 1) % images.length);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, images.length, hasMultiple, onClose, onNavigate]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 px-4 py-8"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        aria-label="Close"
        className="absolute right-4 top-4 text-3xl leading-none text-white/70 transition-colors hover:text-white"
      >
        &times;
      </button>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index - 1 + images.length) % images.length);
            }}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 px-3 py-6 text-4xl leading-none text-white/70 transition-colors hover:text-white sm:left-4"
          >
            &#8249;
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onNavigate((index + 1) % images.length);
            }}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-6 text-4xl leading-none text-white/70 transition-colors hover:text-white sm:right-4"
          >
            &#8250;
          </button>
        </>
      )}

      {image.isVideo ? (
        <video
          src={image.url}
          controls
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- signed R2 URL
        <img
          src={image.url}
          alt=""
          onClick={(e) => e.stopPropagation()}
          className="max-h-full max-w-full object-contain"
        />
      )}

      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-xs uppercase tracking-[0.15em] text-white/60">
        {index + 1} / {images.length}
      </div>
    </div>
  );
}
