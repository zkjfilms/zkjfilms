// Shared availability check for galleries — used by both the page
// (app/gallery/[slug]/page.tsx) and the access API
// (app/api/gallery-access/route.ts) so the two can't drift out of sync.
//
// Archived and expired are deliberately independent: a gallery can be
// archived immediately regardless of its expires_at, and expires_at can
// still be set/inspected on an archived gallery for later reference.

export type GalleryAvailability = {
  expires_at: string | null;
  archived_at: string | null;
};

export function isGalleryUnavailable(gallery: GalleryAvailability): boolean {
  if (gallery.archived_at !== null) return true;
  if (gallery.expires_at !== null) {
    return new Date(gallery.expires_at).getTime() < Date.now();
  }
  return false;
}
