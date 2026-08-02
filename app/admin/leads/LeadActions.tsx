"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leads";

export default function LeadActions({
  id,
  status,
  notes,
}: {
  id: string;
  status: LeadStatus;
  notes: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [notesValue, setNotesValue] = useState(notes ?? "");
  const [error, setError] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  async function patchLead(body: { status?: string; notes?: string }) {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data: { error?: string } = await response
          .json()
          .catch(() => ({}));
        setError(data.error ?? "Failed to update lead.");
        return;
      }

      router.refresh();
    } catch {
      setError("Failed to update lead.");
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/leads/${id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const data: { error?: string } = await response
          .json()
          .catch(() => ({}));
        setError(data.error ?? "Failed to delete lead.");
        setConfirmingDelete(false);
        return;
      }

      router.refresh();
    } catch {
      setError("Failed to delete lead.");
      setConfirmingDelete(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex min-w-[160px] flex-col gap-2">
      <select
        value={status}
        disabled={pending}
        onChange={(e) => patchLead({ status: e.target.value })}
        className="border-b border-border bg-transparent py-1 text-sm text-foreground outline-none focus:border-accent disabled:opacity-50"
      >
        {LEAD_STATUSES.map((s) => (
          <option key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <input
        type="text"
        placeholder="Notes…"
        value={notesValue}
        disabled={pending}
        onChange={(e) => setNotesValue(e.target.value)}
        onBlur={() => {
          if (notesValue !== (notes ?? "")) patchLead({ notes: notesValue });
        }}
        className="border-b border-border bg-transparent py-1 text-xs text-muted outline-none focus:border-accent disabled:opacity-50"
      />

      {error && <p className="text-xs text-red-700">{error}</p>}

      {confirmingDelete ? (
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
            onClick={() => setConfirmingDelete(false)}
            disabled={pending}
            className="text-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirmingDelete(true)}
          disabled={pending}
          className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-red-700 hover:underline disabled:opacity-50"
        >
          Delete
        </button>
      )}
    </div>
  );
}
