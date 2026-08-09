import Image from "next/image";
import Link from "next/link";
import Gallery from "@/components/Gallery";
import FaqAccordion from "@/components/FaqAccordion";
import { FAQ_ITEMS, type FaqItem } from "@/lib/faq";
import { SERVICES, type Service } from "@/lib/services";

export default function ServiceLandingPage({
  service,
}: {
  service: Service;
}) {
  const faqItems = service.faqIds
    .map((id) => FAQ_ITEMS.find((item) => item.id === id))
    .filter((item): item is FaqItem => item !== undefined);

  const otherServices = SERVICES.filter((s) => s.slug !== service.slug);

  return (
    <div className="flex flex-col">
      <section className="relative -mt-20 flex min-h-[70vh] items-end overflow-hidden">
        <Image
          src={`https://picsum.photos/seed/${service.heroImageSeed}/1800/1200`}
          alt={service.heroImageAlt}
          fill
          priority
          className="object-cover"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-black/5 to-black/5" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/55 via-black/5 to-transparent" />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-16 sm:px-10 lg:pl-16">
          <p className="mb-5 text-[11px] uppercase tracking-[0.3em] text-white/70">
            {service.tagline}
          </p>
          <h1 className="max-w-xl font-serif text-4xl italic leading-tight text-white sm:text-5xl md:text-6xl">
            {service.name}
          </h1>
        </div>
      </section>

      {service.gallery ? (
        <Gallery groups={[service.gallery]} />
      ) : (
        <p className="mx-auto max-w-2xl px-6 py-16 text-center text-muted sm:px-10">
          {service.description}
        </p>
      )}

      {faqItems.length > 0 && (
        <div className="mx-auto w-full max-w-2xl px-6 sm:px-10">
          <FaqAccordion items={faqItems} />
        </div>
      )}

      <div className="mx-auto mt-12 flex w-full max-w-2xl justify-center px-6 sm:px-10">
        <Link
          href="/book"
          className="border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Book This Session
        </Link>
      </div>

      <div className="mx-auto mb-24 mt-10 flex w-full max-w-2xl flex-col items-center gap-3 px-6 text-center sm:px-10">
        <p className="text-xs uppercase tracking-[0.3em] text-muted">
          Other Sessions
        </p>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          {otherServices.map((other) => (
            <Link
              key={other.slug}
              href={`/${other.slug}`}
              className="text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
            >
              {other.name}
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
