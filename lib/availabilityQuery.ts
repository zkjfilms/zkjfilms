import { getSupabaseClient } from "@/lib/supabase";
import {
  computeOpenSlots,
  resolveHoursForDate,
  type AvailabilityRule,
  type AvailabilityOverride,
  type SchedulingLimits,
} from "@/lib/scheduling";

export type AppointmentTypeRow = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  color: string;
};

export async function fetchActiveAppointmentTypes(): Promise<AppointmentTypeRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchOpenSlotsForDate(params: {
  date: string;
  appointmentType: AppointmentTypeRow;
}): Promise<ReturnType<typeof computeOpenSlots>> {
  const supabase = getSupabaseClient();
  const { date, appointmentType } = params;

  const [{ data: rules }, { data: overrides }, { data: blocked }, { data: bookings }, { data: busy }, { data: limitsRow }] =
    await Promise.all([
      supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
      supabase
        .from("availability_overrides")
        .select("date, start_time, end_time, is_closed")
        .eq("date", date),
      supabase.from("blocked_times").select("start_time, end_time").eq("date", date),
      supabase
        .from("bookings")
        .select("start_time, end_time, appointment_type_id, status")
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${date}T23:59:59Z`)
        .in("status", ["confirmed", "pending"]),
      supabase
        .from("google_busy_blocks_cache")
        .select("start_time, end_time")
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${date}T23:59:59Z`),
      supabase.from("scheduling_limits").select("*").single(),
    ]);

  if (!limitsRow) return [];

  // Bookings' own appointment type's buffers matter for exclusion, so
  // fetch the small set of distinct types referenced that day.
  const typeIds = Array.from(new Set((bookings ?? []).map((b) => b.appointment_type_id)));
  const { data: bookingTypes } = typeIds.length
    ? await supabase
        .from("appointment_types")
        .select("id, buffer_before_minutes, buffer_after_minutes")
        .in("id", typeIds)
    : { data: [] as { id: string; buffer_before_minutes: number; buffer_after_minutes: number }[] };
  const bufferById = new Map((bookingTypes ?? []).map((t) => [t.id, t]));

  const dayStartUtc = new Date(`${date}T00:00:00Z`);
  function toMinutesSinceMidnightLocal(iso: string): number {
    // Bookings are stored as UTC instants; convert to minutes-since-local-midnight
    // in the business timezone for comparison against the (local) working window.
    const d = new Date(iso);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
    return Number(parts.hour) * 60 + Number(parts.minute);
  }

  const rulesShaped: AvailabilityRule[] = (rules ?? []).map((r) => ({
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
  const overridesShaped: AvailabilityOverride[] = (overrides ?? []).map((o) => ({
    date: o.date,
    startTime: o.start_time,
    endTime: o.end_time,
    isClosed: o.is_closed,
  }));
  const limits: SchedulingLimits = {
    minNoticeHours: limitsRow.min_notice_hours,
    maxAdvanceDays: limitsRow.max_advance_days,
    dailyCap: limitsRow.daily_cap,
    startTimeIntervalMinutes: limitsRow.start_time_interval_minutes,
  };

  void dayStartUtc; // reserved for future cross-midnight handling; unused today

  return computeOpenSlots({
    date,
    now: new Date(),
    durationMinutes: appointmentType.duration_minutes,
    bufferBeforeMinutes: appointmentType.buffer_before_minutes,
    bufferAfterMinutes: appointmentType.buffer_after_minutes,
    rules: rulesShaped,
    overrides: overridesShaped,
    blockedTimes: (blocked ?? []).map((b) => ({ startTime: b.start_time, endTime: b.end_time })),
    existingBookings: (bookings ?? []).map((b) => {
      const type = bufferById.get(b.appointment_type_id);
      return {
        startMinutes: toMinutesSinceMidnightLocal(b.start_time),
        endMinutes: toMinutesSinceMidnightLocal(b.end_time),
        bufferBeforeMinutes: type?.buffer_before_minutes ?? 0,
        bufferAfterMinutes: type?.buffer_after_minutes ?? 0,
      };
    }),
    busyBlocks: (busy ?? []).map((b) => ({
      startMinutes: toMinutesSinceMidnightLocal(b.start_time),
      endMinutes: toMinutesSinceMidnightLocal(b.end_time),
    })),
    confirmedBookingsCountForDay: (bookings ?? []).filter((b) => b.status === "confirmed").length,
    limits,
  });
}

export function resolveHoursQuick(
  date: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
) {
  return resolveHoursForDate(date, rules, overrides);
}
