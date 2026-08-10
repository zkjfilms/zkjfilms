import { BUSINESS_TIME_ZONE } from "@/lib/scheduling";

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// Shared between /admin/availability, /book, /manage/[token] and the
// booking emails (lib/email.ts) — all of them mean "the business's local
// time," never the host runtime's.
//
// Every toLocale* call below MUST pass an explicit timeZone: without one,
// these render in the host's zone, which is UTC on Vercel — a 7pm
// America/Chicago session would go out in a confirmation email as "2:00 AM"
// the next day. It also made /manage/[token] hydrate differently from its
// SSR output (server UTC vs. the browser's own zone). timeZoneName pins the
// abbreviation into the string so out-of-town clients can see this is CDT/CST,
// not necessarily their own local time.
export function formatTimeRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const dateStr = start.toLocaleDateString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  return `${dateStr} · ${startTime}–${endTime}`;
}

export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

// Schema.org priceRange (e.g. for LocalBusiness JSON-LD): a whole-dollar
// "$min-$max" built from live prices rather than a hand-maintained guess.
// Returns null for an empty input so callers can omit the field entirely
// instead of asserting a range that doesn't exist.
export function formatPriceRange(pricesCents: number[]): string | null {
  if (pricesCents.length === 0) return null;
  const whole = (cents: number) => `$${Math.round(cents / 100)}`;
  const min = Math.min(...pricesCents);
  const max = Math.max(...pricesCents);
  return min === max ? whole(min) : `${whole(min)}-${whole(max)}`;
}
