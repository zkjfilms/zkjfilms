"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "./AppointmentTypeList";

type Status = "idle" | "loading" | "error";

const DEFAULT_COLOR = "#4f46e5";

function toFormState(appointmentType: AppointmentType | null) {
  if (!appointmentType) {
    return {
      name: "",
      durationMinutes: "30",
      bufferBeforeMinutes: "0",
      bufferAfterMinutes: "0",
      priceDollars: "",
      requiresPayment: false,
      color: DEFAULT_COLOR,
    };
  }
  return {
    name: appointmentType.name,
    durationMinutes: String(appointmentType.duration_minutes),
    bufferBeforeMinutes: String(appointmentType.buffer_before_minutes),
    bufferAfterMinutes: String(appointmentType.buffer_after_minutes),
    priceDollars: (appointmentType.price_cents / 100).toString(),
    requiresPayment: appointmentType.requires_payment,
    color: appointmentType.color,
  };
}

export default function AppointmentTypeForm({
  appointmentType = null,
  onDone,
  onCancel,
}: {
  appointmentType?: AppointmentType | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [form, setForm] = useState(() => toFormState(appointmentType));
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState("");

  const isEditing = appointmentType !== null;

  function handleChange(
    e: ChangeEvent<HTMLInputElement>,
  ) {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    const durationMinutes = Number(form.durationMinutes);
    const bufferBeforeMinutes = Number(form.bufferBeforeMinutes);
    const bufferAfterMinutes = Number(form.bufferAfterMinutes);
    const priceCents = Math.round(Number(form.priceDollars) * 100);

    if (!form.name.trim()) {
      setError("Enter a name.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      setError("Enter a valid duration.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(bufferBeforeMinutes) || bufferBeforeMinutes < 0) {
      setError("Enter a valid buffer before.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(bufferAfterMinutes) || bufferAfterMinutes < 0) {
      setError("Enter a valid buffer after.");
      setStatus("error");
      return;
    }
    if (!Number.isFinite(priceCents) || priceCents < 0) {
      setError("Enter a valid price.");
      setStatus("error");
      return;
    }

    const body = {
      name: form.name.trim(),
      durationMinutes,
      bufferBeforeMinutes,
      bufferAfterMinutes,
      priceCents,
      requiresPayment: form.requiresPayment,
      color: form.color,
    };

    try {
      const response = await fetch(
        isEditing
          ? `/api/admin/appointment-types/${appointmentType.id}`
          : "/api/admin/appointment-types",
        {
          method: isEditing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data: { error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setStatus("error");
        return;
      }

      setStatus("idle");
      router.refresh();
      onDone();
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
      <div>
        <label
          htmlFor="name"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          value={form.name}
          onChange={handleChange}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label
            htmlFor="durationMinutes"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Duration (min)
          </label>
          <input
            id="durationMinutes"
            name="durationMinutes"
            type="number"
            min="1"
            step="1"
            required
            value={form.durationMinutes}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="bufferBeforeMinutes"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Buffer before (min)
          </label>
          <input
            id="bufferBeforeMinutes"
            name="bufferBeforeMinutes"
            type="number"
            min="0"
            step="1"
            required
            value={form.bufferBeforeMinutes}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="bufferAfterMinutes"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Buffer after (min)
          </label>
          <input
            id="bufferAfterMinutes"
            name="bufferAfterMinutes"
            type="number"
            min="0"
            step="1"
            required
            value={form.bufferAfterMinutes}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label
            htmlFor="priceDollars"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Price ($)
          </label>
          <input
            id="priceDollars"
            name="priceDollars"
            type="number"
            min="0"
            step="0.01"
            required
            value={form.priceDollars}
            onChange={handleChange}
            className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
        <div>
          <label
            htmlFor="color"
            className="block text-xs uppercase tracking-[0.15em] text-muted"
          >
            Color
          </label>
          <input
            id="color"
            name="color"
            type="color"
            value={form.color}
            onChange={handleChange}
            className="mt-2 h-10 w-full border border-border bg-transparent"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-foreground">
        <input
          type="checkbox"
          name="requiresPayment"
          checked={form.requiresPayment}
          onChange={handleChange}
          className="h-4 w-4 border-border accent-accent"
        />
        Requires payment at booking
      </label>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "loading"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Saving…" : isEditing ? "Save changes" : "Create type"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={status === "loading"}
          className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
