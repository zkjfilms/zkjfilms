"use client";

import { useState, type FormEvent } from "react";
import { SESSION_TYPES } from "@/lib/leads";
import { formatTimeRange } from "@/lib/format";

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
};

type Status = "idle" | "loading";

const EMPTY_FORM = { clientName: "", clientEmail: "", notes: "" };

function redirectTo(url: string) {
  window.location.href = url;
}

export default function BookingFlow({ slots }: { slots: Slot[] }) {
  const [sessionTypeFilter, setSessionTypeFilter] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const filteredSlots = sessionTypeFilter
    ? slots.filter((s) => s.session_type === sessionTypeFilter)
    : slots;

  const selectedSlot = slots.find((s) => s.id === selectedSlotId) ?? null;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedSlot || status === "loading") return;

    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: selectedSlot.id, ...form }),
      });

      const data: { checkoutUrl?: string; error?: string } =
        await response.json();

      if (!response.ok || !data.checkoutUrl) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }

      // Full navigation to an external domain (Stripe Checkout) — next/navigation's
      // router is for internal routes only, so this is the correct API.
      redirectTo(data.checkoutUrl);
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  if (slots.length === 0) {
    return (
      <p className="text-center text-muted">
        No open times right now — check back soon, or{" "}
        <a href="/contact" className="text-accent underline-offset-4 hover:underline">
          reach out directly
        </a>
        .
      </p>
    );
  }

  return (
    <div>
      <div className="mb-8">
        <label
          htmlFor="sessionTypeFilter"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Session type
        </label>
        <select
          id="sessionTypeFilter"
          value={sessionTypeFilter}
          onChange={(e) => {
            setSessionTypeFilter(e.target.value);
            setSelectedSlotId(null);
          }}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        >
          <option value="">All types</option>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      {!selectedSlot ? (
        <div className="space-y-2">
          {filteredSlots.length === 0 ? (
            <p className="text-muted">No open times for that session type.</p>
          ) : (
            filteredSlots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setSelectedSlotId(slot.id)}
                className="block w-full border border-border px-4 py-3 text-left transition-colors hover:border-accent"
              >
                <span className="text-foreground">
                  {formatTimeRange(slot.start_time, slot.end_time)}
                </span>
                <span className="ml-3 text-xs uppercase tracking-[0.15em] text-muted">
                  {slot.session_type}
                </span>
              </button>
            ))
          )}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="border border-border p-4">
            <p className="text-sm text-foreground">
              {formatTimeRange(selectedSlot.start_time, selectedSlot.end_time)}{" "}
              — {selectedSlot.session_type}
            </p>
            <button
              type="button"
              onClick={() => setSelectedSlotId(null)}
              className="mt-2 text-xs uppercase tracking-[0.15em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
            >
              Choose a different time
            </button>
          </div>

          <div>
            <label
              htmlFor="clientName"
              className="block text-xs uppercase tracking-[0.15em] text-muted"
            >
              Name
            </label>
            <input
              id="clientName"
              required
              value={form.clientName}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, clientName: e.target.value }));
                setError("");
              }}
              className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
          </div>

          <div>
            <label
              htmlFor="clientEmail"
              className="block text-xs uppercase tracking-[0.15em] text-muted"
            >
              Email
            </label>
            <input
              id="clientEmail"
              type="email"
              required
              value={form.clientEmail}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, clientEmail: e.target.value }));
                setError("");
              }}
              className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
          </div>

          <div>
            <label
              htmlFor="notes"
              className="block text-xs uppercase tracking-[0.15em] text-muted"
            >
              Notes (optional)
            </label>
            <textarea
              id="notes"
              rows={3}
              value={form.notes}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, notes: e.target.value }))
              }
              className="mt-2 w-full resize-none border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
          </div>

          {error && <p className="text-sm text-red-700">{error}</p>}

          <button
            type="submit"
            disabled={status === "loading"}
            className="w-full border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "loading" ? "Starting checkout…" : "Continue to payment"}
          </button>
        </form>
      )}
    </div>
  );
}
