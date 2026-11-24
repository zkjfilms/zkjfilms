import { describe, expect, it } from "vitest";
import {
  BUSINESS_ID, breadcrumbJsonLd, businessJsonLd, faqJsonLd, personJsonLd, serviceJsonLd, videoJsonLd,
} from "@/lib/jsonLd";
import { SITE_URL } from "@/lib/seo";

describe("jsonLd", () => {
  it("business keeps its @id and omits priceRange when unknown", () => {
    const b = businessJsonLd(null) as Record<string, unknown>;
    expect(b["@id"]).toBe(BUSINESS_ID);
    expect(b).not.toHaveProperty("priceRange");
    expect((businessJsonLd("$150–$500") as Record<string, unknown>).priceRange).toBe("$150–$500");
  });
  it("breadcrumb is Home → page with absolute URLs", () => {
    const b = breadcrumbJsonLd("headshots") as { itemListElement: { position: number; name: string; item: string }[] };
    expect(b.itemListElement).toEqual([
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Headshots in Columbia, MO", item: `${SITE_URL}/headshots` },
    ]);
  });
  it("service links its provider and adds an offer only with a price", () => {
    const base = { name: "Headshots", description: "Desc", path: "/headshots", image: "https://img.example/h.jpg" };
    const without = serviceJsonLd({ ...base, startingPriceCents: null }) as Record<string, unknown>;
    expect(without.provider).toEqual({ "@id": BUSINESS_ID });
    expect(without).not.toHaveProperty("offers");
    const withPrice = serviceJsonLd({ ...base, startingPriceCents: 15000 }) as { offers: Record<string, unknown> };
    expect(withPrice.offers).toMatchObject({ "@type": "Offer", price: "150.00", priceCurrency: "USD" });
  });
  it("person works for the business", () => {
    expect(personJsonLd()).toMatchObject({ "@type": "Person", name: "Zach K. Johnson", worksFor: { "@id": BUSINESS_ID } });
  });
  it("faq maps questions to answers", () => {
    expect(faqJsonLd([{ question: "Q?", answer: "A." }])).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }],
    });
  });
  it("video falls back to the title for description", () => {
    const v = videoJsonLd({ title: "Reel", description: null, posterUrl: "https://img.example/p.jpg", contentUrl: "https://img.example/v.mp4", uploadDate: "2026-01-01T00:00:00Z" });
    expect(v).toMatchObject({ "@type": "VideoObject", name: "Reel", description: "Reel", thumbnailUrl: ["https://img.example/p.jpg"] });
  });
});
