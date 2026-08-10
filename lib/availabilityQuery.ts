import { getSupabaseClient } from "@/lib/supabase";
import {
  computeOpenSlots,
  resolveHoursForDate,
  businessDayUtcBounds,
  utcIsoToBusinessDate,
  type AvailabilityRule,
  type AvailabilityOverride,
  type SchedulingLimits,
} from "@/lib/scheduling";

// Bookings are stored as UTC instants; convert to minutes-since-local-midnight
// in the business timezone for comparison against the (local) working window.
function toMinutesSinceMidnightLocal(iso: string): number {
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

// A span whose end clock-time is earlier than its start clock-time crossed
// local midnight. Business hours are assumed not to cross midnight, so this
// only affects the rare display-layer edge case — the database's exclusion
// constraint on bookings.time_range remains the real backstop.
function clampEndOfDay(startMinutes: number, endMinutes: number): number {
  return endMinutes < startMinutes ? 24 * 60 : endMinutes;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const list = map.get(keyFn(item));
    if (list) list.push(item);
    else map.set(keyFn(item), [item]);
  }
  return map;
}

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

  // Bookings and the busy-block cache are timestamptz columns; filtering
  // them by "this date" must use the true UTC bounds of the business-local
  // calendar day, not `${date}T00:00:00Z`/`${date}T23:59:59Z` literals —
  // those are the wrong window whenever America/Chicago isn't UTC (e.g. a
  // 19:00 CDT booking is 00:00Z the *next* UTC day and would otherwise be
  // invisible to this date's query).
  const { startUtc, endUtc } = businessDayUtcBounds(date);

  const [
    { data: rules, error: rulesError },
    { data: overrides },
    { data: blocked },
    { data: bookings, error: bookingsError },
    { data: busy, error: busyError },
    { data: limitsRow, error: limitsError },
  ] = await Promise.all([
    supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
    supabase
      .from("availability_overrides")
      .select("date, start_time, end_time, is_closed")
      .eq("date", date),
    supabase.from("blocked_times").select("start_time, end_time").eq("date", date),
    supabase
      .from("bookings")
      .select("start_time, end_time, appointment_type_id, status, pending_expires_at")
      .gte("start_time", startUtc)
      .lt("start_time", endUtc)
      .in("status", ["confirmed", "pending"]),
    supabase
      .from("google_busy_blocks_cache")
      .select("start_time, end_time")
      .gte("start_time", startUtc)
      .lt("start_time", endUtc),
    supabase.from("scheduling_limits").select("*").single(),
  ]);

  // `rules` and `limitsRow` drive the entire computation — silently
  // defaulting either to empty/missing on a failed query would make this
  // function indistinguishable from "genuinely fully booked" when it's
  // actually "the database read failed." Let callers see the failure and
  // return a 500 instead.
  if (rulesError) throw rulesError;
  if (limitsError) throw limitsError;
  if (!limitsRow) throw new Error("scheduling_limits row not found.");

  // Same reasoning, inverted and worse: `bookings` and `busy` are the
  // obstacles. Defaulting them to [] on a failed read doesn't say "fully
  // booked," it says "everything is free" — already-booked times would be
  // offered to the next client and only the database's exclusion
  // constraint would stop the double-booking, after they'd paid.
  if (bookingsError) throw bookingsError;
  if (busyError) throw busyError;

  // A 'pending' booking is an unpaid hold; it only blocks its slot until
  // pending_expires_at. The Stripe checkout.session.expired webhook and the
  // sweep script (scripts/scheduling.mjs) both flip expired holds to
  // 'canceled', but neither is guaranteed to have run — a missed webhook
  // with no sweep scheduled would otherwise keep a dead hold blocking its
  // slot forever. Enforcing the expiry at read time makes availability
  // correct immediately, independent of any cleanup job.
  const now = Date.now();
  const activeBookings = (bookings ?? []).filter(
    (b) =>
      b.status !== "pending" ||
      b.pending_expires_at === null ||
      b.pending_expires_at === undefined ||
      new Date(b.pending_expires_at).getTime() > now,
  );

  // Bookings' own appointment type's buffers matter for exclusion, so
  // fetch the small set of distinct types referenced that day.
  const typeIds = Array.from(new Set(activeBookings.map((b) => b.appointment_type_id)));
  const { data: bookingTypes } = typeIds.length
    ? await supabase
        .from("appointment_types")
        .select("id, buffer_before_minutes, buffer_after_minutes")
        .in("id", typeIds)
    : { data: [] as { id: string; buffer_before_minutes: number; buffer_after_minutes: number }[] };
  const bufferById = new Map((bookingTypes ?? []).map((t) => [t.id, t]));

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

  return computeOpenSlots({
    date,
    now: new Date(),
    durationMinutes: appointmentType.duration_minutes,
    bufferBeforeMinutes: appointmentType.buffer_before_minutes,
    bufferAfterMinutes: appointmentType.buffer_after_minutes,
    rules: rulesShaped,
    overrides: overridesShaped,
    blockedTimes: (blocked ?? []).map((b) => ({ startTime: b.start_time, endTime: b.end_time })),
    existingBookings: activeBookings.map((b) => {
      const type = bufferById.get(b.appointment_type_id);
      const startMinutes = toMinutesSinceMidnightLocal(b.start_time);
      const endMinutes = clampEndOfDay(startMinutes, toMinutesSinceMidnightLocal(b.end_time));
      return {
        startMinutes,
        endMinutes,
        bufferBeforeMinutes: type?.buffer_before_minutes ?? 0,
        bufferAfterMinutes: type?.buffer_after_minutes ?? 0,
      };
    }),
    busyBlocks: (busy ?? []).map((b) => {
      const startMinutes = toMinutesSinceMidnightLocal(b.start_time);
      const endMinutes = clampEndOfDay(startMinutes, toMinutesSinceMidnightLocal(b.end_time));
      return { startMinutes, endMinutes };
    }),
    confirmedBookingsCountForDay: activeBookings.filter((b) => b.status === "confirmed").length,
    limits,
  });
}

// Same computation as fetchOpenSlotsForDate, but for every date in a month at
// once. The per-date version issues ~7 queries per call, so a calendar month
// looping over it sequentially (the original /api/availability/dates
// implementation) meant up to ~31 * 7 round trips to render one month view.
// Here the month-wide rules/overrides/bookings/busy-blocks are fetched once
// (6 queries total, run in parallel) and computeOpenSlots is run per day
// in memory against that shared data.
export async function fetchOpenDatesForMonth(params: {
  dates: string[]; // "YYYY-MM-DD", every day in the target month, any order
  appointmentType: AppointmentTypeRow;
}): Promise<string[]> {
  const supabase = getSupabaseClient();
  const { dates, appointmentType } = params;
  if (dates.length === 0) return [];

  const sortedDates = [...dates].sort();
  const firstDate = sortedDates[0];
  const lastDate = sortedDates[sortedDates.length - 1];
  const monthStartUtc = businessDayUtcBounds(firstDate).startUtc;
  const monthEndUtc = businessDayUtcBounds(lastDate).endUtc;

  const [
    { data: rules, error: rulesError },
    { data: overrides },
    { data: blocked },
    { data: bookings, error: bookingsError },
    { data: busy, error: busyError },
    { data: limitsRow, error: limitsError },
  ] = await Promise.all([
    supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
    supabase
      .from("availability_overrides")
      .select("date, start_time, end_time, is_closed")
      .gte("date", firstDate)
      .lte("date", lastDate),
    supabase
      .from("blocked_times")
      .select("date, start_time, end_time")
      .gte("date", firstDate)
      .lte("date", lastDate),
    supabase
      .from("bookings")
      .select("start_time, end_time, appointment_type_id, status, pending_expires_at")
      .gte("start_time", monthStartUtc)
      .lt("start_time", monthEndUtc)
      .in("status", ["confirmed", "pending"]),
    supabase
      .from("google_busy_blocks_cache")
      .select("start_time, end_time")
      .gte("start_time", monthStartUtc)
      .lt("start_time", monthEndUtc),
    supabase.from("scheduling_limits").select("*").single(),
  ]);

  if (rulesError) throw rulesError;
  if (limitsError) throw limitsError;
  if (!limitsRow) throw new Error("scheduling_limits row not found.");
  if (bookingsError) throw bookingsError;
  if (busyError) throw busyError;

  const now = Date.now();
  const activeBookings = (bookings ?? []).filter(
    (b) =>
      b.status !== "pending" ||
      b.pending_expires_at === null ||
      b.pending_expires_at === undefined ||
      new Date(b.pending_expires_at).getTime() > now,
  );

  const typeIds = Array.from(new Set(activeBookings.map((b) => b.appointment_type_id)));
  const { data: bookingTypes } = typeIds.length
    ? await supabase
        .from("appointment_types")
        .select("id, buffer_before_minutes, buffer_after_minutes")
        .in("id", typeIds)
    : { data: [] as { id: string; buffer_before_minutes: number; buffer_after_minutes: number }[] };
  const bufferById = new Map((bookingTypes ?? []).map((t) => [t.id, t]));

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

  // Bucket month-wide bookings/busy-blocks by the business-local calendar
  // date their start_time falls on — the exact inverse of the per-date
  // businessDayUtcBounds filter the single-date version uses, so this
  // produces the same per-day partition without a query per day.
  const blockedByDate = groupBy(blocked ?? [], (b) => b.date);
  const bookingsByDate = groupBy(activeBookings, (b) => utcIsoToBusinessDate(b.start_time));
  const busyByDate = groupBy(busy ?? [], (b) => utcIsoToBusinessDate(b.start_time));

  const openDates: string[] = [];
  for (const date of dates) {
    const dayBookings = bookingsByDate.get(date) ?? [];
    const dayBusy = busyByDate.get(date) ?? [];
    const dayBlocked = blockedByDate.get(date) ?? [];

    const slots = computeOpenSlots({
      date,
      now: new Date(),
      durationMinutes: appointmentType.duration_minutes,
      bufferBeforeMinutes: appointmentType.buffer_before_minutes,
      bufferAfterMinutes: appointmentType.buffer_after_minutes,
      rules: rulesShaped,
      overrides: overridesShaped,
      blockedTimes: dayBlocked.map((b) => ({ startTime: b.start_time, endTime: b.end_time })),
      existingBookings: dayBookings.map((b) => {
        const type = bufferById.get(b.appointment_type_id);
        const startMinutes = toMinutesSinceMidnightLocal(b.start_time);
        const endMinutes = clampEndOfDay(startMinutes, toMinutesSinceMidnightLocal(b.end_time));
        return {
          startMinutes,
          endMinutes,
          bufferBeforeMinutes: type?.buffer_before_minutes ?? 0,
          bufferAfterMinutes: type?.buffer_after_minutes ?? 0,
        };
      }),
      busyBlocks: dayBusy.map((b) => {
        const startMinutes = toMinutesSinceMidnightLocal(b.start_time);
        const endMinutes = clampEndOfDay(startMinutes, toMinutesSinceMidnightLocal(b.end_time));
        return { startMinutes, endMinutes };
      }),
      confirmedBookingsCountForDay: dayBookings.filter((b) => b.status === "confirmed").length,
      limits,
    });

    if (slots.length > 0) openDates.push(date);
  }

  return openDates;
}

export function resolveHoursQuick(
  date: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
) {
  return resolveHoursForDate(date, rules, overrides);
}
