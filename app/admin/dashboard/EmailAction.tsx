"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EmailAction({
  id,
  emailSent,
}: {
  id: string;
  emailSent: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function handleSend() {
    setPending(true);
    setError("");

    try {
      const response = await fetch(`/api/admin/contracts/${id}/send-email`, {
        method: "POST",
      });

      if (!response.ok) {
        const data: { error?: string } = await response
          .json()
          .catch(() => ({}));
        setError(data.error ?? "Failed to send.");
        return;
      }

      router.refresh();
    } catch {
      setError("Failed to send.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className={emailSent ? "text-muted" : "text-red-700"}>
        {emailSent ? "Sent" : "Not sent"}
      </span>
      <button
        type="button"
        onClick={handleSend}
        disabled={pending}
        className="text-left text-xs text-accent underline-offset-4 transition-colors hover:underline disabled:opacity-50"
      >
        {pending ? "Sending…" : emailSent ? "Resend" : "Send"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}
