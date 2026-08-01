"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";

type SubmitStatus = "idle" | "loading" | "error";

function storageKey(slug: string) {
  return `gallery-access:${slug}`;
}

// No real external events to subscribe to — sessionStorage only changes
// here, from handleSubmit below — so this just satisfies the hook's
// contract with a no-op.
function subscribe() {
  return () => {};
}

export default function GalleryGate({
  slug,
  title,
}: {
  slug: string;
  title: string;
}) {
  // Unlock state lives in sessionStorage only — there's no server session
  // behind it. That's fine while this route only shows a placeholder
  // message, but once real images are wired up, the image-fetching code
  // must re-verify the password server-side (e.g. via this same
  // /api/gallery-access check) rather than trusting this client flag,
  // since sessionStorage can be set directly from devtools.
  const unlocked = useSyncExternalStore(
    subscribe,
    () => sessionStorage.getItem(storageKey(slug)) === "unlocked",
    () => false, // server/initial-hydration snapshot — sessionStorage doesn't exist yet
  );

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

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      sessionStorage.setItem(storageKey(slug), "unlocked");
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  if (unlocked) {
    return (
      <div className="mx-auto flex min-h-[70vh] w-full max-w-2xl flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          {title}
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          Gallery unlocked
        </h1>
        <p className="mt-4 text-muted">Images will load here.</p>
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
