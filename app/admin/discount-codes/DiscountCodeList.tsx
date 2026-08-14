"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/format";
import type { DiscountCode } from "@/lib/discountCodes";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import DiscountCodeForm from "./DiscountCodeForm";

function formatValue(discountCode: DiscountCode): string {
  return discountCode.type === "percentage"
    ? `${discountCode.value}% off`
    : `${formatCents(discountCode.value)} off`;
}

function formatApplicability(discountCode: DiscountCode, appointmentTypes: AppointmentType[]): string {
  if (!discountCode.appointment_type_ids || discountCode.appointment_type_ids.length === 0) {
    return "All appointment types";
  }
  const names = discountCode.appointment_type_ids
    .map((id) => appointmentTypes.find((t) => t.id === id)?.name)
    .filter((name): name is string => Boolean(name));
  return names.length > 0 ? names.join(", ") : "All appointment types";
}

function ActiveToggle({ discountCode }: { discountCode: DiscountCode }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleToggle() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/discount-codes/${discountCode.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !discountCode.active }),
      });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
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
        {pending ? "Working…" : discountCode.active ? "Deactivate" : "Activate"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function DeleteButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/discount-codes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to delete.");
        setConfirming(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to delete.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-3 text-xs">
        <button
          type="button"
          onClick={handleDelete}
          disabled={pending}
          className="text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending ? "Deleting…" : "Confirm delete"}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="text-muted hover:text-foreground disabled:opacity-50"
        >
          Cancel
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-red-700 hover:underline"
    >
      Delete
    </button>
  );
}

export default function DiscountCodeList({
  initialCodes,
  appointmentTypes,
}: {
  initialCodes: DiscountCode[];
  appointmentTypes: AppointmentType[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8">
      {creating ? (
        <DiscountCodeForm
          appointmentTypes={appointmentTypes}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          New code
        </button>
      )}

      {initialCodes.length === 0 ? (
        <p className="text-muted">No discount codes yet.</p>
      ) : (
        <div className="border-t border-border">
          {initialCodes.map((discountCode) =>
            editingId === discountCode.id ? (
              <div key={discountCode.id} className="border-b border-border/60 py-6">
                <DiscountCodeForm
                  discountCode={discountCode}
                  appointmentTypes={appointmentTypes}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            ) : (
              <div
                key={discountCode.id}
                className={`flex items-center justify-between gap-4 border-b border-border/60 py-4 ${
                  discountCode.active ? "" : "opacity-50"
                }`}
              >
                <div>
                  <p className="text-foreground">
                    {discountCode.code}
                    {!discountCode.active && (
                      <span className="ml-2 text-xs uppercase tracking-[0.15em] text-muted">
                        Inactive
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted">
                    {formatValue(discountCode)} · {formatApplicability(discountCode, appointmentTypes)}
                    {discountCode.expires_at
                      ? ` · expires ${new Date(discountCode.expires_at).toLocaleDateString("en-US")}`
                      : ""}
                    {discountCode.max_redemptions
                      ? ` · ${discountCode.redemption_count}/${discountCode.max_redemptions} used`
                      : ` · ${discountCode.redemption_count} used`}
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <button
                    type="button"
                    onClick={() => setEditingId(discountCode.id)}
                    className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    Edit
                  </button>
                  <ActiveToggle discountCode={discountCode} />
                  <DeleteButton id={discountCode.id} />
                </div>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
