import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { DISCOUNT_CODE_TYPES, isValidDiscountValue, type DiscountCodeType } from "@/lib/discountCodes";

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
    .from("discount_codes")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("discount_codes list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ discountCodes: data });
}

type CreatePayload = {
  code: string;
  type: DiscountCodeType;
  value: number;
  active: boolean;
  expiresAt: string | null;
  maxRedemptions: number | null;
  appointmentTypeIds: string[] | null;
};

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.code !== "string" ||
    !b.code.trim() ||
    typeof b.type !== "string" ||
    !DISCOUNT_CODE_TYPES.includes(b.type as DiscountCodeType) ||
    typeof b.value !== "number" ||
    !isValidDiscountValue(b.type as DiscountCodeType, b.value) ||
    typeof b.active !== "boolean" ||
    (b.expiresAt !== null && typeof b.expiresAt !== "string") ||
    (b.maxRedemptions !== null &&
      (typeof b.maxRedemptions !== "number" || !Number.isInteger(b.maxRedemptions) || b.maxRedemptions <= 0)) ||
    (b.appointmentTypeIds !== null &&
      !(Array.isArray(b.appointmentTypeIds) && b.appointmentTypeIds.every((id) => typeof id === "string")))
  ) {
    return null;
  }
  return {
    code: b.code.trim().toUpperCase(),
    type: b.type as DiscountCodeType,
    value: b.value,
    active: b.active,
    expiresAt: b.expiresAt as string | null,
    maxRedemptions: b.maxRedemptions as number | null,
    appointmentTypeIds:
      Array.isArray(b.appointmentTypeIds) && b.appointmentTypeIds.length > 0
        ? (b.appointmentTypeIds as string[])
        : null,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid discount code." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("discount_codes")
    .insert({
      code: payload.code,
      type: payload.type,
      value: payload.value,
      active: payload.active,
      expires_at: payload.expiresAt,
      max_redemptions: payload.maxRedemptions,
      appointment_type_ids: payload.appointmentTypeIds,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      return Response.json({ error: "That code already exists." }, { status: 409 });
    }
    console.error("discount_codes insert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ discountCode: data }, { status: 201 });
}
