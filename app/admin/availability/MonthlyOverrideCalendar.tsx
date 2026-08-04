"use client";

import { useEffect, useState } from "react";
import DayOverrideEditor from "./DayOverrideEditor";

type DayHours = { startTime: string; endTime: string } | null;

type DayData = {
  date: string; // "YYYY-MM-DD"
  hours: DayHours;
  hasOverride: boolean;
  blockedCount: number;
};

type Status = "loading" | "idle" | "error";

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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

export default function MonthlyOverrideCalendar() {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1); // 1-based
  const [days, setDays] = useState<DayData[]>([]);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const monthParam = `${year}-${String(month).padStart(2, "0")}`;
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  const leadingBlanks = new Date(year, month - 1, 1).getDay();

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      setError("");
      try {
        const response = await fetch(
          `/api/admin/availability-overrides?month=${monthParam}`,
        );
        const data: { days?: DayData[]; error?: string } = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setError(data.error ?? "Couldn't load calendar.");
          setStatus("error");
          return;
        }

        setDays(data.days ?? []);
        setStatus("idle");
      } catch {
        if (!cancelled) {
          setError("Couldn't load calendar.");
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [monthParam, reloadToken]);

  function goToPreviousMonth() {
    setSelectedDate(null);
    if (month === 1) {
      setYear((y) => y - 1);
      setMonth(12);
    } else {
      setMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    setSelectedDate(null);
    if (month === 12) {
      setYear((y) => y + 1);
      setMonth(1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  function handleSaved() {
    setSelectedDate(null);
    setReloadToken((t) => t + 1);
  }

  const selectedDay = days.find((d) => d.date === selectedDate) ?? null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          onClick={goToPreviousMonth}
          aria-label="Previous month"
          className="px-2 py-1 text-muted transition-colors hover:text-foreground"
        >
          &larr;
        </button>
        <p className="font-serif text-xl italic text-foreground">{monthLabel}</p>
        <button
          type="button"
          onClick={goToNextMonth}
          aria-label="Next month"
          className="px-2 py-1 text-muted transition-colors hover:text-foreground"
        >
          &rarr;
        </button>
      </div>

      {error && <p className="mb-4 text-xs text-red-700">{error}</p>}

      {status === "loading" && days.length === 0 ? (
        <p className="text-muted">Loading calendar…</p>
      ) : (
        <div className="grid grid-cols-7 gap-px border border-border bg-border text-sm">
          {WEEKDAY_LABELS.map((label) => (
            <div
              key={label}
              className="bg-background px-2 py-2 text-center text-xs uppercase tracking-[0.15em] text-muted"
            >
              {label}
            </div>
          ))}

          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} className="min-h-[88px] bg-background" />
          ))}

          {days.map((day) => (
            <button
              key={day.date}
              type="button"
              onClick={() =>
                setSelectedDate((current) => (current === day.date ? null : day.date))
              }
              className={`min-h-[88px] bg-background p-2 text-left transition-colors hover:bg-foreground/5 ${
                selectedDate === day.date ? "ring-2 ring-inset ring-accent" : ""
              }`}
            >
              <p className="text-xs text-muted">{Number(day.date.slice(-2))}</p>
              <p
                className={`mt-1 text-xs ${
                  day.hours ? "text-foreground" : "text-muted"
                }`}
              >
                {formatHours(day.hours)}
              </p>
              {day.hasOverride && (
                <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-accent">
                  Override
                </p>
              )}
              {day.blockedCount > 0 && (
                <p className="mt-1 text-xs text-accent underline underline-offset-2">
                  {day.blockedCount} blocked time{day.blockedCount === 1 ? "" : "s"}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {selectedDate && (
        <div className="mt-8">
          <DayOverrideEditor
            date={selectedDate}
            initialHours={selectedDay?.hours ?? null}
            hasOverride={selectedDay?.hasOverride ?? false}
            onSaved={handleSaved}
            onCancel={() => setSelectedDate(null)}
          />
        </div>
      )}
    </div>
  );
}
