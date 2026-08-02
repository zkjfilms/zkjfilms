import type { Metadata } from "next";
import Link from "next/link";
import ContactForm from "./ContactForm";
import { buildPageMetadata } from "@/lib/seo";

const TITLE = "Contact & Booking";
const DESCRIPTION =
  "Book a portrait, headshot, or boudoir photography session with a Columbia, Missouri photographer serving Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: TITLE,
    description: DESCRIPTION,
    path: "/contact",
  });
}

export default function ContactPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Get In Touch
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Let&rsquo;s <span className="text-accent">talk</span>.
        </h1>
        <p className="mt-5 text-muted">
          Interested in booking a session, or just want to talk through an
          idea before committing to anything? Reach out below &mdash; I read
          every message myself and typically respond within a day or two.
        </p>
      </header>

      <section id="booking" className="mb-16 scroll-mt-24 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Schedule Online
        </p>
        <h2 className="mb-6 font-serif text-3xl italic text-foreground sm:text-4xl">
          Book a Session
        </h2>
        <p className="mx-auto mb-8 max-w-md text-muted">
          Pick a session type and an open time, and you&rsquo;ll get a
          session agreement to sign by email right after.
        </p>
        <Link
          href="/book"
          className="inline-block border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          View Availability &amp; Book
        </Link>
      </section>

      <ContactForm />

      <p className="mt-12 text-center text-sm leading-relaxed text-muted">
        Based in Columbia, Missouri, working throughout Mid-Missouri. Studio
        sessions available by appointment &mdash; once we&rsquo;re talking,
        I&rsquo;ll walk you through location, pricing, and what to expect.
        <br />
        If you&rsquo;d rather email directly, reach me at [EMAIL &mdash;
        placeholder].
      </p>
    </div>
  );
}
