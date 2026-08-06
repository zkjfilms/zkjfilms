import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import ManageBooking from "./ManageBooking";

export function generateMetadata(): Metadata {
  return { title: "Manage Your Booking", robots: { index: false, follow: false } };
}

function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Booking</p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">Not found</h1>
      <p className="mt-4 text-muted">
        This link doesn&rsquo;t match an active booking. It may already have been rescheduled or
        cancelled — contact us if you need help.
      </p>
    </div>
  );
}

function Finalizing() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Booking</p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">Finalizing…</h1>
      <p className="mt-4 text-muted">We&rsquo;re confirming your payment. This usually takes a few seconds — refresh in a moment.</p>
    </div>
  );
}

// Date.now() has to stay inside this plain helper, not the component body
// — same purity rule as app/admin/galleries/page.tsx and lib/gallery.ts.
function isWithinNoticeWindow(startTime: string, noticeHours: number): boolean {
  const hoursUntil = (new Date(startTime).getTime() - Date.now()) / (1000 * 60 * 60);
  return hoursUntil >= noticeHours;
}

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, appointment_types(name, duration_minutes)")
    .eq("booking_token", token)
    .in("status", ["confirmed", "pending"])
    .maybeSingle();

  if (error) {
    console.error("Failed to load booking for /manage:", error);
  }
  if (!booking) return <NotFound />;
  if (booking.status === "pending") return <Finalizing />;

  const { data: limits } = await supabase.from("scheduling_limits").select("cancel_reschedule_notice_hours").single();
  const noticeHours = limits?.cancel_reschedule_notice_hours ?? 24;
  const withinWindow = isWithinNoticeWindow(booking.start_time, noticeHours);

  return <ManageBooking booking={booking} withinWindow={withinWindow} />;
}
