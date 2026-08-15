# Gallery Ready Email Notification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the photographer email a client their gallery link plus working credentials from a "Notify client" panel on `/admin/galleries/[slug]`, rotating a fresh password+PIN on every send rather than ever storing them in retrievable form.

**Architecture:** Two new nullable columns on `galleries` (`client_email`, `credentials_sent_at`) plus a new seeded row in the existing `templates` table (`gallery_ready`), automatically editable through the site's existing generic `TemplateEditor`. A new admin-only route generates and hashes a fresh password/PIN, **persists them before attempting the send** (the reverse of this repo's existing contract-email route, for reasons specific to this feature — see the route's own task below), fills the template, and sends via the existing Resend setup. The admin UI gets a client-directory-backed name search (reusing the same confirmed-bookings query `/admin/clients` already runs, via a new small shared helper) and a two-step inline send confirmation.

**Tech Stack:** Next.js API routes, Supabase (schema + queries), bcryptjs, Resend (existing `lib/email.ts`), React (client component state).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-15-gallery-ready-email-design.md`.
- No plaintext or encrypted-at-rest storage of the gallery password/PIN — every send generates a brand-new pair, hashed the same way `scripts/gallery.mjs` already hashes them (`bcrypt.hash(_, 10)`). This was a deliberate security tradeoff the project owner made during brainstorming; do not introduce a retrievable-credential storage path.
- **Persist before send, not send before persist** — see Task 4. This is a deliberate deviation from `app/api/admin/contracts/[id]/send-email/route.ts`'s ordering, justified in the spec and restated in Task 4's brief. Do not "fix" it to match the contracts route.
- On any failure from template-fetch through send (Task 4, step 6 onward), the route returns the freshly-generated plaintext `password`/`pin` in its error response body — this is intentional so nothing is lost, not a security leak to "fix." Only the admin-authenticated caller of this specific route ever sees that response.
- No change to `scripts/gallery.mjs` — it remains a fully independent way to rotate a gallery's credentials, without emailing them.
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, `npm run build`, `curl` against the dev server, and manual browser checks — same pattern as every prior plan here (see `docs/superpowers/plans/2026-08-15-gallery-favorites.md`).
- Schema changes must be applied manually by the project owner via Supabase's SQL Editor (no direct Postgres connection is available in `.env.local`, only the REST-based service-role key, which can't run DDL). Do not attempt to run migrations yourself via any CLI or script. If a verification step fails because a column/row doesn't exist yet, stop and report NEEDS_CONTEXT.
- `/admin/clients` is not touched by this plan at all — Task 5 adds a new, independent helper for the gallery page's name search, not a refactor of that page.

---

## Task 1: Schema migration

**Files:**
- Modify: `supabase/schema.sql` (append migration)

**Interfaces:**
- Produces: `galleries.client_email` (nullable text), `galleries.credentials_sent_at` (nullable timestamptz), and a seeded `templates` row with `template_type = 'gallery_ready'` — consumed by Tasks 4 and 6.

- [ ] **Step 1: Apply the schema migration**

Confirm with the project owner that they've run this in Supabase's SQL Editor (Project → SQL Editor → New query) against the live database:

```sql
alter table galleries add column if not exists client_email text;
alter table galleries add column if not exists credentials_sent_at timestamptz;

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

Then append the exact same statements (with the comments below) to the end of `supabase/schema.sql`, after the file's current final block (`alter table gallery_favorites enable row level security;`), so the file stays the source of truth for a fresh provision:

```sql

-- Client-facing "gallery ready" notifications. client_email is set (or
-- updated) whenever an admin sends the notification from
-- /admin/galleries/[slug] — not captured at gallery:create time, since
-- galleries can predate this feature. credentials_sent_at is bookkeeping
-- only (drives the "Not yet sent" / "Last sent <date>" admin UI state);
-- it does not gate anything.
alter table galleries add column if not exists client_email text;
alter table galleries add column if not exists credentials_sent_at timestamptz;

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

Do not attempt to run this migration yourself — there is no direct Postgres connection available. If Step 2 below fails with a missing-column or missing-row error, the migration hasn't been applied yet — stop and report NEEDS_CONTEXT rather than trying to work around it.

- [ ] **Step 2: Verify the migration**

```bash
node --env-file=.env.local -e "
import('@supabase/supabase-js').then(async ({ createClient }) => {
  const url = process.env.SUPABASE_URL.replace(/\/rest\/v1\/?\$/, '');
  const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const g = await supabase.from('galleries').select('client_email, credentials_sent_at').limit(1);
  const t = await supabase.from('templates').select('template_type, content').eq('template_type', 'gallery_ready').maybeSingle();
  console.log(JSON.stringify({ galleriesColumnsOk: !g.error, galleriesError: g.error, template: t.data, templateError: t.error }, null, 2));
});
"
```

Expected: `galleriesColumnsOk: true`, `galleriesError: null`, `template` is a non-null object with `template_type: "gallery_ready"` and the seeded content, `templateError: null`.

- [ ] **Step 3: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add client_email/credentials_sent_at columns and gallery_ready template"
```

---

## Task 2: Credential + template-fill helpers

**Files:**
- Create: `lib/galleryCredentials.ts`
- Create: `lib/galleryReadyEmail.ts`

**Interfaces:**
- Produces: `generateGalleryPassword(): string` and `generateGalleryPin(): string` (both from `lib/galleryCredentials.ts`), consumed by Task 4's route.
- Produces: `fillGalleryReadyTemplate(content: string, values: GalleryReadyValues): string` (from `lib/galleryReadyEmail.ts`), where `GalleryReadyValues = { clientName: string; galleryTitle: string; galleryUrl: string; galleryPassword: string; galleryPin: string }`, consumed by Task 4's route.

- [ ] **Step 1: Create `lib/galleryCredentials.ts`**

This is the TypeScript-side twin of `scripts/gallery.mjs`'s `generatePassword()`/`generatePin()` — that script runs as plain Node and can't import this file, so the word list and logic are duplicated by hand here, the same way this codebase already hand-duplicates `PUBLIC_IMAGES_BASE_URL`/`UPLOAD_CONTENT_TYPES` between `lib/media.ts`/`lib/r2.ts` and `scripts/uploadImage.mjs`. Copy the word list from `scripts/gallery.mjs`'s `PASSWORD_WORDS` constant exactly:

```ts
// TypeScript-side twin of scripts/gallery.mjs's generatePassword()/
// generatePin() — that script runs as plain Node and can't import this
// file, so this is kept in sync by hand. Same word list, same shapes.

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

- [ ] **Step 2: Create `lib/galleryReadyEmail.ts`**

```ts
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
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/galleryCredentials.ts lib/galleryReadyEmail.ts
git commit -m "Add gallery credential generation and template-fill helpers"
```

---

## Task 3: `sendGalleryReadyEmail` in `lib/email.ts`

**Files:**
- Modify: `lib/email.ts`

**Interfaces:**
- Produces: `sendGalleryReadyEmail(params: { clientEmail: string; galleryTitle: string; bodyText: string }): Promise<{ ok: true } | { ok: false; error: string }>`, consumed by Task 4's route.

- [ ] **Step 1: Append the new function**

`lib/email.ts` currently ends (its final 5 lines) with:

```ts
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

Append this new function after that closing brace, at the end of the file:

```ts

// Sent from the admin "Notify client" action
// (app/api/admin/galleries/[slug]/send-ready-email/route.ts) once a
// fresh gallery password/PIN have already been generated and persisted.
// The caller fills the template before calling this — same division of
// responsibility as sendSigningLinkEmail, which doesn't know about
// template tokens either. bodyText is rendered into a plain <pre> block
// rather than a richer HTML layout: this template is short and
// credential-bearing, not worth a separate HTML version the admin's
// plain-text edits in /admin/templates would drift out of sync with.
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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. (`Resend`, `FROM_ADDRESS`, and `escapeHtml` are all already imported/defined earlier in this file — no new imports needed.)

- [ ] **Step 3: Commit**

```bash
git add lib/email.ts
git commit -m "Add sendGalleryReadyEmail"
```

---

## Task 4: `POST /api/admin/galleries/[slug]/send-ready-email`

**Files:**
- Create: `app/api/admin/galleries/[slug]/send-ready-email/route.ts`

**Interfaces:**
- Consumes: `generateGalleryPassword`/`generateGalleryPin` (Task 2), `fillGalleryReadyTemplate` (Task 2), `sendGalleryReadyEmail` (Task 3), `isGalleryUnavailable` from `lib/gallery.ts` (existing), `ADMIN_ACCESS_COOKIE`/`isValidAccessToken` from `lib/adminAccess.ts` (existing, same pattern as `app/api/admin/templates/[type]/route.ts`).
- Produces: `POST { clientEmail: string }` → `{ ok: true, sentAt: string }` on success; `{ error: string, password?: string, pin?: string }` on failure (the `password`/`pin` fields appear only when credentials were already rotated before the failure — see Step 6 below), consumed by Task 6's `NotifyClientPanel.tsx`.

- [ ] **Step 1: Create the route**

```ts
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
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Create a test fixture gallery**

```bash
npm run gallery:create -- test-gallery-ready-email "Ready Email Test" "Test Client"
```

Expected: prints `URL:`, `Password:`, `PIN:` (this repo's `gallery:create` always generates both), `Expires: never`. Save the printed password and PIN — you'll need them to prove rotation actually invalidated them in Step 4 below.

- [ ] **Step 4: Manually verify against the dev server**

Start the dev server (`npm run dev`, likely in the background), then log into `/admin` in a browser or grab the admin cookie value another way — simplest is to just use the browser tools if available (see Task 6's instructions for loading them), or verify via curl using the `ADMIN_PASSWORD` from `.env.local` to first obtain a valid `admin_access` cookie by POSTing to whatever the admin login endpoint is (check `app/admin/AdminGate.tsx` / its form action for the exact endpoint and payload shape before writing this curl command — do not guess the shape).

Send:

```bash
curl -s -b "admin_access=<cookie value>" -X POST http://localhost:3000/api/admin/galleries/test-gallery-ready-email/send-ready-email \
  -H "Content-Type: application/json" \
  -d '{"clientEmail":"you+test@example.com"}' | python3 -m json.tool
```

(Use a real inbox you control instead of `you+test@example.com` if you want to see the actual email content — this repo's Resend setup sends real email, there's no sandbox mode.)

Expected: `{"ok": true, "sentAt": "<ISO timestamp>"}`.

Confirm rotation actually happened — the *original* `gallery:create`-issued password/PIN from Step 3 should now fail:

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-ready-email","password":"<the ORIGINAL password from Step 3>"}'
```

Expected: `401 {"error":"Incorrect password."}`.

Confirm the email itself arrived (check the inbox you sent to) with the gallery title, a working `/gallery/test-gallery-ready-email` link, and a password/PIN — and confirm that password/PIN combination DOES successfully unlock the gallery via `/api/gallery-access`.

Confirm the 410 path: `npm run gallery:archive -- test-gallery-ready-email`, retry the same send curl above, expect `410 {"error":"This gallery has expired."}`. Then `npm run gallery:unarchive -- test-gallery-ready-email` to restore it for later tasks.

Confirm the failure-fallback path: temporarily comment out or rename `RESEND_API_KEY` in `.env.local`, restart the dev server, retry the send curl. Expected: `502` with `error`, `password`, and `pin` fields present — and confirm via a fresh `/api/gallery-access` attempt that the *returned* password/pin actually work (proving credentials were persisted even though the send failed). Restore `RESEND_API_KEY` and restart the dev server afterward.

Leave `test-gallery-ready-email` in place — Task 6 reuses it. Stop the dev server when done.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/galleries/\[slug\]/send-ready-email/route.ts
git commit -m "Add POST /api/admin/galleries/[slug]/send-ready-email"
```

---

## Task 5: Shared client-directory helper

**Files:**
- Create: `lib/clientDirectory.ts`

**Interfaces:**
- Produces: `getConfirmedBookingClients(supabase: SupabaseClient): Promise<DirectoryClient[]>`, where `DirectoryClient = { name: string; email: string; phone: string | null }`, consumed by Task 6's `app/admin/galleries/[slug]/page.tsx`.
- Consumes: nothing new.

**`app/admin/clients/page.tsx` is deliberately NOT modified by this task.** Its rollup computation (`bookingCount`, `totalPaidCents`, the per-client `bookings` array) needs every booking row per client, not a deduped list, plus `amount_paid_cents`/`appointment_types(name)` fields this helper doesn't select — so it still needs its own full query regardless of this helper's existence. This helper and that page's query are two independent call sites reading the same table with the same filter and the same dedup rule, not one shared code path.

- [ ] **Step 1: Create `lib/clientDirectory.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

// Confirmed-bookings client list, deduped by email (newest booking
// wins) — same query shape /admin/clients runs for its own rollups, but
// that page needs every row (not deduped) plus fields this doesn't
// select, so it keeps its own separate query. This is for the gallery
// page's "Notify client" name search, which only needs name/email/phone.
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

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/clientDirectory.ts
git commit -m "Add shared confirmed-bookings client directory helper"
```

---

## Task 6: Admin UI — "Notify client" panel

**Files:**
- Modify: `app/admin/galleries/[slug]/page.tsx`
- Create: `app/admin/galleries/[slug]/NotifyClientPanel.tsx`

**Interfaces:**
- Consumes: `getConfirmedBookingClients` (Task 5), `POST /api/admin/galleries/[slug]/send-ready-email` (Task 4).
- No new interfaces produced — this is the plan's final consumer.

- [ ] **Step 1: Extend `app/admin/galleries/[slug]/page.tsx`**

Read the current file first. Add `client_email, credentials_sent_at` to the existing `galleries` select (currently `"id, title, client_name"`), call `getConfirmedBookingClients(supabase)` (imported from `@/lib/clientDirectory`) alongside the existing `gallery_favorites`/`listGalleryImages` calls, and render a new `<NotifyClientPanel>` below the existing `<GalleryPhotoGrid>` (or below the `imagesError`/empty-state branches — it should render regardless of whether photos loaded, since notifying is independent of the photo grid). Pass:

```tsx
<NotifyClientPanel
  slug={slug}
  initialClientEmail={gallery.client_email}
  initialSentAt={gallery.credentials_sent_at}
  directory={directory}
/>
```

where `directory` is the result of `getConfirmedBookingClients(supabase)`.

- [ ] **Step 2: Create `NotifyClientPanel.tsx`**

```tsx
"use client";

import { useMemo, useState } from "react";
import type { DirectoryClient } from "@/lib/clientDirectory";

type SendState = "idle" | "confirming" | "sending" | "sent" | "error";

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function NotifyClientPanel({
  slug,
  initialClientEmail,
  initialSentAt,
  directory,
}: {
  slug: string;
  initialClientEmail: string | null;
  initialSentAt: string | null;
  directory: DirectoryClient[];
}) {
  const [email, setEmail] = useState(initialClientEmail ?? "");
  const [nameQuery, setNameQuery] = useState("");
  const [sentAt, setSentAt] = useState(initialSentAt);
  const [state, setState] = useState<SendState>("idle");
  const [error, setError] = useState("");
  const [fallbackCreds, setFallbackCreds] = useState<{ password: string; pin: string } | null>(null);

  const matches = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return [];
    return directory
      .filter((c) => c.name.toLowerCase().includes(q))
      .slice(0, 6);
  }, [nameQuery, directory]);

  const canSend = email.includes("@");

  async function handleConfirmSend() {
    setState("sending");
    setError("");
    setFallbackCreds(null);

    try {
      const response = await fetch(`/api/admin/galleries/${slug}/send-ready-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientEmail: email }),
      });

      const data: {
        error?: string;
        sentAt?: string;
        password?: string;
        pin?: string;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong.");
        if (data.password && data.pin) {
          setFallbackCreds({ password: data.password, pin: data.pin });
        }
        setState("error");
        return;
      }

      setSentAt(data.sentAt ?? new Date().toISOString());
      setState("sent");
    } catch {
      setError("Something went wrong.");
      setState("error");
    }
  }

  return (
    <div className="mx-auto mt-16 max-w-xl border-t border-border pt-10">
      <h2 className="mb-4 text-center text-xs uppercase tracking-[0.3em] text-muted">
        Notify client
      </h2>

      <p className="mb-4 text-center text-sm text-muted">
        {sentAt ? `Last sent ${formatSentAt(sentAt)}` : "Not yet sent"}
      </p>

      <div className="relative mb-3">
        <input
          type="text"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
          placeholder="Search clients by name…"
          className="w-full border border-border bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted"
        />
        {matches.length > 0 && (
          <div className="absolute z-10 mt-1 w-full border border-border bg-background">
            {matches.map((client) => (
              <button
                key={client.email}
                type="button"
                onClick={() => {
                  setEmail(client.email);
                  setNameQuery("");
                }}
                className="block w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface"
              >
                {client.name} — {client.email}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        type="email"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value);
          if (state !== "idle" && state !== "confirming") setState("idle");
        }}
        placeholder="client@example.com"
        className="mb-4 w-full border border-border bg-transparent px-4 py-2 text-sm text-foreground placeholder:text-muted"
      />

      {state === "confirming" ? (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted">
            This emails new credentials to <strong>{email}</strong>. Any
            previously shared password/PIN will stop working. Send?
          </p>
          <div className="flex justify-center gap-4">
            <button
              type="button"
              onClick={() => setState("idle")}
              className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmSend}
              className="border border-foreground px-6 py-2 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background"
            >
              Confirm &amp; Send
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={!canSend || state === "sending"}
          onClick={() => setState("confirming")}
          className="w-full border border-foreground px-6 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-foreground"
        >
          {state === "sending"
            ? "Sending…"
            : sentAt
              ? "Resend gallery-ready email"
              : "Send gallery-ready email"}
        </button>
      )}

      {state === "sent" && (
        <p className="mt-3 text-center text-sm text-muted">Sent.</p>
      )}

      {state === "error" && (
        <div className="mt-4 space-y-2 text-center text-sm">
          <p className="text-red-600">{error}</p>
          {fallbackCreds && (
            <p className="text-muted">
              Password: <strong>{fallbackCreds.password}</strong> — PIN:{" "}
              <strong>{fallbackCreds.pin}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Type-check and build**

```bash
npx tsc --noEmit
npm run build
```

Expected: both succeed with no errors.

- [ ] **Step 4: Manual browser verification**

If the `claude-in-chrome` or `chrome-devtools` browser tools are available (load via `ToolSearch` with query `"select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__tabs_create_mcp,mcp__claude-in-chrome__tabs_close_mcp"` if deferred), use them; otherwise do this manually in a real browser.

With `npm run dev` running and logged into `/admin`:

1. Navigate to `/admin/galleries/test-gallery-ready-email` (the fixture from Task 4). Confirm the "Notify client" panel renders below the photo grid, showing "Last sent {date}" (Task 4's verification already sent to it) or "Not yet sent" if you're re-running this fresh.
2. Type a partial name that matches an existing confirmed booking in this database (check `/admin/clients` for a real name to search on first). Confirm the dropdown appears with matches; click one and confirm the email field fills in; confirm the dropdown closes.
3. Confirm typing an arbitrary email directly (not matching any client) also works and enables the Send button.
4. Click "Send…"/"Resend…". Confirm the inline two-step confirmation appears with the correct email shown, and that Cancel returns to the idle button state with nothing sent.
5. Click through to Confirm & Send. Confirm the button shows "Sending…", then either "Sent." (check the real inbox for the email) or, if you're testing the failure path again, the fallback password/PIN display.
6. Confirm the "Last sent" status updates immediately after a successful send without a page reload.

- [ ] **Step 5: Clean up the test fixture**

```bash
npm run gallery:delete -- test-gallery-ready-email --yes
```

- [ ] **Step 6: Commit**

```bash
git add app/admin/galleries/\[slug\]/page.tsx app/admin/galleries/\[slug\]/NotifyClientPanel.tsx
git commit -m "Add Notify client panel to the admin gallery page"
```
