import HeroImage from "@/components/HeroImage";
import Link from "next/link";
import type { Metadata } from "next";
import SectionNav from "@/components/SectionNav";
import { BUSINESS, DEFAULT_OG_IMAGE, SITE_URL, buildPageMetadata } from "@/lib/seo";
import { publicImageUrl } from "@/lib/media";
import { fetchActiveAppointmentTypes, type AppointmentTypeRow } from "@/lib/availabilityQuery";
import { formatPrice, formatPriceRange } from "@/lib/format";
import { getSupabaseClient } from "@/lib/supabase";
import ServicesGrid, { type ServiceCard } from "@/components/ServicesGrid";
import {
  BOUDOIR_SERVICE,
  CREATIVE_PORTRAITS_SERVICE,
  HEADSHOTS_SERVICE,
  MUSIC_SERVICE,
  type Service,
} from "@/lib/services";

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

// "From $X" for the cheapest active, paid appointment type whose name passes
// `match` — null when none does (e.g. a service with no bookable type yet).
function startingPrice(
  types: AppointmentTypeRow[],
  match: (name: string) => boolean,
): string | null {
  const prices = types
    .filter((type) => type.requires_payment && match(type.name))
    .map((type) => type.price_cents);
  return prices.length ? `From ${formatPrice(Math.min(...prices))}` : null;
}

export default async function Home() {
  let priceRange: string | null = null;
  let appointmentTypes: AppointmentTypeRow[] = [];
  try {
    appointmentTypes = await fetchActiveAppointmentTypes();
    priceRange = formatPriceRange(
      appointmentTypes
        .filter((type) => type.requires_payment)
        .map((type) => type.price_cents),
    );
  } catch (err) {
    console.error("Failed to load live pricing for homepage schema:", err);
  }

  // The Films card borrows the first film's poster (same ordering as /films);
  // until a film exists it's a "coming soon" text panel instead.
  const { data: firstFilm } = await getSupabaseClient()
    .from("videos")
    .select("poster_key, title")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  // Each service card links to its page and shows a live starting price
  // matched by the service's own appointment type name, with the service's
  // subject-framed 2:3 hero crop unless a card-specific image is given.
  const serviceCard = (service: Service, image?: ServiceCard["image"]): ServiceCard => ({
    href: `/${service.slug}`,
    name: service.name,
    line: service.tagline,
    price: startingPrice(appointmentTypes, (name) => name === service.appointmentTypeName),
    image: image ?? { src: service.mobileHeroImageUrl ?? service.heroImageUrl ?? "", alt: service.heroImageAlt },
  });
  const serviceCards: ServiceCard[] = [
    serviceCard(CREATIVE_PORTRAITS_SERVICE),
    serviceCard(HEADSHOTS_SERVICE),
    // Zach's pick for the homepage — chosen over the boudoir hero, whose
    // horizontal pose doesn't survive a 4:5 crop. Landscape source, so the
    // crop is shifted toward her face.
    serviceCard(BOUDOIR_SERVICE, {
      src: publicImageUrl("boudoir/gallery/TRA_2587-Edit.jpg"),
      alt: "Woman with long wavy blonde hair lying on a deep red floor in black lace lingerie with a strappy harness, one hand resting on her chest, looking up at the camera.",
      position: "58% center",
    }),
    serviceCard(MUSIC_SERVICE),
    {
      href: "/films",
      name: "Films",
      line: "Cinematic video — highlight reels and film pieces.",
      price: startingPrice(appointmentTypes, (name) => /videography/i.test(name)),
      image: firstFilm?.poster_key
        ? { src: publicImageUrl(firstFilm.poster_key), alt: `Still from ${firstFilm.title}` }
        : null,
      panelNote: firstFilm?.poster_key ? undefined : "New films coming soon",
    },
  ];

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
        {/*
          No quality override here on purpose: at fill+100vw this serves the
          3840px retina bucket, where quality 90 vs the default 75 nearly
          doubles the payload (2.9MB vs 1.5MB) for a difference invisible at
          web display size — directly hurt this image's load time.
        */}
        <HeroImage
          src={publicImageUrl("hero.jpg", "20260908151510070")}
          mobileSrc={publicImageUrl("mobile/hero.jpg")}
          alt="Woman with dark wavy hair and a nose ring smiling and looking off to the side, framed through out-of-focus green leaves and branches in warm forest light."
          eager
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/25 via-black/5 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-24 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            Portrait photography inspired by classic cinema, Columbia, Missouri
          </p>
          <h1 className="max-w-2xl font-serif text-4xl leading-tight text-white sm:text-5xl md:text-6xl">
            Every portrait, its own <em className="italic text-accent">still frame</em>.
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
          I&rsquo;m Zach &mdash; a Columbia, Missouri photographer drawn to
          the look and feel of classic film.
        </p>
        <p className="mx-auto mt-8 max-w-xl text-base leading-relaxed text-muted">
          My work is about the moment someone stops performing for the
          camera and just is. Whether that&rsquo;s a confident headshot or
          something more artistic and unguarded, I&rsquo;m drawn to images
          that feel honest rather than staged, shaped by the mood and light
          of the films I grew up on. I&rsquo;ve spent years building a
          practice around portrait photography in Mid-Missouri &mdash; for
          people who want to be seen clearly, and photographed with real
          care. Every session starts as a conversation, not a checklist. My
          goal is a set of images that actually feels like you.
        </p>
      </section>

      {/* 03 — Work */}
      <section
        id="work"
        className="relative flex min-h-[85vh] scroll-mt-24 items-end overflow-hidden"
      >
        {/* Same reasoning as the hero image above — no quality override. */}
        <HeroImage
          src={publicImageUrl("second.jpg", "20260908175153144")}
          mobileSrc={publicImageUrl("mobile/second.jpg")}
          alt="Woman with long wavy dark hair tilted back, off-shoulder white blouse with puff sleeves, standing between two tree trunks with arms outstretched touching the bark, golden backlight filtering through leaves above."
          objectPosition="center 15%"
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
            href="/creative-portraits"
            className="mt-2 border-b border-white/50 pb-1 text-xs uppercase tracking-[0.2em] text-white transition-colors hover:border-white"
          >
            View Portfolio →
          </Link>
        </div>
      </section>

      {/* 04 — What I Offer */}
      <section
        id="connect"
        className="mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-28 sm:px-10"
      >
        <div className="mx-auto max-w-xl text-center">
          <h2 className="mb-5 text-[11px] uppercase tracking-[0.3em] text-muted">
            04 &mdash; What I Offer
          </h2>
          <p className="font-serif text-3xl italic leading-snug text-foreground sm:text-4xl">
            Sessions for every kind of story.
          </p>
          <p className="mt-6 text-base leading-relaxed text-muted">
            Portraits, headshots, boudoir, live music, and film &mdash; for
            clients across Columbia and Mid-Missouri, each treated as a genuine
            collaboration.
          </p>
        </div>
        <div className="mt-16">
          <ServicesGrid cards={serviceCards} />
        </div>
        <div className="mt-16 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/book"
            className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
          >
            Book a Session
          </Link>
          <Link
            href="/contact"
            className="text-xs uppercase tracking-[0.2em] text-muted transition-colors hover:text-foreground"
          >
            Start a Conversation
          </Link>
        </div>
      </section>
    </div>
  );
}
