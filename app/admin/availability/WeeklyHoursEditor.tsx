"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type Status = "loading" | "idle" | "saving" | "error";

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

type DayState = {
  enabled: boolean;
  startTime: string; // "HH:MM", for <input type="time">
  endTime: string;
};

type RuleResponse = { day_of_week: number; start_time: string; end_time: string };

function emptyDays(): DayState[] {
  return DAY_LABELS.map(() => ({
    enabled: false,
    startTime: DEFAULT_START,
    endTime: DEFAULT_END,
  }));
}

// Supabase returns "HH:MM:SS"; <input type="time"> wants "HH:MM".
function toInputTime(value: string): string {
  return value.slice(0, 5);
}

export default function WeeklyHoursEditor() {
  const [hasRegularHours, setHasRegularHours] = useState(false);
  const [days, setDays] = useState<DayState[]>(emptyDays);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/admin/availability-rules");
        const data: { rules?: RuleResponse[]; error?: string } = await response.json();
        if (cancelled) return;

        if (!response.ok) {
          setError(data.error ?? "Couldn't load current hours.");
          setStatus("error");
          return;
        }

        const rules = data.rules ?? [];
        if (rules.length > 0) {
          setHasRegularHours(true);
          setDays((prev) => {
            const next = [...prev];
            for (const rule of rules) {
              next[rule.day_of_week] = {
                enabled: true,
                startTime: toInputTime(rule.start_time),
                endTime: toInputTime(rule.end_time),
              };
            }
            return next;
          });
        }
        setStatus("idle");
      } catch {
        if (!cancelled) {
          setError("Couldn't load current hours.");
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleDayToggle(index: number) {
    setDays((prev) =>
      prev.map((day, i) => (i === index ? { ...day, enabled: !day.enabled } : day)),
    );
  }

  function handleTimeChange(
    index: number,
    field: "startTime" | "endTime",
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const { value } = e.target;
    setDays((prev) =>
      prev.map((day, i) => (i === index ? { ...day, [field]: value } : day)),
    );
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaved(false);
    setError("");

    const enabledDays = hasRegularHours
      ? days
          .map((day, index) => ({ ...day, dayOfWeek: index }))
          .filter((day) => day.enabled)
      : [];

    for (const day of enabledDays) {
      if (!day.startTime || !day.endTime || day.endTime <= day.startTime) {
        setError(`${DAY_LABELS[day.dayOfWeek]}: end time must be after start time.`);
        setStatus("error");
        return;
      }
    }

    setStatus("saving");

    const body = enabledDays.map((day) => ({
      dayOfWeek: day.dayOfWeek,
      startTime: `${day.startTime}:00`,
      endTime: `${day.endTime}:00`,
    }));

    try {
      const response = await fetch("/api/admin/availability-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("idle");
      setSaved(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "loading") {
    return <p className="text-muted">Loading hours…</p>;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-4 border border-border p-6"
    >
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          checked={hasRegularHours}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            setHasRegularHours(e.target.checked)
          }
          className="h-4 w-4 border-border accent-accent"
        />
        I have regular hours every week
      </label>

      {hasRegularHours && (
        <div className="space-y-3 border-t border-border pt-4">
          {DAY_LABELS.map((label, index) => {
            const day = days[index];
            return (
              <div key={label} className="flex flex-wrap items-center gap-4">
                <label className="flex w-32 shrink-0 items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={day.enabled}
                    onChange={() => handleDayToggle(index)}
                    className="h-4 w-4 border-border accent-accent"
                  />
                  {label}
                </label>
                <input
                  type="time"
                  value={day.startTime}
                  disabled={!day.enabled}
                  onChange={(e) => handleTimeChange(index, "startTime", e)}
                  className="border-b border-border bg-transparent py-1 text-foreground outline-none focus:border-accent disabled:opacity-40"
                />
                <span className="text-muted">to</span>
                <input
                  type="time"
                  value={day.endTime}
                  disabled={!day.enabled}
                  onChange={(e) => handleTimeChange(index, "endTime", e)}
                  className="border-b border-border bg-transparent py-1 text-foreground outline-none focus:border-accent disabled:opacity-40"
                />
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs text-red-700">{error}</p>}
      {saved && !error && <p className="text-xs text-accent">Saved.</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Save weekly hours"}
      </button>
    </form>
  );
}
