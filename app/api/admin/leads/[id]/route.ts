import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { LEAD_STATUSES } from "@/lib/leads";

type PatchPayload = { status?: string; notes?: string };

function parsePatchPayload(body: unknown): PatchPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const { status, notes } = body as Record<string, unknown>;

  const payload: PatchPayload = {};

  if (status !== undefined) {
    if (
      typeof status !== "string" ||
      !LEAD_STATUSES.includes(status as (typeof LEAD_STATUSES)[number])
    ) {
      return null;
    }
    payload.status = status;
  }

  if (notes !== undefined) {
    if (typeof notes !== "string") return null;
    payload.notes = notes;
  }

  if (payload.status === undefined && payload.notes === undefined) {
    return null;
  }

  return payload;
}

async function isAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePatchPayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("leads")
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to update lead:", error);
    return Response.json({ error: "Failed to update lead." }, { status: 500 });
  }

  if (!data) {
    return Response.json({ error: "Lead not found." }, { status: 404 });
  }

  return Response.json({ ok: true, lead: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await isAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { id } = await params;

  const supabase = getSupabaseClient();
  const { error } = await supabase.from("leads").delete().eq("id", id);

  if (error) {
    console.error("Failed to delete lead:", error);
    return Response.json({ error: "Failed to delete lead." }, { status: 500 });
  }

  return Response.json({ ok: true });
}
