"use client";

/**
 * NOT REAL ACCESS CONTROL.
 *
 * This gate is a client-side placeholder only: the password is hardcoded in
 * the bundle, the check runs in the browser, and the "content" below never
 * actually leaves the initial page payload — anyone can read it from
 * dev tools regardless of whether they pass the gate.
 *
 * Before any real (e.g. age-restricted or private client) content goes
 * behind this route, replace this with server-side access control —
 * e.g. a signed session cookie set via an API route / middleware after
 * verifying credentials server-side, so ungated content is never sent
 * to an unauthenticated client at all.
 */

import { useState, type FormEvent } from "react";

const PLACEHOLDER_PASSWORD = "preview";

export default function GateScreen() {
  const [unlocked, setUnlocked] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!ageConfirmed) {
      setError("Please confirm you are 18 or older to continue.");
      return;
    }

    if (password !== PLACEHOLDER_PASSWORD) {
      setError("Incorrect password.");
      return;
    }

    setError("");
    setUnlocked(true);
  }

  if (unlocked) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-24 text-center sm:px-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Private Gallery
        </p>
        <h1 className="font-serif text-4xl italic text-foreground sm:text-5xl">
          Restricted Content
        </h1>
        <p className="mt-6 text-muted">
          This is placeholder content for a gated gallery. Real work will
          live here once proper server-side access control is in place.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-6 py-24 sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Private Gallery
      </p>
      <h1 className="font-serif text-3xl italic leading-tight text-foreground sm:text-4xl">
        Enter to <span className="text-accent">view</span>.
      </h1>
      <p className="mt-4 text-sm text-muted">
        This gallery contains restricted content. Please confirm your age and
        enter the password to continue.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 space-y-6">
        <div>
          <label
            htmlFor="password"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
          />
        </div>

        <label className="flex items-start gap-3 text-sm text-muted">
          <input
            type="checkbox"
            checked={ageConfirmed}
            onChange={(e) => setAgeConfirmed(e.target.checked)}
            className="mt-1 h-4 w-4 shrink-0 border-border bg-transparent accent-accent"
          />
          I confirm that I am 18 years of age or older.
        </label>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          className="w-full border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Enter
        </button>
      </form>
    </div>
  );
}
