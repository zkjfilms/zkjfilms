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
  const { data, error } = await supabase
    .from("appointment_types")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("appointment_types list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ appointmentTypes: data });
}

type CreatePayload = {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  requiresPayment: boolean;
  usesBoudoirReminder: boolean;
  color: string;
};

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.name !== "string" ||
    !b.name.trim() ||
    typeof b.durationMinutes !== "number" ||
    b.durationMinutes <= 0 ||
    typeof b.bufferBeforeMinutes !== "number" ||
    b.bufferBeforeMinutes < 0 ||
    typeof b.bufferAfterMinutes !== "number" ||
    b.bufferAfterMinutes < 0 ||
    typeof b.priceCents !== "number" ||
    b.priceCents < 0 ||
    typeof b.requiresPayment !== "boolean" ||
    typeof b.usesBoudoirReminder !== "boolean" ||
    typeof b.color !== "string"
  ) {
    return null;
  }
  return {
    name: b.name.trim(),
    durationMinutes: b.durationMinutes,
    bufferBeforeMinutes: b.bufferBeforeMinutes,
    bufferAfterMinutes: b.bufferAfterMinutes,
    priceCents: b.priceCents,
    requiresPayment: b.requiresPayment,
    usesBoudoirReminder: b.usesBoudoirReminder,
    color: b.color,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid appointment type." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: maxRow } = await supabase
    .from("appointment_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("appointment_types")
    .insert({
      name: payload.name,
      duration_minutes: payload.durationMinutes,
      buffer_before_minutes: payload.bufferBeforeMinutes,
      buffer_after_minutes: payload.bufferAfterMinutes,
      price_cents: payload.priceCents,
      requires_payment: payload.requiresPayment,
      uses_boudoir_reminder: payload.usesBoudoirReminder,
      color: payload.color,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (error) {
    console.error("appointment_types insert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ appointmentType: data }, { status: 201 });
}
