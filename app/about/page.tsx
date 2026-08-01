import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";

const TITLE = "About";
const DESCRIPTION =
  "Meet the photographer behind Nocturne Studio, a Columbia, Missouri portrait, boudoir, and fine art photographer serving Mid-Missouri.";

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/about" });
}

export default function AboutPage() {
  return (
    <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-14 px-6 py-20 sm:px-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] lg:items-start lg:gap-20">
      <div className="relative order-1 aspect-[4/5] w-full overflow-hidden lg:order-2">
        <Image
          src="https://picsum.photos/seed/nocturne-studio-portrait/900/1125"
          alt="Zach, portrait and boudoir photographer based in Columbia, Missouri"
          fill
          className="object-cover"
          sizes="(min-width: 1024px) 50vw, 100vw"
        />
      </div>

      <div className="order-2 lg:order-1">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          The Studio
        </p>
        <h1 className="font-serif text-4xl leading-tight text-foreground sm:text-5xl">
          A little about <em className="italic text-accent">me</em>
        </h1>

        <div className="mt-8 space-y-6 text-muted leading-relaxed">
          <p>
            I&rsquo;m a portrait and fine art photographer based in
            Columbia, Missouri, working out of my studio at [STUDIO LOCATION
            &mdash; placeholder]. Photography found me through a background
            in research and administration &mdash; a strange starting
            point, maybe, but it taught me patience, attention to detail,
            and how to make people comfortable enough to open up. Those same
            instincts show up in every session I shoot now.
          </p>
          <p>
            My work moves between a few different worlds: polished
            portraits and headshots for people who need to show up
            professionally, boudoir sessions for people rediscovering
            confidence in their own image, and a slower, more personal body
            of fine art and literary-influenced photography that I make
            because I have to, not because anyone commissioned it.
          </p>
          <p>
            If there&rsquo;s a thread running through all of it, it&rsquo;s
            this: I want the camera to feel like the safest place in the
            room. That&rsquo;s true whether we&rsquo;re shooting headshots
            in an afternoon or spending hours building a set for something
            stranger and more artistic.
          </p>
          <p>
            Based in Columbia, Missouri and working throughout Mid-Missouri,
            I&rsquo;m always glad to talk through what you&rsquo;re
            picturing &mdash; even if you&rsquo;re not sure yet how to
            describe it.
          </p>
        </div>

        <Link
          href="/contact"
          className="mt-10 inline-block border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
        >
          Get in Touch
        </Link>

        <h2 className="mt-10 border-t border-border pt-8 text-xs uppercase tracking-[0.3em] text-muted">
          Studio Details
        </h2>
        <dl className="mt-4 grid grid-cols-2 gap-6 text-sm">
          <div>
            <dt className="uppercase tracking-[0.15em] text-muted">
              Based In
            </dt>
            <dd className="mt-1 text-foreground">Columbia, MO</dd>
          </div>
          <div>
            <dt className="uppercase tracking-[0.15em] text-muted">
              Available For
            </dt>
            <dd className="mt-1 text-foreground">
              Portraits, Headshots &amp; Boudoir
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
