import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { SESSION_TYPES } from "@/lib/leads";

// Manual lead entry (referrals, phone calls) — leads.status defaults to
// "new" and source to "manual" via the table's column defaults.

type Payload = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, email, sessionType, message } = body as Record<
    string,
    unknown
  >;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof sessionType !== "string" ||
    typeof message !== "string"
  ) {
    return null;
  }

  const trimmed = {
    name: name.trim(),
    email: email.trim(),
    sessionType: sessionType.trim(),
    message: message.trim(),
  };

  if (
    !trimmed.name ||
    !EMAIL_REGEX.test(trimmed.email) ||
    !SESSION_TYPES.includes(
      trimmed.sessionType as (typeof SESSION_TYPES)[number],
    ) ||
    !trimmed.message
  ) {
    return null;
  }

  return trimmed;
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
      { error: "Please fill out all fields with a valid email address." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("leads")
    .insert({
      name: payload.name,
      email: payload.email,
      session_type: payload.sessionType,
      message: payload.message,
      source: "manual",
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create lead:", error);
    return Response.json({ error: "Failed to create lead." }, { status: 500 });
  }

  return Response.json({ ok: true, lead: data });
}
