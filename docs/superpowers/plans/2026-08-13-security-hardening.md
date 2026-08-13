# Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rate limiting to the two password-protected API routes that currently have none (`/api/admin-access`, `/api/gated-access`), and add a baseline set of security response headers (CSP + others) to every page — both changes at zero added runtime latency or reduced cacheability.

**Architecture:** Rate limiting reuses the existing `checkRateLimit()`/`getClientIp()` helpers from `lib/rateLimit.ts` (already used by `/api/bookings` and `/api/gallery-access`), no new infrastructure. Security headers are a static, build-time-known set returned from `next.config.ts`'s `headers()` function — applied by Vercel's edge to every response with no per-request computation, no `proxy.ts`, no nonces.

**Tech Stack:** Next.js API routes, Next.js `headers()` config, no new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-13-security-hardening-design.md`.
- Rate limiting: `maxHits: 10, windowMinutes: 15` per IP, via the existing combined `checkRateLimit()` (not the split `peekRateLimit`/`recordRateLimitHit` pair built for the multi-step gallery PIN flow — neither of these routes has a multi-step flow, so the simpler helper is the right fit, matching `/api/bookings`'s usage exactly).
- CSP must be **static, no nonces** — this is a deliberate choice to avoid forcing dynamic rendering, which would disable static generation and the 5-minute ISR revalidation on `/`, `/films`, `/faq`, `/book`. Do not introduce a `proxy.ts` (this Next.js version's name for what's historically `middleware.ts` — confirmed in `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md`) or any nonce mechanism.
- `script-src`/`style-src` include `'unsafe-inline'` — required for Next/React's own inline hydration data and this site's DB-driven inline JSON-LD structured data (`app/page.tsx`, `app/faq/page.tsx`), which can't be hash-pinned at build time.
- No automated test suite exists in this repo (no `test` script, no Jest/Vitest). Verification is `tsc --noEmit`, `npm run build`, manual `curl`/browser checks, following the same pattern as every prior plan in this repo.

---

## Task 1: Rate limiting on `/api/admin-access` and `/api/gated-access`

**Files:**
- Modify: `app/api/admin-access/route.ts`
- Modify: `app/api/gated-access/route.ts`

**Interfaces:**
- Consumes: `checkRateLimit(params: { ip: string; endpoint: string; maxHits: number; windowMinutes: number }): Promise<{ allowed: boolean }>` and `getClientIp(request: Request): string`, both existing and unchanged, from `lib/rateLimit.ts`.

- [ ] **Step 1: Add rate limiting to `app/api/admin-access/route.ts`**

Replace this exact block:

```ts
import {
  checkPassword,
  createAccessToken,
  ADMIN_ACCESS_COOKIE,
} from "@/lib/adminAccess";

type Payload = { password: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { password } = body as Record<string, unknown>;

  if (typeof password !== "string" || !password) return null;

  return { password };
}

export async function POST(request: Request) {
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

  if (!process.env.ADMIN_PASSWORD) {
```

with:

```ts
import {
  checkPassword,
  createAccessToken,
  ADMIN_ACCESS_COOKIE,
} from "@/lib/adminAccess";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

type Payload = { password: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { password } = body as Record<string, unknown>;

  if (typeof password !== "string" || !password) return null;

  return { password };
}

export async function POST(request: Request) {
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

  const { allowed } = await checkRateLimit({
    ip: getClientIp(request),
    endpoint: "admin-access",
    maxHits: 10,
    windowMinutes: 15,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429 },
    );
  }

  if (!process.env.ADMIN_PASSWORD) {
```

- [ ] **Step 2: Add rate limiting to `app/api/gated-access/route.ts`**

Replace this exact block:

```ts
import {
  checkPassword,
  createAccessToken,
  GATED_ACCESS_COOKIE,
} from "@/lib/gatedAccess";

type Payload = { password: string; ageConfirmed: boolean };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { password, ageConfirmed } = body as Record<string, unknown>;

  if (typeof password !== "string" || typeof ageConfirmed !== "boolean") {
    return null;
  }

  return { password, ageConfirmed };
}

export async function POST(request: Request) {
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

  if (!payload.ageConfirmed) {
    return Response.json(
      { error: "Please confirm you are 18 or older to continue." },
      { status: 400 },
    );
  }

  if (!process.env.GATED_ACCESS_PASSWORD) {
```

with:

```ts
import {
  checkPassword,
  createAccessToken,
  GATED_ACCESS_COOKIE,
} from "@/lib/gatedAccess";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

type Payload = { password: string; ageConfirmed: boolean };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const { password, ageConfirmed } = body as Record<string, unknown>;

  if (typeof password !== "string" || typeof ageConfirmed !== "boolean") {
    return null;
  }

  return { password, ageConfirmed };
}

export async function POST(request: Request) {
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

  const { allowed } = await checkRateLimit({
    ip: getClientIp(request),
    endpoint: "gated-access",
    maxHits: 10,
    windowMinutes: 15,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many attempts. Please try again shortly." },
      { status: 429 },
    );
  }

  if (!payload.ageConfirmed) {
    return Response.json(
      { error: "Please confirm you are 18 or older to continue." },
      { status: 400 },
    );
  }

  if (!process.env.GATED_ACCESS_PASSWORD) {
```

- [ ] **Step 3: `tsc --noEmit` and `npm run build`**

Run: `npx tsc --noEmit && npm run build`
Expected: both succeed with no new errors.

- [ ] **Step 4: Manually verify against a local dev server**

Start `npm run dev` if not already running.

Confirm the happy path still works first — a correct password should behave exactly as before:

```bash
curl -s -i -X POST http://localhost:3000/api/admin-access \
  -H "Content-Type: application/json" \
  -d '{"password":"<your real ADMIN_PASSWORD from .env.local>"}'
```

Expected: `200`, `Set-Cookie` header present, same as before this change.

Then confirm rate limiting triggers on repeated failures. Run 11 times in a row (any shell loop, e.g. `for i in $(seq 1 11); do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/admin-access -H "Content-Type: application/json" -d '{"password":"wrong"}'; done`):

Expected: the first 10 return `401` (`Incorrect password.`), the 11th returns `429` (`Too many attempts. Please try again shortly.`).

Repeat both checks against `/api/gated-access` (body needs `ageConfirmed: true` too, e.g. `{"password":"wrong","ageConfirmed":true}` for the failure loop, and your real `GATED_ACCESS_PASSWORD` + `"ageConfirmed":true` for the happy-path check).

Note: both loops consume part of the same IP's 15-minute budget for their respective endpoint — run each endpoint's two checks back-to-back and don't repeat them unnecessarily within the same 15-minute window, or the happy-path check could itself get rate-limited.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin-access/route.ts app/api/gated-access/route.ts
git commit -m "Add rate limiting to /api/admin-access and /api/gated-access"
```

---

## Task 2: Security response headers

**Files:**
- Modify: `next.config.ts` (full-file replacement — the file is small and gains a new helper function plus the `headers()` config)

**Interfaces:**
- Produces: a `Content-Security-Policy` (and other security headers) applied to every response via Next's `headers()` config — no other file depends on or imports anything from this change.

- [ ] **Step 1: Replace `next.config.ts`**

Replace the entire file with:

```ts
import type { NextConfig } from "next";
import { PUBLIC_IMAGES_BASE_URL } from "./lib/media";

// Static (no nonces) CSP — the nonce-based alternative Next.js supports
// requires every page to render dynamically per request, which would
// disable the static generation and 5-minute ISR revalidation this site
// relies on (/, /films, /faq, /book). script-src/style-src need
// 'unsafe-inline' as the tradeoff: Next/React inject inline hydration
// data, and several pages render inline JSON-LD structured data
// (app/page.tsx, app/faq/page.tsx) with DB-driven content that can't be
// hash-pinned at build time.
function buildCspHeader(isDev: boolean): string {
  const r2PublicHost = new URL(PUBLIC_IMAGES_BASE_URL).hostname;
  return [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    // Client galleries and /films load photos/videos directly from R2 via
    // plain <img>/<video> tags (signed or public URLs), not through
    // next/image's same-origin proxy — bare 'self' wouldn't cover these.
    // The private bucket's account-ID subdomain isn't a secret (it's
    // already visible in every signed URL a gallery viewer's browser
    // requests), so a wildcard is used rather than hardcoding it.
    `img-src 'self' blob: data: https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    `media-src 'self' https://*.r2.cloudflarestorage.com https://${r2PublicHost}`,
    `font-src 'self'`,
    // lib/supabaseBrowser.ts connects directly from the browser for
    // Realtime Broadcast (live booking-availability updates) — the only
    // client-side Supabase usage in the app.
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

const nextConfig: NextConfig = {
  images: {
    // Next.js 16 requires listing every quality value used via the
    // `quality` prop on next/image — an unlisted value silently falls back
    // to the nearest allowed one (75 is the only default) instead of
    // erroring, which is what made components/ServiceLandingPage.tsx's
    // (and others') quality={90} appear to have no effect in production.
    qualities: [75, 90],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: "fastly.picsum.photos",
        port: "",
        pathname: "/**",
        search: "",
      },
      {
        protocol: "https",
        hostname: new URL(PUBLIC_IMAGES_BASE_URL).hostname,
        port: "",
        pathname: "/**",
        search: "",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: buildCspHeader(process.env.NODE_ENV === "development"),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
```

- [ ] **Step 2: `tsc --noEmit`**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build — confirm static/ISR rendering is unaffected**

Run: `npm run build`
Expected: succeeds with no new errors, and the route table's static/ISR markers are unchanged from before this task — `/films`, `/faq`, `/book` should still show the `5m 1y` (or equivalent) ISR marker, `/`, `/portraits`, `/headshots`, `/creative-portraits`, `/boudoir` etc. should still show as static (`○`), not dynamic (`ƒ`). This is the concrete proof the static-CSP choice didn't force dynamic rendering.

- [ ] **Step 4: Verify headers in both dev and production modes**

Dev mode (`npm run dev` if not already running):

```bash
curl -sI http://localhost:3000/
```

Expected: `Content-Security-Policy` header present, `script-src` includes `'unsafe-eval'`. Also confirm `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options` are all present.

Production mode (`npm run build && npm run start`, on a free port if 3000 is already in use by the dev server — e.g. `PORT=3001 npm run start`):

```bash
curl -sI http://localhost:3001/
```

Expected: same headers, but `script-src` does **not** include `'unsafe-eval'`.

- [ ] **Step 5: Browser verification — confirm nothing on the site actually breaks under the new CSP**

With the production server from Step 4 still running, open the homepage in a browser with devtools open to the console:

- Confirm no CSP violation errors appear on a normal page load (this is the real test — Vercel Analytics/Speed Insights, `next/font`-loaded fonts, and normal page rendering should all work silently under the new policy).
- Unlock a real gallery (or create a scratch one with `npm run gallery:create`/`npm run gallery:upload` and clean it up after with `npm run gallery:delete -- <slug> --yes`) and confirm photos/videos still load and play — this exercises the `img-src`/`media-src` R2 allowances specifically.
- Visit `/films` and confirm video playback still works — same allowance, different bucket.
- Visit `/book` and confirm the availability calendar loads/updates without a CSP violation in the console for the Supabase Realtime `wss://` connection.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts
git commit -m "Add security response headers (CSP + others) via next.config.ts"
```
