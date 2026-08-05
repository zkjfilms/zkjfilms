"use client";

import { useState, type FormEvent } from "react";

type Props = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  onBack: () => void;
};

function redirectTo(url: string) {
  window.location.href = url;
}

export default function BookingForm({ appointmentTypeId, date, startTime, onBack }: Props) {
  const [form, setForm] = useState({ clientName: "", clientEmail: "", clientPhone: "", notes: "", honeypot: "" });
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentTypeId, date, startTime, ...form }),
      });
      const data: { checkoutUrl?: string | null; error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("idle");
        return;
      }
      if (data.checkoutUrl) {
        redirectTo(data.checkoutUrl);
        return;
      }
      redirectTo("/book/confirmed");
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <button type="button" onClick={onBack} className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
        Choose a different time
      </button>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Name</label>
        <input
          required
          value={form.clientName}
          onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Email</label>
        <input
          required
          type="email"
          value={form.clientEmail}
          onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Phone (optional)</label>
        <input
          value={form.clientPhone}
          onChange={(e) => setForm((p) => ({ ...p, clientPhone: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          rows={3}
          className="w-full border border-border bg-transparent p-3 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      {/* Honeypot — hidden from real visitors via CSS, not `type="hidden"`
          (some bots skip hidden inputs but still fill visible-but-offscreen ones). */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          Leave this field blank
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.honeypot}
            onChange={(e) => setForm((p) => ({ ...p, honeypot: e.target.value }))}
          />
        </label>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full border border-foreground py-3 text-xs uppercase tracking-[0.3em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
      >
        {status === "loading" ? "Please wait…" : "Confirm Booking"}
      </button>
    </form>
  );
}
