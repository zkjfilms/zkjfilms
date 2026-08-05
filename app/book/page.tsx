import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import BookingFlow from "./BookingFlow";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Book a Session",
    description: "Book a portrait, headshot, or boudoir photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    path: "/book",
  });
}

export default function BookPage() {
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
    </div>
  );
}
