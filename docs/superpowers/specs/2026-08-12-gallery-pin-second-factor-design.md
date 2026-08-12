# Gallery PIN (Second Factor)

## Problem

Client galleries are gated by a single password (`docs/superpowers/specs/2026-08-12-gallery-create-upload-design.md`). A prior code review flagged that this password is the *only* gate protecting private client photos, with no rate limiting on the verifying endpoint — the entropy fix applied then (3 words + a 2-digit number) raises the guess space but doesn't add a second, independent layer of protection.

## Goal

Add an optional 4-digit PIN as a second factor for client galleries specifically, entered as a separate step after the password, plus rate limiting on the endpoint that checks both — without breaking any gallery created before this feature exists.

## Design

### Schema

Append to `supabase/schema.sql` (the file's established convention — historical statements aren't edited, new ones are appended):

```sql
alter table galleries add column if not exists pin_hash text;
```

Nullable, no default. A gallery with `pin_hash is null` never triggers the PIN step — this is what makes every gallery created before this feature (including the existing `andi` gallery) keep working exactly as today with zero migration action required.

### `scripts/gallery.mjs`: `create` (updated)

After generating and hashing the password (existing behavior, unchanged), also generate a 4-digit PIN:

```js
function generatePin() {
  return String(randomInt(0, 10000)).padStart(4, "0");
}
```

Hash it the same way as the password (`bcrypt.hash(pin, 10)`) and include `pin_hash` in the `galleries` insert. Print it once, alongside the password, in the same "shown once" block:

```
Created gallery "andi".
URL: https://zkjfilms.com/gallery/andi
Password: lantern-cinder-granite-65
PIN: 4821
(Shown once — only their hashes are stored. Save both before closing this terminal.)
Expires: never
```

### `scripts/gallery.mjs`: `set-pin` (new command)

`npm run gallery:set-pin -- <slug>` — generates a fresh 4-digit PIN via the same `generatePin()`, hashes it, and updates the gallery's `pin_hash` (looking the gallery up first, same "no gallery found" error pattern as the other lifecycle commands). Prints the new PIN once, same "shown once" framing. This is how a PIN gets added to a gallery created before this feature (e.g. `andi`), or rotated on an existing one. No corresponding "clear PIN" command — removing this protection is rare enough to do by hand in Supabase if it's ever actually needed, not worth a one-line CLI command that makes it easy to accidentally weaken a gallery's protection.

### `app/api/gallery-access/route.ts`

Payload type becomes `{ slug: string; password: string; pin?: string }`.

Rate limiting, added at the top of the handler before any Supabase lookup, using the existing `checkRateLimit()`/`getClientIp()` helpers from `lib/rateLimit.ts` (already used by `app/api/bookings/route.ts`, following its exact call pattern):

```ts
const ip = getClientIp(request);
const { allowed } = await checkRateLimit({ ip, endpoint: "gallery-access", maxHits: 10, windowMinutes: 15 });
if (!allowed) {
  return Response.json({ error: "Too many attempts. Please try again shortly." }, { status: 429 });
}
```

The `galleries` select gains `pin_hash`. After the existing password check passes (unchanged: existence check, then `isGalleryUnavailable`, then `bcrypt.compare` against `password_hash`):

- If `gallery.pin_hash` is `null` → proceed exactly as today: fetch and return signed image URLs.
- If `gallery.pin_hash` is set:
  - Request has no `pin` → respond `{ ok: true, pinRequired: true }` with no images (200 — the password itself was correct, this isn't an error state).
  - Request has a `pin` → `bcrypt.compare(pin, gallery.pin_hash)`. Mismatch → `401` with `{ error: "Incorrect PIN." }` (a distinct message from `"Incorrect password."`, so the client shows the error on the right screen). Match → proceed exactly as the no-PIN path does: fetch and return signed image URLs.

The client always re-sends `password` alongside `pin` on the second request — the server re-verifies both from scratch every time. No new token, cookie, or session concept: this keeps the endpoint stateless, matching how the rest of the gallery-access flow already works (the only persisted state is the final unlocked session in `sessionStorage`, written once both checks pass).

### `components/PasswordField.tsx` (extended, backward compatible)

Two new optional props, both defaulting to today's exact behavior so the 3 existing callers (`GalleryGate`, `AdminGate`, `GateScreen`) need no changes:

```ts
type PasswordFieldProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  variant: "dark" | "light";
  label?: string; // defaults to "Password"
  inputMode?: "text" | "numeric"; // defaults to "text"
  maxLength?: number; // defaults to undefined (no cap)
};
```

`label` resolves a seam a previous review flagged (the label was hardcoded, anticipating exactly this kind of second caller). `inputMode="numeric"` brings up a numeric keyboard on mobile for the PIN field; `maxLength={4}` caps entry length — both are client-side UX conveniences only, not the actual security boundary (that's the server-side `bcrypt.compare`, which works regardless of what the client sends).

### `app/gallery/[slug]/GalleryGate.tsx`

New local state: `const [stage, setStage] = useState<"password" | "pin">("password")` and `const [pin, setPin] = useState("")`. Deliberately not persisted anywhere (not `sessionStorage`, not a URL param) — a page refresh mid-PIN-entry simply restarts at the password screen. This is a conscious simplicity choice: the alternative (persisting "password verified" across a refresh) needs its own expiry/invalidation story for a low-value edge case (an interrupted unlock attempt), and re-typing the password once more is a small cost.

Flow:
1. Password-stage submit (`handleSubmit`, existing function, logic added): POST `{slug, password}`. On `data.pinRequired`, set `stage = "pin"` and stop (don't touch `sessionStorage`, reset `submitStatus` to idle so the PIN screen starts clean). On images returned directly (no PIN required), behave exactly as today.
2. PIN-stage submit (new `handlePinSubmit`): POST `{slug, password, pin}` (password read from existing state, not re-typed). On success, write the unlocked session to `sessionStorage` exactly as the current single-step flow does today. On `401` with the PIN-specific error, show it on the PIN screen and let the user retry the PIN (password stays remembered in state, only the PIN field needs correcting) — matches the existing gate's "clear error on next keystroke" behavior, applied to the PIN field.
3. Render: while `stage === "pin"`, show a screen visually identical in structure to the password screen (same overlay, same heading treatment) but with `<PasswordField label="PIN" inputMode="numeric" maxLength={4} .../>` instead, and its own submit button ("Continue" or similar, not "View Gallery").

### Out of scope

- No "clear PIN" CLI command (see `set-pin` above).
- No persistence of the intermediate "password verified, awaiting PIN" state across a page refresh.
- Admin sign-in (`AdminGate.tsx`) and the age-gated section (`GateScreen.tsx`) are unaffected — single-factor password only, per the scope decision made during brainstorming.
- No change to how `expires_at`/`archived_at` are checked — that logic runs once, on the password step, exactly as today.
- No visible indication to a site visitor, before entering a password, of whether a given gallery has a PIN configured — the `pinRequired` response only appears after a *correct* password, so an incorrect-password guess reveals nothing about whether a second factor exists.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- `npm run gallery:create -- test-gallery-pin "Test" "Test"`: confirm both a password and a 4-digit PIN print, and that the `galleries` row has both `password_hash` and `pin_hash` set (bcrypt-prefixed).
- `npm run gallery:set-pin -- andi`: confirm a new PIN prints and `andi`'s row gets a `pin_hash` where it previously had `null`.
- Browser, on `test-gallery-pin` (has a PIN): enter the correct password → confirm the PIN screen appears with no photos shown yet → enter an incorrect PIN → confirm "Incorrect PIN." and the screen stays on PIN entry → enter the correct PIN → confirm photos load and the gallery behaves exactly as before (download, lightbox, `sessionStorage` session) once unlocked.
- Browser, on the existing `andi` gallery *before* running `gallery:set-pin` on it: confirm the password alone still unlocks it directly, no PIN screen appears — proves backward compatibility.
- Confirm rate limiting: script or manually fire 11 requests at `/api/gallery-access` for the same IP within 15 minutes and confirm the 11th returns `429` with the "Too many attempts" message.
- Confirm an incorrect password on a PIN-protected gallery still shows "Incorrect password." and never reaches/mentions the PIN step.
- Clean up: `npm run gallery:delete -- test-gallery-pin --yes`.
