// Shared booking policy constants and time-math helpers. Used by the
// deposit checkout flow (app/api/book), the reschedule/cancellation API
// routes (app/api/manage/[token]/*), and their confirmation emails —
// kept in one place so the policy numbers can't drift out of sync.
//
// See docs/superpowers/specs/2026-08-02-booking-deposits-reschedule-cancellation-design.md.

export const RESCHEDULE_NOTICE_HOURS = 72;
export const RESCHEDULE_FEE_CENTS = 5000;
export const PENDING_HOLD_MINUTES = 30;

export function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60);
}

export function daysUntil(iso: string): number {
  return hoursUntil(iso) / 24;
}

export type RefundTier = { percent: 100 | 50 | 0; label: string };

// >=7 days out: full refund. >=3 days (72h): half. Under 3 days: none.
export function refundTierForCancellation(daysNotice: number): RefundTier {
  if (daysNotice >= 7) return { percent: 100, label: "full refund" };
  if (daysNotice >= 3) return { percent: 50, label: "50% refund" };
  return { percent: 0, label: "no refund" };
}
