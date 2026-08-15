import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, type GalleryMedia } from "@/lib/r2";
import GalleryPhotoGrid from "@/app/gallery/[slug]/GalleryPhotoGrid";
import NotifyClientPanel from "./NotifyClientPanel";
import { getConfirmedBookingClients } from "@/lib/clientDirectory";

// robots noindex is inherited from app/admin/layout.tsx.
export function generateMetadata(): Metadata {
  return { title: "Admin — Gallery" };
}

export default async function AdminGalleryDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = getSupabaseClient();

  // Deliberately not gated by isGalleryUnavailable — unlike the
  // client-facing /gallery/[slug] route, the photographer should still
  // be able to pull favorites/downloads from an archived or expired
  // gallery for their own reference.
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("id, title, client_name, client_email, credentials_sent_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("Supabase gallery lookup failed:", error);
  }

  if (!gallery) {
    return (
      <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
        <p className="text-muted">Gallery not found.</p>
      </div>
    );
  }

  const { data: favoriteRows, error: favoritesError } = await supabase
    .from("gallery_favorites")
    .select("image_key")
    .eq("gallery_id", gallery.id);

  if (favoritesError) {
    console.error("Failed to load gallery favorites:", favoritesError);
  }
  const favoritedKeys = new Set((favoriteRows ?? []).map((row) => row.image_key));

  let images: GalleryMedia[];
  let imagesError = false;
  try {
    images = await listGalleryImages(slug);
  } catch (err) {
    console.error("Failed to list gallery images from R2:", err);
    images = [];
    imagesError = true;
  }

  const directory = await getConfirmedBookingClients(supabase);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">
          {gallery.client_name}
        </p>
        <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">
          {gallery.title}
        </h1>
      </div>

      {imagesError ? (
        <p className="text-center text-muted">
          Photos couldn&rsquo;t be loaded from R2 right now.
        </p>
      ) : images.length === 0 ? (
        <p className="text-center text-muted">No photos uploaded yet.</p>
      ) : (
        <GalleryPhotoGrid title={gallery.title} images={images} favoritedKeys={favoritedKeys} />
      )}

      <NotifyClientPanel
        slug={slug}
        initialClientEmail={gallery.client_email}
        initialSentAt={gallery.credentials_sent_at}
        directory={directory}
      />
    </div>
  );
}
