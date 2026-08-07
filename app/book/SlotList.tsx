"use client";

import { useEffect, useState } from "react";
import { formatSlotForDisplay, BUSINESS_TIME_ZONE } from "@/lib/scheduling";
import { subscribeToSchedulingChannel } from "@/lib/supabaseBrowser";

export type Slot = {
  startTime: string; // "HH:MM", business-local
  endTime: string;
};

type Status = "loading" | "ready" | "error";

export default function SlotList({
  appointmentTypeId,
  date,
  onSelectSlot,
}: {
  appointmentTypeId: string;
  date: string;
  onSelectSlot: (slot: Slot) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [liveKey, setLiveKey] = useState(0);

  // Only render the "(your time)" conversion when it would actually say
  // something different from the business-local time.
  const browserTimeZone =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : BUSINESS_TIME_ZONE;
  const showBrowserTime = browserTimeZone !== BUSINESS_TIME_ZONE;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const response = await fetch(
          `/api/availability/slots?appointmentTypeId=${encodeURIComponent(appointmentTypeId)}&date=${encodeURIComponent(date)}`,
        );
        const data: { slots?: Slot[] } = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.slots) {
          setStatus("error");
          return;
        }
        setSlots(data.slots);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [appointmentTypeId, date, liveKey]);

  // Refetch on any scheduling broadcast, not just ones whose payload date
  // matches this list's date. Global changes — the weekly hours template,
  // the scheduling limits — alter availability for every future date at
  // once and can only carry one date in their payload, so a date-equality
  // filter would silently drop exactly the changes that matter most.
  // BookingCalendar and the admin DayView already refetch unconditionally.
  useEffect(() => {
    const unsubscribe = subscribeToSchedulingChannel(() => {
      setLiveKey((k) => k + 1);
    });
    return unsubscribe;
  }, []);

  if (status === "loading") {
    return <p className="text-muted">Loading open times…</p>;
  }

  if (status === "error") {
    return (
      <p className="text-sm text-red-700">
        Couldn&apos;t load open times for that date. Please try again.
      </p>
    );
  }

  if (slots.length === 0) {
    return (
      <p className="text-muted">
        No open times on that date &mdash; pick another day from the
        calendar above.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {slots.map((slot) => {
        const businessTime = formatSlotForDisplay(
          date,
          slot.startTime,
          BUSINESS_TIME_ZONE,
        );
        const localTime = showBrowserTime
          ? formatSlotForDisplay(date, slot.startTime, browserTimeZone)
          : null;
        return (
          <button
            key={slot.startTime}
            type="button"
            onClick={() => onSelectSlot(slot)}
            className="block w-full border border-border px-4 py-3 text-left transition-colors hover:border-accent"
          >
            <span className="text-foreground">{businessTime}</span>
            {localTime && (
              <span className="ml-3 text-xs uppercase tracking-[0.15em] text-muted">
                {localTime} (your time)
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
