import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

type Payload = { startTime: string; endTime: string; sessionType: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { startTime, endTime, sessionType } = body as Record<string, unknown>;

  if (
    typeof startTime !== "string" ||
    typeof endTime !== "string" ||
    typeof sessionType !== "string"
  ) {
    return null;
  }

  const start = new Date(startTime);
  const end = new Date(endTime);
  const trimmedType = sessionType.trim();

  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start ||
    !trimmedType
  ) {
    return null;
  }

  return {
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    sessionType: trimmedType,
  };
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json(
      { error: "Please provide a valid time range and session type." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("booking_slots")
    .insert({
      start_time: payload.startTime,
      end_time: payload.endTime,
      session_type: payload.sessionType,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create booking slot:", error);
    return Response.json({ error: "Failed to create slot." }, { status: 500 });
  }

  return Response.json({ ok: true, slot: data });
}
