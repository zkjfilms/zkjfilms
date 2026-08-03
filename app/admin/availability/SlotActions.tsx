"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SlotActions({
  id,
  status,
}: {
  id: string;
  status: "open" | "pending" | "booked";
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const label = status === "open" ? "Delete" : "Cancel booking";

  async function handleAction() {
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/availability/${id}`, {
        method: status === "open" ? "DELETE" : "PATCH",
      });

      if (!response.ok) {
        const data: { error?: string } = await response
          .json()
          .catch(() => ({}));
        setError(data.error ?? "Failed.");
        setConfirming(false);
        return;
      }

      router.refresh();
    } catch {
      setError("Failed.");
      setConfirming(false);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {confirming ? (
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={handleAction}
            disabled={pending}
            className="text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
          >
            {pending ? "Working…" : `Confirm ${label.toLowerCase()}`}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="text-muted hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-red-700 hover:underline"
        >
          {label}
        </button>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
