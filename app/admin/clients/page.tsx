import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import ClientDirectoryList, { type ClientBookingRow } from "./ClientDirectoryList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Clients" };
}

type BookingRow = {
  client_name: string;
  client_email: string;
  client_phone: string | null;
  start_time: string;
  amount_paid_cents: number | null;
  appointment_types: { name: string } | { name: string }[] | null;
};

function typeName(row: BookingRow): string {
  const rel = row.appointment_types;
  if (!rel) return "Appointment";
  return Array.isArray(rel) ? (rel[0]?.name ?? "Appointment") : rel.name;
}

export default async function AdminClientsPage() {
  const supabase = getSupabaseClient();
  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("client_name, client_email, client_phone, start_time, amount_paid_cents, appointment_types(name)")
    .eq("status", "confirmed")
    .order("start_time", { ascending: false });

  if (error) {
    console.error("bookings list for client directory failed:", error);
  }

  const clientsByEmail = new Map<string, ClientBookingRow>();
  for (const row of (bookings ?? []) as BookingRow[]) {
    const booking = {
      typeName: typeName(row),
      startTime: row.start_time,
      amountPaidCents: row.amount_paid_cents,
    };
    const existing = clientsByEmail.get(row.client_email);
    if (!existing) {
      clientsByEmail.set(row.client_email, {
        email: row.client_email,
        name: row.client_name,
        phone: row.client_phone,
        bookingCount: 1,
        firstBooking: row.start_time,
        lastBooking: row.start_time,
        totalPaidCents: row.amount_paid_cents ?? 0,
        bookings: [booking],
      });
      continue;
    }
    existing.bookingCount += 1;
    existing.totalPaidCents += row.amount_paid_cents ?? 0;
    existing.bookings.push(booking);
    // Rows are already ordered newest-first, so the first time we see a
    // given email is its most recent booking — keep that name/phone.
    if (row.start_time < existing.firstBooking) {
      existing.firstBooking = row.start_time;
    }
  }
  const clients = Array.from(clientsByEmail.values()).sort(
    (a, b) => new Date(b.lastBooking).getTime() - new Date(a.lastBooking).getTime(),
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">Clients</h1>
      </div>
      {clients.length === 0 ? (
        <p className="text-muted">{error ? "Couldn't load clients." : "No completed bookings yet."}</p>
      ) : (
        <ClientDirectoryList clients={clients} />
      )}
    </div>
  );
}
