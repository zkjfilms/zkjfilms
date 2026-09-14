"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  start_time: string;
  status: string;
};

type LineItem = { description: string; amount: string };

type BookingMode = "none" | "existing" | "new";

export default function InvoiceForm({
  appointmentTypes,
  bookings,
  onDone,
  onCancel,
}: {
  appointmentTypes: AppointmentType[];
  bookings: BookingOption[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [bookingMode, setBookingMode] = useState<BookingMode>("none");
  const [bookingSearch, setBookingSearch] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [newBookingAppointmentTypeId, setNewBookingAppointmentTypeId] = useState("");
  const [newBookingDate, setNewBookingDate] = useState("");
  const [newBookingTime, setNewBookingTime] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", amount: "" }]);
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const filteredBookings = bookings.filter((b) => {
    const q = bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return b.client_name.toLowerCase().includes(q) || b.client_email.toLowerCase().includes(q);
  });

  function updateLineItem(index: number, field: keyof LineItem, value: string) {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  }

  function addLineItem() {
    setLineItems((prev) => [...prev, { description: "", amount: "" }]);
  }

  function removeLineItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setStatus("loading");
    setError("");

    if (!clientName.trim() || !clientEmail.trim()) {
      setError("Enter a client name and email.");
      setStatus("error");
      return;
    }

    const nonEmptyLineItems = lineItems.filter(
      (item) => item.description.trim() || item.amount.trim(),
    );

    if (nonEmptyLineItems.length === 0) {
      setError("Add at least one line item with a description and amount.");
      setStatus("error");
      return;
    }

    const parsedLineItems: { description: string; amountCents: number }[] = [];
    for (const item of nonEmptyLineItems) {
      const amount = Number(item.amount);
      if (!item.description.trim() || !Number.isFinite(amount) || amount <= 0) {
        setError("Every line item needs a description and a valid amount.");
        setStatus("error");
        return;
      }
      parsedLineItems.push({ description: item.description.trim(), amountCents: Math.round(amount * 100) });
    }

    if (bookingMode === "new" && (!newBookingAppointmentTypeId || !newBookingDate || !newBookingTime)) {
      setError("Fill out the new booking's appointment type, date, and time.");
      setStatus("error");
      return;
    }

    if (bookingMode === "existing" && !selectedBookingId) {
      setError('Select a booking to link, or choose "None".');
      setStatus("error");
      return;
    }

    try {
      let bookingId: string | null = null;

      if (bookingMode === "existing") {
        bookingId = selectedBookingId || null;
      } else if (bookingMode === "new") {
        const bookingResponse = await fetch("/api/admin/bookings", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointmentTypeId: newBookingAppointmentTypeId,
            date: newBookingDate,
            startTime: newBookingTime,
            clientName: clientName.trim(),
            clientEmail: clientEmail.trim(),
            clientPhone: "",
            notes: "",
          }),
        });
        const bookingData: { booking?: { id: string }; error?: string } = await bookingResponse.json();
        if (!bookingResponse.ok) {
          setError(bookingData.error ?? "Failed to create the booking.");
          setStatus("error");
          return;
        }
        bookingId = bookingData.booking?.id ?? null;
      }

      const response = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          bookingId,
          lineItems: parsedLineItems,
          dueDate: dueDate || null,
        }),
      });
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
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4 border border-border p-6">
      <div>
        <label htmlFor="clientName" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Client name
        </label>
        <input
          id="clientName"
          type="text"
          required
          value={clientName}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setClientName(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        <label htmlFor="clientEmail" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Client email
        </label>
        <input
          id="clientEmail"
          type="email"
          required
          value={clientEmail}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setClientEmail(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">Booking</p>
        <div className="flex gap-4 text-sm text-foreground">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === "none"}
              onChange={() => setBookingMode("none")}
              className="h-4 w-4 border-border accent-accent"
            />
            None
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === "existing"}
              onChange={() => setBookingMode("existing")}
              className="h-4 w-4 border-border accent-accent"
            />
            Link existing
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="bookingMode"
              checked={bookingMode === "new"}
              onChange={() => setBookingMode("new")}
              className="h-4 w-4 border-border accent-accent"
            />
            Create new
          </label>
        </div>

        {bookingMode === "existing" && (
          <div className="mt-3 space-y-2">
            <input
              type="text"
              placeholder="Search by name or email"
              value={bookingSearch}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setBookingSearch(e.target.value)}
              className="w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
            <select
              value={selectedBookingId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedBookingId(e.target.value)}
              className="w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            >
              <option value="">Select a booking</option>
              {filteredBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.client_name} — {new Date(b.start_time).toLocaleString("en-US")}
                </option>
              ))}
            </select>
          </div>
        )}

        {bookingMode === "new" && (
          <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <select
              value={newBookingAppointmentTypeId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setNewBookingAppointmentTypeId(e.target.value)}
              className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            >
              <option value="">Appointment type</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newBookingDate}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewBookingDate(e.target.value)}
              className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
            <input
              type="time"
              value={newBookingTime}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewBookingTime(e.target.value)}
              className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            />
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">Line items</p>
        <div className="space-y-3">
          {lineItems.map((item, index) => (
            <div key={index} className="flex items-center gap-3">
              <input
                type="text"
                placeholder="Description"
                value={item.description}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateLineItem(index, "description", e.target.value)}
                className="flex-1 border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
              />
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="Amount ($)"
                value={item.amount}
                onChange={(e: ChangeEvent<HTMLInputElement>) => updateLineItem(index, "amount", e.target.value)}
                className="w-32 border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
              />
              {lineItems.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeLineItem(index)}
                  className="text-xs text-muted underline-offset-4 transition-colors hover:text-red-700 hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={addLineItem}
          className="mt-3 text-xs text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Add line item
        </button>
      </div>

      <div>
        <label htmlFor="dueDate" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Due date (optional — defaults to 30 days)
        </label>
        <input
          id="dueDate"
          type="date"
          value={dueDate}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setDueDate(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      {error && <p className="text-xs text-red-700">{error}</p>}

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={status === "loading"}
          className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : "Send invoice"}
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
