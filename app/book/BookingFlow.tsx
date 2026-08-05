"use client";

import { useState } from "react";
import AppointmentTypePicker, {
  type AppointmentType,
} from "./AppointmentTypePicker";
import BookingCalendar from "./BookingCalendar";
import BookingForm from "./BookingForm";
import SlotList, { type Slot } from "./SlotList";
import { formatCents } from "@/lib/format";
import { formatSlotForDisplay, BUSINESS_TIME_ZONE } from "@/lib/scheduling";

type Step = "type" | "date" | "slot" | "form";

const CHANGE_LINK_CLASS =
  "text-xs uppercase tracking-[0.15em] text-muted underline-offset-4 transition-colors hover:text-foreground hover:underline";

function formatDateLong(date: string): string {
  // Parsed as a local wall-clock date (not UTC midnight) so the weekday
  // shown matches the business-local calendar day the slots belong to.
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export default function BookingFlow() {
  const [step, setStep] = useState<Step>("type");
  const [appointmentType, setAppointmentType] =
    useState<AppointmentType | null>(null);
  const [date, setDate] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);

  function handleSelectType(type: AppointmentType) {
    setAppointmentType(type);
    setDate(null);
    setSlot(null);
    setStep("date");
  }

  function handleSelectDate(selectedDate: string) {
    setDate(selectedDate);
    setSlot(null);
    setStep("slot");
  }

  function handleSelectSlot(selectedSlot: Slot) {
    setSlot(selectedSlot);
    setStep("form");
  }

  // Going back to an earlier step clears every selection that depended on
  // it — the calendar's open dates and the slot list are both scoped to
  // the appointment type, and the slot list is scoped to the date, so a
  // stale downstream selection would no longer be valid.
  function changeType() {
    setAppointmentType(null);
    setDate(null);
    setSlot(null);
    setStep("type");
  }

  function changeDate() {
    setDate(null);
    setSlot(null);
    setStep("date");
  }

  function changeSlot() {
    setSlot(null);
    setStep("slot");
  }

  return (
    <div className="space-y-8">
      {appointmentType && step !== "type" && (
        <div className="flex items-center justify-between gap-4 border border-border px-4 py-3">
          <div className="flex items-center gap-3">
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-full border border-border"
              style={{ backgroundColor: appointmentType.color }}
            />
            <span className="text-sm text-foreground">
              {appointmentType.name} &middot;{" "}
              {appointmentType.duration_minutes} min
              {appointmentType.requires_payment
                ? ` · ${formatCents(appointmentType.price_cents)}`
                : ""}
            </span>
          </div>
          <button type="button" onClick={changeType} className={CHANGE_LINK_CLASS}>
            Change
          </button>
        </div>
      )}

      {step === "type" && (
        <AppointmentTypePicker onSelect={handleSelectType} />
      )}

      {date && (step === "slot" || step === "form") && (
        <div className="flex items-center justify-between gap-4 border border-border px-4 py-3">
          <span className="text-sm text-foreground">
            {formatDateLong(date)}
          </span>
          <button type="button" onClick={changeDate} className={CHANGE_LINK_CLASS}>
            Change
          </button>
        </div>
      )}

      {step === "date" && appointmentType && (
        <BookingCalendar
          appointmentTypeId={appointmentType.id}
          onSelectDate={handleSelectDate}
        />
      )}

      {step === "slot" && appointmentType && date && (
        <SlotList
          appointmentTypeId={appointmentType.id}
          date={date}
          onSelectSlot={handleSelectSlot}
        />
      )}

      {step === "form" && slot && date && appointmentType && (
        <div className="border border-border p-4">
          <p className="mb-6 text-sm text-foreground">
            {formatSlotForDisplay(date, slot.startTime, BUSINESS_TIME_ZONE)}
          </p>
          <BookingForm
            appointmentTypeId={appointmentType.id}
            date={date}
            startTime={slot.startTime}
            onBack={changeSlot}
          />
        </div>
      )}
    </div>
  );
}
