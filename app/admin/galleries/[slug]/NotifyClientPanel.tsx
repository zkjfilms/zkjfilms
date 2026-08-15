"use client";

import { useMemo, useState } from "react";
import type { DirectoryClient } from "@/lib/clientDirectory";

type SendState = "idle" | "confirming" | "sending" | "sent" | "error";

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function NotifyClientPanel({
  slug,
  initialClientEmail,
  initialSentAt,
  directory,
}: {
  slug: string;
  initialClientEmail: string | null;
  initialSentAt: string | null;
  directory: DirectoryClient[];
}) {
  const [email, setEmail] = useState(initialClientEmail ?? "");
  const [nameQuery, setNameQuery] = useState("");
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState("");
  const [fallbackCreds, setFallbackCreds] = useState<{ password: string; pin: string } | null>(null);

  const matches = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return [];
    return directory
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [nameQuery, directory]);

  const canSend = email.includes("@");

  async function handleConfirmSend() {
    setState("sending");
    setError("");
    setFallbackCreds(null);

    try {
      const response = await fetch(`/api/admin/galleries/${slug}/send-ready-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientEmail: email }),
      });

      const data: {
        error?: string;
        sentAt?: string;
        password?: string;
        pin?: string;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong.");
        if (data.password && data.pin) {
          setFallbackCreds({ password: data.password, pin: data.pin });
        }
        setState("error");
        return;
      }

      setSentAt(data.sentAt ?? new Date().toISOString());
      setState("sent");
    } catch {
      setError("Something went wrong.");
      setState("error");
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-xl border-t border-border pt-10">
      <h2 className="mb-4 text-center text-xs uppercase tracking-[0.3em] text-muted">
        Notify client
      </h2>

      <p className="mb-4 text-center text-sm text-muted">
        {sentAt ? `Last sent ${formatSentAt(sentAt)}` : "Not yet sent"}
      </p>

      <div className="relative mb-3">
        <input
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="Search clients by name…"
          className="w-full border border-border bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full border border-border bg-background">
            {matches.map((client) => (
              <button
                key={client.email}
                type="button"
                onClick={() => {
                  setEmail(client.email);
                  setNameQuery("");
                }}
                className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface"
              >
                {client.name} — {client.email}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state !== "idle" && state !== "confirming") setState("idle");
        }}
        placeholder="client@example.com"
        className="mb-4 w-full border border-border bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted"
      />

      {state === "confirming" ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted">
            This emails new credentials to <strong>{email}</strong>. Any
            previously shared password/PIN will stop working. Send?
          </p>
          <div className="flex justify-center gap-4">
            <button
              type="button"
              onClick={() => setState("idle")}
              className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSend}
              className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
            >
              Confirm &amp; Send
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canSend || state === "sending"}
          onClick={() => setState("confirming")}
          className="w-full border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
        >
          {state === "sending"
            ? "Sending…"
            : sentAt
              ? "Resend gallery-ready email"
              : "Send gallery-ready email"}
        </button>
      )}

      {state === "sent" && (
        <p className="mt-3 text-center text-sm text-muted">Sent.</p>
      )}

      {state === "error" && (
        <div className="mt-4 space-y-2 text-center text-sm">
          <p className="text-red-600">{error}</p>
          {fallbackCreds && (
            <p className="text-muted">
              Password: <strong>{fallbackCreds.password}</strong> — PIN:{" "}
              <strong>{fallbackCreds.pin}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
