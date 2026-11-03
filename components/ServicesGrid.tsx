import Image from "next/image";
import Link from "next/link";

export type ServiceCard = {
  href: string;
  name: string;
  line: string;
  // "From $250" — null when no matching bookable type exists yet, so the
  // card simply omits a price rather than showing a wrong one.
  price: string | null;
  // null renders a text panel instead of a photo (e.g. Films before any
  // film exists). `position` is the object-position for the 4:5 crop of a
  // differently shaped source photo.
  image: { src: string; alt: string; position?: string } | null;
  panelNote?: string;
};

// The homepage's "What I Offer" section: one card per kind of work, each
// linking to its page. Cards wrap in a centered flex row (rather than a
// fixed grid) so an odd last row sits in the middle instead of hanging left.
// Up to four sit in one row on large screens; five or more go three across.
export default function ServicesGrid({ cards }: { cards: ServiceCard[] }) {
  const largeWidth = cards.length <= 4 ? "lg:w-[calc(25%-1.125rem)]" : "lg:w-[calc(33.333%-1rem)]";
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-12 sm:gap-x-6">
      {cards.map((card) => (
        <li key={card.href} className={`w-[calc(50%-0.5rem)] sm:w-[calc(50%-0.75rem)] ${largeWidth}`}>
          <Link href={card.href} className="group block text-left">
            <div className="relative aspect-[4/5] overflow-hidden bg-foreground">
              {card.image ? (
                <Image
                  src={card.image.src}
                  alt={card.image.alt}
                  fill
                  quality={90}
                  className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
                  style={card.image.position ? { objectPosition: card.image.position } : undefined}
                  sizes="(min-width: 1024px) 360px, (min-width: 640px) 45vw, 50vw"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center px-6 text-center">
                  <p className="font-serif text-xl italic leading-snug text-background sm:text-2xl">{card.line}</p>
                  {card.panelNote && (
                    <p className="mt-4 text-[10px] uppercase tracking-[0.25em] text-background/60">{card.panelNote}</p>
                  )}
                </div>
              )}
            </div>
            <p className="mt-4 font-serif text-lg italic text-foreground sm:text-xl">{card.name}</p>
            {card.image && <p className="mt-1 text-sm leading-relaxed text-muted">{card.line}</p>}
            <p className="mt-2 text-[11px] uppercase tracking-[0.2em] text-muted transition-colors group-hover:text-accent">
              {card.price ? `${card.price} · ` : ""}View →
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}
