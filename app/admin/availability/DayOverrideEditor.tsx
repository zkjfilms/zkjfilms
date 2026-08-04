"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";

type Mode = "regular" | "custom" | "closed";
type Status = "idle" | "saving" | "error";

const DEFAULT_START = "09:00";
const DEFAULT_END = "17:00";

// Supabase returns "HH:MM:SS"; <input type="time"> wants "HH:MM".
function toInputTime(value: string): string {
  return value.slice(0, 5);
}

function initialMode(
  hasOverride: boolean,
  hours: { startTime: string; endTime: string } | null,
): Mode {
  if (!hasOverride) return "regular";
  return hours ? "custom" : "closed";
}

function formatDateLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function DayOverrideEditor({
  date,
  initialHours = null,
  hasOverride = false,
  onSaved,
  onCancel,
}: {
  date: string; // "YYYY-MM-DD"
  // The resolved hours and override state for this date, as of the
  // parent calendar's last fetch — used only to pick a sensible
  // starting selection. Both are optional so this component also works
  // mounted standalone with just a date.
  initialHours?: { startTime: string; endTime: string } | null;
  hasOverride?: boolean;
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<Mode>(() => initialMode(hasOverride, initialHours));
  const [startTime, setStartTime] = useState(
    initialHours ? toInputTime(initialHours.startTime) : DEFAULT_START,
  );
  const [endTime, setEndTime] = useState(
    initialHours ? toInputTime(initialHours.endTime) : DEFAULT_END,
  );
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    let body: Record<string, unknown>;
    if (mode === "regular") {
      body = { clear: true };
    } else if (mode === "closed") {
      body = { isClosed: true };
    } else {
      if (!startTime || !endTime || endTime <= startTime) {
        setError("End time must be after start time.");
        setStatus("error");
        return;
      }
      body = { isClosed: false, startTime: `${startTime}:00`, endTime: `${endTime}:00` };
    }

    setStatus("saving");

    try {
      const response = await fetch(
        `/api/admin/availability-overrides?date=${date}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data: { error?: string } = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("idle");
      onSaved();
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-4 border border-border p-6"
    >
      <p className="text-xs uppercase tracking-[0.15em] text-muted">
        {formatDateLabel(date)}
      </p>

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="mode"
            value="regular"
            checked={mode === "regular"}
            onChange={() => setMode("regular")}
            className="h-4 w-4 border-border accent-accent"
          />
          Use regular hours
        </label>

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="mode"
            value="custom"
            checked={mode === "custom"}
            onChange={() => setMode("custom")}
            className="h-4 w-4 border-border accent-accent"
          />
          Custom hours
        </label>
        {mode === "custom" && (
          <div className="ml-6 flex flex-wrap items-center gap-4">
            <input
              type="time"
              value={startTime}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)}
              className="border-b border-border bg-transparent py-1 text-foreground outline-none focus:border-accent"
            />
            <span className="text-muted">to</span>
            <input
              type="time"
              value={endTime}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEndTime(e.target.value)}
              className="border-b border-border bg-transparent py-1 text-foreground outline-none focus:border-accent"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="mode"
            value="closed"
            checked={mode === "closed"}
            onChange={() => setMode("closed")}
            className="h-4 w-4 border-border accent-accent"
          />
          Closed
        </label>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "saving"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={status === "saving"}
            className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
