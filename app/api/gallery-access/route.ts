import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";

type Payload = { slug: string; password: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slug, password } = body as Record<string, unknown>;

  if (
    typeof slug !== "string" ||
    typeof password !== "string" ||
    !slug ||
    !password
  ) {
    return null;
  }

  return { slug, password };
}

export async function POST(request: Request) {
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

  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    console.error("Failed to create Supabase client:", err);
    return Response.json(
      { error: "Gallery service is not configured yet." },
      { status: 500 },
    );
  }

  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("password_hash")
    .eq("slug", payload.slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!gallery) {
    return Response.json({ error: "Gallery not found." }, { status: 404 });
  }

  const passwordMatches = await bcrypt.compare(
    payload.password,
    gallery.password_hash,
  );

  if (!passwordMatches) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  return Response.json({ ok: true });
}
