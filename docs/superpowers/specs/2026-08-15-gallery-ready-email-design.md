# Gallery Ready Email Notification

## Problem

There's no automated way to tell a client their gallery is ready. Today the photographer would have to manually copy the password/PIN — printed once by `gallery:create` and never stored in plaintext again, by deliberate design (see `docs/superpowers/specs/2026-08-12-gallery-pin-second-factor-design.md`) — and relay it to the client through some other channel by hand.

## Goal

A "Send gallery-ready email" action on the existing `/admin/galleries/[slug]` page (added in `docs/superpowers/specs/2026-08-15-gallery-favorites-design.md`) that emails the client a link to their gallery plus working credentials, without ever storing plaintext passwords/PINs at rest. Each send generates a brand-new password + PIN (rotate-on-send) rather than persisting a retrievable copy of the old one — the project owner explicitly chose to keep today's security posture (bcrypt-hash-only, no plaintext/encrypted-at-rest secrets) over the convenience of resending unchanged credentials, since resending is expected to be rare. Includes a client-directory-backed name search on the send form to cut down on email-address typos, and a two-step confirm before sending, since sending is consequential (it invalidates any previously shared credentials).

## Design

### Schema

Two new nullable columns on `galleries`, appended to `supabase/schema.sql` after its current final block:

```sql

-- Client-facing "gallery ready" notifications. client_email is set (or
-- updated) whenever an admin sends the notification from
-- /admin/galleries/[slug] — not captured at gallery:create time, since
-- galleries can predate this feature. credentials_sent_at is bookkeeping
-- only (drives the "Not yet sent" / "Last sent <date>" admin UI state);
-- it does not gate anything.
alter table galleries add column if not exists client_email text;
alter table galleries add column if not exists credentials_sent_at timestamptz;
```

A new seeded template row, appended as its own `insert` (the file's established convention is to append new statements, never edit the historical seed block for `model_release`/`booking_agreement`):

```sql

-- Seed placeholder content — replace via /admin/templates before real use.
insert into templates (template_type, content)
values (
  'gallery_ready',
  'Hi {{client_name}},

Your gallery, {{gallery_title}}, is ready to view!

{{gallery_url}}

Password: {{gallery_password}}
PIN: {{gallery_pin}}

Enjoy your photos,
Zach K. Johnson'
)
on conflict (template_type) do nothing;
```

This row makes the template immediately editable at `/admin/templates` through the existing generic `TemplateEditor` component — no new editor UI is needed for this feature.

### `lib/galleryCredentials.ts` (new)

`scripts/gallery.mjs`'s `generatePassword()`/`generatePin()` can't be imported here — that script runs as plain Node, not through Next/TypeScript (the same reason this codebase already hand-duplicates `PUBLIC_IMAGES_BASE_URL`/`UPLOAD_CONTENT_TYPES` between `lib/media.ts`/`lib/r2.ts` and `scripts/uploadImage.mjs`). This file is the TypeScript-side twin, kept in sync by hand with `scripts/gallery.mjs`'s copies — same word list, same shapes:

```ts
import { randomInt } from "node:crypto";

const PASSWORD_WORDS = [
  "dune", "lantern", "willow", "harbor", "ember", "meadow", "cedar",
  "canyon", "ridge", "marble", "violet", "amber", "thistle", "granite",
  "coral", "birch", "quartz", "tundra", "orchid", "copper", "alpine",
  "cinder", "sable", "laurel",
];

export function generateGalleryPassword(): string {
  const words: string[] = [];
  while (words.length < 3) {
    const candidate = PASSWORD_WORDS[randomInt(PASSWORD_WORDS.length)];
    if (!words.includes(candidate)) words.push(candidate);
  }
  const number = randomInt(10, 100);
  return `${words.join("-")}-${number}`;
}

export function generateGalleryPin(): string {
  return String(randomInt(0, 10000)).padStart(4, "0");
}
```

### `lib/galleryReadyEmail.ts` (new)

Token-fill function, analogous to `lib/contracts.ts`'s `fillTemplate` but with this template's own distinct token set (no `session_type`/`session_date`, and two sensitive tokens that contracts' templates never carry):

```ts
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
```

### `lib/email.ts` (extended)

New `sendGalleryReadyEmail`, alongside the file's existing `send*` functions, following their exact shape (`{ ok: true } | { ok: false; error: string }`, `RESEND_API_KEY` check, `FROM_ADDRESS`, plain-text + HTML bodies via `escapeHtml`). Takes the already-filled subject/body (the caller fills the template — this function's job is only sending, matching how `sendSigningLinkEmail` doesn't know about template tokens either):

```ts
export async function sendGalleryReadyEmail(params: {
  clientEmail: string;
  galleryTitle: string;
  bodyText: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [params.clientEmail],
      subject: `${params.galleryTitle} is ready to view`,
      text: params.bodyText,
      html: `<pre style="font-family: inherit; white-space: pre-wrap;">${escapeHtml(params.bodyText)}</pre>`,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

The HTML body is a plain `<pre>`-wrapped escape of the same text the admin edited in `/admin/templates` — this template is short and credential-bearing, not worth a separate rich-HTML layout the admin's plain-text edits would drift out of sync with.

### New route: `app/api/admin/galleries/[slug]/send-ready-email/route.ts`

`POST { clientEmail: string }`, admin-cookie protected — same `isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)` check every other `/api/admin/*` route uses (e.g. `app/api/admin/templates/[type]/route.ts`).

1. Validate `clientEmail` is a non-empty string containing `@` (light validation — Resend/the client's own mail server is the real check, this just catches obvious typos before they cost a send).
2. Look up the gallery by `slug` (`id, title, expires_at, archived_at`). 404 if not found.
3. `isGalleryUnavailable(gallery)` → 410. Sending credentials for a gallery the client can't actually reach is nonsensical — this is a new check this route adds (the existing admin gallery *view* deliberately skips it, but *sending new credentials* is a different, forward-looking action, not a look-back at existing work).
4. Generate `password = generateGalleryPassword()`, `pin = generateGalleryPin()`; hash both with `bcrypt.hash(_, 10)` (matching `scripts/gallery.mjs`'s cost factor).
5. **Persist before sending** (deliberately the reverse of `app/api/admin/contracts/[id]/send-email/route.ts`'s order, for a reason specific to this route — see below): update the gallery row with `password_hash`, `pin_hash`, `client_email: payload.clientEmail`, `credentials_sent_at: new Date().toISOString()`. 500 on failure, nothing else has happened yet.
6. Fetch the `gallery_ready` template's `content` from `templates`.
7. `fillGalleryReadyTemplate(content, { clientName: gallery.client_name, galleryTitle: gallery.title, galleryUrl: `${SITE_URL}/gallery/${slug}`, galleryPassword: password, galleryPin: pin })`.
8. `sendGalleryReadyEmail({ clientEmail: payload.clientEmail, galleryTitle: gallery.title, bodyText: filled })`.
9. **Anything from step 6 onward can fail independently** (template fetch error, missing template row, or the send itself) — all three land in the same fallback, since by this point step 5 has already rotated the live credentials: respond `502` with `{ error: "Credentials were reset, but the email failed to send. Copy these and send them yourself, or try again.", password, pin }`. The one-time plaintext is still in memory at this point, so the failure response hands it back rather than losing it. If everything through step 8 succeeds: `{ ok: true, sentAt: <the timestamp from step 5> }`.

**Why persist-then-send, not send-then-persist:** `app/api/admin/contracts/[id]/send-email/route.ts` sends first and treats its DB update (`email_sent_at`) as best-effort bookkeeping — reasonable there, since nothing functional depends on that flag. Here, the DB update *is* the functional artifact: the emailed password only works if its hash is already saved. Sending first and persisting second would mean a persist failure leaves the client holding a password that was never actually saved — for a first-ever send (the common case per the project owner) there's no fallback credential they already have, so that failure mode is a real lockout with no recovery but "contact the photographer." Persisting first means the worst case on a send failure is "credentials rotated, admin sees them once in the error response and can relay manually or just click Send again" — recoverable either way, and self-explanatory in the UI.

### `lib/clientDirectory.ts` (new — small extraction from `/admin/clients`)

`app/admin/clients/page.tsx` already queries `bookings` for `status = 'confirmed'` and dedupes by email; this pulls just that base list (name/email/phone, no booking-count/total rollups — those stay page-local to `/admin/clients`) into a shared function both pages call, so the two "who is this client" views can't drift:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

export type DirectoryClient = { name: string; email: string; phone: string | null };

export async function getConfirmedBookingClients(
  supabase: SupabaseClient,
): Promise<DirectoryClient[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("client_name, client_email, client_phone, start_time")
    .eq("status", "confirmed")
    .order("start_time", { ascending: false });

  if (error) {
    console.error("Confirmed-bookings client lookup failed:", error);
    return [];
  }

  const byEmail = new Map<string, DirectoryClient>();
  for (const row of data ?? []) {
    if (!byEmail.has(row.client_email)) {
      byEmail.set(row.client_email, {
        name: row.client_name,
        email: row.client_email,
        phone: row.client_phone,
      });
    }
  }
  return Array.from(byEmail.values());
}
```

Rows are already ordered newest-first, so the first time a given email is seen is its most recent booking — same "keep the newest name" reasoning `app/admin/clients/page.tsx` already relies on, preserved here.

`app/admin/clients/page.tsx` is updated to call this for its base list, then layer its existing booking-count/total/date rollup loop on top of it, instead of re-deriving the dedup itself — the rollup logic (`bookingCount`, `totalPaidCents`, etc.) is unchanged, only the base-list derivation moves.

### `app/admin/galleries/[slug]/page.tsx` (extended)

Also selects `client_email, credentials_sent_at` from the gallery, and calls `getConfirmedBookingClients(supabase)`. Passes `slug`, `initialClientEmail: gallery.client_email`, `initialSentAt: gallery.credentials_sent_at`, and `directory: DirectoryClient[]` into a new client component.

### `app/admin/galleries/[slug]/NotifyClientPanel.tsx` (new client component)

Rendered below the photo grid. Owns:

- `email` state, seeded from `initialClientEmail ?? ""`.
- A name-search input above the email field: as the admin types, filters `directory` client-side (substring match on `name`, case-insensitive) and shows up to ~6 matches in a small dropdown styled like the rest of this admin UI (not a native `<datalist>`, to match the site's existing custom-styled-input convention — e.g. `PasswordField`, `TemplateEditor` — rather than default browser chrome). Selecting one sets `email` to that match's address; the email field underneath stays a plain, always-editable `<input type="email">` regardless, so a client with no booking record can just be typed in directly.
- A status line: `initialSentAt` renders as "Last sent {formatted date}" (via the existing `lib/format.ts` date helper), or "Not yet sent" if null.
- A two-step Send control: first click (disabled if `email` is empty/has no `@`) swaps the button for an inline confirmation — *"This emails new credentials to `{email}`. Any previously shared password/PIN will stop working. Send?"* with **Confirm** / **Cancel** — matching this app's existing pattern of inline state swaps (e.g. `GalleryGate`'s password→PIN stage transition) rather than a native `confirm()`, which nothing else in this admin UI uses.
- On Confirm: `POST` to the new route with `{ clientEmail: email }`. On `{ok:true}`: update the displayed "Last sent" status to now, show a brief success message. On the `502` fallback shape: show the returned `password`/`pin` directly in the UI with a "copy" affordance and a clear note that the email did not go out, so the admin can relay them manually. On any other error: a plain inline error message, matching this app's existing form-error conventions (e.g. `GalleryGate`'s `error` state).

### Out of scope

- No automatic "gallery ready" detection (e.g. from an upload finishing) — sending is always a deliberate, manual admin action, per the request.
- No resend history/log beyond the single `credentials_sent_at` timestamp — only "when was it last sent," not a full audit trail of every send.
- No encryption-at-rest option for the password/PIN — deliberately rejected during brainstorming in favor of keeping today's bcrypt-hash-only posture.
- No change to `scripts/gallery.mjs` — the CLI's own `create`/`set-password`/`set-pin` commands are untouched; this feature is a second, independent way credentials can be rotated, specifically the one that also emails them.
- No rich HTML email layout — plain-text template rendered into a minimally-styled `<pre>` block, matching the template's plain-text editing surface.
- `/admin/clients`'s own per-client rollup UI (booking counts, totals, expand/collapse) is unchanged — only its base client-list derivation is extracted, not its rendering.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- Confirm the schema migration is applied (per this repo's convention, in Supabase's SQL Editor) before testing — both `alter table` statements and the `gallery_ready` template insert.
- `/admin/templates`: confirm the new "Gallery Ready" entry appears and is editable/saveable through the existing `TemplateEditor`, with no changes needed to that component.
- On a test gallery: open `/admin/galleries/<slug>`, confirm the "Notify client" panel shows "Not yet sent," type a partial client name that matches an existing confirmed booking, confirm the dropdown appears and selecting a match fills the email field; also confirm typing an arbitrary email directly (no matching client) works.
- Click Send, confirm the inline two-step confirmation appears before anything happens, cancel it, confirm nothing was sent and the gallery's row is unchanged.
- Click Send, confirm through, confirm: the email arrives at the target address with the gallery's title, a working `/gallery/<slug>` link, and a password/PIN that actually unlock it (bcrypt-compare against the new hash succeeds); the admin panel now shows "Last sent {date}"; a second `/api/gallery-access` attempt using the *original* `gallery:create`-issued password/PIN now fails (proving rotation actually invalidated them).
- Force a send failure (e.g. temporarily unset `RESEND_API_KEY`) and confirm: the gallery's `password_hash`/`pin_hash` were still updated (the new password DOES work against `/api/gallery-access` even though the email didn't send), the admin UI shows the fallback password/PIN display with the "email failed" message, and re-adding the key and clicking Send again succeeds normally.
- Confirm sending against an archived or expired test gallery returns the 410 and no email goes out.
- Confirm `/admin/clients` still renders identically (same client rows, same booking counts/totals) after its base-list derivation moves to the shared `lib/clientDirectory.ts` helper.
