import { requireAdmin } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { broadcastAvailabilityChange } from "@/lib/realtimeBroadcast";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabaseClient();

  // Fetch the date before deleting — once the row is gone there's no
  // other way to know which day's view needs to refetch.
  const { data: blockedTime } = await supabase
    .from("blocked_times")
    .select("date")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase.from("blocked_times").delete().eq("id", id);
  if (error) {
    console.error("blocked_times delete failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (blockedTime) {
    await broadcastAvailabilityChange({ date: blockedTime.date });
  }
  return Response.json({ ok: true });
}
