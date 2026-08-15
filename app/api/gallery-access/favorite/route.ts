import { getSupabaseClient } from "@/lib/supabase";
import { isGalleryUnavailable } from "@/lib/gallery";
import { isValidFavoriteToken } from "@/lib/galleryFavoriteToken";

type Payload = {
  slug: string;
  imageKey: string;
  favoriteToken: string;
  favorited: boolean;
};

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slug, imageKey, favoriteToken, favorited } = body as Record<
    string,
    unknown
  >;

  if (
    typeof slug !== "string" ||
    typeof imageKey !== "string" ||
    typeof favoriteToken !== "string" ||
    typeof favorited !== "boolean" ||
    !slug ||
    !imageKey ||
    !favoriteToken
  ) {
    return null;
  }

  return { slug, imageKey, favoriteToken, favorited };
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

  // Cheap and stateless — checked before any database work, since an
  // invalid/expired token can't do anything here regardless of what the
  // gallery lookup below would find.
  if (!isValidFavoriteToken(payload.slug, payload.favoriteToken)) {
    return Response.json({ error: "Session expired." }, { status: 401 });
  }

  // Make sure the claimed imageKey actually belongs to this gallery's R2
  // prefix (matching listGalleryImages in lib/r2.ts) — otherwise a valid
  // token for one gallery could be used to favorite/unfavorite an
  // arbitrary key in another gallery's namespace.
  if (!payload.imageKey.startsWith(`galleries/${payload.slug}/`)) {
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
    .select("id, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!gallery) {
    return Response.json({ error: "Gallery not found." }, { status: 404 });
  }

  // Same defense-in-depth as the check in gallery-access: if a gallery
  // becomes archived or its expires_at passes mid-session, favoriting
  // stops working too, not just the initial unlock.
  if (isGalleryUnavailable(gallery)) {
    return Response.json({ error: "This gallery has expired." }, { status: 410 });
  }

  if (payload.favorited) {
    const { error: upsertError } = await supabase.from("gallery_favorites").upsert(
      { gallery_id: gallery.id, image_key: payload.imageKey },
      { onConflict: "gallery_id,image_key", ignoreDuplicates: true },
    );
    if (upsertError) {
      console.error("Failed to save favorite:", upsertError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  } else {
    const { error: deleteError } = await supabase
      .from("gallery_favorites")
      .delete()
      .eq("gallery_id", gallery.id)
      .eq("image_key", payload.imageKey);
    if (deleteError) {
      console.error("Failed to remove favorite:", deleteError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
