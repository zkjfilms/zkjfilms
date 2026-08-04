import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import { buildPageMetadata } from "@/lib/seo";
import BookingFlow from "./BookingFlow";

const TITLE = "Book a Session";
const DESCRIPTION =
  "Book a portrait, headshot, or boudoir photography session with a Columbia, Missouri photographer serving Mid-Missouri.";

// Slot availability changes whenever a booking, cancellation, or admin
// edit happens — this page has no cookies/params to force dynamic
// rendering on its own, so without this it gets statically cached at
// build time and never reflects live availability.
export const dynamic = "force-dynamic";

export function generateMetadata(): Metadata {
  return buildPageMetadata({ title: TITLE, description: DESCRIPTION, path: "/book" });
}

// Date.now() has to stay inside this plain helper, not the component
// body — same purity rule applied throughout this codebase (see
// lib/gallery.ts, app/admin/dashboard/page.tsx).
function nowIso(): string {
  return new Date().toISOString();
}

export default async function BookPage() {
  const supabase = getSupabaseClient();
  const { data: slots, error } = await supabase
    .from("booking_slots")
    .select("id, start_time, end_time, session_type, deposit_cents")
    .eq("status", "open")
    .gte("start_time", nowIso())
    .order("start_time", { ascending: true });

  if (error) {
    console.error("Supabase booking_slots list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Schedule Online
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Book a <span className="text-accent">session</span>.
        </h1>
        <p className="mt-5 text-muted">
          Pick a session type and an open time below. You&rsquo;ll get a
          session agreement to sign by email right after.
        </p>
      </header>

      <BookingFlow slots={slots ?? []} />
    </div>
  );
}
