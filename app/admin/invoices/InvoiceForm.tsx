"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { AppointmentType } from "@/app/admin/appointment-types/AppointmentTypeList";
import { addMinutesToTime, businessLocalToUtcIso } from "@/lib/scheduling";
import { formatTimeRange } from "@/lib/format";

type BookingOption = {
  id: string;
  client_name: string;
  client_email: string;
  client_phone: string | null;
  start_time: string;
  end_time: string;
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
  const [phone, setPhone] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressPostalCode, setAddressPostalCode] = useState("");
  const [sessionDateTime, setSessionDateTime] = useState("");
  const [bookingMode, setBookingMode] = useState<BookingMode>("none");
  const [bookingSearch, setBookingSearch] = useState("");
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [newBookingAppointmentTypeId, setNewBookingAppointmentTypeId] = useState("");
  const [newBookingDate, setNewBookingDate] = useState("");
  const [newBookingTime, setNewBookingTime] = useState("");
  const [notes, setNotes] = useState("");
  const [pricingAppointmentTypeId, setPricingAppointmentTypeId] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: "", amount: "" }]);
  const [dueDate, setDueDate] = useState("");
  const [conflictWarning, setConflictWarning] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  const filteredBookings = bookings.filter((b) => {
    const q = bookingSearch.trim().toLowerCase();
    if (!q) return true;
    return b.client_name.toLowerCase().includes(q) || b.client_email.toLowerCase().includes(q);
  });

  // "Link existing": selecting a booking fills in what's already known about
  // that client — still editable afterward. Adjusted during render (not in an effect)
  // per React's own guidance for syncing state when a prop/selection changes —
  // avoids the extra render an effect-based sync would cause, and the lint rule
  // that flags setState inside effects for exactly this reason. The key folds in
  // bookingMode (empty string whenever this mode isn't active) so leaving and
  // re-entering "existing" — even with the same booking still selected — re-syncs,
  // matching what a bookingMode-dependent effect would have done. Initializing the
  // synced-key state from the current key (not a sentinel that can never match)
  // avoids a harmless-but-wasteful first render.
  const existingKey = bookingMode === "existing" ? selectedBookingId : "";
  const [syncedExistingKey, setSyncedExistingKey] = useState(existingKey);
  if (existingKey !== syncedExistingKey) {
    setSyncedExistingKey(existingKey);
    const booking = bookingMode === "existing" ? bookings.find((b) => b.id === existingKey) : undefined;
    if (booking) {
      setClientName(booking.client_name);
      setClientEmail(booking.client_email);
      setPhone(booking.client_phone ?? "");
      setSessionDateTime(formatTimeRange(booking.start_time, booking.end_time));
    }
  }

  // "Create new": recompute the session date/time display string whenever the
  // new booking's appointment type, date, or time changes, or when re-entering
  // this mode (same bookingMode-folding rationale as above). Uses the same
  // duration + timezone helpers the admin-booking-creation endpoint itself
  // uses, so the displayed range matches what actually gets booked — except
  // addMinutesToTime doesn't wrap past 24:00 (e.g. "23:00" + 120 minutes
  // returns "25:00", not "01:00"), which would make businessLocalToUtcIso
  // build an invalid Date and throw. Skip the auto-fill rather than crash the
  // form in that case; the admin can still type the session time in by hand.
  const newBookingKey =
    bookingMode === "new" ? `${newBookingAppointmentTypeId}|${newBookingDate}|${newBookingTime}` : "";
  const [syncedNewBookingKey, setSyncedNewBookingKey] = useState(newBookingKey);
  if (newBookingKey !== syncedNewBookingKey) {
    setSyncedNewBookingKey(newBookingKey);
    if (bookingMode === "new" && newBookingAppointmentTypeId && newBookingDate && newBookingTime) {
      const type = appointmentTypes.find((t) => t.id === newBookingAppointmentTypeId);
      if (type) {
        const endTime = addMinutesToTime(newBookingTime, type.duration_minutes);
        const [endHours] = endTime.split(":").map(Number);
        if (endHours < 24) {
          const startIso = businessLocalToUtcIso(newBookingDate, newBookingTime);
          const endIso = businessLocalToUtcIso(newBookingDate, endTime);
          setSessionDateTime(formatTimeRange(startIso, endIso));
        }
      }
    }
  }

  // Appointment-type-driven line-item auto-fill: fires whenever the relevant
  // appointment-type selection changes — the "Create new" mode dropdown
  // above (reused for this second purpose) or the standalone pricing-only
  // dropdown rendered near Line Items in "None"/"Link existing" modes.
  // Deliberately keyed only on the appointment-type id, not date/time, so
  // changing the date in "Create new" mode doesn't re-trigger a price
  // overwrite. Same render-time-sync pattern as the two blocks above; only
  // ever touches line item 0, leaving any additional line items alone.
  const priceAppointmentTypeId = bookingMode === "new" ? newBookingAppointmentTypeId : pricingAppointmentTypeId;
  const [syncedPriceAppointmentTypeId, setSyncedPriceAppointmentTypeId] = useState(priceAppointmentTypeId);
  if (priceAppointmentTypeId !== syncedPriceAppointmentTypeId) {
    setSyncedPriceAppointmentTypeId(priceAppointmentTypeId);
    const type = appointmentTypes.find((t) => t.id === priceAppointmentTypeId);
    if (type) {
      setLineItems((prev) => {
        const next = [...prev];
        next[0] = { description: type.name, amount: (type.price_cents / 100).toFixed(2) };
        return next;
      });
    }
  }

  // Non-blocking heads-up for "Create new" mode: since the slot is no longer
  // held while the invoice is unpaid, check whether the picked time already
  // has a confirmed/pending booking, so the admin isn't caught by surprise
  // later — informational only, never blocks submission. The trigger key
  // resets the warning during render (same pattern as the sync blocks
  // above) whenever the underlying selection changes, so leaving "Create
  // new" mode or clearing a field clears the warning immediately with no
  // extra render. The actual network fetch below still needs a real
  // useEffect — it's reaching out to an external system — but its body
  // never calls setState synchronously (only inside the async .then()),
  // since ESLint's react-hooks/set-state-in-effect rule flags any
  // synchronous setState directly in an effect body, even ones that are
  // just resetting to a default before async work starts.
  const conflictCheckKey =
    bookingMode === "new" ? `${newBookingAppointmentTypeId}|${newBookingDate}|${newBookingTime}` : "";
  const [syncedConflictCheckKey, setSyncedConflictCheckKey] = useState(conflictCheckKey);
  if (conflictCheckKey !== syncedConflictCheckKey) {
    setSyncedConflictCheckKey(conflictCheckKey);
    setConflictWarning(false);
  }

  useEffect(() => {
    if (bookingMode !== "new" || !newBookingAppointmentTypeId || !newBookingDate || !newBookingTime) {
      return;
    }
    const type = appointmentTypes.find((t) => t.id === newBookingAppointmentTypeId);
    if (!type) return;
    const endTime = addMinutesToTime(newBookingTime, type.duration_minutes);
    const [endHours] = endTime.split(":").map(Number);
    if (endHours >= 24) return;
    const startIso = businessLocalToUtcIso(newBookingDate, newBookingTime);
    const endIso = businessLocalToUtcIso(newBookingDate, endTime);
    let cancelled = false;
    fetch(`/api/admin/day-view?date=${newBookingDate}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { bookings?: { start_time: string; end_time: string }[] | null } | null) => {
        if (cancelled || !data?.bookings) return;
        const overlaps = data.bookings.some(
          (b) => new Date(b.start_time) < new Date(endIso) && new Date(b.end_time) > new Date(startIso),
        );
        setConflictWarning(overlaps);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bookingMode, newBookingAppointmentTypeId, newBookingDate, newBookingTime, appointmentTypes]);

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

    if (sessionDateTime.length > 140) {
      setError("Session date & time must be 140 characters or fewer.");
      setStatus("error");
      return;
    }

    if (phone.trim().length > 32) {
      setError("Phone must be 32 characters or fewer.");
      setStatus("error");
      return;
    }

    if (notes.trim().length > 450) {
      setError("Notes must be 450 characters or fewer.");
      setStatus("error");
      return;
    }

    if (
      addressLine1.trim().length > 100 ||
      addressCity.trim().length > 100 ||
      addressState.trim().length > 100 ||
      addressPostalCode.trim().length > 100
    ) {
      setError("Billing address fields must be 100 characters or fewer.");
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

    const billingAddress =
      addressLine1.trim() || addressCity.trim() || addressState.trim() || addressPostalCode.trim()
        ? {
            line1: addressLine1.trim(),
            city: addressCity.trim(),
            state: addressState.trim(),
            postalCode: addressPostalCode.trim(),
          }
        : null;

    let bookingId: string | null = null;
    let newBooking: {
      appointmentTypeId: string;
      date: string;
      startTime: string;
      clientPhone: string;
      notes: string;
    } | null = null;

    if (bookingMode === "existing") {
      bookingId = selectedBookingId || null;
    } else if (bookingMode === "new") {
      newBooking = {
        appointmentTypeId: newBookingAppointmentTypeId,
        date: newBookingDate,
        startTime: newBookingTime,
        clientPhone: phone.trim(),
        notes: notes.trim(),
      };
    }

    try {
      const response = await fetch("/api/admin/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: clientName.trim(),
          clientEmail: clientEmail.trim(),
          bookingId,
          newBooking,
          lineItems: parsedLineItems,
          dueDate: dueDate || null,
          sessionDateTime: sessionDateTime.trim() || null,
          clientPhone: phone.trim() || null,
          billingAddress,
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
        <label htmlFor="phone" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Phone (optional)
        </label>
        <input
          id="phone"
          type="tel"
          value={phone}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPhone(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        <p className="mb-2 block text-xs uppercase tracking-[0.15em] text-muted">Billing address (optional)</p>
        <input
          type="text"
          placeholder="Address line 1"
          value={addressLine1}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressLine1(e.target.value)}
          className="mb-3 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <input
            type="text"
            placeholder="City"
            value={addressCity}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressCity(e.target.value)}
            className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="State"
            value={addressState}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressState(e.target.value)}
            className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
          <input
            type="text"
            placeholder="ZIP"
            value={addressPostalCode}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAddressPostalCode(e.target.value)}
            className="border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
          />
        </div>
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
          <div className="mt-3 space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
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
            {conflictWarning && (
              <p className="text-xs text-amber-700">⚠ This time already has a booking.</p>
            )}
            <div>
              <label htmlFor="notes" className="block text-xs uppercase tracking-[0.15em] text-muted">
                Notes (optional)
              </label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setNotes(e.target.value)}
                rows={2}
                maxLength={450}
                className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
              />
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="sessionDateTime" className="block text-xs uppercase tracking-[0.15em] text-muted">
          Session date &amp; time (shown on invoice)
        </label>
        <input
          id="sessionDateTime"
          type="text"
          value={sessionDateTime}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setSessionDateTime(e.target.value)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
        />
      </div>

      <div>
        {bookingMode !== "new" && (
          <div className="mb-3">
            <label htmlFor="pricingAppointmentType" className="block text-xs uppercase tracking-[0.15em] text-muted">
              Appointment type (optional — auto-fills a line item)
            </label>
            <select
              id="pricingAppointmentType"
              value={pricingAppointmentTypeId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setPricingAppointmentTypeId(e.target.value)}
              className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none focus:border-accent"
            >
              <option value="">Select appointment type</option>
              {appointmentTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
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
