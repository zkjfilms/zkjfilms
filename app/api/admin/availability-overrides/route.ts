import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { resolveHoursForDate } from "@/lib/scheduling";
import { broadcastAvailabilityChange } from "@/lib/realtimeBroadcast";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

function daysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    days.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`,
    );
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const monthParam = new URL(request.url).searchParams.get("month");
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    return Response.json({ error: "month must be YYYY-MM." }, { status: 400 });
  }
  const [year, month] = monthParam.split("-").map(Number);
  const dates = daysInMonth(year, month);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const supabase = getSupabaseClient();
  const [{ data: rules }, { data: overrides }, { data: blocked }] = await Promise.all([
    supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
    supabase
      .from("availability_overrides")
      .select("date, start_time, end_time, is_closed")
      .gte("date", firstDate)
      .lte("date", lastDate),
    supabase
      .from("blocked_times")
      .select("date")
      .gte("date", firstDate)
      .lte("date", lastDate),
  ]);

  const rulesShaped = (rules ?? []).map((r) => ({
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
  const overridesShaped = (overrides ?? []).map((o) => ({
    date: o.date,
    startTime: o.start_time,
    endTime: o.end_time,
    isClosed: o.is_closed,
  }));
  const blockedCounts = new Map<string, number>();
  for (const b of blocked ?? []) {
    blockedCounts.set(b.date, (blockedCounts.get(b.date) ?? 0) + 1);
  }

  const days = dates.map((date) => ({
    date,
    hours: resolveHoursForDate(date, rulesShaped, overridesShaped),
    hasOverride: overridesShaped.some((o) => o.date === date),
    blockedCount: blockedCounts.get(date) ?? 0,
  }));

  return Response.json({ days });
}

type OverridePayload =
  | { isClosed: true }
  | { isClosed: false; startTime: string; endTime: string }
  | { clear: true };

function parseOverridePayload(body: unknown): OverridePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.clear === true) return { clear: true };
  if (b.isClosed === true) return { isClosed: true };
  if (
    b.isClosed === false &&
    typeof b.startTime === "string" &&
    typeof b.endTime === "string" &&
    b.endTime > b.startTime
  ) {
    return { isClosed: false, startTime: b.startTime, endTime: b.endTime };
  }
  return null;
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  const payload = parseOverridePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid override payload." }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  if ("clear" in payload) {
    const { error } = await supabase.from("availability_overrides").delete().eq("date", date);
    if (error) {
      console.error("availability_overrides delete failed:", error);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
    await broadcastAvailabilityChange({ date });
    return Response.json({ ok: true });
  }

  const row: {
    date: string;
    is_closed: boolean;
    start_time: string | null;
    end_time: string | null;
  } =
    payload.isClosed === true
      ? { date, is_closed: true, start_time: null, end_time: null }
      : { date, is_closed: false, start_time: payload.startTime, end_time: payload.endTime };

  const { error } = await supabase.from("availability_overrides").upsert(row, { onConflict: "date" });
  if (error) {
    console.error("availability_overrides upsert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  await broadcastAvailabilityChange({ date });
  return Response.json({ ok: true });
}
