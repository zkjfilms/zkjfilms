# CAPTCHA / Bot Verification for Contact and Booking Forms

## Problem

`/api/contact` and `/api/bookings` are public, unauthenticated endpoints that accept form submissions from anyone. Neither verifies the submitter is human:

- `/api/contact` has no rate limiting, no honeypot, and no bot verification at all — it's fully open to automated spam.
- `/api/bookings` has a honeypot field and IP-based rate limiting (5 requests / 10 minutes), but no bot verification — a low-and-slow or distributed bot could still flood the calendar and trigger real Stripe checkout sessions.

This was flagged as a security recommendation during an earlier hardening pass and explicitly deferred. It's now being built.

## Goal

Add Cloudflare Turnstile verification to both forms so a human check happens before an email is sent, a lead is logged, or a booking is created — with minimal friction for real visitors and no change to either form's existing validation, honeypot, or rate-limiting behavior.

## Design

### Provider and mode

**Cloudflare Turnstile**, **Managed** widget mode. Chosen over reCAPTCHA v3 (sends behavior data to Google, requires tuning a score threshold) and hCaptcha (no particular advantage here) because the site already has a Cloudflare relationship (R2 storage), Turnstile is privacy-friendly, and Managed mode shows most real visitors nothing at all while still presenting a checkbox or puzzle to suspicious traffic — stronger bot-stopping power than the fully-invisible mode, with negligible added friction.

Turnstile is used in **explicit-render mode** (the JS API, not the auto-render `<div class="cf-turnstile">` tag) because both forms are controlled React components that need to read the resulting token programmatically and reset the widget after a failed submission — the auto-render mode doesn't give clean hooks for either.

### Server: `lib/turnstile.ts` (new)

```ts
export type TurnstileResult = { ok: true } | { ok: false; reason: "invalid" | "unreachable" };

export async function verifyTurnstileToken(
  token: string,
  ip: string,
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error("TURNSTILE_SECRET_KEY is not set.");
    return { ok: false, reason: "unreachable" };
  }

  let response: Response;
  try {
    response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      },
    );
  } catch (err) {
    console.error("Turnstile verification request failed:", err);
    return { ok: false, reason: "unreachable" };
  }

  if (!response.ok) {
    console.error("Turnstile siteverify returned non-OK status:", response.status);
    return { ok: false, reason: "unreachable" };
  }

  const data = (await response.json()) as { success: boolean };
  return data.success ? { ok: true } : { ok: false, reason: "invalid" };
}
```

Returns a discriminated result rather than a plain boolean specifically so callers can tell a genuinely bad/expired token (`reason: "invalid"`, → 400) apart from Cloudflare's verification service itself being unreachable (`reason: "unreachable"`, → 503) — the two cases the error-handling table below requires different responses for. Every error path (missing secret, network failure, non-OK HTTP status) maps to `"unreachable"`, since none of them mean the visitor failed a real check. Tokens are single-use and expire after 5 minutes, so no caching or replay handling is needed here; each call is a fresh check against Cloudflare.

### Client: `components/TurnstileWidget.tsx` (new)

A shared client component used by both forms:

- Loads `https://challenges.cloudflare.com/turnstile/v0/api.js` via `next/script` (`strategy="afterInteractive"`, `onError` sets a `scriptFailed` state).
- Renders the widget into a ref'd container via `window.turnstile.render(container, { sitekey, callback, "expired-callback", "error-callback" })` once the script has loaded.
- Props: `onVerify(token: string)`, called from the `callback` option. `expired-callback` and `error-callback` both call `onVerify("")` to clear any stored token in the parent.
- Exposes a `reset()` method (via `useImperativeHandle` + `forwardRef`) that calls `window.turnstile.reset(widgetId)` — the parent form calls this after a server-side rejection so the visitor gets a fresh challenge instead of retrying with a dead token. The component exports its ref type as `export type TurnstileWidgetHandle = { reset: () => void };` so consuming forms can type `useRef<TurnstileWidgetHandle>(null)`.
- If `scriptFailed` is true (script blocked or failed to load), renders an inline message instead of the widget: "Verification failed to load. Please disable ad blockers or refresh and try again." No token is ever produced in this state, so the submit button downstream stays disabled — this fails closed rather than silently skipping verification.

### `ContactForm.tsx` / `BookingForm.tsx`

Each gets:

- A `turnstileToken` state slot (`useState("")`) and a `widgetRef` (`useRef<TurnstileWidgetHandle>(null)`).
- `<TurnstileWidget ref={widgetRef} onVerify={setTurnstileToken} />` rendered above the submit button.
- Submit button `disabled` when `turnstileToken` is empty (in addition to the existing `status === "loading"` check).
- `turnstileToken` included in the JSON body already sent to `/api/contact` / `/api/bookings`.
- On a server response indicating verification failure specifically (see error contract below), call `widgetRef.current?.reset()` and clear `turnstileToken` so the disabled-submit state re-engages until the visitor re-verifies.

### `app/api/contact/route.ts` / `app/api/bookings/route.ts`

Both routes add `turnstileToken` to their payload type and parser (`typeof b.turnstileToken !== "string" || !b.turnstileToken` → reject, same pattern as the other required fields already use).

Check ordering (cheapest/local checks first, since Turnstile verification is a network round-trip to Cloudflare):

1. Payload shape/field validation (existing).
2. Honeypot check (`/api/bookings` only — existing, unchanged).
3. Rate limit check (`/api/bookings` only — existing, unchanged).
4. `verifyTurnstileToken(payload.turnstileToken, getClientIp(request))` — **new**, both routes.
5. Existing business logic (send email / create booking).

A non-`ok` result from step 4 returns, based on `reason`:

```ts
if (result.reason === "unreachable") {
  return Response.json(
    { error: "Verification service is temporarily unavailable. Please try again shortly." },
    { status: 503 },
  );
}
return Response.json(
  { error: "Verification failed. Please try again." },
  { status: 400 },
);
```

`/api/contact` gains this as its only new check (it has no honeypot or rate limit today — see Out of scope). `/api/bookings` gains it as an additional layer on top of its existing honeypot and rate limit, not a replacement for either.

### CSP (`next.config.ts`)

Three directives in `buildCspHeader()` gain `https://challenges.cloudflare.com`:

- `script-src` — loads the Turnstile widget script.
- `frame-src` — the interactive challenge (when Managed mode escalates past the invisible pass) renders in an iframe.
- `connect-src` — the widget script makes its own network calls to Cloudflare, which CSP's `connect-src` governs regardless of which script initiated them.

### Environment variables

- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — public, used client-side by `TurnstileWidget` to render the widget.
- `TURNSTILE_SECRET_KEY` — server-only, used by `lib/turnstile.ts` to call `siteverify`.

Both added to `.env.example` as placeholders. For local development ahead of having real keys, Cloudflare publishes fixed test site keys with predictable behavior (e.g. `1x00000000000000000000AA` always passes, `2x00000000000000000000AB` always blocks) — `.env.example` documents these so the feature is testable end-to-end before real keys exist.

**One-time setup (outside this codebase, before deploying):** create a Turnstile widget in the Cloudflare dashboard (Turnstile → Add Site), Managed mode, with `zkjfilms.com` and `localhost` as allowed domains; copy the site key and secret key into `.env.local` and into Vercel's Production + Preview environment variables.

### Error handling summary

| Scenario | Behavior |
|---|---|
| Widget script fails to load | Inline message shown; submit stays disabled (fails closed) |
| Token expires before submit | `expired-callback` clears the token; submit re-disables |
| Server rejects the token (expired/reused/invalid) | `400`; form resets the widget for a retry |
| Cloudflare's `siteverify` endpoint unreachable (outage) | `verifyTurnstileToken` returns `{ ok: false, reason: "unreachable" }`; route responds `503 { error: "Verification service is temporarily unavailable. Please try again shortly." }`, logged server-side |

The outage case is a deliberate fail-closed choice: a real Cloudflare Turnstile outage would briefly block real submissions too, but this is judged safer than accepting a fail-open path that an attacker could potentially trigger to bypass verification entirely.

### Out of scope

- Rate limiting or a honeypot field for `/api/contact` — a separate, pre-existing gap; not part of this ask.
- reCAPTCHA v3 or hCaptcha as alternative/additional providers.
- Any change to the gallery/admin/gated-access password flows — unrelated auth surface, already rate-limited from the earlier security-hardening pass.
- Any change to `/api/bookings`'s existing honeypot or rate-limit logic — Turnstile is additive.

## Testing / Verification

- `tsc --noEmit` and a full production build.
- `curl -X POST http://localhost:3000/api/contact` and `.../api/bookings` with a payload missing `turnstileToken` — confirm `400`.
- Browser, using Cloudflare's "always passes" test site key: submit both forms end-to-end — confirm the contact email/lead and the booking (including Stripe checkout redirect where applicable) still work exactly as before this change.
- Browser, using Cloudflare's "always blocks" test site key: confirm both forms surface the verification-failed error and neither sends an email/logs a lead nor creates a booking.
- Browser devtools console on `/contact` and `/book`: confirm the widget renders and passes with no CSP violation reports (validates the `script-src`/`frame-src`/`connect-src` additions).
- Confirm `/api/bookings`'s existing honeypot-triggers-silent-success behavior and 5-requests/10-minutes rate limit are both unchanged (submit with the honeypot filled, and submit 6 times rapidly with a valid Turnstile token to confirm the 6th still gets rate-limited, not verification-blocked).
