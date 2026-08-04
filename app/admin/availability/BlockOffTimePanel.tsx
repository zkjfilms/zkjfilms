"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";

type Status = "idle" | "saving" | "error";

const DEFAULT_START = "09:00";
const DEFAULT_END = "10:00";

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Slide-over for creating a single blocked-time entry (mirrors the Acuity
// reference). Standalone: the parent decides when to mount/unmount it and
// what date to preselect — this component owns only its own form state and
// the POST. Once mounted (e.g. from the availability overview page or a
// calendar day cell in Task 8), `onSaved` lets the parent refetch whatever
// is currently displaying blocked-time counts (the Task 5 monthly calendar,
// the Task 8 day view).
export default function BlockOffTimePanel({
  initialDate,
  onSaved,
  onClose,
}: {
  initialDate?: string; // "YYYY-MM-DD", defaults to today
  onSaved: () => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(initialDate ?? todayIsoDate());
  const [startTime, setStartTime] = useState(DEFAULT_START);
  const [endTime, setEndTime] = useState(DEFAULT_END);
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("Choose a date.");
      setStatus("error");
      return;
    }
    if (!startTime || !endTime || endTime <= startTime) {
      setError("End time must be after start time.");
      setStatus("error");
      return;
    }

    setStatus("saving");

    try {
      const response = await fetch("/api/admin/blocked-times", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          startTime: `${startTime}:00`,
          endTime: `${endTime}:00`,
          reason: reason.trim(),
        }),
      });

      const data: { error?: string } = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("idle");
      setStartTime(DEFAULT_START);
      setEndTime(DEFAULT_END);
      setReason("");
      onSaved();
    } catch {
      setError("Something went wrong. Please try again.");
      setStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Block off time"
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col overflow-y-auto border-l border-border bg-background p-6"
      >
        <div className="mb-8 flex items-center justify-between">
          <h2 className="font-serif text-2xl italic text-foreground">
            Block off time
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-2xl leading-none text-muted transition-colors hover:text-foreground"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="blocked-date"
              className="block text-xs uppercase tracking-[0.15em] text-muted"
            >
              Date
            </label>
            <input
              id="blocked-date"
              type="date"
              required
              value={date}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setDate(e.target.value)}
              className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label
                htmlFor="blocked-start"
                className="block text-xs uppercase tracking-[0.15em] text-muted"
              >
                Start
              </label>
              <input
                id="blocked-start"
                type="time"
                required
                value={startTime}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setStartTime(e.target.value)}
                className="mt-2 border-b border-border bg-transparent py-1 text-foreground outline-none focus:border-accent"
              />
            </div>
            <span className="mt-6 text-muted">to</span>
            <div>
              <label
                htmlFor="blocked-end"
                className="block text-xs uppercase tracking-[0.15em] text-muted"
              >
                End
              </label>
              <input
                id="blocked-end"
                type="time"
                required
                value={endTime}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setEndTime(e.target.value)}
                className="mt-2 border-b border-border bg-transparent py-1 text-foreground outline-none focus:border-accent"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="blocked-reason"
              className="block text-xs uppercase tracking-[0.15em] text-muted"
            >
              Reason (optional)
            </label>
            <textarea
              id="blocked-reason"
              rows={3}
              value={reason}
              onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              placeholder="Lunch, personal appointment, travel…"
              className="mt-2 w-full resize-none border border-border bg-transparent p-2 text-foreground outline-none focus:border-accent"
            />
          </div>

          {error && <p className="text-xs text-red-700">{error}</p>}

          <div className="flex items-center gap-4 pt-2">
            <button
              type="submit"
              disabled={status === "saving"}
              className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "saving" ? "Saving…" : "Block time"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={status === "saving"}
              className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
