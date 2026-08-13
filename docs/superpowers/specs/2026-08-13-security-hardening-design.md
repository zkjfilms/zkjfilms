# Security Hardening: Rate Limiting + Response Headers

## Problem

Two gaps identified in a review of the site's current security posture, both fixable at zero runtime performance cost:

1. **`/api/admin-access` and `/api/gated-access` have no rate limiting.** Both already compare passwords with a timing-safe comparison (`lib/adminAccess.ts`/`lib/gatedAccess.ts`, `crypto.timingSafeEqual`) — good — but neither throttles repeated attempts, unlike `/api/gallery-access` (which gained rate limiting in an earlier piece of work) and `/api/bookings`. An attacker can attempt unlimited password guesses against the admin login or the age-gated boudoir section.
2. **No security response headers anywhere on the site.** No Content-Security-Policy, no `Strict-Transport-Security`, no `X-Content-Type-Options`, no `Referrer-Policy`, no `Permissions-Policy`, no clickjacking protection (`frame-ancestors`/`X-Frame-Options`). Confirmed via `grep` — no `vercel.json`, no `proxy.ts` (this Next.js version's name for what's historically called `middleware.ts` — confirmed in `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`), no `headers()` call in `next.config.ts`.

## Goal

Add rate limiting to the two unprotected password endpoints, and add a baseline set of security response headers — all with zero added latency or reduced cacheability for any existing page.

## Design

### Rate limiting

`app/api/admin-access/route.ts` and `app/api/gated-access/route.ts` each gain, at the top of their `POST` handler (after body parsing, before the password check):

```ts
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

const ip = getClientIp(request);
const { allowed } = await checkRateLimit({
  ip,
  endpoint: "admin-access", // "gated-access" in the other route
  maxHits: 10,
  windowMinutes: 15,
});
if (!allowed) {
  return Response.json(
    { error: "Too many attempts. Please try again shortly." },
    { status: 429 },
  );
}
```

Uses the existing combined `checkRateLimit()` (check-and-record-on-every-allowed-attempt), the same helper `/api/bookings` already calls — not the split `peekRateLimit`/`recordRateLimitHit` pair built for `/api/gallery-access`. That split exists specifically to let a successful *first step* of a two-request PIN flow not consume budget; neither of these routes has a multi-step flow, so the simpler combined helper is the right fit, consistent with `/api/bookings`'s usage. 10 attempts / 15 minutes matches the per-IP threshold already used for gallery passwords.

### Security headers

Added via `next.config.ts`'s `headers()` function — a static, build-time-known header set applied by Vercel's edge to every response, not a per-request computation. This is the "Without Nonces" pattern from Next's own CSP guide, chosen specifically because the alternative (nonce-based CSP) requires per-request dynamic rendering and would disable static generation and the 5-minute ISR revalidation this site already relies on (`/`, `/films`, `/faq`, `/book`) — a real, direct performance regression the project owner explicitly ruled out.

```ts
function buildCspHeader(isDev: boolean): string {
  const r2PublicHost = new URL(PUBLIC_IMAGES_BASE_URL).hostname;
  return [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    `media-src 'self' https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    `font-src 'self'`,
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}
```

- `script-src`/`style-src` need `'unsafe-inline'` (not nonces, per the decision above) — Next/React inject inline hydration data, and this site renders inline `<script type="application/ld+json">` structured data on several pages (`app/page.tsx`, `app/faq/page.tsx`) whose content is partly DB-driven and can't be hash-pinned at build time.
- `img-src`/`media-src` include both R2 hostnames because client galleries (`GalleryGate.tsx`/`GalleryLightbox.tsx`) and the public showcase videos (`app/films`) load photos/videos directly via plain `<img>`/`<video>` tags pointing at signed or public R2 URLs — not through `next/image`'s same-origin proxy, which is what the bare `'self'` would otherwise cover. The private-bucket pattern uses a wildcard subdomain (`*.r2.cloudflarestorage.com`) since the exact account-ID subdomain isn't a secret (it's already visible in every signed URL a gallery viewer's browser requests) and a wildcard survives any future R2 endpoint change without a code edit.
- `connect-src` includes the Supabase project host (`https://*.supabase.co` and its `wss://` equivalent) because `lib/supabaseBrowser.ts` connects directly from the browser for Realtime Broadcast (live booking-availability updates) — the only client-side Supabase usage in the app (never `.from()`, per that file's own comment).
- No explicit allowance needed for Vercel Analytics/Speed Insights — the official `@vercel/analytics`/`@vercel/speed-insights` Next.js integrations proxy through the deployment's own same-origin path when hosted on Vercel (which this site is), so `'self'` already covers them. Confirm this holds after deploy by watching the browser console for CSP violation reports on a real page load.
- `frame-ancestors 'none'` — nothing about this site needs to be embeddable in another page's iframe.

Alongside the CSP, the same `headers()` entry adds:

```ts
{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
{ key: "X-Content-Type-Options", value: "nosniff" },
{ key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
{ key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
{ key: "X-Frame-Options", value: "DENY" },
```

`Permissions-Policy` disables exactly the browser features this site never uses (camera, microphone, geolocation, the Payment Request API — Stripe Checkout is a full-page redirect, not an in-page payment API call) — pure downside-free lockout of APIs with no legitimate use here. `X-Frame-Options: DENY` is redundant with `frame-ancestors 'none'` for modern browsers but is free and covers older browsers that don't honor the CSP directive.

### Out of scope

- Nonce-based CSP — the stronger option, explicitly ruled out due to its dynamic-rendering performance cost.
- Vercel Firewall/WAF custom rules — a platform-level consideration, not a code change; can be revisited separately if ever needed.
- CAPTCHA or bot-verification on the contact/booking forms — a different problem (spam, not auth brute-forcing), not requested here.
- Any change to `/api/gallery-access`'s existing rate limiting — already covers what this pass covers for the other two password routes.

## Testing / Verification

- `tsc --noEmit` and a full production build — confirm the build itself isn't affected by the new headers (a static `headers()` addition shouldn't touch build output shape, but confirm the route list still shows the same static/ISR markers it did before, e.g. `/films` still shows as `5m 1y`, not converted to dynamic).
- `npm run dev`, then `curl -sI http://localhost:3000/` and confirm the `Content-Security-Policy` and other headers are present, and that `script-src` includes `'unsafe-eval'` in dev but not in a production build.
- `npm run build && npm run start`, then `curl -sI http://localhost:3000/` and confirm the production CSP (no `'unsafe-eval'`) and all other headers are present.
- Browser: load the homepage with the production server running, open devtools console, confirm **no CSP violation reports** on a normal page load (this is the real test of whether the policy is too strict — Vercel Analytics/Speed Insights, Google Fonts via `next/font`, and normal page rendering should all work silently).
- Browser: unlock a real gallery (or a scratch one) and confirm photos/videos still load and play — this exercises the `img-src`/`media-src` R2 allowances specifically.
- Browser: visit `/films` and confirm video playback still works — same allowance, different bucket.
- Browser: on `/book`, confirm the live availability calendar still updates (exercises the Supabase Realtime `connect-src` allowance) — or at minimum confirm no CSP violation is logged for a `wss://` connection attempt.
- `curl -s -X POST http://localhost:3000/api/admin-access -H "Content-Type: application/json" -d '{"password":"wrong"}'` in a loop 11 times: confirm the 11th returns `429`.
- Same loop against `/api/gated-access` with a `{"password":"wrong","ageConfirmed":true}` body: confirm the 11th returns `429`.
- Confirm a *correct* admin/gated password still works normally after the rate-limit changes (the happy path is unaffected — `checkRateLimit` only blocks once the threshold is exceeded).
