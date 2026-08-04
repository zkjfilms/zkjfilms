"use client";

import { useEffect, useState } from "react";
import WeeklyHoursEditor from "./WeeklyHoursEditor";
import MonthlyOverrideCalendar from "./MonthlyOverrideCalendar";
import SchedulingLimitsForm from "./SchedulingLimitsForm";

type Tab = "hours" | "limits";

// Two-tab modal (mirrors the Acuity reference's "Availability" dialog):
// Tab 1 stacks the recurring weekly template (Task 4) above the per-date
// override calendar (Task 5) — both manage their own fetch/save state, this
// component only decides which is visible. Tab 2 is the scheduling-limits
// singleton form (Task 7). Fully prop-controlled (`open`/`onClose`) so the
// parent page owns when it's mounted.
export default function AvailabilityEditor({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>("hours");
  // Tracks the `open` value as of the last render so we can detect a
  // closed->open transition and reset to the first tab. Adjusted during
  // render (React's documented pattern for resetting state without an
  // effect) rather than in a useEffect, since this component stays mounted
  // across opens/closes and a synchronous setState in an effect body would
  // trigger a needless extra render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setTab("hours");
  }

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-10 sm:py-16"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit availability and limits"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-3xl border border-border bg-background p-6 sm:p-10"
      >
        <div className="mb-8 flex items-start justify-between">
          <h2 className="font-serif text-2xl italic text-foreground">
            Availability &amp; limits
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

        <div role="tablist" className="mb-8 flex gap-6 border-b border-border">
          <button
            type="button"
            role="tab"
            onClick={() => setTab("hours")}
            aria-selected={tab === "hours"}
            className={`border-b-2 pb-3 text-xs uppercase tracking-[0.2em] transition-colors ${
              tab === "hours"
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Set hours of availability
          </button>
          <button
            type="button"
            role="tab"
            onClick={() => setTab("limits")}
            aria-selected={tab === "limits"}
            className={`border-b-2 pb-3 text-xs uppercase tracking-[0.2em] transition-colors ${
              tab === "limits"
                ? "border-accent text-foreground"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            Scheduling limits
          </button>
        </div>

        {tab === "hours" ? (
          <div className="space-y-10">
            <WeeklyHoursEditor />
            <div className="border-t border-border pt-10">
              <p className="mb-4 text-xs uppercase tracking-[0.15em] text-muted">
                Date overrides
              </p>
              <MonthlyOverrideCalendar />
            </div>
          </div>
        ) : (
          <SchedulingLimitsForm />
        )}
      </div>
    </div>
  );
}
