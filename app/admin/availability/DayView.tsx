"use client";

import { useEffect, useState } from "react";
import { BUSINESS_TIME_ZONE } from "@/lib/scheduling";

type Status = "loading" | "idle" | "error";

type ResolvedHours = { startTime: string; endTime: string } | null;

type BookingRow = {
  id: string;
  client_name: string;
  start_time: string; // timestamptz
  end_time: string;
  appointment_type_id: string;
  status: "pending" | "confirmed" | "canceled";
};

type BlockedTimeRow = {
  id: string;
  start_time: string; // "HH:MM:SS"
  end_time: string;
  reason: string | null;
};

type OpenSlot = { startTime: string; endTime: string }; // "HH:MM"

type DayViewResponse = {
  hours: ResolvedHours;
  bookings: BookingRow[];
  blockedTimes: BlockedTimeRow[];
  openSlots: OpenSlot[];
  error?: string;
};

type AppointmentType = { id: string; name: string; active: boolean };

// "HH:MM:SS" or "HH:MM" -> "9:00am"
function formatClockTime(time: string): string {
  const [hoursStr, minutesStr] = time.split(":");
  const hours24 = Number(hoursStr);
  const period = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutesStr}${period}`;
}

// Bookings carry real timestamptz values; render them in the business
// timezone rather than the admin's browser timezone so the day view always
// matches what WeeklyHoursEditor/DayOverrideEditor mean by "9am".
function formatBookingTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// Renders bookings, blocked times, and computed open slots for a single
// date side by side, sourced from the combined GET /api/admin/day-view
// endpoint (one round trip instead of three). `refreshKey` lets a parent
// (e.g. after Block Off Time saves) force a refetch without this component
// needing to know why.
export default function DayView({
  date,
  refreshKey,
}: {
  date: string; // "YYYY-MM-DD"
  refreshKey?: number;
}) {
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([]);
  const [appointmentTypeId, setAppointmentTypeId] = useState<string>("");
  const [data, setData] = useState<DayViewResponse | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");

  // Load appointment types once, used to pick which duration/buffers drive
  // the open-slot computation.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/admin/appointment-types");
        const result: { appointmentTypes?: AppointmentType[] } = await response.json();
        if (cancelled || !response.ok) return;
        const types = result.appointmentTypes ?? [];
        setAppointmentTypes(types);
        setAppointmentTypeId((current) => {
          if (current) return current;
          const firstActive = types.find((t) => t.active) ?? types[0];
          return firstActive ? firstActive.id : "";
        });
      } catch {
        // Non-fatal: the day view still works without open-slot computation.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError("");
      try {
        const params = new URLSearchParams({ date });
        if (appointmentTypeId) params.set("appointmentTypeId", appointmentTypeId);
        const response = await fetch(`/api/admin/day-view?${params.toString()}`);
        const result: DayViewResponse = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setError(result.error ?? "Couldn't load the day view.");
          setStatus("error");
          return;
        }

        setData(result);
        setStatus("idle");
      } catch {
        if (!cancelled) {
          setError("Couldn't load the day view.");
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [date, appointmentTypeId, refreshKey]);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <p className="font-serif text-xl italic text-foreground">{formatDateLabel(date)}</p>
        <div className="flex items-center gap-2">
          <label
            htmlFor="day-view-appointment-type"
            className="text-xs uppercase tracking-[0.15em] text-muted"
          >
            Open slots for
          </label>
          <select
            id="day-view-appointment-type"
            value={appointmentTypeId}
            onChange={(e) => setAppointmentTypeId(e.target.value)}
            className="border-b border-border bg-transparent py-1 text-sm text-foreground outline-none focus:border-accent"
          >
            {appointmentTypes.length === 0 && <option value="">No appointment types</option>}
            {appointmentTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="mb-4 text-xs text-red-700">{error}</p>}

      {status === "loading" && !data ? (
        <p className="text-muted">Loading day view…</p>
      ) : !data ? null : (
        <>
          <p className="mb-6 text-sm text-muted">
            Hours:{" "}
            <span className="text-foreground">
              {data.hours
                ? `${formatClockTime(data.hours.startTime)}–${formatClockTime(data.hours.endTime)}`
                : "Closed"}
            </span>
          </p>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-3">
            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.15em] text-muted">
                Bookings ({data.bookings.length})
              </p>
              {data.bookings.length === 0 ? (
                <p className="text-sm text-muted">No bookings.</p>
              ) : (
                <ul className="space-y-3">
                  {data.bookings.map((booking) => (
                    <li key={booking.id} className="border border-border p-3 text-sm">
                      <p className="text-foreground">{booking.client_name}</p>
                      <p className="text-muted">
                        {formatBookingTime(booking.start_time)}–
                        {formatBookingTime(booking.end_time)}
                      </p>
                      <p className="text-xs uppercase tracking-[0.1em] text-accent">
                        {booking.status}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.15em] text-muted">
                Blocked times ({data.blockedTimes.length})
              </p>
              {data.blockedTimes.length === 0 ? (
                <p className="text-sm text-muted">None.</p>
              ) : (
                <ul className="space-y-3">
                  {data.blockedTimes.map((blocked) => (
                    <li key={blocked.id} className="border border-border p-3 text-sm">
                      <p className="text-foreground">
                        {formatClockTime(blocked.start_time)}–{formatClockTime(blocked.end_time)}
                      </p>
                      {blocked.reason && <p className="text-muted">{blocked.reason}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <p className="mb-3 text-xs uppercase tracking-[0.15em] text-muted">
                Open slots ({data.openSlots.length})
              </p>
              {data.openSlots.length === 0 ? (
                <p className="text-sm text-muted">
                  {appointmentTypeId ? "No open slots." : "Choose an appointment type."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {data.openSlots.map((slot) => (
                    <li key={slot.startTime} className="text-sm text-foreground">
                      {formatClockTime(slot.startTime)}–{formatClockTime(slot.endTime)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
