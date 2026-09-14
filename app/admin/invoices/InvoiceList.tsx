"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCents } from "@/lib/format";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import InvoiceForm from "./InvoiceForm";

type InvoiceLineItem = { id: string; description: string; amount_cents: number };

type Invoice = {
  id: string;
  client_name: string;
  client_email: string;
  status: "draft" | "open" | "paid" | "void" | "uncollectible";
  due_date: string | null;
  hosted_invoice_url: string | null;
  booking_id: string | null;
  invoice_line_items: InvoiceLineItem[];
};

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  status: string;
};

function invoiceTotalCents(invoice: Invoice): number {
  return invoice.invoice_line_items.reduce((sum, item) => sum + item.amount_cents, 0);
}

function VoidButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  async function handleVoid() {
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/void`, { method: "POST" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to void.");
        setConfirming(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Failed to void.");
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
          onClick={handleVoid}
          disabled={pending}
          className="text-red-700 underline-offset-4 hover:underline disabled:opacity-50"
        >
          {pending ? "Voiding…" : "Confirm void"}
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
      Void
    </button>
  );
}

function ResendButton({ invoiceId }: { invoiceId: string }) {
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function handleResend() {
    setPending(true);
    setError("");
    setSent(false);
    try {
      const response = await fetch(`/api/admin/invoices/${invoiceId}/resend`, { method: "POST" });
      if (!response.ok) {
        const data: { error?: string } = await response.json().catch(() => ({}));
        setError(data.error ?? "Failed to resend.");
        return;
      }
      setSent(true);
    } catch {
      setError("Failed to resend.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleResend}
        disabled={pending}
        className="text-left text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
      >
        {pending ? "Sending…" : sent ? "Sent!" : "Resend"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

export default function InvoiceList({
  initialInvoices,
  appointmentTypes,
  bookings,
}: {
  initialInvoices: Invoice[];
  appointmentTypes: AppointmentType[];
  bookings: BookingOption[];
}) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-8">
      {creating ? (
        <InvoiceForm
          appointmentTypes={appointmentTypes}
          bookings={bookings}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          New invoice
        </button>
      )}

      {initialInvoices.length === 0 ? (
        <p className="text-muted">No invoices yet.</p>
      ) : (
        <div className="border-t border-border">
          {initialInvoices.map((invoice) => (
            <div
              key={invoice.id}
              className="flex items-center justify-between gap-4 border-b border-border/60 py-4"
            >
              <div>
                <p className="text-foreground">
                  {invoice.client_name}
                  <span className="ml-2 text-xs uppercase tracking-[0.15em] text-muted">
                    {invoice.status}
                  </span>
                </p>
                <p className="text-sm text-muted">
                  {formatCents(invoiceTotalCents(invoice))}
                  {invoice.due_date
                    ? ` · due ${new Date(`${invoice.due_date}T00:00:00`).toLocaleDateString("en-US")}`
                    : ""}
                </p>
              </div>
              <div className="flex items-center gap-4">
                {invoice.hosted_invoice_url && (
                  <a
                    href={invoice.hosted_invoice_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
                  >
                    View
                  </a>
                )}
                {invoice.status === "open" && (
                  <>
                    <ResendButton invoiceId={invoice.id} />
                    <VoidButton invoiceId={invoice.id} />
                  </>
                )}
                {invoice.status === "draft" && <VoidButton invoiceId={invoice.id} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
