# CAPTCHA / Bot Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Cloudflare Turnstile bot verification to the contact form (`/contact`) and booking form (`/book`), so a human check happens before an email is sent, a lead is logged, or a booking is created.

**Architecture:** A server-only `lib/turnstile.ts` helper calls Cloudflare's `siteverify` endpoint and returns a discriminated result (`ok`, or `ok: false` with a reason distinguishing a bad token from an unreachable verification service). A shared `components/TurnstileWidget.tsx` client component wraps Cloudflare's Turnstile JS API in explicit-render mode, exposing a token via callback and a `reset()` handle. Both forms render the widget, hold its token in state, and send it to their existing API routes, which verify it before doing anything else.

**Tech Stack:** Next.js 16.3.0 App Router, React 19, TypeScript, Cloudflare Turnstile (Managed mode). No test framework is installed in this repo (`package.json` has no `test` script) — verification throughout this plan is `tsc --noEmit`, `npm run build`, `curl`, and manual browser checks using Cloudflare's published test keys, matching how every other feature in this codebase has been verified.

## Global Constraints

- Turnstile widget mode: **Managed**, explicit-render (not the auto-render `<div class="cf-turnstile">` tag).
- New env vars: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (client, public) and `TURNSTILE_SECRET_KEY` (server-only).
- `verifyTurnstileToken(token: string, ip: string): Promise<TurnstileResult>` where `TurnstileResult = { ok: true } | { ok: false; reason: "invalid" | "unreachable" }` — every error path (missing secret, network failure, non-OK HTTP status, or a Cloudflare-reported failure) fails closed; only `reason: "invalid"` vs `"unreachable"` distinguishes a bad token from a broken verification service.
- Exact response contract for both routes on verification failure:
  - `reason: "unreachable"` → `503 { error: "Verification service is temporarily unavailable. Please try again shortly." }`
  - `reason: "invalid"` (or missing/empty token in the payload) → `400 { error: "Verification failed. Please try again." }`
- CSP (`next.config.ts`, inside `buildCspHeader`) gains `https://challenges.cloudflare.com` on exactly three directives: `script-src`, `frame-src`, `connect-src`. No other directive changes.
- `components/TurnstileWidget.tsx` exports `export type TurnstileWidgetHandle = { reset: () => void };` — both forms type their ref as `useRef<TurnstileWidgetHandle>(null)`.
- Cloudflare's published fixed test keys (used throughout this plan's manual verification steps, and safe to commit as `.env.example` documentation — they are public, intentionally-predictable Cloudflare-owned keys, not secrets):
  - Site key, always passes: `1x00000000000000000000AA`
  - Site key, always blocks: `2x00000000000000000000AB`
  - Secret key, always passes: `1x0000000000000000000000000000000AA`
  - Secret key, always fails: `2x0000000000000000000000000000000AA`
- Neither form's existing validation, honeypot (`/api/bookings` only), or rate limiting changes — Turnstile is additive, inserted after those existing checks, before business logic.

---

### Task 1: Server-side verification helper, env vars, and CSP

**Files:**
- Create: `lib/turnstile.ts`
- Modify: `next.config.ts` (CSP directives)
- Modify: `.env.example`

**Interfaces:**
- Produces: `export type TurnstileResult = { ok: true } | { ok: false; reason: "invalid" | "unreachable" };` and `export async function verifyTurnstileToken(token: string, ip: string): Promise<TurnstileResult>` from `lib/turnstile.ts` — both later tasks import this.

- [ ] **Step 1: Create `lib/turnstile.ts`**

```ts
export type TurnstileResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unreachable" };

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
    console.error(
      "Turnstile siteverify returned non-OK status:",
      response.status,
    );
    return { ok: false, reason: "unreachable" };
  }

  const data = (await response.json()) as { success: boolean };
  return data.success ? { ok: true } : { ok: false, reason: "invalid" };
}
```

- [ ] **Step 2: Verify the HTTP contract against Cloudflare's real endpoint using test keys**

This checks the exact request shape (form-encoded body, field names) our function relies on, using Cloudflare's publicly documented test secret keys — no app code needs to be running for this step.

Run:
```bash
curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "secret=1x0000000000000000000000000000000AA&response=any-value&remoteip=127.0.0.1"
```
Expected: JSON response containing `"success":true`.

Run:
```bash
curl -s -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "secret=2x0000000000000000000000000000000AA&response=any-value&remoteip=127.0.0.1"
```
Expected: JSON response containing `"success":false`.

Both confirm the endpoint, field names, and response shape `verifyTurnstileToken` codes against are correct.

- [ ] **Step 3: Add the CSP directives**

In `next.config.ts`, inside `buildCspHeader()`, replace exactly these three lines (leave every other directive untouched):

Replace:
```ts
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
```
With:
```ts
    `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com${isDev ? " 'unsafe-eval'" : ""}`,
```

Replace:
```ts
    `frame-src 'self' https://www.google.com`,
```
With:
```ts
    `frame-src 'self' https://www.google.com https://challenges.cloudflare.com`,
```

Replace:
```ts
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co`,
```
With:
```ts
    `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://challenges.cloudflare.com`,
```

- [ ] **Step 4: Add env vars to `.env.example`**

Append this block to the end of `.env.example`:

```
# Cloudflare Turnstile (bot verification on /contact and /book). Create a
# widget at the Cloudflare dashboard > Turnstile > Add widget, Managed
# mode, with zkjfilms.com and localhost as allowed domains. Set the same
# two values in Vercel's Production/Preview env vars before deploying.
#
# For local development before you have real keys, Cloudflare's fixed
# test keys work end-to-end without needing a real widget:
#   Always passes: site=1x00000000000000000000AA secret=1x0000000000000000000000000000000AA
#   Always blocks: site=2x00000000000000000000AB secret=2x0000000000000000000000000000000AA
NEXT_PUBLIC_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

- [ ] **Step 5: Add the test keys to your own `.env.local`**

Run (adjust path if your `.env.local` differs):
```bash
printf '\nNEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA\nTURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA\n' >> .env.local
```
This lets every later browser-verification step in this plan run against the "always passes" test key without needing real Cloudflare dashboard keys yet. Swap in your real keys later (see the plan's final "Manual Cloudflare setup" section) before deploying.

- [ ] **Step 6: Confirm the project still type-checks and builds**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: build succeeds; the CSP header still appears once per response (no duplicate directives), and the route list's static/ISR markers are unchanged from before this task (`/`, `/films`, `/faq`, `/book` still show `5m 1y`).

- [ ] **Step 7: Commit**

```bash
git add lib/turnstile.ts next.config.ts .env.example
git commit -m "Add Turnstile server verification helper, env vars, and CSP allowances"
```

---

### Task 2: Shared widget component, wired into the contact form

**Files:**
- Create: `components/TurnstileWidget.tsx`
- Modify: `app/contact/ContactForm.tsx`
- Modify: `app/api/contact/route.ts`

**Interfaces:**
- Consumes: `verifyTurnstileToken`, `TurnstileResult` from `lib/turnstile.ts` (Task 1).
- Produces: `export type TurnstileWidgetHandle = { reset: () => void };` and `export default function TurnstileWidget` (forwardRef component, props `{ onVerify: (token: string) => void }`) from `components/TurnstileWidget.tsx` — Task 3 imports both.

- [ ] **Step 1: Create `components/TurnstileWidget.tsx`**

```tsx
"use client";

import Script from "next/script";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export type TurnstileWidgetHandle = {
  reset: () => void;
};

type Props = {
  onVerify: (token: string) => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
        },
      ) => string;
      reset: (widgetId: string) => void;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, Props>(
  function TurnstileWidget({ onVerify }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);
    const [scriptLoaded, setScriptLoaded] = useState(false);
    const [scriptFailed, setScriptFailed] = useState(false);

    useImperativeHandle(ref, () => ({
      reset() {
        if (window.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
        }
        onVerify("");
      },
    }));

    // Synchronizes with an external system (renders the Cloudflare
    // widget into the DOM once its script has loaded) — this is the
    // sanctioned use of an effect, not a state-derivation effect.
    useEffect(() => {
      if (!scriptLoaded || !SITE_KEY || !containerRef.current) return;
      if (!window.turnstile || widgetIdRef.current) return;

      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: SITE_KEY,
        callback: (token) => onVerify(token),
        "expired-callback": () => onVerify(""),
        "error-callback": () => onVerify(""),
      });
    }, [scriptLoaded, onVerify]);

    const unavailable = !SITE_KEY || scriptFailed;

    return (
      <div>
        {!unavailable && (
          <Script
            src="https://challenges.cloudflare.com/turnstile/v0/api.js"
            strategy="afterInteractive"
            onLoad={() => setScriptLoaded(true)}
            onError={() => setScriptFailed(true)}
          />
        )}
        <div ref={containerRef} />
        {unavailable && (
          <p className="text-xs text-red-700">
            Verification failed to load. Please disable ad blockers or
            refresh and try again.
          </p>
        )}
      </div>
    );
  },
);

export default TurnstileWidget;
```

Note: `setScriptFailed`/`setScriptLoaded` are called from the `<Script>` component's `onLoad`/`onError` props — these are event-handler callbacks, not code running inside a `useEffect` body, so they don't trip the `react-hooks/set-state-in-effect` lint rule this codebase enforces. The one `useEffect` here only calls the imperative `window.turnstile.render(...)` API — never `setState` — matching the "synchronize with an external system" pattern the rule expects.

- [ ] **Step 2: Modify `app/contact/ContactForm.tsx`**

Replace the full file with:

```tsx
"use client";

import { useRef, useState, type FormEvent } from "react";
import { SESSION_TYPES } from "@/lib/leads";
import TurnstileWidget, {
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";

type Status = "idle" | "loading" | "submitted" | "error";

type FormValues = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
};

type FormErrors = Partial<Record<keyof FormValues, string>>;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {};

  if (!values.name.trim()) {
    errors.name = "Please enter your name.";
  }

  if (!values.email.trim()) {
    errors.email = "Please enter your email.";
  } else if (!EMAIL_REGEX.test(values.email.trim())) {
    errors.email = "Please enter a valid email address.";
  }

  if (!values.sessionType) {
    errors.sessionType = "Please select a session type.";
  }

  if (!values.message.trim()) {
    errors.message = "Please share a few details.";
  }

  return errors;
}

export default function ContactForm() {
  const [status, setStatus] = useState<Status>("idle");
  const [errors, setErrors] = useState<FormErrors>({});
  const [form, setForm] = useState<FormValues>({
    name: "",
    email: "",
    sessionType: "",
    message: "",
  });
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const validationErrors = validate(form);
    setErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      return;
    }

    setStatus("loading");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, turnstileToken }),
      });

      if (!response.ok) {
        throw new Error("Request failed");
      }

      setStatus("submitted");
    } catch {
      turnstileRef.current?.reset();
      setTurnstileToken("");
      setStatus("error");
    }
  }

  if (status === "submitted") {
    return (
      <div className="border border-border px-6 py-10 text-center">
        <p className="font-serif text-2xl italic text-foreground">
          Thank you.
        </p>
        <p className="mt-3 text-muted">
          Your message has been received. I&rsquo;ll get back to you within a
          day or two.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-8">
      <div>
        <label
          htmlFor="name"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          value={form.name}
          onChange={handleChange}
          aria-invalid={Boolean(errors.name)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        />
        {errors.name && (
          <p className="mt-2 text-xs text-red-700">{errors.name}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="email"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          value={form.email}
          onChange={handleChange}
          aria-invalid={Boolean(errors.email)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        />
        {errors.email && (
          <p className="mt-2 text-xs text-red-700">{errors.email}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="sessionType"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          What kind of session are you interested in?
        </label>
        <select
          id="sessionType"
          name="sessionType"
          value={form.sessionType}
          onChange={handleChange}
          aria-invalid={Boolean(errors.sessionType)}
          className="mt-2 w-full border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        >
          <option value="" disabled>
            Select one
          </option>
          {SESSION_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
        {errors.sessionType && (
          <p className="mt-2 text-xs text-red-700">{errors.sessionType}</p>
        )}
      </div>

      <div>
        <label
          htmlFor="message"
          className="block text-xs uppercase tracking-[0.15em] text-muted"
        >
          Tell me a bit about what you&rsquo;re picturing
        </label>
        <textarea
          id="message"
          name="message"
          rows={5}
          value={form.message}
          onChange={handleChange}
          aria-invalid={Boolean(errors.message)}
          className="mt-2 w-full resize-none border-b border-border bg-transparent py-2 text-foreground outline-none transition-colors focus:border-accent"
        />
        {errors.message && (
          <p className="mt-2 text-xs text-red-700">{errors.message}</p>
        )}
      </div>

      <TurnstileWidget ref={turnstileRef} onVerify={setTurnstileToken} />

      <div>
        <button
          type="submit"
          disabled={status === "loading" || !turnstileToken}
          className="mt-4 border border-foreground px-8 py-3 text-xs uppercase tracking-[0.2em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "loading" ? "Sending…" : "Send Message"}
        </button>
        {status === "error" && (
          <p className="mt-3 text-xs text-red-700">
            Something went wrong sending your message. Please try again, or
            reach out directly using the details below.
          </p>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Modify `app/api/contact/route.ts`**

Replace the full file with:

```ts
import { Resend } from "resend";
import { BUSINESS } from "@/lib/seo";
import { getSupabaseClient } from "@/lib/supabase";
import { escapeHtml } from "@/lib/email";
import { verifyTurnstileToken } from "@/lib/turnstile";
import { getClientIp } from "@/lib/rateLimit";

const FROM_ADDRESS = `${BUSINESS.name} <${BUSINESS.email}>`;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ContactPayload = {
  name: string;
  email: string;
  sessionType: string;
  message: string;
  turnstileToken: string;
};

function parsePayload(body: unknown): ContactPayload | null {
  if (typeof body !== "object" || body === null) return null;
  const { name, email, sessionType, message, turnstileToken } = body as Record<
    string,
    unknown
  >;

  if (
    typeof name !== "string" ||
    typeof email !== "string" ||
    typeof sessionType !== "string" ||
    typeof message !== "string" ||
    typeof turnstileToken !== "string" ||
    !turnstileToken
  ) {
    return null;
  }

  const trimmed = {
    name: name.trim(),
    email: email.trim(),
    sessionType: sessionType.trim(),
    message: message.trim(),
    turnstileToken,
  };

  if (
    !trimmed.name ||
    !EMAIL_REGEX.test(trimmed.email) ||
    !trimmed.sessionType ||
    !trimmed.message
  ) {
    return null;
  }

  return trimmed;
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
    return Response.json(
      { error: "Please fill out all fields with a valid email address." },
      { status: 400 },
    );
  }

  const verification = await verifyTurnstileToken(
    payload.turnstileToken,
    getClientIp(request),
  );
  if (!verification.ok) {
    if (verification.reason === "unreachable") {
      return Response.json(
        {
          error:
            "Verification service is temporarily unavailable. Please try again shortly.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "Verification failed. Please try again." },
      { status: 400 },
    );
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("RESEND_API_KEY is not set.");
    return Response.json(
      { error: "Email service is not configured yet." },
      { status: 500 },
    );
  }

  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [BUSINESS.email],
      replyTo: payload.email,
      subject: `New inquiry from ${payload.name}`,
      text: [
        `Name: ${payload.name}`,
        `Email: ${payload.email}`,
        `Session type: ${payload.sessionType}`,
        "",
        "Message:",
        payload.message,
      ].join("\n"),
      html: `
        <h2>New contact form submission</h2>
        <p><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
        <p><strong>Session type:</strong> ${escapeHtml(payload.sessionType)}</p>
        <p><strong>Message:</strong></p>
        <p>${escapeHtml(payload.message).replace(/\n/g, "<br />")}</p>
      `,
    });

    if (error) {
      console.error("Resend error:", error);
      return Response.json(
        { error: "Failed to send message." },
        { status: 502 },
      );
    }

    // Best-effort — the email is the primary notification, so a lead
    // logging failure shouldn't fail the whole submission.
    try {
      const supabase = getSupabaseClient();
      const { error: leadError } = await supabase.from("leads").insert({
        name: payload.name,
        email: payload.email,
        session_type: payload.sessionType,
        message: payload.message,
      });
      if (leadError) {
        console.error("Failed to record lead:", leadError);
      }
    } catch (err) {
      console.error("Failed to record lead:", err);
    }

    return Response.json({ ok: true });
  } catch (err) {
    console.error("Failed to send contact email:", err);
    return Response.json(
      { error: "Failed to send message." },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 4: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Verify the missing-token case**

Run:
```bash
npm run dev
```
In a second terminal:
```bash
curl -s -X POST http://localhost:3000/api/contact \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","email":"test@example.com","sessionType":"Portrait","message":"hi"}'
```
Expected: `400` with an error about required fields (the payload has no `turnstileToken` at all, so `parsePayload` rejects it before verification ever runs).

- [ ] **Step 6: Verify the widget passes and the form submits (browser, always-passes test key)**

With `.env.local`'s `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA` / `TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA` (set in Task 1, Step 5) and `npm run dev` running:

1. Open `http://localhost:3000/contact`.
2. Confirm the Turnstile widget renders (a checkbox/badge area appears below the message field) and the "Send Message" button is disabled until it resolves.
3. Fill out all fields and submit.
4. Confirm the "Thank you" success state appears (matches pre-existing behavior — no visual regression).
5. Open devtools console: confirm no CSP violation messages during this flow (validates Task 1 Step 3's CSP additions).

- [ ] **Step 7: Verify a blocked token is rejected (browser, always-blocks test key)**

Temporarily edit `.env.local`:
```bash
sed -i.bak 's/^NEXT_PUBLIC_TURNSTILE_SITE_KEY=.*/NEXT_PUBLIC_TURNSTILE_SITE_KEY=2x00000000000000000000AB/' .env.local
sed -i.bak 's/^TURNSTILE_SECRET_KEY=.*/TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA/' .env.local
```
Restart `npm run dev`, reload `/contact`, fill out and submit the form.
Expected: the form shows its existing "Something went wrong" error state (the widget still returns a token in the always-blocks case — Cloudflare's siteverify is what rejects it server-side), and no email is sent / no lead is logged (check the `leads` table in Supabase, or just confirm no email arrives).

Restore the always-passes test key afterward:
```bash
mv .env.local.bak .env.local
```

- [ ] **Step 8: Commit**

```bash
git add components/TurnstileWidget.tsx app/contact/ContactForm.tsx app/api/contact/route.ts
git commit -m "Add Turnstile bot verification to the contact form"
```

---

### Task 3: Wire the widget into the booking form

**Files:**
- Modify: `app/book/BookingForm.tsx`
- Modify: `app/api/bookings/route.ts`

**Interfaces:**
- Consumes: `TurnstileWidget`, `TurnstileWidgetHandle` from `components/TurnstileWidget.tsx` (Task 2); `verifyTurnstileToken` from `lib/turnstile.ts` (Task 1).

- [ ] **Step 1: Modify `app/book/BookingForm.tsx`**

Replace the full file with:

```tsx
"use client";

import { useRef, useState, type FormEvent } from "react";
import TurnstileWidget, {
  type TurnstileWidgetHandle,
} from "@/components/TurnstileWidget";

type Props = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  onBack: () => void;
};

function redirectTo(url: string) {
  window.location.href = url;
}

export default function BookingForm({ appointmentTypeId, date, startTime, onBack }: Props) {
  const [form, setForm] = useState({ clientName: "", clientEmail: "", clientPhone: "", notes: "", honeypot: "" });
  const [status, setStatus] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<TurnstileWidgetHandle>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentTypeId, date, startTime, ...form, turnstileToken }),
      });
      const data: { checkoutUrl?: string | null; error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        turnstileRef.current?.reset();
        setTurnstileToken("");
        setStatus("idle");
        return;
      }
      if (data.checkoutUrl) {
        redirectTo(data.checkoutUrl);
        return;
      }
      redirectTo("/book/confirmed");
    } catch {
      setError("Something went wrong. Please try again.");
      turnstileRef.current?.reset();
      setTurnstileToken("");
      setStatus("idle");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <button type="button" onClick={onBack} className="text-xs uppercase tracking-[0.2em] text-muted hover:text-foreground">
        Choose a different time
      </button>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Name</label>
        <input
          required
          value={form.clientName}
          onChange={(e) => setForm((p) => ({ ...p, clientName: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Email</label>
        <input
          required
          type="email"
          value={form.clientEmail}
          onChange={(e) => setForm((p) => ({ ...p, clientEmail: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Phone (optional)</label>
        <input
          value={form.clientPhone}
          onChange={(e) => setForm((p) => ({ ...p, clientPhone: e.target.value }))}
          className="w-full border-b border-border bg-transparent pb-2 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label className="mb-2 block text-xs uppercase tracking-[0.3em] text-muted">Notes (optional)</label>
        <textarea
          value={form.notes}
          onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
          rows={3}
          className="w-full border border-border bg-transparent p-3 text-foreground focus:border-accent focus:outline-none"
        />
      </div>
      {/* Honeypot — hidden from real visitors via CSS, not `type="hidden"`
          (some bots skip hidden inputs but still fill visible-but-offscreen ones). */}
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          Leave this field blank
          <input
            tabIndex={-1}
            autoComplete="off"
            value={form.honeypot}
            onChange={(e) => setForm((p) => ({ ...p, honeypot: e.target.value }))}
          />
        </label>
      </div>
      <TurnstileWidget ref={turnstileRef} onVerify={setTurnstileToken} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "loading" || !turnstileToken}
        className="w-full border border-foreground py-3 text-xs uppercase tracking-[0.3em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
      >
        {status === "loading" ? "Please wait…" : "Confirm Booking"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Modify `app/api/bookings/route.ts`**

In the `Payload` type (near the top), add the new field:

```ts
type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string;
  honeypot: string;
  turnstileToken: string;
};
```

In `parsePayload`, add the validation check and the returned field:

```ts
function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.appointmentTypeId !== "string" ||
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string" ||
    typeof b.clientName !== "string" ||
    !b.clientName.trim() ||
    typeof b.clientEmail !== "string" ||
    !EMAIL_REGEX.test(b.clientEmail.trim()) ||
    typeof b.clientPhone !== "string" ||
    typeof b.notes !== "string" ||
    typeof b.honeypot !== "string" ||
    typeof b.turnstileToken !== "string" ||
    !b.turnstileToken
  ) {
    return null;
  }
  return {
    appointmentTypeId: b.appointmentTypeId,
    date: b.date,
    startTime: b.startTime,
    clientName: b.clientName.trim(),
    clientEmail: b.clientEmail.trim(),
    clientPhone: b.clientPhone.trim(),
    notes: b.notes.trim(),
    honeypot: b.honeypot,
    turnstileToken: b.turnstileToken,
  };
}
```

Add the import at the top of the file (alongside the existing imports):

```ts
import { verifyTurnstileToken } from "@/lib/turnstile";
```

In the `POST` handler, insert the verification check immediately after the existing rate-limit check (after honeypot and rate-limit, before the appointment-type lookup):

```ts
  const ip = getClientIp(request);
  const { allowed } = await checkRateLimit({ ip, endpoint: "bookings", maxHits: 5, windowMinutes: 10 });
  if (!allowed) {
    return Response.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const verification = await verifyTurnstileToken(payload.turnstileToken, ip);
  if (!verification.ok) {
    if (verification.reason === "unreachable") {
      return Response.json(
        {
          error:
            "Verification service is temporarily unavailable. Please try again shortly.",
        },
        { status: 503 },
      );
    }
    return Response.json(
      { error: "Verification failed. Please try again." },
      { status: 400 },
    );
  }

  const supabase = getSupabaseClient();
```

(This reuses the `ip` constant already computed for `getClientIp(request)` immediately above — do not call `getClientIp` a second time.)

- [ ] **Step 3: Type-check and build**

Run: `npx tsc --noEmit`
Expected: no output (clean).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify the missing-token case**

With `npm run dev` running:
```bash
curl -s -X POST http://localhost:3000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"appointmentTypeId":"00000000-0000-0000-0000-000000000000","date":"2026-09-01","startTime":"10:00","clientName":"Test","clientEmail":"test@example.com","clientPhone":"","notes":"","honeypot":""}'
```
Expected: `400` (payload has no `turnstileToken`, rejected by `parsePayload` before verification, rate limiting, or the appointment-type lookup ever run).

- [ ] **Step 5: Verify end-to-end booking still works (browser, always-passes test key)**

Confirm `.env.local` has the always-passes test keys (restored at the end of Task 2, Step 7). With `npm run dev` running:

1. Open `http://localhost:3000/book`.
2. Pick an appointment type, date, and time slot to reach the booking form.
3. Confirm the Turnstile widget renders and "Confirm Booking" is disabled until it resolves.
4. Fill out the form and submit.
5. Confirm the existing behavior is unchanged: either a redirect to `/book/confirmed` (free appointment types) or to a Stripe checkout URL (paid types) — whichever this appointment type requires.
6. Devtools console: confirm no CSP violations during this flow.

- [ ] **Step 6: Verify a blocked token is rejected (browser, always-blocks test key)**

Repeat Task 2 Step 7's key-swap procedure, then attempt a booking through `/book`.
Expected: the form shows the "Verification failed. Please try again." error (via the existing `error` state, sourced from the response's `data.error`), and no row is created in the `bookings` table.

Restore the always-passes test key afterward (same `mv .env.local.bak .env.local` as before).

- [ ] **Step 7: Verify the honeypot and rate limit still work unchanged**

With the always-passes test key restored:

- **Honeypot:** submitting via `curl` with a non-empty `honeypot` field and a valid-shaped (even fake) `turnstileToken` should still short-circuit to `{ ok: true, checkoutUrl: null }` before verification ever runs (the honeypot check remains ordered before the Turnstile check). Confirm no new row appears in `bookings`.
- **Rate limit:** submit 6 booking requests in rapid succession through the browser UI (or via `curl` with a real token obtained from the always-passes widget). Confirm the 6th request within the 10-minute window returns `429 Too many requests`, not the Turnstile error — this confirms the rate-limit check still runs (and still blocks) before the Turnstile check, exactly as ordered in Step 2 above.

- [ ] **Step 8: Commit**

```bash
git add app/book/BookingForm.tsx app/api/bookings/route.ts
git commit -m "Add Turnstile bot verification to the booking form"
```

---

## Manual Cloudflare Setup (for you — not part of the subagent task loop above)

The tasks above use Cloudflare's public test keys so the feature is fully buildable and testable without real credentials. Before deploying to production, set up a real Turnstile widget:

1. Go to the [Cloudflare dashboard](https://dash.cloudflare.com/) and sign in (same account as your R2 buckets, if you want everything under one account — Turnstile doesn't require R2 or any other product).
2. In the left sidebar, find **Turnstile** (under "Security" or searchable from the top). If this is your first widget, you may land directly on an "Add widget" screen.
3. Click **Add widget** (or **Add site**).
4. **Widget name:** anything recognizable, e.g. `zkjfilms.com`.
5. **Domains:** add `zkjfilms.com` and `localhost` (localhost lets you test with real keys locally later if you ever want to, though the test keys from Task 1 cover local development already).
6. **Widget mode:** select **Managed**.
7. Click **Create**. Cloudflare shows you two values:
   - **Site Key** — starts with something other than `1x`/`2x`/`3x` (those prefixes are reserved for the test keys). This is public.
   - **Secret Key** — keep this one private, same handling as any other API secret in this project.
8. Add both to `.env.local`, replacing the test-key lines Task 1 added:
   ```
   NEXT_PUBLIC_TURNSTILE_SITE_KEY=<your real site key>
   TURNSTILE_SECRET_KEY=<your real secret key>
   ```
9. Add both to Vercel: **Project Settings → Environment Variables**, add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` for **Production** and **Preview** environments, same as `GATED_ACCESS_PASSWORD`/`ADMIN_PASSWORD` are already set up.
10. Redeploy (or the next push will pick up the new env vars automatically).
11. Visit the live `/contact` and `/book` pages once deployed and submit a real test message/booking to confirm the widget renders and verification succeeds with your real keys.
