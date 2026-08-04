import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("scheduling_limits").select("*").single();
  if (error) {
    console.error("scheduling_limits read failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ limits: data });
}

type UpdatePayload = {
  minNoticeHours: number;
  maxAdvanceDays: number;
  cancelRescheduleNoticeHours: number;
  dailyCap: number | null;
  startTimeIntervalMinutes: number;
};

function parsePayload(body: unknown): UpdatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.minNoticeHours !== "number" ||
    b.minNoticeHours < 0 ||
    typeof b.maxAdvanceDays !== "number" ||
    b.maxAdvanceDays < 1 ||
    typeof b.cancelRescheduleNoticeHours !== "number" ||
    b.cancelRescheduleNoticeHours < 0 ||
    (b.dailyCap !== null && (typeof b.dailyCap !== "number" || b.dailyCap < 1)) ||
    typeof b.startTimeIntervalMinutes !== "number" ||
    b.startTimeIntervalMinutes < 5
  ) {
    return null;
  }
  return {
    minNoticeHours: b.minNoticeHours,
    maxAdvanceDays: b.maxAdvanceDays,
    cancelRescheduleNoticeHours: b.cancelRescheduleNoticeHours,
    dailyCap: b.dailyCap as number | null,
    startTimeIntervalMinutes: b.startTimeIntervalMinutes,
  };
}

export async function PUT(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid scheduling limits." }, { status: 400 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("scheduling_limits")
    .update({
      min_notice_hours: payload.minNoticeHours,
      max_advance_days: payload.maxAdvanceDays,
      cancel_reschedule_notice_hours: payload.cancelRescheduleNoticeHours,
      daily_cap: payload.dailyCap,
      start_time_interval_minutes: payload.startTimeIntervalMinutes,
    })
    .eq("id", true)
    .select()
    .single();

  if (error) {
    console.error("scheduling_limits update failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ limits: data });
}
