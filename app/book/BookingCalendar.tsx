"use client";

import { useEffect, useMemo, useState } from "react";
import { subscribeToSchedulingChannel } from "@/lib/supabaseBrowser";

type Status = "loading" | "ready" | "error";

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function daysInMonth(year: number, month: number): number {
  // Day 0 of the following month is the last day of this one.
  return new Date(year, month, 0).getDate();
}

function firstWeekdayOfMonth(year: number, month: number): number {
  return new Date(year, month - 1, 1).getDay();
}

export default function BookingCalendar({
  appointmentTypeId,
  onSelectDate,
}: {
  appointmentTypeId: string;
  onSelectDate: (date: string) => void;
}) {
  const today = useMemo(() => new Date(), []);
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth() + 1); // 1-indexed
  const [openDates, setOpenDates] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<Status>("loading");
  const [liveKey, setLiveKey] = useState(0);

  const monthKey = `${viewYear}-${pad(viewMonth)}`;
  const isCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth() + 1;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const response = await fetch(
          `/api/availability/dates?appointmentTypeId=${encodeURIComponent(appointmentTypeId)}&month=${encodeURIComponent(monthKey)}`,
        );
        const data: { openDates?: string[] } = await response.json();
        if (cancelled) return;
        if (!response.ok || !data.openDates) {
          setStatus("error");
          return;
        }
        setOpenDates(new Set(data.openDates));
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [appointmentTypeId, monthKey, liveKey]);

  // Any availability or booking change could affect which dates in this
  // month are open, so refetch on any broadcast rather than trying to
  // filter by date.
  useEffect(() => {
    const unsubscribe = subscribeToSchedulingChannel(() => {
      setLiveKey((k) => k + 1);
    });
    return unsubscribe;
  }, []);

  function goToPrevMonth() {
    if (isCurrentMonth) return;
    if (viewMonth === 1) {
      setViewYear((y) => y - 1);
      setViewMonth(12);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    if (viewMonth === 12) {
      setViewYear((y) => y + 1);
      setViewMonth(1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const monthLabel = new Date(viewYear, viewMonth - 1, 1).toLocaleDateString(
    "en-US",
    { month: "long", year: "numeric" },
  );

  const leadingBlanks = firstWeekdayOfMonth(viewYear, viewMonth);
  const totalDays = daysInMonth(viewYear, viewMonth);
  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: totalDays }, (_, i) => i + 1),
  ];

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={goToPrevMonth}
          disabled={isCurrentMonth}
          aria-label="Previous month"
          className="px-2 py-1 text-xs uppercase tracking-[0.15em] text-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          &larr; Prev
        </button>
        <p className="text-sm uppercase tracking-[0.15em] text-foreground">
          {monthLabel}
        </p>
        <button
          type="button"
          onClick={goToNextMonth}
          aria-label="Next month"
          className="px-2 py-1 text-xs uppercase tracking-[0.15em] text-muted transition-colors hover:text-foreground"
        >
          Next &rarr;
        </button>
      </div>

      {status === "error" ? (
        <p className="text-sm text-red-700">
          Couldn&apos;t load availability for {monthLabel}. Please try again.
        </p>
      ) : (
        <div className="grid grid-cols-7 gap-1 text-center">
          {WEEKDAY_LABELS.map((label, i) => (
            <div
              key={i}
              className="py-1 text-xs uppercase tracking-[0.1em] text-muted"
            >
              {label}
            </div>
          ))}
          {cells.map((day, i) => {
            if (day === null) return <div key={`blank-${i}`} />;
            const dateKey = toDateKey(viewYear, viewMonth, day);
            const isOpen = status === "ready" && openDates.has(dateKey);
            return isOpen ? (
              <button
                key={dateKey}
                type="button"
                onClick={() => onSelectDate(dateKey)}
                className="aspect-square border border-border text-sm text-foreground transition-colors hover:border-accent hover:bg-accent hover:text-background"
              >
                {day}
              </button>
            ) : (
              <button
                key={dateKey}
                type="button"
                disabled
                className="aspect-square border border-transparent text-sm text-muted opacity-30 disabled:cursor-not-allowed"
              >
                {day}
              </button>
            );
          })}
        </div>
      )}
      {status === "loading" && (
        <p className="mt-3 text-xs text-muted">Loading availability…</p>
      )}
    </div>
  );
}
