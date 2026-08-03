"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { SESSION_TYPES } from "@/lib/leads";

type Status = "idle" | "loading" | "error";

const EMPTY_FORM = {
  date: "",
  startTime: "",
  endTime: "",
  sessionType: "",
  depositDollars: "",
};

export default function AddSlotForm() {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY_FORM);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    // Combined and converted here, in the browser — new Date() with no
    // timezone suffix parses against the browser's local time, which is
    // the right behavior for a single-timezone (Central) local business
    // as long as whoever's managing availability is browsing from there.
    const startTime = new Date(`${form.date}T${form.startTime}`);
    const endTime = new Date(`${form.date}T${form.endTime}`);

    if (
      Number.isNaN(startTime.getTime()) ||
      Number.isNaN(endTime.getTime()) ||
      endTime <= startTime
    ) {
      setError("End time must be after start time.");
      setStatus("error");
      return;
    }

    const depositCents = Math.round(Number(form.depositDollars) * 100);
    if (!Number.isFinite(depositCents) || depositCents <= 0) {
      setError("Enter a valid deposit amount.");
      setStatus("error");
      return;
    }

    try {
      const response = await fetch("/api/admin/availability", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          sessionType: form.sessionType,
          depositCents,
        }),
      });

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setForm(EMPTY_FORM);
      setStatus("idle");
      router.refresh();
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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor="date"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Date
          </label>
          <input
            id="date"
            name="date"
            type="date"
            required
            value={form.date}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="startTime"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Start
          </label>
          <input
            id="startTime"
            name="startTime"
            type="time"
            required
            value={form.startTime}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="endTime"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            End
          </label>
          <input
            id="endTime"
            name="endTime"
            type="time"
            required
            value={form.endTime}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div>
        <label
          htmlFor="sessionType"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Session type
        </label>
        <select
          id="sessionType"
          name="sessionType"
          required
          value={form.sessionType}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        >
          <option value="" disabled>
            Select one
          </option>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label
          htmlFor="depositDollars"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Deposit ($)
        </label>
        <input
          id="depositDollars"
          name="depositDollars"
          type="number"
          min="0"
          step="0.01"
          required
          value={form.depositDollars}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <button
        type="submit"
        disabled={status === "loading"}
        className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
      >
        {status === "loading" ? "Adding…" : "Add slot"}
      </button>
    </form>
  );
}
