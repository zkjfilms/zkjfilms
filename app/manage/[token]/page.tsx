import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import ManageBooking from "./ManageBooking";

// Private links — never indexed, disallowed in robots.ts too.
export function generateMetadata(): Metadata {
  return {
    title: "Manage Your Booking",
    robots: { index: false, follow: false },
  };
}

function BookingNotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Booking
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        Not found
      </h1>
      <p className="mt-4 text-muted">
        This link doesn&rsquo;t match an active booking. It may already
        have been rescheduled or cancelled — contact us if you need help.
      </p>
    </div>
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

export default async function ManagePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("booking_slots")
    .select("id, start_time, end_time, session_type, client_name, client_email")
    .eq("booking_token", token)
    .eq("status", "booked")
    .maybeSingle();

  if (error) {
    console.error("Supabase booking lookup by token failed:", error);
  }

  if (!booking) {
    return <BookingNotFound />;
  }

  const { data: otherSlots, error: slotsError } = await supabase
    .from("booking_slots")
    .select("id, start_time, end_time, session_type")
    .eq("status", "open")
    .eq("session_type", booking.session_type)
    .gte("start_time", nowIso())
    .order("start_time", { ascending: true });

  if (slotsError) {
    console.error("Supabase open-slots lookup failed:", slotsError);
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          Manage Booking
        </p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Your <span className="text-accent">session</span>.
        </h1>
      </header>

      <ManageBooking token={token} booking={booking} otherSlots={otherSlots ?? []} />
    </div>
  );
}
