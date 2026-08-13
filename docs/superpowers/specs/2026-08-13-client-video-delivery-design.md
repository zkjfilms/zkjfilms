# Client Video Delivery (mixed into existing galleries)

## Problem

Client galleries (`app/gallery/[slug]`, backed by `lib/r2.ts`'s private R2 bucket) only ever display photos — `scripts/gallery.mjs`'s `upload()` only recognizes image extensions. There's no way to deliver video work (a wedding highlight reel, a session's video component) to a client through the same password/PIN-protected gallery they already use for their photos. This is the second of two video features discussed — the first, public showcase videos on `/films`, is already shipped and explicitly separate infrastructure (public bucket, its own table).

## Goal

Let video files be uploaded into an existing client gallery alongside photos, through the same `gallery:upload` command, and displayed inline in the same grid/lightbox — no separate video section, no separate access gate, no manual thumbnail step.

## Design

### Storage

No new bucket, no new table. Videos live in the exact same place photos already do: the private client-gallery R2 bucket (`lib/r2.ts`, `R2_BUCKET_NAME`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY` — never the public bucket used by showcase videos), under the same `galleries/<slug>/` prefix. The gallery's password/PIN gate already controls that entire prefix, so video delivery inherits access control, expiration, and archiving with zero new code.

### Upload (`scripts/gallery.mjs`)

`upload()` already scans a local folder, checks each file's extension against `UPLOAD_CONTENT_TYPES`, and uploads matches while skipping/warning on the rest. Add one entry:

```js
const UPLOAD_CONTENT_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
};
```

That's the entire upload-side change. A shoot folder containing both photos and `.mp4` clips uploads in one `gallery:upload` call, same as today. MP4 only for v1 (matches the showcase-videos decision: universal native browser playback, no transcoding pipeline).

### Data layer (`lib/r2.ts`)

`listGalleryImages` currently returns `GalleryImage[]` (`key`, `url`, `downloadUrl`, `filename`) for everything under the prefix, with no type distinction — it already doesn't care what kind of file it's listing. Renamed to `GalleryMedia` (the type name `GalleryImage` stops being accurate once it can hold videos) with one new field:

```ts
export type GalleryMedia = {
  key: string;
  url: string;
  downloadUrl: string;
  filename: string;
  isVideo: boolean;
};
```

`isVideo` is computed from the filename extension (a small `VIDEO_EXTENSIONS = new Set([".mp4"])` check) inside `listGalleryImages`, no other logic change — signed URL generation (`getSignedUrl` + `GetObjectCommand`) is identical for both file types, and R2 presigned GET URLs support HTTP Range requests regardless of content type, so video seeking/scrubbing works the same way it already does for the public showcase videos.

Every other file that imports the `GalleryImage` type (`app/api/gallery-access/route.ts`, `GalleryGate.tsx`, `GalleryLightbox.tsx`) updates its import to `GalleryMedia` — a rename, not a behavior change.

### Grid display (`GalleryGate.tsx`)

Each tile currently renders a plain `<img>`. Conditional on `media.isVideo`:

```tsx
{media.isVideo ? (
  <video
    src={media.url}
    preload="metadata"
    muted
    playsInline
    className="h-full w-full object-cover"
  />
) : (
  <img src={media.url} ... /> // unchanged
)}
```

`preload="metadata"` fetches just enough of the file for the browser to display its first frame — no separate poster image, no upload-time extra step, unlike the showcase videos' curated-poster requirement (a deliberate difference: a showcase reel is one hand-picked piece, a client delivery can be dozens of raw clips, and requiring a poster per clip doesn't scale the same way). A small play-icon overlay (reusing the site's existing thin-stroke SVG icon convention, e.g. the caret/hamburger icons in `Navbar.tsx`) sits centered on video tiles so it reads as a video before it's clicked.

Selection checkboxes, "Download all"/"Download selected", and the per-tile hover download link are all already format-agnostic — they operate on `key`/`downloadUrl`/`filename`, never on file type. No changes needed there.

### Lightbox (`GalleryLightbox.tsx`)

Conditional on `media.isVideo`, swaps the `<img>` for:

```tsx
<video
  src={media.url}
  controls
  onClick={(e) => e.stopPropagation()}
  className="max-h-full max-w-full object-contain"
/>
```

No `autoPlay` — opening the lightbox on a video shows the player paused with controls, matching how photos don't do anything automatic either. Arrow-key/button navigation between lightbox items is unchanged and works uniformly across a mixed photo/video set (`images.length`, `index` logic doesn't care what's at each index).

### Out of scope

- Poster/thumbnail image upload option for client videos (auto-only, per the design decision above).
- Any video format beyond MP4.
- Scrubbing-preview thumbnails, duration badges, or other video-specific UI polish beyond the play-icon overlay described above.
- Any change to the showcase-videos feature (`/films`, public bucket, `videos` table) — entirely separate infrastructure, untouched by this work.
- Any change to gallery creation, expiration, archiving, or the password/PIN access flow — this feature adds a file type to an existing, unmodified access-control boundary.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- `npm run gallery:upload -- <existing-test-slug> <folder-with-photos-and-one-mp4>`: confirm both photos and the video upload in one pass, with the video correctly getting `Content-Type: video/mp4`.
- Browser, unlocked gallery view: confirm the video tile renders a first-frame thumbnail (not a broken/blank box) with a visible play-icon overlay, sitting in the same grid as photo tiles with no layout break.
- Click the video tile: confirm the lightbox opens with a working, controllable `<video>` player (play/pause/seek/volume), not autoplaying.
- Confirm arrow-key/button navigation moves correctly between photo and video items in the lightbox in either direction.
- Confirm "Select this photo" checkbox and "Download all"/"Download selected" work correctly when a video is included in the selection (the video file downloads with the correct filename, same as a photo would).
- Confirm an existing photo-only gallery (e.g. `andi`, no videos) renders and behaves completely unchanged — no visual or functional regression for galleries with zero video files.
