"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const STORAGE_KEY = "boudoir-age-confirmed";

// "checking" is the initial render on both server and client, so hydration
// never mismatches — the localStorage read only happens in an effect, after
// which we flip straight to "gated" or "confirmed" without ever flashing the
// gate at a returning visitor who already confirmed.
type Status = "checking" | "gated" | "confirmed";

export default function AgeGate() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");

  useEffect(() => {
    let confirmed = false;
    try {
      confirmed = window.localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      // Storage unavailable (private browsing, blocked cookies, etc.) —
      // fall through to showing the gate every visit rather than erroring.
    }
    // localStorage doesn't exist during SSR, so this genuinely has to be an
    // effect (not state adjusted during render) — there's no prop/state to
    // derive "gated" vs "confirmed" from until after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(confirmed ? "confirmed" : "gated");
  }, []);

  useEffect(() => {
    if (status !== "gated") return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [status]);

  if (status !== "gated") return null;

  function handleConfirm() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Nothing to do if storage isn't available — the gate will just
      // reappear next visit, which is an acceptable fallback.
    }
    setStatus("confirmed");
  }

  function handleDecline() {
    router.push("/");
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background px-6">
      <div className="w-full max-w-md text-center">
        <p className="mb-4 text-xs uppercase tracking-[0.3em] text-muted">
          Content Notice
        </p>
        <h1 className="mb-5 font-serif text-3xl italic text-foreground">
          18+ content ahead
        </h1>
        <p className="mb-10 text-sm leading-relaxed text-muted">
          This page contains fine art boudoir and nude photography intended
          for a mature audience. You must be at least 18 years old to
          continue.
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={handleConfirm}
            autoFocus
            className="w-full border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background sm:w-auto"
          >
            I&rsquo;m 18 or older &mdash; Continue
          </button>
          <button
            type="button"
            onClick={handleDecline}
            className="w-full text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground sm:w-auto"
          >
            Leave
          </button>
        </div>
      </div>
    </div>
  );
}
