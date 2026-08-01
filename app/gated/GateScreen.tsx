"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Status = "idle" | "loading" | "error";

export default function GateScreen() {
  const router = useRouter();
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!ageConfirmed || status === "loading") return;

    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gated-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password, ageConfirmed }),
      });

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      // The server has set the access cookie; re-render this route so the
      // server component picks it up and swaps in the gallery.
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
      <div className="w-full max-w-md">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
          Private Gallery
        </p>
        <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
          Before you continue
        </h1>
        <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
          This section contains artistic boudoir and nude photography
          intended for a mature audience. Please confirm your age and enter
          the access password to continue.
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

          <label className="flex items-start gap-3 text-sm text-background/70">
            <input
              type="checkbox"
              checked={ageConfirmed}
              onChange={(e) => setAgeConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4 shrink-0 border-background/30 bg-transparent accent-accent"
            />
            I confirm that I am 18 years of age or older.
          </label>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={!ageConfirmed || status === "loading"}
            className="w-full border border-background px-8 py-3 text-xs uppercase tracking-[0.2em] text-background transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:border-background/25 disabled:text-background/40 disabled:hover:bg-transparent disabled:hover:text-background/40"
          >
            {status === "loading" ? "Checking…" : "Continue"}
          </button>
        </form>

        <div className="mt-8 text-center">
          <Link
            href="/"
            className="text-xs uppercase tracking-[0.15em] text-background/40 underline-offset-4 transition-colors hover:text-background/70 hover:underline"
          >
            Back to main site
          </Link>
        </div>
      </div>
    </div>
  );
}
