// Token-fill for the "gallery_ready" template (see /admin/templates),
// analogous to lib/contracts.ts's fillTemplate but with this template's
// own distinct token set.

export type GalleryReadyValues = {
  clientName: string;
  galleryTitle: string;
  galleryUrl: string;
  galleryPassword: string;
  galleryPin: string;
};

export function fillGalleryReadyTemplate(
  content: string,
  values: GalleryReadyValues,
): string {
  return content
    .replaceAll("{{client_name}}", values.clientName)
    .replaceAll("{{gallery_title}}", values.galleryTitle)
    .replaceAll("{{gallery_url}}", values.galleryUrl)
    .replaceAll("{{gallery_password}}", values.galleryPassword)
    .replaceAll("{{gallery_pin}}", values.galleryPin);
}
