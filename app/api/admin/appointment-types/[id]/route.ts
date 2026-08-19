import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

type UpdatePayload = Partial<{
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  requiresPayment: boolean;
  usesBoudoirReminder: boolean;
  color: string;
  active: boolean;
  sortOrder: number;
}>;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as UpdatePayload | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.durationMinutes !== undefined) update.duration_minutes = body.durationMinutes;
  if (body.bufferBeforeMinutes !== undefined) update.buffer_before_minutes = body.bufferBeforeMinutes;
  if (body.bufferAfterMinutes !== undefined) update.buffer_after_minutes = body.bufferAfterMinutes;
  if (body.priceCents !== undefined) update.price_cents = body.priceCents;
  if (body.requiresPayment !== undefined) update.requires_payment = body.requiresPayment;
  if (body.usesBoudoirReminder !== undefined) update.uses_boudoir_reminder = body.usesBoudoirReminder;
  if (body.color !== undefined) update.color = body.color;
  if (body.active !== undefined) update.active = body.active;
  if (body.sortOrder !== undefined) update.sort_order = body.sortOrder;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("appointment_types")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("appointment_types update failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ appointmentType: data });
}
