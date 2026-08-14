import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import DiscountCodeList from "./DiscountCodeList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Discount Codes" };
}

export default async function DiscountCodesPage() {
  const supabase = getSupabaseClient();
  const [
    { data: discountCodes, error: discountCodesError },
    { data: appointmentTypes, error: appointmentTypesError },
  ] = await Promise.all([
    supabase.from("discount_codes").select("*").order("created_at", { ascending: false }),
    supabase.from("appointment_types").select("*").order("sort_order", { ascending: true }),
  ]);

  if (discountCodesError) {
    console.error("discount_codes list failed:", discountCodesError);
  }
  if (appointmentTypesError) {
    console.error("appointment_types list failed:", appointmentTypesError);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Discount Codes</h1>
      </div>
      <DiscountCodeList
        initialCodes={discountCodes ?? []}
        appointmentTypes={appointmentTypes ?? []}
      />
    </div>
  );
}
