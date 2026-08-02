// Shared between the public contact form (app/contact/ContactForm.tsx),
// the auto-capture in app/api/contact/route.ts, and the admin leads UI
// (app/admin/leads), so they can't drift out of sync.

export const SESSION_TYPES = [
  "Headshots",
  "Creative Portrait",
  "Boudoir",
  "Other",
] as const;

export const LEAD_STATUSES = [
  "new",
  "contacted",
  "booked",
  "completed",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  booked: "Booked",
  completed: "Completed",
  lost: "Lost",
};
