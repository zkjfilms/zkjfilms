import { describe, expect, it } from "vitest";
import { startingPriceCents } from "@/lib/pricing";
import type { AppointmentTypeRow } from "@/lib/availabilityQuery";

const t = (name: string, price_cents: number, requires_payment = true) =>
  ({ name, price_cents, requires_payment } as AppointmentTypeRow);

describe("startingPriceCents", () => {
  it("returns the lowest paid matching price", () => {
    const types = [t("Headshots", 20000), t("Headshots", 15000), t("Headshots", 5000, false), t("Boudoir", 1000)];
    expect(startingPriceCents(types, (n) => n === "Headshots")).toBe(15000);
  });
  it("returns null when nothing matches", () => {
    expect(startingPriceCents([t("Boudoir", 1000)], (n) => n === "Headshots")).toBeNull();
  });
});
