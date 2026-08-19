"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/format";
import AppointmentTypeForm from "./AppointmentTypeForm";

export type AppointmentType = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  uses_boudoir_reminder: boolean;
  color: string;
  active: boolean;
  sort_order: number;
  created_at: string;
};

function ArchiveToggle({ appointmentType }: { appointmentType: AppointmentType }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleToggle() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(
        `/api/admin/appointment-types/${appointmentType.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: !appointmentType.active }),
        },
      );

      if (!response.ok) {
        const data: { error?: string } = await response
          .json()
          .catch(() => ({}));
        setError(data.error ?? "Failed.");
        return;
      }

      router.refresh();
    } catch {
      setError("Failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleToggle}
        disabled={pending}
        className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending
          ? "Working…"
          : appointmentType.active
            ? "Archive"
            : "Activate"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

export default function AppointmentTypeList({
  initialTypes,
}: {
  initialTypes: AppointmentType[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8">
      {creating ? (
        <AppointmentTypeForm
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          New type
        </button>
      )}

      {initialTypes.length === 0 ? (
        <p className="text-muted">No appointment types yet.</p>
      ) : (
        <div className="border-t border-border">
          {initialTypes.map((appointmentType) =>
            editingId === appointmentType.id ? (
              <div
                key={appointmentType.id}
                className="border-b border-border/60 py-6"
              >
                <AppointmentTypeForm
                  appointmentType={appointmentType}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div
                key={appointmentType.id}
                className={`flex items-center justify-between gap-4 border-b border-border/60 py-4 ${
                  appointmentType.active ? "" : "opacity-50"
                }`}
              >
                <div className="flex items-center gap-4">
                  <span
                    aria-hidden
                    className="h-3 w-3 shrink-0 rounded-full border border-border"
                    style={{ backgroundColor: appointmentType.color }}
                  />
                  <div>
                    <p className="text-foreground">
                      {appointmentType.name}
                      {!appointmentType.active && (
                        <span className="ml-2 text-xs uppercase tracking-[0.15em] text-muted">
                          Archived
                        </span>
                      )}
                    </p>
                    <p className="text-sm text-muted">
                      {appointmentType.duration_minutes}min @{" "}
                      {formatCents(appointmentType.price_cents)}
                      {appointmentType.requires_payment
                        ? " · payment required"
                        : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setEditingId(appointmentType.id)}
                    className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    Edit
                  </button>
                  <ArchiveToggle appointmentType={appointmentType} />
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
