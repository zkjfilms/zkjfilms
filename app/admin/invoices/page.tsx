import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import InvoiceList from "./InvoiceList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Invoices" };
}

export default async function InvoicesPage() {
  const supabase = getSupabaseClient();
  const [
    { data: invoices, error: invoicesError },
    { data: appointmentTypes, error: appointmentTypesError },
    { data: bookings, error: bookingsError },
  ] = await Promise.all([
    supabase
      .from("invoices")
      .select("*, invoice_line_items(*)")
      .order("created_at", { ascending: false }),
    supabase.from("appointment_types").select("*").order("sort_order", { ascending: true }),
    supabase
      .from("bookings")
      .select("id, client_name, client_email, start_time, status")
      .eq("status", "confirmed")
      .order("start_time", { ascending: false })
      .limit(200),
  ]);

  if (invoicesError) {
    console.error("invoices list failed:", invoicesError);
  }
  if (appointmentTypesError) {
    console.error("appointment_types list failed:", appointmentTypesError);
  }
  if (bookingsError) {
    console.error("bookings list failed:", bookingsError);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Invoices</h1>
      </div>
      <InvoiceList
        initialInvoices={invoices ?? []}
        appointmentTypes={appointmentTypes ?? []}
        bookings={bookings ?? []}
      />
    </div>
  );
}
