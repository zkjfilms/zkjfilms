# Gallery PIN (Second Factor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional 4-digit PIN as a second factor for client galleries, entered as a separate step after the password, with rate limiting on the checking endpoint and CLI commands (`gallery:set-pin`, `gallery:set-password`) to reset either secret without ever hand-typing a replacement.

**Architecture:** A nullable `pin_hash` column on `galleries` (a gallery with no PIN never triggers the second step — fully backward compatible with every gallery created before this feature). `scripts/gallery.mjs` generates and prints the PIN at creation time and via two new reset commands. `/api/gallery-access` gains rate limiting and a `pinRequired` response shape. `GalleryGate.tsx` gets a second local UI stage that appears only when the API asks for it, reusing the same `PasswordField` component from the prior password-reveal-toggle work (extended with two small optional props).

**Tech Stack:** Next.js API routes, Supabase (schema + queries), bcryptjs, the existing `lib/rateLimit.ts` Postgres-backed rate limiter (currently only used by `app/api/bookings/route.ts`), React (client component state).

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-12-gallery-pin-second-factor-design.md`.
- `pin_hash` is nullable with no default. A gallery with `pin_hash is null` must behave exactly as it does today — no PIN step ever appears for it. This is what keeps the existing `andi` gallery (and any other pre-existing gallery) working without any migration action on that row.
- `gallery:set-pin` and `gallery:set-password` are **generate-only** — neither takes an argument to set an exact value. This is a deliberate security/workflow decision (confirmed with the project owner): resets always produce a fresh, full-entropy secret the same way `create` does, never a hand-picked one.
- Rate limiting on `/api/gallery-access`: `maxHits: 10, windowMinutes: 15`, using the existing `checkRateLimit()`/`getClientIp()` helpers from `lib/rateLimit.ts` exactly as `app/api/bookings/route.ts` already calls them — no new rate-limiting mechanism.
- The PIN check never runs before the password check, and an incorrect password never reveals whether a gallery has a PIN configured at all (the `pinRequired` field only appears in a response after a *correct* password).
- The `galleries.pin_hash` column must exist in the live Supabase database before Task 1's verification steps (and Tasks 2/3, which depend on it) can succeed. The project owner is applying this manually via Supabase's SQL Editor — Task 1, Step 1 gives the exact statement; do not attempt to run it via any automated tool, and if it appears not to have been applied yet (Task 1's verification queries fail with a missing-column error), stop and report NEEDS_CONTEXT rather than guessing at a workaround.
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, `npm run build`, and manual CLI/API/browser checks, following the same pattern as every prior plan in this repo (see `docs/superpowers/plans/2026-08-12-gallery-create-upload.md` and `docs/superpowers/plans/2026-08-12-password-reveal-toggle.md`).

---

## Task 1: Schema migration + CLI (`create` update, `set-pin`, `set-password`)

**Files:**
- Modify: `supabase/schema.sql` (append migration)
- Modify: `scripts/gallery.mjs` (add `generatePin()`, update `create()`, add `setPin()`/`setPassword()`, wire dispatch + usage text)
- Modify: `package.json` (add `gallery:set-pin`, `gallery:set-password` scripts)

**Interfaces:**
- Produces: `generatePin(): string` — a 4-digit zero-padded string (e.g. `"0472"`), used by `create()`, `setPin()`, and this task alone (no other task calls it directly).
- Produces: CLI commands `npm run gallery:set-pin -- <slug>` and `npm run gallery:set-password -- <slug>`, and an updated `npm run gallery:create -- ...` that now also generates and prints a PIN.
- Consumes (from later tasks): nothing — this task has no dependency on Tasks 2 or 3.

- [ ] **Step 1: Apply the schema migration**

Confirm with the project owner that they've run this in Supabase's SQL Editor (Project → SQL Editor → New query) against the live database:

```sql
alter table galleries add column if not exists pin_hash text;
```

Then append the exact same statement to the end of `supabase/schema.sql`, after the file's existing final comment block (the "Known limitation" note), so the file stays the source of truth for a fresh provision:

```sql

-- Second factor for client galleries: an optional 4-digit PIN, checked
-- after the password in app/api/gallery-access/route.ts. Nullable with
-- no default — a null pin_hash means the gallery has no PIN and the
-- second step never appears, which is what keeps every gallery created
-- before this column existed working unchanged.
alter table galleries add column if not exists pin_hash text;
```

Do not attempt to run this migration yourself via any CLI or script — there is no `DATABASE_URL`/direct Postgres connection available in this repo's `.env.local`, only the Supabase REST-based service-role key, which cannot execute DDL. If a later verification step in this task fails because the column doesn't exist yet, stop and report NEEDS_CONTEXT rather than trying to work around it.

- [ ] **Step 2: Add `generatePin()` to `scripts/gallery.mjs`**

Add immediately after the `generatePassword()` function (before the `const SLUG_PATTERN = /^[a-z0-9-]+$/;` line):

```js
// Used by create() and setPin() below. Zero-padded so e.g. 0472 stays
// four characters — compared as a string, never parsed as a number.
function generatePin() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}
```

- [ ] **Step 3: Update `create()` to also generate and store a PIN**

Replace this exact block:

```js
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("galleries")
    .insert({
      slug,
      title,
      client_name: clientName,
      password_hash: passwordHash,
      expires_at: expiresAt,
    })
    .select("slug")
    .single();

  if (error) {
    console.error("Failed to create gallery:", error.message);
    process.exit(1);
  }

  console.log(`Created gallery "${data.slug}".`);
  console.log(`URL: ${SITE_URL}/gallery/${data.slug}`);
  console.log(`Password: ${password}`);
  console.log("(Shown once — only its hash is stored. Save it before closing this terminal.)");
  console.log(expiresAt ? `Expires: ${expiresAt}` : "Expires: never");
```

with:

```js
  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const { data, error } = await supabase
    .from("galleries")
    .insert({
      slug,
      title,
      client_name: clientName,
      password_hash: passwordHash,
      pin_hash: pinHash,
      expires_at: expiresAt,
    })
    .select("slug")
    .single();

  if (error) {
    console.error("Failed to create gallery:", error.message);
    process.exit(1);
  }

  console.log(`Created gallery "${data.slug}".`);
  console.log(`URL: ${SITE_URL}/gallery/${data.slug}`);
  console.log(`Password: ${password}`);
  console.log(`PIN: ${pin}`);
  console.log("(Shown once — only their hashes are stored. Save both before closing this terminal.)");
  console.log(expiresAt ? `Expires: ${expiresAt}` : "Expires: never");
```

- [ ] **Step 4: Add `setPin()` and `setPassword()`**

Add both after the closing brace of `setArchived()` and before `async function del(slug, opts) {`:

```js
async function setPin(slug) {
  if (!slug) {
    console.error("Usage: npm run gallery:set-pin -- <slug>");
    process.exit(1);
  }

  const pin = generatePin();
  const pinHash = await bcrypt.hash(pin, 10);

  const { data, error } = await supabase
    .from("galleries")
    .update({ pin_hash: pinHash })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error("Failed to set PIN:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Set new PIN for gallery "${data.slug}".`);
  console.log(`PIN: ${pin}`);
  console.log("(Shown once — only its hash is stored. Save it before closing this terminal.)");
}

async function setPassword(slug) {
  if (!slug) {
    console.error("Usage: npm run gallery:set-password -- <slug>");
    process.exit(1);
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);

  const { data, error } = await supabase
    .from("galleries")
    .update({ password_hash: passwordHash })
    .eq("slug", slug)
    .select("slug")
    .maybeSingle();

  if (error) {
    console.error("Failed to set password:", error.message);
    process.exit(1);
  }

  if (!data) {
    console.error(`No gallery found with slug "${slug}".`);
    process.exit(1);
  }

  console.log(`Set new password for gallery "${data.slug}".`);
  console.log(`Password: ${password}`);
  console.log("(Shown once — only its hash is stored. Save it before closing this terminal.)");
}
```

- [ ] **Step 5: Wire up dispatch and usage text**

In the dispatch block, add two cases immediately before `} else if (command === "delete") {`:

```js
} else if (command === "set-pin") {
  await setPin(args[0]);
} else if (command === "set-password") {
  await setPassword(args[0]);
} else if (command === "delete") {
```

Update the usage list in the final `else` branch to read:

```js
  console.error(
    [
      "Usage:",
      "  npm run gallery:list",
      '  npm run gallery:create -- <slug> "<title>" "<client-name>" [expires-at]',
      "  npm run gallery:upload -- <slug> <local-folder>",
      "  npm run gallery:set-expiry -- <slug> <date|none>",
      "  npm run gallery:archive -- <slug>",
      "  npm run gallery:unarchive -- <slug>",
      "  npm run gallery:set-pin -- <slug>",
      "  npm run gallery:set-password -- <slug>",
      "  npm run gallery:delete -- <slug> [--yes] [--keep-photos]",
    ].join("\n"),
  );
```

Also update the usage comment block at the very top of the file (the `// Usage (via npm scripts...` comment) to add the same two lines in the same position, matching the existing format there.

- [ ] **Step 6: Add npm scripts**

In `package.json`, add these two lines immediately after `"gallery:unarchive"` and before `"gallery:delete"`:

```json
    "gallery:set-pin": "node --env-file=.env.local scripts/gallery.mjs set-pin",
    "gallery:set-password": "node --env-file=.env.local scripts/gallery.mjs set-password",
```

- [ ] **Step 7: Manually verify against the real Supabase project**

Run:

```bash
npm run gallery:create -- test-gallery-pin "Test" "Test"
```

Expected: prints a `URL:`, `Password:`, and now also a `PIN:` line (4 digits), plus the updated "Shown once" line mentioning "their hashes". If this fails with a Postgres error mentioning `pin_hash` not existing, the migration from Step 1 hasn't been applied yet — stop and report NEEDS_CONTEXT.

```bash
npm run gallery:set-pin -- test-gallery-pin
```

Expected: prints a new PIN, different from the one `create` generated.

```bash
npm run gallery:set-password -- test-gallery-pin
```

Expected: prints a new password, different from the one `create` generated.

```bash
npm run gallery:set-pin -- nonexistent-slug-xyz
npm run gallery:set-password -- nonexistent-slug-xyz
```

Expected: both fail cleanly with `No gallery found with slug "nonexistent-slug-xyz".`, no crash.

Also confirm `npm run gallery:list` still works unaffected (it doesn't select `pin_hash`, so this should be a no-op check, but confirm no regression).

Leave `test-gallery-pin` in place — Task 2 and Task 3 reuse it. Do not delete it yet.

- [ ] **Step 8: Commit**

```bash
git add supabase/schema.sql scripts/gallery.mjs package.json
git commit -m "Add PIN generation to gallery:create and new gallery:set-pin/set-password commands"
```

---

## Task 2: API route (`/api/gallery-access` — rate limiting + PIN check)

**Files:**
- Modify: `app/api/gallery-access/route.ts`

**Interfaces:**
- Consumes: `checkRateLimit(params: { ip: string; endpoint: string; maxHits: number; windowMinutes: number }): Promise<{ allowed: boolean }>` and `getClientIp(request: Request): string`, both from `lib/rateLimit.ts` (existing, unchanged — see `app/api/bookings/route.ts` for the established call pattern).
- Consumes: the `pin_hash` column added in Task 1 (must exist in the database — Task 1 confirms this before this task starts).
- Produces: the response shape `{ ok: true, pinRequired: true }` (no `images`) when a correct password is submitted for a PIN-protected gallery without a `pin`, and `{ error: "Incorrect PIN." }` (401) when a wrong PIN is submitted. Task 3's `GalleryGate.tsx` consumes both.

- [ ] **Step 1: Add the rate-limiting import**

Replace:

```ts
import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, SIGNED_URL_EXPIRY_SECONDS } from "@/lib/r2";
import { isGalleryUnavailable } from "@/lib/gallery";
```

with:

```ts
import bcrypt from "bcryptjs";
import { getSupabaseClient } from "@/lib/supabase";
import { listGalleryImages, SIGNED_URL_EXPIRY_SECONDS } from "@/lib/r2";
import { isGalleryUnavailable } from "@/lib/gallery";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
```

- [ ] **Step 2: Update the payload type and parser to accept an optional `pin`**

Replace:

```ts
type Payload = { slug: string; password: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { slug, password } = body as Record<string, unknown>;

  if (
    typeof slug !== "string" ||
    typeof password !== "string" ||
    !slug ||
    !password
  ) {
    return null;
  }

  return { slug, password };
}
```

with:

```ts
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
```

- [ ] **Step 3: Add the rate-limit check**

Replace:

```ts
  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  let supabase;
```

with:

```ts
  const payload = parsePayload(rawBody);
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const ip = getClientIp(request);
  const { allowed } = await checkRateLimit({
    ip,
    endpoint: "gallery-access",
    maxHits: 10,
    windowMinutes: 15,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429 },
    );
  }

  let supabase;
```

- [ ] **Step 4: Select `pin_hash` and add the PIN check after the password check**

Replace:

```ts
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("password_hash, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();
```

with:

```ts
  const { data: gallery, error } = await supabase
    .from("galleries")
    .select("password_hash, pin_hash, expires_at, archived_at")
    .eq("slug", payload.slug)
    .maybeSingle();
```

Then replace:

```ts
  const passwordMatches = await bcrypt.compare(
    payload.password,
    gallery.password_hash,
  );

  if (!passwordMatches) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  // The client caches this response (including expiresAt) in
```

with:

```ts
  const passwordMatches = await bcrypt.compare(
    payload.password,
    gallery.password_hash,
  );

  if (!passwordMatches) {
    return Response.json({ error: "Incorrect password." }, { status: 401 });
  }

  if (gallery.pin_hash) {
    if (!payload.pin) {
      return Response.json({ ok: true, pinRequired: true });
    }

    const pinMatches = await bcrypt.compare(payload.pin, gallery.pin_hash);
    if (!pinMatches) {
      return Response.json({ error: "Incorrect PIN." }, { status: 401 });
    }
  }

  // The client caches this response (including expiresAt) in
```

- [ ] **Step 5: `tsc --noEmit` and `npm run build`**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 6: Manually verify against the real Supabase project**

Using `test-gallery-pin` from Task 1 (which has a PIN):

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-pin","password":"<the password gallery:set-password printed in Task 1>"}'
```

(Run `npm run dev` first if not already running.) Expected: `{"ok":true,"pinRequired":true}`, no `images` key.

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-pin","password":"<password>","pin":"0000"}'
```

Expected (assuming `0000` isn't the real PIN): `401` with `{"error":"Incorrect PIN."}`.

```bash
curl -s -X POST http://localhost:3000/api/gallery-access \
  -H "Content-Type: application/json" \
  -d '{"slug":"test-gallery-pin","password":"<password>","pin":"<the PIN gallery:set-pin printed in Task 1>"}'
```

Expected: `{"ok":true,"images":[...],"expiresAt":...}` (images array may be empty if no photos were uploaded — that's fine, this is testing the auth flow, not the upload feature).

Confirm the `andi` gallery (no `pin_hash`, unless the project owner already ran `gallery:set-pin` on it) still returns images directly from a single password-only request — no `pinRequired` ever appears for it.

Confirm rate limiting: fire 11 password requests in a row (any slug, correct or incorrect) from the same shell/IP within a couple minutes and confirm the 11th returns `429` with `{"error":"Too many attempts. Please try again shortly."}`. A small loop works: `for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/gallery-access -H "Content-Type: application/json" -d '{"slug":"test-gallery-pin","password":"wrong"}'; done` — expect ten `401`s (or a mix, since a `pinRequired` 200 wouldn't happen with a wrong password) then a `429` on the 11th, though note this consumes part of the rate-limit budget other verification steps in this task also need — run this check last.

- [ ] **Step 7: Commit**

```bash
git add app/api/gallery-access/route.ts
git commit -m "Add rate limiting and PIN verification to /api/gallery-access"
```

---

## Task 3: Frontend (`PasswordField` extension + `GalleryGate` two-step flow)

**Files:**
- Modify: `components/PasswordField.tsx`
- Modify: `app/gallery/[slug]/GalleryGate.tsx`

**Interfaces:**
- Consumes: the `{ ok: true, pinRequired: true }` and `{ error: "Incorrect PIN." }` response shapes from Task 2's `/api/gallery-access`.
- Produces (extends `PasswordField`'s existing signature from the prior password-reveal-toggle plan): `{ id, value, onChange, variant, label?, inputMode?, maxLength? }` — the 3 pre-existing callers (`GalleryGate`'s password stage, `AdminGate`, `GateScreen`) pass none of the three new props and must render byte-identical to before this task.

- [ ] **Step 1: Extend `PasswordField` with `label`, `inputMode`, `maxLength`**

Replace:

```tsx
type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variant: "dark" | "light";
};
```

with:

```tsx
type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variant: "dark" | "light";
  label?: string;
  inputMode?: "text" | "numeric";
  maxLength?: number;
};
```

Replace:

```tsx
export default function PasswordField({
  id,
  value,
  onChange,
  variant,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const classes = VARIANT_CLASSES[variant];

  return (
    <div>
      <label
        htmlFor={id}
        className={`block text-xs uppercase tracking-[0.15em] ${classes.label}`}
      >
        Password
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border-b bg-transparent py-2 pr-10 outline-none transition-colors focus:border-accent ${classes.input}`}
        />
```

with:

```tsx
export default function PasswordField({
  id,
  value,
  onChange,
  variant,
  label = "Password",
  inputMode = "text",
  maxLength,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false);
  const classes = VARIANT_CLASSES[variant];

  return (
    <div>
      <label
        htmlFor={id}
        className={`block text-xs uppercase tracking-[0.15em] ${classes.label}`}
      >
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="none"
          inputMode={inputMode}
          maxLength={maxLength}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`w-full border-b bg-transparent py-2 pr-10 outline-none transition-colors focus:border-accent ${classes.input}`}
        />
```

- [ ] **Step 2: `tsc --noEmit` to confirm the extension alone compiles**

Run: `npx tsc --noEmit`
Expected: no errors. `AdminGate.tsx` and `GateScreen.tsx` still call `PasswordField` with only `id`/`value`/`onChange`/`variant` and must still type-check (the 3 new props are all optional).

- [ ] **Step 3: Add `stage`/`pin` state and a session-writing helper to `GalleryGate.tsx`**

Replace:

```tsx
  const [password, setPassword] = useState("");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
```

with:

```tsx
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [stage, setStage] = useState<"password" | "pin">("password");
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus>("idle");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Shared by both handleSubmit and handlePinSubmit below — both end the
  // same way once the server confirms access (with or without a PIN
  // step in between), and this keeps that one behavior in one place.
  function commitSession(data: {
    images?: GalleryImage[];
    imagesError?: boolean;
    expiresAt?: number;
  }) {
    const newSession: Session = {
      images: data.images ?? [],
      imagesError: data.imagesError ?? false,
      expiresAt: data.expiresAt ?? Date.now(),
    };
    sessionStorage.setItem(sessionKey(slug), JSON.stringify(newSession));
  }
```

- [ ] **Step 4: Update `handleSubmit` to handle `pinRequired`, and add `handlePinSubmit`**

Replace:

```tsx
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password }),
      });

      const data: {
        error?: string;
        images?: GalleryImage[];
        imagesError?: boolean;
        expiresAt?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      const newSession: Session = {
        images: data.images ?? [],
        imagesError: data.imagesError ?? false,
        expiresAt: data.expiresAt ?? Date.now(),
      };
      sessionStorage.setItem(sessionKey(slug), JSON.stringify(newSession));
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }
```

with:

```tsx
  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password }),
      });

      const data: {
        error?: string;
        pinRequired?: boolean;
        images?: GalleryImage[];
        imagesError?: boolean;
        expiresAt?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      if (data.pinRequired) {
        setSubmitStatus("idle");
        setStage("pin");
        return;
      }

      commitSession(data);
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }

  async function handlePinSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitStatus === "loading") return;

    setSubmitStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/gallery-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, password, pin }),
      });

      const data: {
        error?: string;
        images?: GalleryImage[];
        imagesError?: boolean;
        expiresAt?: number;
      } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setSubmitStatus("error");
        return;
      }

      commitSession(data);
      setSubmitStatus("idle");
    } catch {
      setError("Something went wrong. Please try again.");
      setSubmitStatus("error");
    }
  }
```

- [ ] **Step 5: Add the PIN screen render, between the unlocked-gallery view and the password screen**

Replace:

```tsx
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
      <div className="w-full max-w-md">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
          Private Gallery
        </p>
        <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
          {title}
        </h1>
        <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
          Enter the password shared with you to view your gallery.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-6">
```

with:

```tsx
  if (stage === "pin") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
        <div className="w-full max-w-md">
          <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
            Private Gallery
          </p>
          <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
            {title}
          </h1>
          <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
            Enter the 4-digit PIN shared with you to continue.
          </p>

          <form onSubmit={handlePinSubmit} className="mt-10 space-y-6">
            <PasswordField
              id="pin"
              label="PIN"
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(value) => {
                setPin(value);
                setError("");
              }}
              variant="dark"
            />

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              type="submit"
              disabled={submitStatus === "loading"}
              className="w-full border border-background px-8 py-3 text-xs uppercase tracking-[0.2em] text-background transition-colors hover:bg-background hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitStatus === "loading" ? "Checking…" : "Continue"}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-foreground px-6 py-16 sm:px-10">
      <div className="w-full max-w-md">
        <p className="mb-3 text-center text-xs uppercase tracking-[0.3em] text-background/50">
          Private Gallery
        </p>
        <h1 className="text-center font-serif text-3xl italic leading-tight text-background sm:text-4xl">
          {title}
        </h1>
        <p className="mt-5 text-center text-sm leading-relaxed text-background/70">
          Enter the password shared with you to view your gallery.
        </p>

        <form onSubmit={handleSubmit} className="mt-10 space-y-6">
```

(The rest of the password-screen `<form>` — the existing `<PasswordField>` for the password, the error paragraph, and the submit button — is unchanged and stays exactly as it is today; only the JSX *above* it, up through the `<form onSubmit={handleSubmit} ...>` opening tag, is being duplicated into the new PIN branch and left in place for the password branch.)

- [ ] **Step 6: `tsc --noEmit` and `npm run build`**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 7: Manually verify in the browser**

Start `npm run dev` (Task 2's server can be reused if still running). Using `test-gallery-pin` from Tasks 1/2 (has both a password and PIN — use the latest ones `gallery:set-password`/`gallery:set-pin` printed, or the originals from `gallery:create` if you didn't run those reset commands again):

- Visit `/gallery/test-gallery-pin`. Enter the correct password, submit. Confirm the screen swaps to a PIN prompt (not the photo grid) — same visual shell (dark overlay, same title), "Enter the 4-digit PIN..." copy, and a "Continue" button (not "View Gallery").
- Confirm the PIN input shows a numeric keyboard on a mobile viewport/emulation (`inputMode="numeric"`) and won't accept more than 4 characters.
- Enter an incorrect PIN, submit. Confirm "Incorrect PIN." appears and you're still on the PIN screen (not bounced back to the password screen).
- Enter the correct PIN, submit. Confirm the photo grid loads exactly as the no-PIN flow already does (this proves `commitSession` still works identically to the pre-existing single-step path).
- Refresh the page after unlocking: confirm it goes straight to the photo grid (the `sessionStorage` session still works exactly as before — this task didn't touch that mechanism).
- Visit `/gallery/andi` (or whichever gallery has no `pin_hash`): confirm the password alone still unlocks it directly, no PIN screen ever appears.
- On `test-gallery-pin`, enter an incorrect *password* (not PIN): confirm "Incorrect password." appears on the password screen — you should never reach or see any mention of a PIN when the password itself is wrong.

- [ ] **Step 8: Clean up the scratch gallery from Task 1**

```bash
npm run gallery:delete -- test-gallery-pin --yes
```

- [ ] **Step 9: Commit**

```bash
git add components/PasswordField.tsx "app/gallery/[slug]/GalleryGate.tsx"
git commit -m "Add PIN entry screen to GalleryGate, extend PasswordField with label/inputMode/maxLength"
```
