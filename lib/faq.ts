import {
  fetchActiveAppointmentTypes,
  type AppointmentTypeRow,
} from "@/lib/availabilityQuery";

export type FaqCategory =
  | "Pricing"
  | "Session Process"
  | "What to Wear"
  | "Privacy & Discretion"
  | "Logistics";

export type FaqItem = {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
};

export const FAQ_CATEGORIES: FaqCategory[] = [
  "Pricing",
  "Session Process",
  "What to Wear",
  "Privacy & Discretion",
  "Logistics",
];

export const FAQ_ITEMS: FaqItem[] = [
  {
    // Prices/durations here mirror the live, admin-editable appointment_types
    // table (price_cents/duration_minutes), managed via
    // app/admin/appointment-types/AppointmentTypeForm.tsx. If those settings
    // change, update this answer to match.
    id: "session-cost",
    category: "Pricing",
    question: "How much do sessions cost?",
    answer:
      "Professional Headshots start at $150 (20 minutes); Creative Portraits sessions start at $250 (2 hours); Fine Art Boudoir & Nude sessions start at $500 (3 hours). Full payment is collected at booking to confirm your session. Looking for something longer — a full-day creative shoot or event/video production? Reach out directly for a custom quote.",
  },
  {
    id: "session-length",
    category: "Session Process",
    question: "How long does a session take?",
    answer:
      "It depends on the style — standard sessions run 30 minutes to a few hours, and full-day rates are available for event or creative video production. Exact durations for each session type are shown when you book.",
  },
  {
    id: "session-what-happens",
    category: "Session Process",
    question: "What happens during a session?",
    answer:
      "Arrive on time and we'll spend the first few minutes talking through the goals for the shoot, along with anything I should know going in — disabilities, allergies, or posing challenges — so the session is comfortable and works for you.",
  },
  {
    id: "what-to-wear",
    category: "What to Wear",
    question: "What should I wear or bring?",
    answer:
      "Come in whatever you're comfortable traveling in — you'll change on-site. For the actual session, bring something suited to the style: more formal for professional headshots or portraits, simple pieces or costume looks for creative portraits, and lingerie or kink-style pieces for boudoir and nude sessions.",
  },
  {
    id: "privacy-boudoir",
    category: "Privacy & Discretion",
    question: "How is my privacy handled for boudoir/nude images?",
    answer:
      "Images are stored privately on a secure drive in my home — never on a public or shared cloud. Whether any images are ever shown publicly is entirely your choice: fully public, public with your face/features cropped out, or completely private and never shared.",
  },
  {
    id: "sign-anything",
    category: "Privacy & Discretion",
    question: "Will I need to sign anything?",
    answer:
      "Yes — a model release and booking agreement, sent for you to review and sign online before your session.",
  },
  {
    id: "location-parking",
    category: "Logistics",
    question: "Where are sessions held? Is there parking?",
    answer:
      "The studio is at 2101 W Broadway Ave, Suite 208, Columbia, MO — in the Crossroads plaza. Parking is free on-site; the easiest entrance is up the stairs by Planet Fitness, and there's also a ramp for accessible entry.",
  },
  {
    // Notice windows here mirror the live, admin-editable scheduling_limits
    // table (min_notice_hours/max_advance_days/cancel_reschedule_notice_hours),
    // managed via app/admin/availability/SchedulingLimitsForm.tsx. If those
    // settings change, update this answer to match.
    id: "booking-window-reschedule",
    category: "Logistics",
    question: "How far ahead do I need to book, and can I reschedule?",
    answer:
      "Sessions can be booked online starting 24 hours out and up to a year in advance. Need to cancel or reschedule? You can do that yourself online up to 48 hours before your session for a full refund — inside that window, just reach out directly.",
  },
];

function formatWholeDollars(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

function formatDuration(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `${minutes} minutes`;
}

// Matches each known service against the live appointment_types rows by a
// stable keyword rather than an exact name — admin can freely rename types
// (see app/admin/appointment-types/AppointmentTypeForm.tsx) without silently
// breaking this answer. Returns null if any of the three can't be matched,
// so callers fall back to the static default above instead of rendering a
// sentence with a service missing.
function buildSessionCostAnswer(types: AppointmentTypeRow[]): string | null {
  const find = (keyword: string) =>
    types.find((t) => t.name.toLowerCase().includes(keyword));

  const headshots = find("headshot");
  const creative = find("creative");
  const boudoir = find("boudoir");
  if (!headshots || !creative || !boudoir) return null;

  return (
    `Professional Headshots start at ${formatWholeDollars(headshots.price_cents)} (${formatDuration(headshots.duration_minutes)}); ` +
    `Creative Portraits sessions start at ${formatWholeDollars(creative.price_cents)} (${formatDuration(creative.duration_minutes)}); ` +
    `Fine Art Boudoir & Nude sessions start at ${formatWholeDollars(boudoir.price_cents)} (${formatDuration(boudoir.duration_minutes)}). ` +
    "Full payment is collected at booking to confirm your session. Looking for something longer — a full-day creative shoot or event/video production? Reach out directly for a custom quote."
  );
}

// Single source of truth for pricing/duration copy: pulls the same live
// appointment_types data that powers /book (via fetchActiveAppointmentTypes)
// instead of relying on the hand-maintained numbers above. Falls back to the
// static FAQ_ITEMS answer — which stays kept up to date as a floor — if the
// query fails or a service can't be matched, so the page never breaks or
// shows a malformed answer.
export async function getFaqItems(): Promise<FaqItem[]> {
  let dynamicAnswer: string | null = null;
  try {
    const types = await fetchActiveAppointmentTypes();
    dynamicAnswer = buildSessionCostAnswer(types);
  } catch (err) {
    console.error("Failed to load live pricing for FAQ:", err);
  }

  if (!dynamicAnswer) return FAQ_ITEMS;

  return FAQ_ITEMS.map((item) =>
    item.id === "session-cost" ? { ...item, answer: dynamicAnswer } : item,
  );
}
