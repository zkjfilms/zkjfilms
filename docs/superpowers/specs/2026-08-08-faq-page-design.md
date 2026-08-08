# FAQ page + booking-flow teaser

## Context

A full-site review identified "no FAQ" as one of the highest-leverage
trust/conversion gaps: nothing on the site currently answers the
questions that stall a booking (pricing ballpark, session process,
privacy/discretion for boudoir, cancellation policy) before a visitor has
to email to ask. This is the second of two related site-improvement items
from that review — the first (testimonials) was explicitly deferred: there
are no real client testimonials to use yet, and building an empty
placeholder section was rejected as counter to the work already done
removing other placeholder content from the site. Testimonials get their
own future spec once real quotes exist; this spec is FAQ only.

While gathering real content for this spec, a higher-severity issue
surfaced and was already fixed separately (not part of this spec): the
live `booking_agreement` and `model_release` contract templates in the
`templates` table contain literal `"[PLACEHOLDER TEXT — ...]"` marker text.
No contract has been signed yet, but nothing stopped one from being sent.
A code-level guard was added in `app/api/admin/contracts/route.ts` to
block contract creation from a template containing that marker (commit
`fe9afc0`). The actual legal language for those two templates is being
handled separately by the site owner's own lawyer — not part of this or
any other spec.

## Decisions made with the user

- **Placement:** a dedicated `/faq` page (full content, targets long-tail
  question search queries organically — Google's 2023 policy change
  limits `FAQPage` schema's *rich-snippet* eligibility to mostly
  government/health sites, but the page still earns normal organic
  rankings for those queries) **plus** a short teaser embedded on `/book`
  (not `/contact` — the objections that stall a booking surface mid-flow,
  not while someone's still deciding whether to reach out at all).
- **Content source:** all real answers were gathered directly from the
  site owner (see Content section below) — nothing here is fabricated or
  left as placeholder copy.
- **Real system values used directly** (already public via the live
  booking flow / already-shipped `lib/seo.ts` fix), not re-asked:
  - Session prices: Creative Portraits $250 (2 hr), Fine Art Nude $350
    (3 hr) — from the live `appointment_types` table.
  - Cancellation/reschedule: self-service online up to
    `cancel_reschedule_notice_hours` (currently 48) hours before the
    session, full refund; inside that window, contact directly. From
    `scheduling_limits` and `app/api/manage/[token]/cancel/route.ts` /
    `reschedule/route.ts`.
  - Booking window: `min_notice_hours` (24) to `max_advance_days` (365).
  - Payment model: full session price charged at booking to confirm (not
    a deposit) — from `app/api/bookings/route.ts` (`amountCents:
    type.price_cents`).
  - Studio address: `BUSINESS.address` in `lib/seo.ts` (2101 W Broadway
    Ave, Suite 208, Columbia, MO 65203).

## Architecture

- **`lib/faq.ts`** (new) — single source of truth for FAQ content: an
  exported array of `{ id, category, question, answer }` items. Both the
  full `/faq` page and the `/book` teaser import from here, so the two
  surfaces can never drift out of sync with each other. `answer` is plain
  text (a few contain a single line break for readability — handled as a
  literal `\n` the renderer converts to a paragraph break, no markdown/HTML
  needed for this content).
- **`components/FaqAccordion.tsx`** (new) — server component (no
  `"use client"`, no state) rendering a list of native `<details>`/
  `<summary>` disclosure elements, one per item — this is the codebase's
  existing disclosure pattern (`app/admin/contracts/new/NewContractForm.tsx`'s
  "Preview generated text" block already uses native `<details>`), styled
  with Tailwind to match the site's minimal serif/editorial look (plain
  border-bottom dividers between items, `<summary>` showing the question,
  expanded content showing the answer — no icon library, no custom
  expand/collapse JS). Takes an `items: FaqItem[]` prop — it does not know
  about categories or the full dataset, so it works identically for the
  full page's per-category lists and the teaser's flat 4-item list.
- **`app/faq/page.tsx`** (new) — full page. Renders `lib/faq.ts`'s items
  grouped by `category` (Pricing, Session Process, What to Wear, Privacy &
  Discretion, Logistics — matching the Content section below), each
  category as a heading followed by a `FaqAccordion`. Uses
  `buildPageMetadata()` like every other page (title "FAQ", description
  targeting the site's existing local-SEO keyword pattern). Includes
  `FAQPage` JSON-LD (`@type: "FAQPage"`, `mainEntity` built from the same
  `lib/faq.ts` array) — same pattern as the homepage's existing
  `LocalBusiness` JSON-LD in `app/page.tsx`.
- **`app/book/page.tsx`** (modify) — add a small "Common Questions"
  section using `FaqAccordion` with these 4 items from `lib/faq.ts`, in
  this order: "How much do sessions cost?", "What should I wear or
  bring?", "How is my privacy handled for boudoir/nude images?", "How far
  ahead do I need to book, and can I reschedule?" — the four most likely
  to cause hesitation right at the point of booking. Placed above the
  existing `BookingFlow` component, with a text link to `/faq` for the
  rest. `app/book/page.tsx` is currently a thin server component wrapping
  `<BookingFlow />` — this addition stays within that same file, no new
  route.
- **`app/sitemap.ts`** (modify) — add the `/faq` route (`weekly` or
  `monthly` change frequency, similar priority to `/portraits`).
- **`components/Footer.tsx`** (modify) — add a `/faq` text link in the
  third column, directly below the existing "Click Here to View
  Availability & Book" link (same column that already holds "Studio
  Hours" and "Booking" — no new column, no layout change to the other
  two).

## Content

Grouped by category, in the order they appear on `/faq`. This is the
complete, final copy — not a draft to be refined further during
implementation.

### Pricing
**How much do sessions cost?**
Creative Portraits sessions start at $250 (2 hours); Fine Art Nude
sessions start at $350 (3 hours). Full payment is collected at booking to
confirm your session. Looking for something longer — a full-day creative
shoot or event/video production? Reach out directly for a custom quote.

### Session Process
**How long does a session take?**
It depends on the style — standard sessions run 30 minutes to a few
hours, and full-day rates are available for event or creative video
production. Exact durations for each session type are shown when you
book.

**What happens during a session?**
Arrive on time and we'll spend the first few minutes talking through the
goals for the shoot, along with anything I should know going in —
disabilities, allergies, or posing challenges — so the session is
comfortable and works for you.

### What to Wear
**What should I wear or bring?**
Come in whatever you're comfortable traveling in — you'll change on-site.
For the actual session, bring something suited to the style: more formal
for professional headshots or portraits, simple pieces or costume looks
for creative portraits, and lingerie or kink-style pieces for boudoir and
nude sessions.

### Privacy & Discretion
**How is my privacy handled for boudoir/nude images?**
Images are stored privately on a secure drive in my home — never on a
public or shared cloud. Whether any images are ever shown publicly is
entirely your choice: fully public, public with your face/features
cropped out, or completely private and never shared.

**Will I need to sign anything?**
Yes — a model release and booking agreement, sent for you to review and
sign online before your session.

### Logistics
**Where are sessions held? Is there parking?**
The studio is at 2101 W Broadway Ave, Suite 208, Columbia, MO — in the
Crossroads plaza. Parking is free on-site; the easiest entrance is up the
stairs by Planet Fitness, and there's also a ramp for accessible entry.

**How far ahead do I need to book, and can I reschedule?**
Sessions can be booked online starting 24 hours out and up to a year in
advance. Need to cancel or reschedule? You can do that yourself online up
to 48 hours before your session for a full refund — inside that window,
just reach out directly.

## Out of scope

- Testimonials (separate future spec, blocked on real client quotes).
- Rewriting the `booking_agreement`/`model_release` legal contract text
  (handled separately by the site owner's lawyer; only the code-level
  placeholder guard was in scope, and that's already shipped).
- Any change to `/book`'s actual booking mechanics, pricing, or the
  appointment-type data itself.
- A "recently booked"-style trust signal or any other testimonials
  substitute — deliberately not building a fake-content stand-in per the
  same reasoning that deferred testimonials outright.

## Testing

- Visual check: `/faq` renders all 5 categories with working
  expand/collapse, matches site styling in both light content areas.
- Visual check: `/book`'s new teaser section renders above the booking
  flow, its 4 items expand/collapse independently of the full page's
  accordion instances, and its "see all FAQs" link goes to `/faq`.
- `curl`/`grep` check: `/faq`'s JSON-LD script tag contains a
  `FAQPage`-typed object whose `mainEntity` count matches
  `lib/faq.ts`'s item count.
- `npm run build` succeeds; `/faq` and `/sitemap.xml` (with the new route
  present) both listed in the build output.
- Footer's new `/faq` link resolves and doesn't visually unbalance the
  existing three-column layout.
