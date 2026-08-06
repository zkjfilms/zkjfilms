import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { broadcastAvailabilityChange } from "@/lib/realtimeBroadcast";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("blocked_times")
    .select("id, date, start_time, end_time, reason")
    .eq("date", date)
    .order("start_time", { ascending: true });

  if (error) {
    console.error("blocked_times list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ blockedTimes: data });
}

type CreatePayload = { date: string; startTime: string; endTime: string; reason: string };

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string" ||
    typeof b.endTime !== "string" ||
    b.endTime <= b.startTime ||
    typeof b.reason !== "string"
  ) {
    return null;
  }
  return { date: b.date, startTime: b.startTime, endTime: b.endTime, reason: b.reason.trim() };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid blocked time." }, { status: 400 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("blocked_times")
    .insert({
      date: payload.date,
      start_time: payload.startTime,
      end_time: payload.endTime,
      reason: payload.reason || null,
    })
    .select()
    .single();

  if (error) {
    console.error("blocked_times insert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  await broadcastAvailabilityChange({ date: payload.date });
  return Response.json({ blockedTime: data }, { status: 201 });
}
