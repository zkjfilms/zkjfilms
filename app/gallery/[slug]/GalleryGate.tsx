"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import type { GalleryMedia } from "@/lib/r2";
import GalleryPhotoGrid from "./GalleryPhotoGrid";
import PasswordField from "@/components/PasswordField";

type SubmitStatus = "idle" | "loading" | "error";
type Session = {
  images: GalleryMedia[];
  imagesError: boolean;
  expiresAt: number;
  favoriteToken: string;
  favoritedKeys: string[];
};

function sessionKey(slug: string) {
  return `gallery-session:${slug}`;
}

// No real external events to subscribe to — sessionStorage only changes
// here, from handleSubmit/handlePinSubmit/toggleFavorite below — so this
// just satisfies the hook's contract with a no-op.
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
      favoriteToken: typeof parsed.favoriteToken === "string" ? parsed.favoriteToken : "",
      favoritedKeys: Array.isArray(parsed.favoritedKeys) ? parsed.favoritedKeys : [],
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
  const [favoriteError, setFavoriteError] = useState("");

  // Seeded once from whatever's cached in sessionStorage at mount (the
  // "returning within the same unlocked session" case). Fresh unlocks
  // re-seed this explicitly in handleSubmit/handlePinSubmit below, since
  // this lazy initializer only ever runs once per mount.
  // Guarded for SSR: the lazy initializer below still runs server-side
  // (unlike useSyncExternalStore's getSnapshot, useState's initializer has
  // no separate server-safe variant), where sessionStorage doesn't exist.
  // This is safe to short-circuit to an empty Set on the server — the
  // `unlocked` flag above is always false there (per its own
  // getServerSnapshot), so `favorited` is never rendered server-side
  // anyway; the client re-runs this initializer during hydration, when
  // sessionStorage is available, and seeds correctly.
  const [favorited, setFavorited] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    return new Set(
      parseSession(sessionStorage.getItem(sessionKey(slug)))?.favoritedKeys ?? [],
    );
  });

  // Shared by both handleSubmit and handlePinSubmit below — both end the
  // same way once the server confirms access (with or without a PIN
  // step in between), and this keeps that one behavior in one place.
  function commitSession(data: {
    images?: GalleryMedia[];
    imagesError?: boolean;
    expiresAt?: number;
    favoriteToken?: string;
    favoritedKeys?: string[];
  }) {
    const newSession: Session = {
      images: data.images ?? [],
      imagesError: data.imagesError ?? false,
      expiresAt: data.expiresAt ?? Date.now(),
      favoriteToken: data.favoriteToken ?? "",
      favoritedKeys: data.favoritedKeys ?? [],
    };
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(newSession));
  }

  // Keeps sessionStorage's cached favoritedKeys in sync with local state
  // after every optimistic toggle (and its revert, if the request
  // fails), so a same-tab reload within the session window starts from
  // the right favorited set via the lazy initializer above.
  function patchFavoritedKeys(keys: Set<string>) {
    const current = parseSession(sessionStorage.getItem(sessionKey(slug)));
    if (!current) return;
    const next: Session = { ...current, favoritedKeys: Array.from(keys) };
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(next));
  }

  async function toggleFavorite(key: string, next: boolean, favoriteToken: string) {
    setFavoriteError("");
    const updated = new Set(favorited);
    if (next) updated.add(key);
    else updated.delete(key);
    setFavorited(updated);
    patchFavoritedKeys(updated);

    try {
      const response = await fetch("/api/gallery-access/favorite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, imageKey: key, favoriteToken, favorited: next }),
      });
      if (!response.ok) throw new Error("Favorite request failed.");
    } catch {
      const reverted = new Set(updated);
      if (next) reverted.delete(key);
      else reverted.add(key);
      setFavorited(reverted);
      patchFavoritedKeys(reverted);
      setFavoriteError(
        "Couldn't save that — your session may have expired. Refresh and sign back in.",
      );
    }
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
        favoriteToken?: string;
        favoritedKeys?: string[];
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
      setFavorited(new Set(data.favoritedKeys ?? []));
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
        favoriteToken?: string;
        favoritedKeys?: string[];
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      commitSession(data);
      setFavorited(new Set(data.favoritedKeys ?? []));
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  if (unlocked && session) {
    const { images, imagesError, favoriteToken } = session;

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
            {favoriteError && (
              <p className="mb-4 text-center text-sm text-red-600">{favoriteError}</p>
            )}
            <GalleryPhotoGrid
              title={title}
              images={images}
              favoritedKeys={favorited}
              onToggleFavorite={(key, next) => toggleFavorite(key, next, favoriteToken)}
            />
          </>
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
