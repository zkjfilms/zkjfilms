export const BUSINESS_TIME_ZONE = "America/Chicago";

export type AvailabilityRule = {
  dayOfWeek: number; // 0-6, Sunday-Saturday
  startTime: string; // "HH:MM:SS"
  endTime: string;
};

export type AvailabilityOverride = {
  date: string; // "YYYY-MM-DD"
  startTime: string | null;
  endTime: string | null;
  isClosed: boolean;
};

export type ResolvedHours = { startTime: string; endTime: string } | null;

// date is "YYYY-MM-DD" in the business timezone.
export function resolveHoursForDate(
  date: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
): ResolvedHours {
  const override = overrides.find((o) => o.date === date);
  if (override) {
    if (override.isClosed) return null;
    if (!override.startTime || !override.endTime) return null;
    return { startTime: override.startTime, endTime: override.endTime };
  }

  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const rule = rules.find((r) => r.dayOfWeek === dayOfWeek);
  if (!rule) return null;
  return { startTime: rule.startTime, endTime: rule.endTime };
}

type Span = { start: number; end: number }; // minutes since local midnight

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

export type TimeSlot = { startTime: string; endTime: string }; // "HH:MM"

export type ExistingBooking = {
  startMinutes: number; // minutes since local midnight on the target date
  endMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};

export type BlockedTime = { startTime: string; endTime: string };
export type BusyBlock = { startMinutes: number; endMinutes: number };

export type SchedulingLimits = {
  minNoticeHours: number;
  maxAdvanceDays: number;
  dailyCap: number | null;
  startTimeIntervalMinutes: number;
};

export function computeOpenSlots(params: {
  date: string; // "YYYY-MM-DD"
  now: Date;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  blockedTimes: BlockedTime[];
  existingBookings: ExistingBooking[];
  busyBlocks: BusyBlock[];
  confirmedBookingsCountForDay: number;
  limits: SchedulingLimits;
}): TimeSlot[] {
  const window = resolveHoursForDate(params.date, params.rules, params.overrides);
  if (!window) return [];

  if (params.limits.dailyCap !== null && params.confirmedBookingsCountForDay >= params.limits.dailyCap) {
    return [];
  }

  const windowStart = timeToMinutes(window.startTime);
  const windowEnd = timeToMinutes(window.endTime);
  const step = params.limits.startTimeIntervalMinutes;

  const blockedSpans: Span[] = params.blockedTimes.map((b) => ({
    start: timeToMinutes(b.startTime),
    end: timeToMinutes(b.endTime),
  }));
  const busySpans: Span[] = params.busyBlocks.map((b) => ({
    start: b.startMinutes,
    end: b.endMinutes,
  }));
  const bookingSpans: Span[] = params.existingBookings.map((b) => ({
    start: b.startMinutes - b.bufferBeforeMinutes,
    end: b.endMinutes + b.bufferAfterMinutes,
  }));

  const nowLocal = toBusinessLocalParts(params.now);
  const minNoticeMinutes = params.limits.minNoticeHours * 60;
  const maxAdvanceMinutes = params.limits.maxAdvanceDays * 24 * 60;
  const minutesFromNowToStartOfDate = minutesBetween(nowLocal, params.date);

  const slots: TimeSlot[] = [];
  for (let start = windowStart; start + params.durationMinutes <= windowEnd; start += step) {
    const end = start + params.durationMinutes;
    const occupied: Span = {
      start: start - params.bufferBeforeMinutes,
      end: end + params.bufferAfterMinutes,
    };

    if (blockedSpans.some((s) => overlaps(occupied, s))) continue;
    if (busySpans.some((s) => overlaps(occupied, s))) continue;
    if (bookingSpans.some((s) => overlaps(occupied, s))) continue;

    const minutesFromNow = minutesFromNowToStartOfDate + start;
    if (minutesFromNow < minNoticeMinutes) continue;
    if (minutesFromNow > maxAdvanceMinutes) continue;

    slots.push({
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
    });
  }

  return slots;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function toBusinessLocalParts(date: Date): { date: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Minutes from "now" (business-local) to the start of `targetDate` at
// local midnight — can be negative if targetDate is today or in the past.
function minutesBetween(now: { date: string; minutes: number }, targetDate: string): number {
  const nowDate = new Date(`${now.date}T00:00:00Z`);
  const target = new Date(`${targetDate}T00:00:00Z`);
  const dayDiffMinutes = Math.round((target.getTime() - nowDate.getTime()) / 60000);
  return dayDiffMinutes - now.minutes;
}

export function formatSlotForDisplay(
  date: string,
  time: string,
  timeZone: string,
): string {
  const utcGuess = new Date(`${date}T${time}:00Z`);
  // The business-local wall-clock time interpreted in BUSINESS_TIME_ZONE,
  // then rendered in the caller's timeZone.
  const businessOffsetMs = getTimeZoneOffsetMs(utcGuess, BUSINESS_TIME_ZONE);
  const actualUtc = new Date(utcGuess.getTime() - businessOffsetMs);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(actualUtc);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}
