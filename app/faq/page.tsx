import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";
import JsonLd from "@/components/JsonLd";
import { breadcrumbJsonLd, faqJsonLd } from "@/lib/jsonLd";
import FaqAccordion from "@/components/FaqAccordion";
import { FAQ_CATEGORIES, getFaqItems } from "@/lib/faq";

// Pricing/duration in the "session-cost" answer is pulled live from the
// same appointment_types data that powers /book (see lib/faq.ts). Revalidate
// periodically so an admin price change shows up here without a redeploy.
export const revalidate = 300;

export function generateMetadata(): Metadata {
  return pageMetadata("faq");
}

export default async function FaqPage() {
  const faqItems = await getFaqItems();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <JsonLd data={[faqJsonLd(faqItems), breadcrumbJsonLd("faq")]} />

      <header className="mb-16 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Good to Know
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Frequently asked <span className="text-accent">questions</span>.
        </h1>
        <p className="mt-5 text-muted">
          Can&apos;t find what you&apos;re looking for?{" "}
          <Link
            href="/contact"
            className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
          >
            Reach out directly
          </Link>
          .
        </p>
      </header>

      {FAQ_CATEGORIES.map((category) => (
        <section key={category} className="mb-14">
          <h2 className="mb-4 font-serif text-2xl italic text-foreground">
            {category}
          </h2>
          <FaqAccordion
            items={faqItems.filter((item) => item.category === category)}
          />
        </section>
      ))}
    </div>
  );
}
