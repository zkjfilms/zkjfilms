import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import AppointmentTypeList from "./AppointmentTypeList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Appointment Types" };
}

export default async function AppointmentTypesPage() {
  const supabase = getSupabaseClient();
  const { data: appointmentTypes, error } = await supabase
    .from("appointment_types")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("appointment_types list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Appointment Types</h1>
      </div>
      <AppointmentTypeList initialTypes={appointmentTypes ?? []} />
    </div>
  );
}
