"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { MasonryPhoto } from "@/lib/masonryPhotos";

export default function MasonryGallery({ photos }: { photos: MasonryPhoto[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (selectedIndex === null) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setSelectedIndex(null);
      } else if (e.key === "ArrowRight") {
        setSelectedIndex((i) => (i === null ? null : (i + 1) % photos.length));
      } else if (e.key === "ArrowLeft") {
        setSelectedIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedIndex, photos.length]);

  if (photos.length === 0) return null;

  const selected = selectedIndex === null ? null : photos[selectedIndex];

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-10 sm:px-6">
      <div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
        {photos.map((photo, index) => (
          <button
            key={photo.key}
            type="button"
            onClick={() => setSelectedIndex(index)}
            className="mb-3 block w-full break-inside-avoid overflow-hidden bg-surface"
          >
            <Image
              src={photo.src}
              alt={photo.alt}
              width={photo.width}
              height={photo.height}
              quality={90}
              sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
              className="w-full transition-transform duration-500 ease-out hover:scale-[1.02]"
            />
          </button>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 sm:p-10"
          onClick={() => setSelectedIndex(null)}
        >
          <button
            type="button"
            onClick={() => setSelectedIndex(null)}
            aria-label="Close"
            className="absolute right-4 top-4 text-3xl text-white/80 transition-colors hover:text-white sm:right-8 sm:top-8"
          >
            &times;
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((i) => (i === null ? null : (i - 1 + photos.length) % photos.length));
            }}
            aria-label="Previous photo"
            className="absolute left-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 transition-colors hover:text-white sm:left-6"
          >
            &lsaquo;
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((i) => (i === null ? null : (i + 1) % photos.length));
            }}
            aria-label="Next photo"
            className="absolute right-2 top-1/2 -translate-y-1/2 text-4xl text-white/70 transition-colors hover:text-white sm:right-6"
          >
            &rsaquo;
          </button>
          <div
            className="relative max-h-full max-w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <Image
              src={selected.src}
              alt={selected.alt}
              width={selected.width}
              height={selected.height}
              quality={90}
              sizes="100vw"
              className="max-h-[90vh] w-auto max-w-full object-contain"
            />
          </div>
        </div>
      )}
    </div>
  );
}
