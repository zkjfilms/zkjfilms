import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, SIGNED_URL_EXPIRY_SECONDS } from "@/lib/r2";
import { isGalleryUnavailable } from "@/lib/gallery";
import { peekRateLimit, recordRateLimitHit, getClientIp } from "@/lib/rateLimit";

type Payload = { slug: string; password: string; pin?: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slug, password, pin } = body as Record<string, unknown>;

  if (
    typeof slug !== "string" ||
    typeof password !== "string" ||
    !slug ||
    !password
  ) {
    return null;
  }

  if (pin !== undefined && typeof pin !== "string") {
    return null;
  }

  return { slug, password, pin };
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

  const ip = getClientIp(request);
  const RATE_LIMIT_WINDOW_MINUTES = 15;

  const { allowed: ipAllowed } = await peekRateLimit({
    ip,
    endpoint: "gallery-access",
    maxHits: 10,
    windowMinutes: RATE_LIMIT_WINDOW_MINUTES,
  });
  if (!ipAllowed) {
    return Response.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429 },
    );
  }

  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("password_hash, pin_hash, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!gallery) {
    return Response.json({ error: "Gallery not found." }, { status: 404 });
  }

  // Checked before the password so an expired/archived gallery never
  // confirms or denies a password guess — same reasoning as checking
  // existence first.
  if (isGalleryUnavailable(gallery)) {
    return Response.json({ error: "This gallery has expired." }, { status: 410 });
  }

  // A second, gallery-scoped budget, checked only after confirming the
  // gallery exists (so it can't be used to probe slugs) — deliberately
  // shared across every requesting IP via the constant "global" key,
  // not per-IP, so a distributed attacker who already has the password
  // can't brute-force a PIN by spreading guesses across many IPs. Looser
  // than the per-IP budget since it has to accommodate every legitimate
  // visitor to this one gallery combined, not just one household.
  const GALLERY_RATE_LIMIT_KEY = "global";
  const galleryEndpoint = `gallery-access:${payload.slug}`;
  const { allowed: galleryAllowed } = await peekRateLimit({
    ip: GALLERY_RATE_LIMIT_KEY,
    endpoint: galleryEndpoint,
    maxHits: 50,
    windowMinutes: 60,
  });
  if (!galleryAllowed) {
    return Response.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429 },
    );
  }

  // Only a *failed* password/PIN attempt records a hit against either
  // budget — a successful request never consumes budget, so legitimate
  // multi-tab/multi-device use (which can cost 2 requests per unlock on
  // a PIN-protected gallery, and re-authenticates per tab since the
  // unlocked session lives in sessionStorage) can't lock a real client
  // out. Every failed guess still counts, which is what actually
  // throttles brute force.
  async function recordFailedAttempt() {
    await recordRateLimitHit({ ip, endpoint: "gallery-access" });
    await recordRateLimitHit({ ip: GALLERY_RATE_LIMIT_KEY, endpoint: galleryEndpoint });
  }

  const passwordMatches = await bcrypt.compare(
    payload.password,
    gallery.password_hash,
  );

  if (!passwordMatches) {
    await recordFailedAttempt();
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  if (gallery.pin_hash) {
    if (!payload.pin) {
      return Response.json({ ok: true, pinRequired: true });
    }

    const pinMatches = await bcrypt.compare(payload.pin, gallery.pin_hash);
    if (!pinMatches) {
      await recordFailedAttempt();
      return Response.json({ error: "Incorrect PIN." }, { status: 401 });
    }
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
