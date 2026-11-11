"use client";

import { useEffect, useRef, useState } from "react";
import { downloadZip } from "client-zip";
import type { GalleryMedia, GalleryZip } from "@/lib/r2";
import GalleryLightbox from "./GalleryLightbox";

// Chromium's File System Access API — not in TS's DOM lib yet.
type SaveFilePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<WritableStream> }>;

function zipFilename(title: string, suffix: string) {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "gallery";
  return `${base}${suffix}.zip`;
}

function formatBytes(bytes: number) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}

// Starts a normal browser download of a URL (shown in the browser's own
// downloads bar). The URL carries a Content-Disposition: attachment
// header from the server, so this saves a file rather than navigating.
function startNativeDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

type ZipEntry = { name: string; url: string };

// Original files (full resolution) for "Download all"/"Download favorites".
const originalEntries = (images: GalleryMedia[]): ZipEntry[] =>
  images.map((i) => ({ name: i.filename, url: i.url }));

// The 2400px WebP previews, for the "web size" download. Videos, GIFs
// and photos without previews are left out — they have no smaller copy.
const webEntries = (images: GalleryMedia[]): ZipEntry[] =>
  images
    // != null also covers sessions cached before previewSize existed.
    .filter((i) => i.previewSize != null)
    .map((i) => ({ name: `${i.filename.replace(/\.[^.]+$/, "")}.webp`, url: i.previewUrl }));

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Give the browser a moment to start the save before freeing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Bundles the given files into one .zip, built entirely in the browser:
// each file is fetched from its signed R2 URL (needs the bucket CORS rule
// from scripts/r2-cors.mjs) and streamed into the archive. Files are
// stored, not recompressed — JPEGs and MP4s are already compressed.
//
// Where the browser supports it (Chrome/Edge), the zip streams straight
// to a file on disk, so multi-GB galleries never sit in memory. Elsewhere
// (Safari/Firefox) the zip is assembled as an in-memory Blob, then saved.
//
// Up to ZIP_CONCURRENCY files are fetched in parallel ahead of the one
// currently being written, so the next file is usually ready the moment
// the previous one finishes. `onProgress` reports how many files have
// been handed to the zip so far.
const ZIP_CONCURRENCY = 5;
async function downloadAsZip(
  images: ZipEntry[],
  filename: string,
  onProgress: (done: number) => void,
) {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker })
    .showSaveFilePicker;

  // The save dialog has to open while we're still inside the click's user
  // gesture, i.e. before any network awaits.
  const writable = picker
    ? await picker({
        suggestedName: filename,
        types: [
          { description: "Zip archive", accept: { "application/zip": [".zip"] } },
        ],
      }).then((handle) => handle.createWritable())
    : null;

  const fetchFile = async (image: ZipEntry) => {
    const res = await fetch(image.url);
    if (!res.ok) throw new Error(`Couldn't fetch ${image.name} (${res.status})`);
    return res;
  };

  async function* files() {
    const inFlight: Promise<Response>[] = [];
    let next = 0;
    const fill = () => {
      while (next < images.length && inFlight.length < ZIP_CONCURRENCY) {
        const p = fetchFile(images[next++]);
        // Avoid an unhandled-rejection warning for a prefetch that fails
        // before we reach it — it still throws when awaited below.
        p.catch(() => {});
        inFlight.push(p);
      }
    };
    fill();
    for (let i = 0; i < images.length; i++) {
      onProgress(i);
      const res = await inFlight.shift()!;
      fill();
      yield { name: images[i].name, input: res };
    }
  }

  const zip = downloadZip(files());

  if (writable) {
    await zip.body!.pipeTo(writable);
  } else {
    saveBlob(await zip.blob(), filename);
  }
  onProgress(images.length);
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

// `?? 0` covers sessions cached in sessionStorage before sizes existed.
const totalBytes = (sizes: (number | null | undefined)[]) =>
  sizes.reduce<number>((sum, n) => sum + (n ?? 0), 0);

export default function GalleryPhotoGrid({
  title,
  images,
  fullZip,
  favoritedKeys,
  onToggleFavorite,
}: {
  title: string;
  images: GalleryMedia[];
  fullZip: GalleryZip | null;
  favoritedKeys: Set<string>;
  onToggleFavorite?: (key: string, favorited: boolean) => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [zipping, setZipping] = useState<{ done: number; total: number } | null>(
    null,
  );
  const [zipError, setZipError] = useState<string | null>(null);

  async function startZip(selection: ZipEntry[], suffix: string) {
    if (zipping || selection.length === 0) return;
    setZipError(null);
    setZipping({ done: 0, total: selection.length });
    try {
      await downloadAsZip(selection, zipFilename(title, suffix), (done) =>
        setZipping({ done, total: selection.length }),
      );
    } catch (err) {
      // Closing the save dialog isn't an error worth showing.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.error(err);
        setZipError(
          "Something went wrong building the zip. Try again, or download photos individually.",
        );
      }
    } finally {
      setZipping(null);
    }
  }

  const favoriteImages = images.filter((i) => favoritedKeys.has(i.key));
  const webImages = images.filter((i) => i.previewSize != null);

  const buttonClass =
    "border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground";

  return (
    <>
      <div className="mb-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs uppercase tracking-[0.15em]">
        <button
          type="button"
          disabled={zipping !== null}
          onClick={() =>
            // Prefer the prebuilt zip: an ordinary browser download that
            // shows in the downloads bar, survives closing the tab and
            // never holds the gallery in memory. Fall back to building it
            // here if the gallery has none (or it's out of date).
            fullZip
              ? startNativeDownload(fullZip.url)
              : startZip(originalEntries(images), "")
          }
          className={buttonClass}
        >
          Download all ({images.length} ·{" "}
          {formatBytes(fullZip?.size ?? totalBytes(images.map((i) => i.size)))})
        </button>
        {webImages.length > 0 && (
          <button
            type="button"
            disabled={zipping !== null}
            onClick={() => startZip(webEntries(images), "-web")}
            className={buttonClass}
          >
            Web size ({formatBytes(totalBytes(webImages.map((i) => i.previewSize)))})
          </button>
        )}
        <button
          type="button"
          disabled={zipping !== null || favoritedKeys.size === 0}
          onClick={() => startZip(originalEntries(favoriteImages), "-favorites")}
          className={buttonClass}
        >
          Download favorites ({favoritedKeys.size}
          {favoriteImages.length > 0 &&
            ` · ${formatBytes(totalBytes(favoriteImages.map((i) => i.size)))}`}
          )
        </button>
      </div>
      <p className="mb-8 text-center text-xs text-muted" aria-live="polite">
        {zipping
          ? `Preparing zip… ${zipping.done} of ${zipping.total} files. Keep this tab open.`
          : (zipError ??
            (webImages.length > 0
              ? "Full resolution for printing and archiving. Web size is smaller and quicker, for sharing online."
              : "Downloads as a single .zip file."))}
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
                  src={media.thumbUrl}
                  alt={`${title} photo`}
                  decoding="async"
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
                  className="absolute left-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded bg-black/40 text-white backdrop-blur-sm"
                >
                  <HeartIcon filled={isFavorited} />
                  <span className="sr-only">
                    {isFavorited ? "Favorited" : "Not favorited"}
                  </span>
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
