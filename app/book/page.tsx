import type { Metadata } from "next";
import Link from "next/link";
import { buildPageMetadata } from "@/lib/seo";
import BookingFlow from "./BookingFlow";
import FaqAccordion from "@/components/FaqAccordion";
import { getFaqItems, type FaqItem } from "@/lib/faq";

// Pricing/duration in the "session-cost" teaser answer is pulled live from
// the same appointment_types data that powers the booking flow below (see
// lib/faq.ts). Revalidate periodically so an admin price change shows up
// here without a redeploy.
export const revalidate = 300;

const TEASER_FAQ_IDS = [
  "session-cost",
  "what-to-wear",
  "privacy-boudoir",
  "booking-window-reschedule",
];

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Book a Session",
    description: "Book a portrait, headshot, boudoir, or music/performance photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    path: "/book",
  });
}

export default async function BookPage() {
  const faqItems = await getFaqItems();
  const teaserItems = TEASER_FAQ_IDS.map((id) =>
    faqItems.find((item) => item.id === id),
  ).filter((item): item is FaqItem => item !== undefined);

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Schedule Online</p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Book a <span className="text-accent">session</span>.
        </h1>
        <p className="mt-5 text-muted">Pick a session type and an open time below. You&apos;ll get a confirmation by email right after.</p>
      </header>

      <BookingFlow />

      <section className="mt-16">
        <h2 className="mb-4 text-center font-serif text-xl italic text-foreground">
          Common questions
        </h2>
        <FaqAccordion items={teaserItems} />
        <p className="mt-4 text-center text-sm text-muted">
          <Link
            href="/faq"
            className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
          >
            See all FAQs →
          </Link>
        </p>
      </section>
    </div>
  );
}
