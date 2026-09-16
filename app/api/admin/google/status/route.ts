import { requireAdmin } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data } = await supabase.from("google_calendar_sync").select("connected, last_synced_at").single();
  return Response.json({ connected: data?.connected ?? false, lastSyncedAt: data?.last_synced_at ?? null });
}
