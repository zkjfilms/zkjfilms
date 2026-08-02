import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, SIGNED_URL_EXPIRY_SECONDS } from "@/lib/r2";

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
    .select("password_hash, expires_at")
    .eq("slug", payload.slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!gallery) {
    return Response.json({ error: "Gallery not found." }, { status: 404 });
  }

  // Checked before the password so an expired gallery never confirms or
  // denies a password guess — same reasoning as checking existence first.
  if (
    gallery.expires_at !== null &&
    new Date(gallery.expires_at).getTime() < Date.now()
  ) {
    return Response.json({ error: "This gallery has expired." }, { status: 410 });
  }

  const passwordMatches = await bcrypt.compare(
    payload.password,
    gallery.password_hash,
  );

  if (!passwordMatches) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  // The client caches this response (including expiresAt) in
  // sessionStorage so it doesn't need to re-verify the password on every
  // page load — expiresAt tells it when to drop the cache and re-prompt,
  // matching how long the signed image URLs below stay valid.
  const expiresAt = Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000;

  // The password was correct — don't fail the whole unlock just because
  // R2 is unreachable. The client shows a distinct "couldn't load photos"
  // state when imagesError is set instead of an empty gallery.
  try {
    const images = await listGalleryImages(payload.slug);
    return Response.json({ ok: true, images, expiresAt });
  } catch (err) {
    console.error("Failed to list gallery images from R2:", err);
    return Response.json({ ok: true, images: [], imagesError: true, expiresAt });
  }
}
