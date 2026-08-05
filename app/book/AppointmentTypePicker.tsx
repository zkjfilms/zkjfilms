"use client";

import { useEffect, useState } from "react";
import { formatCents } from "@/lib/format";

export type AppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  color: string;
};

type Status = "loading" | "ready" | "error";

export default function AppointmentTypePicker({
  onSelect,
}: {
  onSelect: (appointmentType: AppointmentType) => void;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>(
    [],
  );

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setStatus("loading");
      try {
        const response = await fetch("/api/availability/appointment-types");
        const data: { appointmentTypes?: AppointmentType[] } =
          await response.json();
        if (cancelled) return;
        if (!response.ok || !data.appointmentTypes) {
          setStatus("error");
          return;
        }
        setAppointmentTypes(data.appointmentTypes);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === "loading") {
    return <p className="text-muted">Loading session types…</p>;
  }

  if (status === "error") {
    return (
      <p className="text-sm text-red-700">
        Couldn&apos;t load session types. Please refresh, or{" "}
        <a
          href="/contact"
          className="text-accent underline-offset-4 hover:underline"
        >
          reach out directly
        </a>
        .
      </p>
    );
  }

  if (appointmentTypes.length === 0) {
    return (
      <p className="text-muted">
        No session types are available right now — check back soon, or{" "}
        <a
          href="/contact"
          className="text-accent underline-offset-4 hover:underline"
        >
          reach out directly
        </a>
        .
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {appointmentTypes.map((appointmentType) => (
        <button
          key={appointmentType.id}
          type="button"
          onClick={() => onSelect(appointmentType)}
          className="flex w-full items-center gap-4 border border-border px-4 py-4 text-left transition-colors hover:border-accent"
        >
          <span
            aria-hidden
            className="h-3 w-3 shrink-0 rounded-full border border-border"
            style={{ backgroundColor: appointmentType.color }}
          />
          <span className="flex-1">
            <span className="block text-foreground">
              {appointmentType.name}
            </span>
            <span className="mt-1 block text-xs uppercase tracking-[0.15em] text-muted">
              {appointmentType.duration_minutes} min
              {appointmentType.requires_payment
                ? ` · ${formatCents(appointmentType.price_cents)}`
                : ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
