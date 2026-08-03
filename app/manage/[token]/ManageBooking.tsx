"use client";

import { useState } from "react";
import { formatTimeRange, formatCents } from "@/lib/format";

type Slot = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
};

type Booking = {
  id: string;
  start_time: string;
  end_time: string;
  session_type: string;
  client_name: string | null;
  client_email: string | null;
};

type View = "idle" | "rescheduling" | "cancelling" | "cancelled";

export default function ManageBooking({
  token,
  booking,
  otherSlots,
}: {
  token: string;
  booking: Booking;
  otherSlots: Slot[];
}) {
  const [view, setView] = useState<View>("idle");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [cancelResult, setCancelResult] = useState<{
    refundStatus: "refunded" | "partial_refund" | "no_refund" | "failed";
    refundAmountCents: number;
  } | null>(null);

  async function handleReschedule() {
    if (!selectedSlotId || pending) return;
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/manage/${token}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSlotId: selectedSlotId }),
      });

      const data: {
        error?: string;
        freeSwap?: boolean;
        checkoutUrl?: string;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }

      if (data.freeSwap) {
        window.location.reload();
        return;
      }

      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
        return;
      }

      setError("Something went wrong. Please try again.");
      setPending(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  async function handleCancel() {
    if (pending) return;
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/manage/${token}/cancel`, {
        method: "POST",
      });

      const data: {
        error?: string;
        refundStatus?: "refunded" | "partial_refund" | "no_refund" | "failed";
        refundAmountCents?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setPending(false);
        return;
      }

      setCancelResult({
        refundStatus: data.refundStatus ?? "no_refund",
        refundAmountCents: data.refundAmountCents ?? 0,
      });
      setView("cancelled");
      setPending(false);
    } catch {
      setError("Something went wrong. Please try again.");
      setPending(false);
    }
  }

  if (view === "cancelled" && cancelResult) {
    const refundLine =
      cancelResult.refundStatus === "refunded"
        ? `A full refund of ${formatCents(cancelResult.refundAmountCents)} is on its way.`
        : cancelResult.refundStatus === "partial_refund"
          ? `A partial refund of ${formatCents(cancelResult.refundAmountCents)} is on its way.`
          : cancelResult.refundStatus === "no_refund"
            ? "Per our cancellation policy, this booking wasn't eligible for a refund."
            : "We're processing your refund and will follow up shortly.";

    return (
      <div className="border border-accent/40 bg-surface p-6 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Cancelled
        </p>
        <h2 className="mt-2 font-serif text-2xl italic text-foreground">
          Your session has been cancelled.
        </h2>
        <p className="mt-4 text-sm text-muted">{refundLine}</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <div className="border border-border p-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Current appointment
        </p>
        <p className="mt-2 text-lg text-foreground">
          {booking.session_type} —{" "}
          {formatTimeRange(booking.start_time, booking.end_time)}
        </p>
      </div>

      {error && <p className="text-sm text-red-700">{error}</p>}

      {view === "idle" && (
        <div className="flex flex-wrap gap-4">
          <button
            type="button"
            onClick={() => setView("rescheduling")}
            className="border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            Reschedule
          </button>
          <button
            type="button"
            onClick={() => setView("cancelling")}
            className="border border-border px-6 py-3 text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:border-red-700 hover:text-red-700"
          >
            Cancel
          </button>
        </div>
      )}

      {view === "rescheduling" && (
        <div>
          <p className="mb-4 text-xs uppercase tracking-[0.15em] text-muted">
            Choose a new time
          </p>
          {otherSlots.length === 0 ? (
            <p className="text-muted">
              No other open times right now for {booking.session_type} —
              check back soon.
            </p>
          ) : (
            <div className="space-y-2">
              {otherSlots.map((slot) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => setSelectedSlotId(slot.id)}
                  className={`block w-full border px-4 py-3 text-left transition-colors ${
                    selectedSlotId === slot.id
                      ? "border-accent"
                      : "border-border hover:border-accent"
                  }`}
                >
                  {formatTimeRange(slot.start_time, slot.end_time)}
                </button>
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-muted">
            Rescheduling less than 72 hours before your current
            appointment incurs a $50 fee, charged before the change takes
            effect. 72 hours or more out, it&rsquo;s free.
          </p>

          <div className="mt-6 flex gap-4">
            <button
              type="button"
              onClick={handleReschedule}
              disabled={!selectedSlotId || pending}
              className="border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Working…" : "Confirm reschedule"}
            </button>
            <button
              type="button"
              onClick={() => {
                setView("idle");
                setSelectedSlotId(null);
                setError("");
              }}
              disabled={pending}
              className="text-xs uppercase tracking-[0.15em] text-muted hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {view === "cancelling" && (
        <div>
          <p className="text-sm text-foreground">
            Cancellation refunds your deposit based on notice given: full
            refund at 7+ days out, 50% at 3–7 days, and no refund inside
            3 days.
          </p>
          <div className="mt-6 flex gap-4">
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="border border-red-700 px-6 py-3 text-xs uppercase tracking-[0.2em] text-red-700 transition-colors hover:bg-red-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Working…" : "Confirm cancellation"}
            </button>
            <button
              type="button"
              onClick={() => {
                setView("idle");
                setError("");
              }}
              disabled={pending}
              className="text-xs uppercase tracking-[0.15em] text-muted hover:text-foreground disabled:opacity-50"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
