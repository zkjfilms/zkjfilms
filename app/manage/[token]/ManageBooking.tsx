"use client";

import { formatTimeRange } from "@/lib/format";
import { BUSINESS } from "@/lib/seo";

type Booking = {
  id: string;
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

        {withinWindow ? (
          <div className="flex flex-wrap gap-4">
            <button
              type="button"
              disabled
              title="Coming soon"
              className="border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground opacity-50 disabled:cursor-not-allowed"
            >
              Reschedule
            </button>
            <button
              type="button"
              disabled
              title="Coming soon"
              className="border border-border px-6 py-3 text-xs uppercase tracking-[0.2em] text-muted opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <p className="w-full text-xs text-muted">
              Online cancellation and rescheduling are coming soon. In the meantime, contact us
              using the details below to make changes.
            </p>
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
