import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { isGalleryUnavailable } from "@/lib/gallery";
import { generateGalleryPassword, generateGalleryPin } from "@/lib/galleryCredentials";
import { fillGalleryReadyTemplate } from "@/lib/galleryReadyEmail";
import { sendGalleryReadyEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/seo";

type Payload = { clientEmail: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { clientEmail } = body as Record<string, unknown>;
  if (typeof clientEmail !== "string" || !clientEmail.includes("@")) {
    return null;
  }
  return { clientEmail };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { slug } = await params;

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
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("id, title, client_name, expires_at, archived_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!gallery) {
    return Response.json({ error: "Gallery not found." }, { status: 404 });
  }

  // Sending credentials for a gallery the client can't actually reach is
  // nonsensical — unlike the admin gallery *view* (app/admin/galleries/
  // [slug]/page.tsx), which deliberately skips this check so the
  // photographer can still browse an archived/expired gallery's photos.
  if (isGalleryUnavailable(gallery)) {
    return Response.json({ error: "This gallery has expired." }, { status: 410 });
  }

  const password = generateGalleryPassword();
  const pin = generateGalleryPin();
  const [passwordHash, pinHash] = await Promise.all([
    bcrypt.hash(password, 10),
    bcrypt.hash(pin, 10),
  ]);

  // Persist before sending — the reverse of app/api/admin/contracts/[id]/
  // send-email/route.ts's ordering. There, the DB update is pure
  // bookkeeping (email_sent_at) with no functional consequence if it
  // fails. Here, the DB update IS the functional artifact: the emailed
  // password only works once its hash is saved. Sending first and
  // persisting second would mean a persist failure leaves the client
  // holding a password that was never actually saved, with no fallback
  // credential for a first-ever send. Persisting first means the worst
  // case on a later failure is "credentials rotated, admin sees them
  // once in this response and can relay manually or just retry."
  const sentAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("galleries")
    .update({
      password_hash: passwordHash,
      pin_hash: pinHash,
      client_email: payload.clientEmail,
      credentials_sent_at: sentAt,
    })
    .eq("id", gallery.id);

  if (updateError) {
    console.error("Failed to persist rotated gallery credentials:", updateError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  // Anything from here on can fail independently (template fetch error,
  // missing template row, or the send itself) — all land in the same
  // fallback, since credentials are already rotated at this point: hand
  // the one-time plaintext back in the response rather than losing it.
  const { data: template, error: templateError } = await supabase
    .from("templates")
    .select("content")
    .eq("template_type", "gallery_ready")
    .maybeSingle();

  if (templateError || !template) {
    console.error("Failed to load gallery_ready template:", templateError);
    return Response.json(
      {
        error: "Credentials were reset, but the email failed to send. Copy these and send them yourself, or try again.",
        password,
        pin,
      },
      { status: 502 },
    );
  }

  const bodyText = fillGalleryReadyTemplate(template.content, {
    clientName: gallery.client_name,
    galleryTitle: gallery.title,
    galleryUrl: `${SITE_URL}/gallery/${slug}`,
    galleryPassword: password,
    galleryPin: pin,
  });

  const result = await sendGalleryReadyEmail({
    clientEmail: payload.clientEmail,
    galleryTitle: gallery.title,
    bodyText,
  });

  if (!result.ok) {
    console.error("Failed to send gallery-ready email:", result.error);
    return Response.json(
      {
        error: "Credentials were reset, but the email failed to send. Copy these and send them yourself, or try again.",
        password,
        pin,
      },
      { status: 502 },
    );
  }

  return Response.json({ ok: true, sentAt });
}
