"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Status = "idle" | "loading" | "error";

export default function AdminGate() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;

    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/admin-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      // The server has set the access cookie; re-render this route so the
      // admin layout picks it up and swaps in the actual page content.
      router.refresh();
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-6 py-24 sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Admin
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        Sign in
      </h1>

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
            autoComplete="off"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError("");
            }}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
          />
        </div>

        {error && <p className="text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={status === "loading"}
          className="w-full border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Checking…" : "Sign In"}
        </button>
      </form>
    </div>
  );
}
