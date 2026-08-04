"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import BlockOffTimePanel from "./BlockOffTimePanel";
import AvailabilityEditor from "./AvailabilityEditor";
import DayView from "./DayView";

type DayHours = { startTime: string; endTime: string } | null;

type DayData = {
  date: string; // "YYYY-MM-DD"
  hours: DayHours;
  hasOverride: boolean;
  blockedCount: number;
};

type WeekStatus = "loading" | "idle" | "error";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function todayIsoDate(): string {
  return toIsoDate(new Date());
}

function toIsoDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// The 7 dates (Sun-Sat) of the week `weekOffset` weeks away from the
// current one.
function weekDatesFor(weekOffset: number): string[] {
  const today = new Date();
  const sunday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay());
  sunday.setDate(sunday.getDate() + weekOffset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(sunday);
    d.setDate(sunday.getDate() + i);
    return toIsoDate(d);
  });
}

// "09:00:00" -> "9:00am"
function formatClockTime(time: string): string {
  const [hoursStr, minutesStr] = time.split(":");
  const hours24 = Number(hoursStr);
  const period = hours24 >= 12 ? "pm" : "am";
  const hours12 = hours24 % 12 || 12;
  return `${hours12}:${minutesStr}${period}`;
}

function formatHours(hours: DayHours): string {
  if (!hours) return "Closed";
  return `${formatClockTime(hours.startTime)}–${formatClockTime(hours.endTime)}`;
}

function formatWeekLabel(dates: string[]): string {
  const start = new Date(`${dates[0]}T00:00:00`);
  const end = new Date(`${dates[6]}T00:00:00`);
  // Always include the month on both ends — Intl.DateTimeFormat with only
  // {day, year} (no month) renders oddly (e.g. "2026 (day: 8)") in Node's
  // ICU data, so there's no safe way to omit it even when both dates share
  // a month.
  const startLabel = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const endLabel = end.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${startLabel} – ${endLabel}`;
}

// Reuses the Task 5 monthly-override endpoint (GET
// /api/admin/availability-overrides?month=YYYY-MM) rather than adding a new
// week-shaped endpoint: it already returns exactly {date, hours,
// hasOverride, blockedCount} for every day it's asked about, which is all
// the weekly strip needs, and a week almost always fits in one month. When
// a week straddles a month boundary (e.g. Jan 28 - Feb 3) this fetches both
// months and merges — cheap given each request is a handful of rows.
async function loadWeek(dates: string[]): Promise<DayData[]> {
  const months = Array.from(new Set(dates.map((d) => d.slice(0, 7))));
  const responses = await Promise.all(
    months.map((month) =>
      fetch(`/api/admin/availability-overrides?month=${month}`).then((r) => r.json()),
    ),
  );
  const byDate = new Map<string, DayData>();
  for (const response of responses as { days?: DayData[] }[]) {
    for (const day of response.days ?? []) {
      byDate.set(day.date, day);
    }
  }
  return dates.map(
    (date) => byDate.get(date) ?? { date, hours: null, hasOverride: false, blockedCount: 0 },
  );
}

export default function AvailabilityOverviewClient() {
  const [weekOffset, setWeekOffset] = useState(0);
  const [weekDays, setWeekDays] = useState<DayData[]>([]);
  const [weekStatus, setWeekStatus] = useState<WeekStatus>("loading");
  const [selectedDate, setSelectedDate] = useState(todayIsoDate());
  const [blockOffOpen, setBlockOffOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const dates = weekDatesFor(weekOffset);
  const datesKey = dates.join(",");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setWeekStatus("loading");
      try {
        const days = await loadWeek(dates);
        if (cancelled) return;
        setWeekDays(days);
        setWeekStatus("idle");
      } catch {
        if (!cancelled) setWeekStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // dates is derived from weekOffset each render; datesKey captures its
    // identity so this only reruns when the actual week (or a save
    // elsewhere) changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datesKey, refreshKey]);

  function handleDateInputChange(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.value) setSelectedDate(e.target.value);
  }

  return (
    <div>
      <div className="mb-10 flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setBlockOffOpen(true)}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Block off time
        </button>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="text-xs uppercase tracking-[0.2em] text-muted underline underline-offset-4 transition-colors hover:text-foreground"
        >
          Edit availability / limits
        </button>
      </div>

      <section className="mb-12">
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w - 1)}
            aria-label="Previous week"
            className="px-2 py-1 text-muted transition-colors hover:text-foreground"
          >
            &larr;
          </button>
          <div className="text-center">
            <p className="font-serif text-xl italic text-foreground">{formatWeekLabel(dates)}</p>
            {weekOffset !== 0 && (
              <button
                type="button"
                onClick={() => setWeekOffset(0)}
                className="text-xs uppercase tracking-[0.15em] text-accent underline underline-offset-4"
              >
                Back to this week
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setWeekOffset((w) => w + 1)}
            aria-label="Next week"
            className="px-2 py-1 text-muted transition-colors hover:text-foreground"
          >
            &rarr;
          </button>
        </div>

        {weekStatus === "loading" && weekDays.length === 0 ? (
          <p className="text-muted">Loading week…</p>
        ) : weekStatus === "error" ? (
          <p className="text-xs text-red-700">Couldn&rsquo;t load this week.</p>
        ) : (
          <div className="grid grid-cols-1 gap-px border border-border bg-border text-sm sm:grid-cols-7">
            {dates.map((date, i) => {
              const day = weekDays.find((d) => d.date === date);
              const isToday = date === todayIsoDate();
              return (
                <button
                  key={date}
                  type="button"
                  onClick={() => setSelectedDate(date)}
                  className={`min-h-[96px] bg-background p-3 text-left transition-colors hover:bg-foreground/5 ${
                    selectedDate === date ? "ring-2 ring-inset ring-accent" : ""
                  }`}
                >
                  <p className="text-xs uppercase tracking-[0.1em] text-muted">
                    {WEEKDAY_LABELS[i]}
                    {isToday && <span className="ml-1 text-accent">&bull;</span>}
                  </p>
                  <p className="mt-1 text-xs text-muted">{Number(date.slice(-2))}</p>
                  <p className={`mt-1 text-xs ${day?.hours ? "text-foreground" : "text-muted"}`}>
                    {formatHours(day?.hours ?? null)}
                  </p>
                  {day?.hasOverride && (
                    <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-accent">
                      Override
                    </p>
                  )}
                  {day && day.blockedCount > 0 && (
                    <p className="mt-1 text-[10px] text-accent">
                      {day.blockedCount} blocked
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label
            htmlFor="day-view-date"
            className="text-xs uppercase tracking-[0.15em] text-muted"
          >
            Jump to date
          </label>
          <input
            id="day-view-date"
            type="date"
            value={selectedDate}
            onChange={handleDateInputChange}
            className="border-b border-border bg-transparent py-1 text-sm text-foreground outline-none focus:border-accent"
          />
        </div>
        <DayView date={selectedDate} refreshKey={refreshKey} />
      </section>

      {blockOffOpen && (
        <BlockOffTimePanel
          initialDate={selectedDate}
          onSaved={() => setRefreshKey((k) => k + 1)}
          onClose={() => setBlockOffOpen(false)}
        />
      )}

      <AvailabilityEditor
        open={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}
