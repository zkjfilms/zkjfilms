"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

type SubmitStatus = "idle" | "loading" | "error";
type GalleryImage = { key: string; url: string };
type Session = {
  images: GalleryImage[];
  imagesError: boolean;
  expiresAt: number;
};

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
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState("");

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
        images?: GalleryImage[];
        imagesError?: boolean;
        expiresAt?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      const newSession: Session = {
        images: data.images ?? [],
        imagesError: data.imagesError ?? false,
        expiresAt: data.expiresAt ?? Date.now(),
      };
      sessionStorage.setItem(sessionKey(slug), JSON.stringify(newSession));
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
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
            {images.map((image) => (
              <div
                key={image.key}
                className="group relative aspect-square overflow-hidden bg-surface"
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- signed R2 URLs, not a static/optimizable asset */}
                <img
                  src={image.url}
                  alt={`${title} photo`}
                  loading="lazy"
                  className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                />
              </div>
            ))}
          </div>
        )}
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
          <div>
            <label
              htmlFor="password"
              className="block text-xs uppercase tracking-[0.15em] text-background/50"
            >
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError("");
              }}
              className="mt-2 w-full border-b border-background/20 bg-transparent py-2 text-background outline-none transition-colors focus:border-accent"
            />
          </div>

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
