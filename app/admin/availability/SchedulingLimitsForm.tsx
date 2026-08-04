"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type Status = "loading" | "idle" | "saving" | "error";

type DailyCapMode = "unlimited" | "capped";

type LimitsResponse = {
  min_notice_hours: number;
  max_advance_days: number;
  cancel_reschedule_notice_hours: number;
  daily_cap: number | null;
  start_time_interval_minutes: number;
};

type FormState = {
  minNoticeHours: string;
  maxAdvanceDays: string;
  cancelRescheduleNoticeHours: string;
  dailyCapMode: DailyCapMode;
  dailyCap: string;
  startTimeIntervalMinutes: string;
};

function toFormState(limits: LimitsResponse): FormState {
  return {
    minNoticeHours: String(limits.min_notice_hours),
    maxAdvanceDays: String(limits.max_advance_days),
    cancelRescheduleNoticeHours: String(limits.cancel_reschedule_notice_hours),
    dailyCapMode: limits.daily_cap === null ? "unlimited" : "capped",
    dailyCap: limits.daily_cap === null ? "" : String(limits.daily_cap),
    startTimeIntervalMinutes: String(limits.start_time_interval_minutes),
  };
}

// Tab 2 of the availability editor assembled in Task 8. Standalone here:
// fetches the single scheduling_limits row on mount and PUTs the whole row
// back on submit, same controlled-form/status pattern as
// AppointmentTypeForm and WeeklyHoursEditor.
export default function SchedulingLimitsForm() {
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/admin/scheduling-limits");
        const data: { limits?: LimitsResponse; error?: string } = await response.json();
        if (cancelled) return;

        if (!response.ok || !data.limits) {
          setError(data.error ?? "Couldn't load scheduling limits.");
          setStatus("error");
          return;
        }

        setForm(toFormState(data.limits));
        setStatus("idle");
      } catch {
        if (!cancelled) {
          setError("Couldn't load scheduling limits.");
          setStatus("error");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
  }

  function handleDailyCapModeChange(mode: DailyCapMode) {
    setForm((prev) => (prev ? { ...prev, dailyCapMode: mode } : prev));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form) return;

    setSaved(false);
    setError("");

    const minNoticeHours = Number(form.minNoticeHours);
    const maxAdvanceDays = Number(form.maxAdvanceDays);
    const cancelRescheduleNoticeHours = Number(form.cancelRescheduleNoticeHours);
    const startTimeIntervalMinutes = Number(form.startTimeIntervalMinutes);
    const dailyCap = form.dailyCapMode === "unlimited" ? null : Number(form.dailyCap);

    if (!Number.isFinite(minNoticeHours) || minNoticeHours < 0) {
      setError("Enter a valid minimum notice.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(maxAdvanceDays) || maxAdvanceDays < 1) {
      setError("Enter a valid maximum advance.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(cancelRescheduleNoticeHours) || cancelRescheduleNoticeHours < 0) {
      setError("Enter a valid cancel/reschedule notice.");
      setStatus("error");
      return;
    }
    if (dailyCap !== null && (!Number.isFinite(dailyCap) || dailyCap < 1)) {
      setError("Enter a valid daily cap, or choose accept until fully booked.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(startTimeIntervalMinutes) || startTimeIntervalMinutes < 5) {
      setError("Enter a valid start-time interval (at least 5 minutes).");
      setStatus("error");
      return;
    }

    setStatus("saving");

    const body = {
      minNoticeHours,
      maxAdvanceDays,
      cancelRescheduleNoticeHours,
      dailyCap,
      startTimeIntervalMinutes,
    };

    try {
      const response = await fetch("/api/admin/scheduling-limits", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data: { limits?: LimitsResponse; error?: string } = await response.json();

      if (!response.ok || !data.limits) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setForm(toFormState(data.limits));
      setStatus("idle");
      setSaved(true);
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  if (status === "loading" || !form) {
    return <p className="text-muted">Loading scheduling limits…</p>;
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-lg space-y-4 border border-border p-6"
    >
      <div>
        <label
          htmlFor="minNoticeHours"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Minimum notice (hours)
        </label>
        <input
          id="minNoticeHours"
          name="minNoticeHours"
          type="number"
          min="0"
          step="1"
          required
          value={form.minNoticeHours}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          How far ahead a client must book — no last-minute appointments inside this window.
        </p>
      </div>

      <div>
        <label
          htmlFor="maxAdvanceDays"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Maximum advance (days)
        </label>
        <input
          id="maxAdvanceDays"
          name="maxAdvanceDays"
          type="number"
          min="1"
          step="1"
          required
          value={form.maxAdvanceDays}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          How far into the future clients can book.
        </p>
      </div>

      <div>
        <label
          htmlFor="cancelRescheduleNoticeHours"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Cancel / reschedule notice (hours)
        </label>
        <input
          id="cancelRescheduleNoticeHours"
          name="cancelRescheduleNoticeHours"
          type="number"
          min="0"
          step="1"
          required
          value={form.cancelRescheduleNoticeHours}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          How much notice a client must give to cancel or reschedule an existing booking.
        </p>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <span className="block text-xs uppercase tracking-[0.15em] text-muted">
          Bookings per day
        </span>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="dailyCapMode"
            checked={form.dailyCapMode === "unlimited"}
            onChange={() => handleDailyCapModeChange("unlimited")}
            className="h-4 w-4 border-border accent-accent"
          />
          Accept until fully booked
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="radio"
            name="dailyCapMode"
            checked={form.dailyCapMode === "capped"}
            onChange={() => handleDailyCapModeChange("capped")}
            className="h-4 w-4 border-border accent-accent"
          />
          Max per day
        </label>
        {form.dailyCapMode === "capped" && (
          <input
            id="dailyCap"
            name="dailyCap"
            type="number"
            min="1"
            step="1"
            required
            value={form.dailyCap}
            onChange={handleChange}
            placeholder="e.g. 3"
            className="mt-1 w-full max-w-[8rem] border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        )}
      </div>

      <div>
        <label
          htmlFor="startTimeIntervalMinutes"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Start-time interval (minutes)
        </label>
        <input
          id="startTimeIntervalMinutes"
          name="startTimeIntervalMinutes"
          type="number"
          min="5"
          step="1"
          required
          value={form.startTimeIntervalMinutes}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
        <p className="mt-1 text-xs text-muted">
          Offered start times will fall on this interval, e.g. every 30 minutes.
        </p>
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}
      {saved && !error && <p className="text-xs text-accent">Saved.</p>}

      <button
        type="submit"
        disabled={status === "saving"}
        className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Save scheduling limits"}
      </button>
    </form>
  );
}
