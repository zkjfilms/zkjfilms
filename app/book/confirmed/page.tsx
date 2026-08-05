import type { Metadata } from "next";

// Reached via Stripe Checkout's success_url. The booking itself is
// finalized asynchronously by the webhook (see lib/bookingWebhooks.ts),
// so this page doesn't query anything — it can't know the finalization
// has landed yet, and doesn't need to.
export function generateMetadata(): Metadata {
  return {
    title: "Booking Confirmed",
    robots: { index: false, follow: false },
  };
}

export default function BookingConfirmedPage() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
        Booked
      </p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
        You&rsquo;re all set.
      </h1>
      <p className="mt-4 text-muted">
        Check your email for your booking confirmation, including a private
        link where you can reschedule or cancel later if you need to.
      </p>
    </div>
  );
}
