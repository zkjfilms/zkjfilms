import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

type Payload = { content: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { content } = body as Record<string, unknown>;
  if (typeof content !== "string") return null;
  return { content };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ type: string }> },
) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { type } = await params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("templates")
    .update({ content: payload.content, updated_at: new Date().toISOString() })
    .eq("template_type", type)
    .select()
    .maybeSingle();

  if (error) {
    console.error("Failed to update template:", error);
    return Response.json(
      { error: "Failed to update template." },
      { status: 500 },
    );
  }

  if (!data) {
    return Response.json({ error: "Template not found." }, { status: 404 });
  }

  return Response.json({ ok: true, template: data });
}
