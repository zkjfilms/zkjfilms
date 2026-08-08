import type { FaqItem } from "@/lib/faq";

export default function FaqAccordion({ items }: { items: FaqItem[] }) {
  return (
    <div className="divide-y divide-border border-y border-border">
      {items.map((item) => (
        <details key={item.id} className="group py-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-foreground marker:content-none">
            <span className="font-serif text-lg italic">{item.question}</span>
            <span className="shrink-0 text-xl text-muted transition-transform duration-200 group-open:rotate-45">
              +
            </span>
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            {item.answer}
          </p>
        </details>
      ))}
    </div>
  );
}
