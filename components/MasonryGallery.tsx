"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import type { MasonryPhoto } from "@/lib/masonryPhotos";

// Keep in sync with Tailwind's default `sm`/`lg` breakpoints — this used to
// be a `columns-1 sm:columns-2 lg:columns-3` CSS multi-column layout, but
// CSS column-balancing only optimizes total height across all columns, not
// how even the *last* row looks — with a few dozen photos that reliably
// left one column visibly hanging past the others. Track the column count
// in JS instead so we can place photos with distributeIntoColumns below.
const SM_BREAKPOINT = 640;
const LG_BREAKPOINT = 1024;

function useColumnCount() {
  const [columns, setColumns] = useState(3);

  useEffect(() => {
    function update() {
      const width = window.innerWidth;
      setColumns(width >= LG_BREAKPOINT ? 3 : width >= SM_BREAKPOINT ? 2 : 1);
    }
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return columns;
}

// Greedy "shortest column first" placement: walk the photos in whatever
// order the caller gives them (masonryPhotos.ts arrays are hand-shuffled
// for visual variety, not upload order) and drop each one into whichever
// column currently has the least content, using aspect ratio as a stand-in
// for rendered height since every column is the same width. This is the
// rule for keeping masonry galleries random-looking AND evenly balanced:
// don't reorder photos by hand to fix a hanging column — the algorithm
// keeps whatever order the array is in and balances the columns itself, so
// adding/removing photos never re-introduces the problem.
function distributeIntoColumns(photos: MasonryPhoto[], columnCount: number) {
  const columns: MasonryPhoto[][] = Array.from({ length: columnCount }, () => []);
  const heights = new Array(columnCount).fill(0);

  for (const photo of photos) {
    let shortest = 0;
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[shortest]) shortest = i;
    }
    columns[shortest].push(photo);
    heights[shortest] += photo.height / photo.width;
  }

  return columns;
}

export default function MasonryGallery({ photos }: { photos: MasonryPhoto[] }) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [failedKeys, setFailedKeys] = useState<Set<string>>(new Set());
  const columnCount = useColumnCount();

  const photoIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    photos.forEach((photo, index) => map.set(photo.key, index));
    return map;
  }, [photos]);

  const columns = useMemo(
    () => distributeIntoColumns(photos, columnCount),
    [photos, columnCount],
  );

  function markFailed(key: string) {
    setFailedKeys((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }

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
      <div className="flex gap-3">
        {columns.map((columnPhotos, columnIndex) => (
          <div key={columnIndex} className="flex flex-1 flex-col gap-3">
            {columnPhotos.map((photo) => {
              const index = photoIndexByKey.get(photo.key)!;
              return (
                <button
                  key={photo.key}
                  type="button"
                  onClick={() => setSelectedIndex(index)}
                  className="block w-full overflow-hidden bg-surface"
                >
                  {failedKeys.has(photo.key) ? (
                    <div
                      style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
                      className="flex w-full items-center justify-center text-xs text-muted"
                    >
                      Image unavailable
                    </div>
                  ) : (
                    <Image
                      src={photo.src}
                      alt={photo.alt}
                      width={photo.width}
                      height={photo.height}
                      quality={90}
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      className="w-full transition-transform duration-500 ease-out hover:scale-[1.02]"
                      onError={() => markFailed(photo.key)}
                    />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 sm:p-10"
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
            {failedKeys.has(selected.key) ? (
              <div className="flex h-[50vh] w-[50vw] items-center justify-center text-sm text-white/70">
                Image unavailable
              </div>
            ) : (
              <Image
                src={selected.src}
                alt={selected.alt}
                width={selected.width}
                height={selected.height}
                quality={90}
                sizes="90vw"
                className="max-h-[90vh] w-auto max-w-full object-contain"
                onError={() => markFailed(selected.key)}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
