import type { SupabaseClient } from "@supabase/supabase-js";

// Confirmed-bookings client list, deduped by email (newest booking
// wins) — same query shape /admin/clients runs for its own rollups, but
// that page needs every row (not deduped) plus fields this doesn't
// select, so it keeps its own separate query. This is for the gallery
// page's "Notify client" name search, which only needs name/email.
export type DirectoryClient = { name: string; email: string };

export async function getConfirmedBookingClients(
  supabase: SupabaseClient,
): Promise<DirectoryClient[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("client_name, client_email, start_time")
    .eq("status", "confirmed")
    .order("start_time", { ascending: false });

  if (error) {
    console.error("Confirmed-bookings client lookup failed:", error);
    return [];
  }

  const byEmail = new Map<string, DirectoryClient>();
  for (const row of data ?? []) {
    if (!byEmail.has(row.client_email)) {
      byEmail.set(row.client_email, {
        name: row.client_name,
        email: row.client_email,
      });
    }
  }
  return Array.from(byEmail.values());
}
