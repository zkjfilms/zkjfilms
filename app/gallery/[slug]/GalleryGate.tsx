"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import type { GalleryMedia } from "@/lib/r2";
import GalleryLightbox from "./GalleryLightbox";
import PasswordField from "@/components/PasswordField";

type SubmitStatus = "idle" | "loading" | "error";
type Session = {
  images: GalleryMedia[];
  imagesError: boolean;
  expiresAt: number;
};

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

function sessionKey(slug: string) {
  return `gallery-session:${slug}`;
}

// No real external events to subscribe to — sessionStorage only changes
// here, from handleSubmit below — so this just satisfies the hook's
// contract with a no-op.
function subscribe() {
  return () => {};
}

function parseSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Session>;
    if (typeof parsed.expiresAt !== "number") return null;
    return {
      images: parsed.images ?? [],
      imagesError: parsed.imagesError ?? false,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

// Date.now() is impure, so the expiry check has to happen inside the
// snapshot function (where useSyncExternalStore expects reads of live
// external state), not in the render body.
function isUnlocked(slug: string): boolean {
  const session = parseSession(sessionStorage.getItem(sessionKey(slug)));
  return session !== null && Date.now() < session.expiresAt;
}

export default function GalleryGate({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  // The unlocked session (including signed image URLs) lives in
  // sessionStorage only — there's no server session behind it. The
  // password is verified server-side once (in handleSubmit, via
  // /api/gallery-access), which also signs the image URLs at that point
  // and tells us when those URLs expire; nothing here trusts client state
  // for the actual authorization, only for whether to show the cached
  // result instead of re-prompting. Once expiresAt passes (the signed
  // URLs would be dead anyway), this falls back to the locked gate
  // rather than showing broken images.
  //
  // Kept as a raw string (a primitive, comparable with ===) rather than
  // parsing inside the snapshot function — useSyncExternalStore requires
  // getSnapshot to return a stable reference when nothing changed, and
  // JSON.parse would allocate a new object on every call.
  const unlocked = useSyncExternalStore(
    subscribe,
    () => isUnlocked(slug),
    () => false, // server/initial-hydration snapshot — sessionStorage doesn't exist yet
  );

  // Parsing (pure, no Date.now()) happens separately in the render body —
  // only the unlocked boolean above needed the impure expiry check.
  const sessionRaw = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(sessionKey(slug)),
    () => null,
  );
  const session = parseSession(sessionRaw);

  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"password" | "pin">("password");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Shared by both handleSubmit and handlePinSubmit below — both end the
  // same way once the server confirms access (with or without a PIN
  // step in between), and this keeps that one behavior in one place.
  function commitSession(data: {
    images?: GalleryMedia[];
    imagesError?: boolean;
    expiresAt?: number;
  }) {
    const newSession: Session = {
      images: data.images ?? [],
      imagesError: data.imagesError ?? false,
      expiresAt: data.expiresAt ?? Date.now(),
    };
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(newSession));
  }

  function toggleSelect(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password }),
      });

      const data: {
        error?: string;
        pinRequired?: boolean;
        images?: GalleryMedia[];
        imagesError?: boolean;
        expiresAt?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      if (data.pinRequired) {
        setSubmitStatus("idle");
        setStage("pin");
        return;
      }

      commitSession(data);
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  async function handlePinSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password, pin }),
      });

      const data: {
        error?: string;
        images?: GalleryMedia[];
        imagesError?: boolean;
        expiresAt?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      commitSession(data);
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  if (unlocked && session) {
    const { images, imagesError } = session;

    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
        <div className="mb-10 text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
            {title}
          </p>
          <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
            Your gallery
          </h1>
        </div>

        {imagesError ? (
          <p className="text-center text-muted">
            Your photos couldn&rsquo;t be loaded right now. Please refresh
            the page, or get in touch if this keeps happening.
          </p>
        ) : images.length === 0 ? (
          <p className="text-center text-muted">
            Your photos are being prepared and will appear here soon.
          </p>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-xs uppercase tracking-[0.15em]">
              <button
                type="button"
                onClick={() =>
                  setSelected(
                    selected.size === images.length
                      ? new Set()
                      : new Set(images.map((image) => image.key)),
                  )
                }
                className="text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                {selected.size === images.length
                  ? "Clear selection"
                  : "Select all"}
              </button>
              <button
                type="button"
                onClick={() => triggerDownloads(images)}
                className="border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background"
              >
                Download all ({images.length})
              </button>
              <button
                type="button"
                disabled={selected.size === 0}
                onClick={() =>
                  triggerDownloads(images.filter((i) => selected.has(i.key)))
                }
                className="border border-foreground px-6 py-2 text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
              >
                Download selected ({selected.size})
              </button>
            </div>
            <p className="mb-8 text-center text-xs text-muted">
              Downloading several photos at once may prompt your browser to
              allow multiple downloads.
            </p>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {images.map((media, i) => (
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

                  <label
                    onClick={(e) => e.stopPropagation()}
                    className="absolute left-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded bg-black/40 backdrop-blur-sm"
                  >
                    <span className="sr-only">
                      Select this {media.isVideo ? "video" : "photo"}
                    </span>
                    <input
                      type="checkbox"
                      checked={selected.has(media.key)}
                      onChange={() => toggleSelect(media.key)}
                      className="h-4 w-4 accent-accent"
                    />
                  </label>

                  <a
                    href={media.downloadUrl}
                    download={media.filename}
                    onClick={(e) => e.stopPropagation()}
                    className="absolute bottom-2 right-2 z-10 rounded bg-black/40 px-2 py-1 text-[10px] uppercase tracking-wide text-white opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          </>
        )}

        {lightboxIndex !== null && (
          <GalleryLightbox
            images={images}
            index={lightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onNavigate={setLightboxIndex}
          />
        )}
      </div>
    );
  }

  if (stage === "pin") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
            Private Gallery
          </p>
          <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
            {title}
          </h1>
          <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
            Enter the 4-digit PIN shared with you to continue.
          </p>

          <form onSubmit={handlePinSubmit} className="mt-10 space-y-6">
            <PasswordField
              id="pin"
              label="PIN"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(value) => {
                setPin(value);
                setError("");
              }}
              variant="dark"
            />

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitStatus === "loading"}
              className="w-full border border-background px-8 py-3 text-xs uppercase tracking-[0.2em] text-background transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitStatus === "loading" ? "Checking…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
      <div className="w-full max-w-md">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
          Private Gallery
        </p>
        <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
          {title}
        </h1>
        <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
          Enter the password shared with you to view your gallery.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-6">
          <PasswordField
            id="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              setError("");
            }}
            variant="dark"
          />

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={submitStatus === "loading"}
            className="w-full border border-background px-8 py-3 text-xs uppercase tracking-[0.2em] text-background transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitStatus === "loading" ? "Checking…" : "View Gallery"}
          </button>
        </form>
      </div>
    </div>
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
