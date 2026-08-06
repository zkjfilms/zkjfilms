"use client";

import { useState } from "react";
import { formatTimeRange } from "@/lib/format";
import { BUSINESS } from "@/lib/seo";
import BookingCalendar from "@/app/book/BookingCalendar";
import SlotList, { type Slot } from "@/app/book/SlotList";

type Booking = {
  id: string;
  booking_token: string;
  appointment_type_id: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  appointment_types: {
    name: string;
    duration_minutes: number;
  } | null;
};

export default function ManageBooking({
  booking,
  withinWindow,
}: {
  booking: Booking;
  withinWindow: boolean;
}) {
  const [canceled, setCanceled] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // Reschedule stays within the booking's existing appointment type (no
  // type picker), so this only needs a date -> slot flow, same shape as
  // BookingFlow's later steps but scoped to one type from the start.
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleDate, setRescheduleDate] = useState<string | null>(null);
  const [reschedulingSubmit, setReschedulingSubmit] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);

  function startReschedule() {
    setRescheduling(true);
    setRescheduleDate(null);
    setRescheduleError(null);
  }

  function cancelReschedule() {
    setRescheduling(false);
    setRescheduleDate(null);
    setRescheduleError(null);
  }

  function changeRescheduleDate() {
    setRescheduleDate(null);
    setRescheduleError(null);
  }

  async function handleSelectRescheduleSlot(slot: Slot) {
    setReschedulingSubmit(true);
    setRescheduleError(null);
    try {
      const response = await fetch(`/api/manage/${booking.booking_token}/reschedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: rescheduleDate, startTime: slot.startTime }),
      });
      const data = await response.json();
      if (!response.ok) {
        setRescheduleError(data.error ?? "Something went wrong.");
        return;
      }
      // The token is unchanged, so /manage/[token] now shows the new time.
      window.location.reload();
    } catch {
      setRescheduleError("Something went wrong. Please try again.");
    } finally {
      setReschedulingSubmit(false);
    }
  }

  async function handleCancel() {
    setCanceling(true);
    setCancelError(null);
    try {
      const response = await fetch(`/api/manage/${booking.booking_token}/cancel`, {
        method: "POST",
      });
      const data = await response.json();
      if (!response.ok) {
        setCancelError(data.error ?? "Something went wrong.");
        return;
      }
      setCanceled(true);
    } catch {
      setCancelError("Something went wrong. Please try again.");
    } finally {
      setCanceling(false);
    }
  }

  if (canceled) {
    return (
      <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
        <header className="mb-12 text-center">
          <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Manage Booking</p>
          <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
            Booking <span className="text-accent">canceled</span>.
          </h1>
        </header>
        <div className="border border-border p-6 text-center">
          <p className="text-sm text-foreground">Your booking has been canceled.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Manage Booking</p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Your <span className="text-accent">session</span>.
        </h1>
      </header>

      <div className="space-y-10">
        <div className="border border-border p-6">
          <p className="text-xs uppercase tracking-[0.3em] text-muted">Current appointment</p>
          <p className="mt-2 text-lg text-foreground">
            {booking.appointment_types?.name ?? "Appointment"} —{" "}
            {formatTimeRange(booking.start_time, booking.end_time)}
          </p>
          {booking.notes && (
            <p className="mt-4 text-sm text-muted">
              <span className="uppercase tracking-[0.2em]">Notes:</span> {booking.notes}
            </p>
          )}
        </div>

        {withinWindow ? rescheduling ? (
          <div className="space-y-6 border border-border p-6">
            <div className="flex items-center justify-between gap-4">
              <p className="text-xs uppercase tracking-[0.3em] text-muted">
                {rescheduleDate ? "Pick a new time" : "Pick a new date"}
              </p>
              <button type="button" onClick={cancelReschedule} className="text-xs uppercase tracking-[0.15em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline">
                Cancel
              </button>
            </div>

            {rescheduleDate && (
              <div className="flex items-center justify-between gap-4 border border-border px-4 py-3">
                <span className="text-sm text-foreground">{rescheduleDate}</span>
                <button type="button" onClick={changeRescheduleDate} className="text-xs uppercase tracking-[0.15em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline">
                  Change
                </button>
              </div>
            )}

            {!rescheduleDate ? (
              <BookingCalendar
                appointmentTypeId={booking.appointment_type_id}
                onSelectDate={setRescheduleDate}
              />
            ) : (
              <SlotList
                appointmentTypeId={booking.appointment_type_id}
                date={rescheduleDate}
                onSelectSlot={handleSelectRescheduleSlot}
              />
            )}

            {reschedulingSubmit && <p className="text-xs text-muted">Rescheduling…</p>}
            {rescheduleError && <p className="text-xs text-red-700">{rescheduleError}</p>}
          </div>
        ) : (
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              onClick={startReschedule}
              className="border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
            >
              Reschedule
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={canceling}
              className="border border-border px-6 py-3 text-xs uppercase tracking-[0.2em] text-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {canceling ? "Canceling…" : "Cancel"}
            </button>
            {cancelError && <p className="w-full text-xs text-red-700">{cancelError}</p>}
          </div>
        ) : (
          <div className="border border-border p-6 text-center">
            <p className="text-sm text-foreground">
              This booking is inside our cancellation window — please contact us directly to
              make changes.
            </p>
            <div className="mt-4 flex flex-col items-center gap-2 text-sm">
              <a href={`mailto:${BUSINESS.email}`} className="text-accent hover:underline">
                {BUSINESS.email}
              </a>
              {BUSINESS.telephone && (
                <a href={`tel:${BUSINESS.telephone}`} className="text-accent hover:underline">
                  {BUSINESS.telephone}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
