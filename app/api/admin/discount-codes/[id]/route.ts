import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { DISCOUNT_CODE_TYPES, isValidDiscountValue, type DiscountCodeType } from "@/lib/discountCodes";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

type UpdatePayload = Partial<{
  code: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  appointmentTypeIds: string[] | null;
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
  if (body.code !== undefined) {
    if (typeof body.code !== "string" || !body.code.trim()) {
      return Response.json({ error: "Invalid code." }, { status: 400 });
    }
    update.code = body.code.trim().toUpperCase();
  }
  if (body.type !== undefined) {
    if (!DISCOUNT_CODE_TYPES.includes(body.type)) {
      return Response.json({ error: "Invalid type." }, { status: 400 });
    }
    update.type = body.type;
  }
  if (body.value !== undefined) {
    if (body.type === undefined || !isValidDiscountValue(body.type, body.value)) {
      return Response.json({ error: "Invalid value." }, { status: 400 });
    }
    update.value = body.value;
  }
  if (body.active !== undefined) update.active = body.active;
  if (body.expiresAt !== undefined) update.expires_at = body.expiresAt;
  if (body.maxRedemptions !== undefined) update.max_redemptions = body.maxRedemptions;
  if (body.appointmentTypeIds !== undefined) {
    update.appointment_type_ids =
      body.appointmentTypeIds && body.appointmentTypeIds.length > 0 ? body.appointmentTypeIds : null;
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("discount_codes")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "That code already exists." }, { status: 409 });
    }
    console.error("discount_codes update failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ discountCode: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("discount_codes").delete().eq("id", id);
  if (error) {
    console.error("discount_codes delete failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
