import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import SectionNav from "@/components/SectionNav";
import { BUSINESS, DEFAULT_OG_IMAGE, SITE_URL, buildPageMetadata } from "@/lib/seo";
import { fetchActiveAppointmentTypes } from "@/lib/availabilityQuery";
import { formatPriceRange } from "@/lib/format";

const TITLE = "Zach K. Johnson | Columbia, MO Portrait & Boudoir Photographer";
const DESCRIPTION =
  "Columbia, Missouri portrait and boudoir photographer offering natural-light portrait, boudoir, and fine art photography sessions throughout Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: TITLE, description: DESCRIPTION });
}

// priceRange is pulled live from the same appointment_types data that
// powers /book (see lib/faq.ts for the identical pattern), so it can't
// drift the way a hand-typed figure would. Revalidate periodically so an
// admin price change shows up here without a redeploy.
export const revalidate = 300;

const sections = [
  { id: "hero", label: "Welcome" },
  { id: "story", label: "Story" },
  { id: "work", label: "Work" },
  { id: "connect", label: "Connect" },
];

export default async function Home() {
  let priceRange: string | null = null;
  try {
    const appointmentTypes = await fetchActiveAppointmentTypes();
    priceRange = formatPriceRange(
      appointmentTypes
        .filter((type) => type.requires_payment)
        .map((type) => type.price_cents),
    );
  } catch (err) {
    console.error("Failed to load live pricing for homepage schema:", err);
  }

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": ["LocalBusiness", "ProfessionalService"],
    "@id": `${SITE_URL}/#business`,
    name: BUSINESS.name,
    description: BUSINESS.description,
    url: SITE_URL,
    telephone: BUSINESS.telephone,
    email: BUSINESS.email,
    image: DEFAULT_OG_IMAGE.url,
    address: {
      "@type": "PostalAddress",
      streetAddress: BUSINESS.address.streetAddress,
      addressLocality: BUSINESS.address.addressLocality,
      addressRegion: BUSINESS.address.addressRegion,
      postalCode: BUSINESS.address.postalCode,
      addressCountry: BUSINESS.address.addressCountry,
    },
    geo: {
      "@type": "GeoCoordinates",
      latitude: BUSINESS.geo.latitude,
      longitude: BUSINESS.geo.longitude,
    },
    areaServed: BUSINESS.areaServed,
    sameAs: BUSINESS.sameAs,
    openingHoursSpecification: {
      "@type": "OpeningHoursSpecification",
      dayOfWeek: BUSINESS.hours.dayOfWeek,
      opens: BUSINESS.hours.opens,
      closes: BUSINESS.hours.closes,
    },
    ...(priceRange ? { priceRange } : {}),
  };

  return (
    <div className="flex flex-col">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
        }}
      />

      <SectionNav sections={sections} />

      {/* 01 — Hero */}
      <section
        id="hero"
        className="relative -mt-20 flex min-h-screen scroll-mt-24 items-end overflow-hidden"
      >
        <Image
          src="https://picsum.photos/seed/nocturne-editorial-hero/1800/1200"
          alt="Natural-light portrait photography session in Columbia, Missouri"
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/10 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            Fine art and intimate photography in Columbia, Missouri
          </p>
          <h1 className="max-w-2xl font-serif text-4xl leading-tight text-white sm:text-5xl md:text-6xl">
            Portraits, <em className="italic text-accent">uncovered</em>.
          </h1>
        </div>
      </section>

      {/* 02 — Story */}
      <section
        id="story"
        className="mx-auto w-full max-w-3xl scroll-mt-24 px-6 py-28 text-center sm:px-10"
      >
        <h2 className="mb-5 text-[11px] uppercase tracking-[0.3em] text-muted">
          02 — The Story
        </h2>
        <p className="font-serif text-3xl italic leading-snug text-foreground sm:text-4xl">
          I&rsquo;m Zach &mdash; a Columbia, Missouri photographer working at
          the intersection of portraiture, boudoir, and fine art.
        </p>
        <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-muted">
          My work is about the moment someone stops performing for the
          camera and just is. Whether that&rsquo;s a confident headshot, a
          quiet boudoir session, or something more artistic and unguarded,
          I&rsquo;m drawn to images that feel honest rather than staged.
          I&rsquo;ve spent years building a practice around portrait and
          boudoir photography in Mid-Missouri &mdash; for people who want to
          be seen clearly, and photographed with real care. Every session
          starts as a conversation, not a checklist. My goal is a set of
          images that actually feels like you.
        </p>
      </section>

      {/* 03 — Work */}
      <section
        id="work"
        className="relative flex min-h-[85vh] scroll-mt-24 items-end overflow-hidden"
      >
        <Image
          src="https://picsum.photos/seed/nocturne-editorial-work/1800/1300"
          alt="Preview of a portrait and boudoir photography session in Mid-Missouri"
          fill
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto flex w-full max-w-6xl flex-col items-start gap-6 px-6 pb-20 sm:px-10">
          <h2 className="text-[11px] uppercase tracking-[0.3em] text-white/70">
            03 — The Work
          </h2>
          <p className="font-serif text-4xl italic text-white sm:text-5xl">
            Have a look &mdash; the work says more than I can.
          </p>
          <Link
            href="/portraits"
            className="mt-2 border-b border-white/50 pb-1 text-xs uppercase tracking-[0.2em] text-white transition-colors hover:border-white"
          >
            View Portfolio →
          </Link>
        </div>
      </section>

      {/* 04 — Connect */}
      <section
        id="connect"
        className="mx-auto w-full max-w-3xl scroll-mt-24 px-6 py-32 text-center sm:px-10"
      >
        <h2 className="mb-5 text-[11px] uppercase tracking-[0.3em] text-muted">
          04 — What I Offer
        </h2>
        <p className="mx-auto max-w-xl text-base leading-relaxed text-muted">
          My work spans creative portraits, professional headshots, and
          boudoir photography for clients across Columbia and Mid-Missouri,
          along with an ongoing body of fine art and nude photographic work
          exploring intimacy, form, and narrative. If you&rsquo;re looking
          for a Columbia photographer who treats a session as genuine
          collaboration rather than a transaction, I&rsquo;d love to work
          with you.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/contact"
            className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            Start a Conversation
          </Link>
          <Link
            href="/about"
            className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
          >
            Explore Services
          </Link>
        </div>
      </section>
    </div>
  );
}
