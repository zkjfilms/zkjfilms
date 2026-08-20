# Masonry Gallery for /headshots and /creative-portraits — Design

**Goal:** Replace the full-splash `Gallery` layout on `/headshots` and `/creative-portraits` with a true masonry grid — mixed horizontal/vertical photos tiled edge-to-edge, each shown at its own natural aspect ratio with no cropping — plus a click-to-enlarge lightbox. `/portraits` and Boudoir keep their current full-splash format untouched.

## Why this shape

Three real alternatives were considered and rejected in favor of true masonry:

1. **Fixed-shape tiles, cropped to fill (`object-fit: cover`)** — the classic mosaic look, but cropping risks cutting off the subject of a photo, which would have required a face/subject-detection pipeline (`smartcrop-sharp` + face detection) to keep crops sensible. Rejected: real added complexity for a problem the next option sidesteps entirely.
2. **Fixed-shape tiles, full image shown (`object-fit: contain`)** — zero cropping logic, but a photo whose aspect ratio doesn't match its tile slot leaves visible empty space, which looks inconsistent in a tightly-packed grid. Rejected for the visual inconsistency.
3. **True masonry — each tile's shape matches its own photo's aspect ratio** (chosen). No cropping, no empty space, no subject-detection pipeline needed at all, since nothing ever gets cut off. Still a genuine mosaic of mixed horizontal/vertical photos — just an organic Pinterest-style rhythm rather than a rigid grid of uniform slots.

**Layout mechanism:** CSS multi-column (`columns-1 sm:columns-2 lg:columns-3`), not native CSS masonry. Checked current browser support directly: as of mid-2026 only Safari 26.4 ships the new `display: grid-lanes` masonry approach unflagged — Chrome and Firefox both still have it behind experimental flags. Not safe to rely on in production yet. CSS multi-column has been universally supported for years and produces the same visual result for this use case (each image naturally sized to its own aspect ratio, flowing into whichever column is shortest).

**Important existing-code constraint, caught while reading the codebase, not assumed:** `/portraits` does not render through `HEADSHOTS_SERVICE`/`CREATIVE_PORTRAITS_SERVICE` — it directly imports and reuses `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY` (the existing `GalleryGroup` constants) for its own continuous, renumbered scroll. Those constants and the existing `Gallery` component are untouched by this project. The new masonry data lives in entirely separate constants — `/portraits` and the dedicated service pages become independent photo sets going forward (portraits keeps its own curated highlight reel; the dedicated pages show the full masonry), which is the sensible default here, not an oversight.

## Data model

A new, deliberately simple type — no `single`/`pair` block concept, since masonry needs nothing beyond a flat list with real dimensions:

```ts
// lib/masonryPhotos.ts (new file — kept separate from lib/services.ts,
// which is already sizeable and owns a different, older gallery format)
export type MasonryPhoto = {
  key: string;      // stable identifier, also used as the React key
  width: number;     // real pixel width, from sharp at upload time
  height: number;    // real pixel height, from sharp at upload time
  alt: string;
  src: string;        // publicImageUrl(...) for real photos, a picsum URL for placeholders
};
```

`Service` (in `lib/services.ts`) gets a new optional field:

```ts
export type Service = {
  // ...existing fields unchanged...
  gallery: GalleryGroup | null;
  masonryPhotos?: MasonryPhoto[]; // new
};
```

`ServiceLandingPage` branches: render the new `MasonryGallery` when `service.masonryPhotos` is set, otherwise fall back to the existing `Gallery` when `service.gallery` is set (Boudoir, whose `gallery` is `null`, and any future full-splash page, are both unaffected). `HEADSHOTS_SERVICE`/`CREATIVE_PORTRAITS_SERVICE` get `masonryPhotos` populated and `gallery: null` — they stop using the old format on their own dedicated pages, while `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY` remain exactly as they are for `/portraits`'s continued direct use.

**Placeholder data:** until real photos are uploaded, `HEADSHOTS_MASONRY_PHOTOS`/`CREATIVE_PORTRAITS_MASONRY_PHOTOS` use `picsum.photos` URLs (already an allowed `next/image` remote host) with deliberately varied width/height pairs — a real mix of landscape and portrait dimensions, not all one shape — so the masonry actually looks like a masonry before any real content exists.

## Sub-project A: upload-time photo metadata

Extends `scripts/uploadImage.mjs`, which today just uploads a file and prints its public URL. Two additions, both computed once at upload time and printed as a ready-to-paste snippet — nothing is auto-published, the photographer still reviews and pastes every entry by hand, same as today:

**1. Real dimensions via `sharp`.** `sharp` is already present in `node_modules` (a Next.js transitive dependency for its own image optimization) but isn't declared as a direct dependency — add it explicitly to `package.json` rather than relying on an undeclared transitive install, which could silently break if Next.js ever changes how it uses `sharp`.

```js
import sharp from "sharp";
// ...after the existing upload...
const { width, height } = await sharp(body).metadata();
```

**2. AI-suggested alt text via a direct Anthropic API vision call.** New `@anthropic-ai/sdk` dependency and `ANTHROPIC_API_KEY` env var (not currently present in this project — a new setup step, same as Twilio was). Matches this codebase's established pattern of direct per-service SDK integration (Resend, Stripe, Twilio) rather than an abstraction/gateway layer — this is a one-off build-time script call, not a live app-runtime AI feature, so there's no ongoing request-routing need that would justify a gateway.

```js
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: requireEnv("ANTHROPIC_API_KEY") });
const response = await anthropic.messages.create({
  model: "claude-sonnet-5",
  max_tokens: 200,
  messages: [{
    role: "user",
    content: [
      { type: "image", source: { type: "base64", media_type: contentType, data: body.toString("base64") } },
      { type: "text", text: "Write concise, specific SEO alt text for this photo from a Columbia, Missouri portrait/headshot photography portfolio. One sentence, no marketing fluff, describe what's actually visible." },
    ],
  }],
});
```

**Output:** the script prints a ready-to-paste `MasonryPhoto` object literal (key, width, height, alt, src) instead of just the bare URL it prints today.

## Sub-project B: `MasonryGallery` component + lightbox

**Files:** `components/MasonryGallery.tsx` (new), `components/ServiceLandingPage.tsx` (modified to branch on `masonryPhotos`).

**Layout:**

```tsx
<div className="columns-1 gap-3 sm:columns-2 lg:columns-3">
  {photos.map((photo, i) => (
    <button key={photo.key} onClick={() => setLightboxIndex(i)} className="mb-3 block w-full break-inside-avoid">
      <Image
        src={photo.src}
        alt={photo.alt}
        width={photo.width}
        height={photo.height}
        quality={90}
        sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
        className="w-full"
      />
    </button>
  ))}
</div>
```

Real `width`/`height` (not `fill`) is what makes each tile size itself to the photo's own aspect ratio inside its column — this is the entire mechanism, no extra layout math needed. `quality={90}` matches this project's existing convention (already an allowed value in `next.config.ts`'s `qualities` list).

**Lightbox:** a hand-built client component (matching this codebase's pattern of custom-built interactive pieces rather than a UI library) — `selectedIndex: number | null` state in `MasonryGallery`, a full-screen fixed overlay when non-null, showing the selected photo enlarged with prev/next controls, closes on click-outside, an explicit close button, and `Escape`/`ArrowLeft`/`ArrowRight` keyboard handling.

## Out of scope

- No face/subject-detection, no smart-crop — eliminated by the true-masonry choice.
- No pagination/infinite scroll for the masonry grid — out of scope unless photo counts grow large enough to matter; revisit later if needed.
- No changes to `/portraits`, `Gallery.tsx`, `HEADSHOTS_GALLERY`/`CREATIVE_PORTRAITS_GALLERY`, or the Boudoir page.
- No bulk/batch re-processing of already-uploaded photos — this pipeline applies to photos uploaded from here forward; existing images already referenced elsewhere are untouched.
- No lightbox added to the existing `Gallery` component or `/portraits` — scoped to the new `MasonryGallery` only.

## Testing

No automated test suite exists in this repo. Verification is `tsc --noEmit`, `npm run build`, and manual checks: confirm the placeholder masonry renders a genuine mixed-orientation layout at each breakpoint (mobile/tablet/desktop), confirm clicking a tile opens the lightbox with working prev/next/close (click, keyboard, and click-outside), confirm `/portraits` is visually unchanged, and — once real Anthropic/upload testing is possible — confirm the upload script prints correct dimensions and a sensible alt-text suggestion for a real test photo.
