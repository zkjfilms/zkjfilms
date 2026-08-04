import type { Metadata } from "next";
import AvailabilityOverviewClient from "./AvailabilityOverviewClient";

export function generateMetadata(): Metadata {
  return { title: "Admin — Availability" };
}

export default function AdminAvailabilityPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Availability</h1>
      </div>
      <AvailabilityOverviewClient />
    </div>
  );
}
