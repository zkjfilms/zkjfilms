# Self-Hosted Availability & Booking System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current `booking_slots`-based booking system with a recurring-availability model (weekly template + per-date overrides + blocked time), full-payment Stripe Checkout per appointment type, two-way Google Calendar sync, and Supabase Realtime push updates between the admin and client views.

**Architecture:** Supabase Postgres (existing project) via `@supabase-js`, matching the rest of this codebase — no Prisma, no SQLite. A Postgres exclusion constraint on `bookings.time_range` makes double-booking structurally impossible at the database level, not just application logic. Real-time sync uses Supabase Realtime **Broadcast** (not `postgres_changes`) — server-side API routes, which already run with the service-role client, explicitly broadcast minimal non-PII payloads after mutating `bookings`/`availability_overrides`/`blocked_times`. This needs zero new RLS policies or anon-key table grants, since Broadcast is independent of table read permissions. Google Calendar sync is a Vercel Cron job polling every 5 minutes into a cache table, plus a direct push on every new booking. Slot computation is one pure, unit-testable function that layers recurring hours → overrides → blocked time → Google busy cache → existing bookings → guardrails.

**Tech Stack:** Next.js App Router (existing), Supabase/Postgres (existing), Resend (existing), Stripe (existing, extended for full payments), `googleapis` (new), Supabase Realtime Broadcast (new).

## Global Constraints

- Spec source: `docs/superpowers/specs/2026-08-04-self-hosted-booking-system-design.md`. Read it before starting — this plan implements it exactly; where this plan resolves something the spec left open, that resolution is called out below.
- Business timezone: **America/Chicago**. All availability is authored and stored relative to this timezone; the client view converts to the visitor's local timezone for display only.
- No appointment-type groups — flat list, one shared calendar. No tiered cancellation refunds — a single admin-configured notice-window cutoff (full refund inside it, self-service blocked outside it). No Google push-webhooks — polling only. No per-slot capacity beyond 1. No recurring/repeating blocked-time entries.
- **Reschedule stays within the same `appointment_type_id`** — no cross-type reschedule, no price proration. (The spec didn't say this explicitly; carried forward from the previous booking system's identical constraint for the identical reason.)
- **Realtime uses Broadcast, not `postgres_changes`.** `bookings` rows carry client PII (name/email/phone/notes) that must never reach an anonymous subscriber; `blocked_times.reason` is admin-only free text the public should never see either. Broadcast payloads are explicitly constructed server-side to contain only what's safe: for booking changes, just `{date, startTime, endTime}`; for availability changes, just `{date}` as an "invalidate and refetch" signal. This also means **no new RLS policies or anon-key grants are needed on any table** — the browser-side realtime client uses the anon key purely for channel pub/sub, with zero SQL table access.
- Data access is exclusively `@supabase-js` with the service-role key server-side (matching `lib/supabase.ts`), same as the rest of this codebase. The one exception: a new browser-side anon-key client (`lib/supabaseBrowser.ts`), used **only** for Realtime channel subscriptions — never for querying a table.
- Multi-statement atomicity (the reschedule's cancel-old + insert-new) is done via a Postgres `plpgsql` RPC function (`reschedule_booking`), called through `.rpc()` — Postgres functions are implicitly transactional, so a failure partway through rolls back everything, and `supabase-js` has no other way to run multi-statement transactions against PostgREST. A single-row insert (initial booking, webhook confirm) is already atomic on its own and needs no RPC — the exclusion constraint alone makes it race-safe.
- No test framework exists in this codebase (confirmed: no vitest/jest, no existing `.test.ts` files) — every task's verification step is `npx tsc --noEmit && npx eslint app lib components`, plus a manual test (curl for APIs, browser for UI, direct SQL for DB state), matching the exact pattern the previous booking-system plan used throughout. Clean up all test data created during manual verification before marking a task complete.
- Development happens in an isolated git worktree (per `superpowers:using-git-worktrees`); the current live booking system keeps running in production untouched until Task 25 (Cutover).
- Env vars needed across this plan (added incrementally, task by task, to `.env.example`): `STRIPE_WEBHOOK_SECRET_BOOKINGS`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

---

## Task 1: Schema migration — full data model

**Files:**
- Modify: `supabase/schema.sql`

**Interfaces:**
- Produces: tables `appointment_types`, `availability_rules`, `availability_overrides`, `blocked_times`, `bookings` (with generated `time_range` column and exclusion constraint), `google_calendar_sync`, `scheduling_limits`, `google_busy_blocks_cache`. Every later task's queries reference these exact table/column names.

- [ ] **Step 1: Append the migration block to `supabase/schema.sql`**

```sql
-- Self-hosted availability & booking system (replaces booking_slots).
create table appointment_types (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_minutes integer not null check (duration_minutes > 0),
  buffer_before_minutes integer not null default 0 check (buffer_before_minutes >= 0),
  buffer_after_minutes integer not null default 0 check (buffer_after_minutes >= 0),
  price_cents integer not null default 0 check (price_cents >= 0),
  requires_payment boolean not null default false,
  color text not null default '#6b7280',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table availability_rules (
  id uuid primary key default gen_random_uuid(),
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null check (end_time > start_time)
);

create table availability_overrides (
  id uuid primary key default gen_random_uuid(),
  date date not null unique,
  start_time time,
  end_time time,
  is_closed boolean not null default false,
  check (is_closed or (start_time is not null and end_time is not null and end_time > start_time))
);

create table blocked_times (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  start_time time not null,
  end_time time not null check (end_time > start_time),
  reason text
);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  appointment_type_id uuid not null references appointment_types(id),
  client_name text not null,
  client_email text not null,
  client_phone text,
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  time_range tstzrange generated always as
    (tstzrange(start_time, end_time, '[)')) stored,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'canceled')),
  notes text,
  booking_token uuid not null default gen_random_uuid(),
  payment_intent_id text,
  amount_paid_cents integer,
  google_event_id text,
  pending_expires_at timestamptz,
  created_at timestamptz not null default now(),
  exclude using gist (time_range with &&)
    where (status in ('pending', 'confirmed'))
);

create index bookings_booking_token_idx on bookings (booking_token);
create index bookings_start_time_idx on bookings (start_time);

create table google_calendar_sync (
  id boolean primary key default true check (id),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  last_synced_at timestamptz,
  connected boolean not null default false
);

create table scheduling_limits (
  id boolean primary key default true check (id),
  min_notice_hours integer not null default 24,
  max_advance_days integer not null default 365,
  cancel_reschedule_notice_hours integer not null default 24,
  daily_cap integer,
  start_time_interval_minutes integer not null default 30
);
insert into scheduling_limits (id) values (true);

-- Replaced wholesale on every cron poll, never incrementally updated.
create table google_busy_blocks_cache (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null check (end_time > start_time),
  synced_at timestamptz not null default now()
);
```

- [ ] **Step 2: Apply the migration**

Paste the SQL above into the Supabase SQL Editor (same process as the previous booking system's schema change) and run it.

- [ ] **Step 3: Verify**

Run this query in the SQL Editor and confirm all 8 tables appear with no errors, and `scheduling_limits` has exactly one row:

```sql
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('appointment_types', 'availability_rules', 'availability_overrides',
  'blocked_times', 'bookings', 'google_calendar_sync', 'scheduling_limits', 'google_busy_blocks_cache')
order by table_name;

select * from scheduling_limits;
```

- [ ] **Step 4: Commit**

```bash
git add supabase/schema.sql
git commit -m "Add schema for self-hosted availability/booking system"
```

---

## Task 2: Slot computation library

**Files:**
- Create: `lib/scheduling.ts`

**Interfaces:**
- Consumes: rows shaped like the `availability_rules`, `availability_overrides`, `blocked_times`, `bookings`, `google_busy_blocks_cache`, `scheduling_limits`, `appointment_types` tables from Task 1 (passed in as plain arrays — this module does no I/O itself, keeping it a pure, directly-testable function).
- Produces:
  - `resolveHoursForDate(date, rules, overrides): { startTime: string; endTime: string } | null` — the day's working window (`null` = closed), used by both slot computation and the admin's monthly override calendar.
  - `computeOpenSlots(params): TimeSlot[]` where `TimeSlot = { startTime: string; endTime: string }` (ISO strings) — the full algorithm from the spec's "Slot computation algorithm" section.
  - `toBusinessTimeZone(date: Date): string` / `formatInTimeZone(date, timeZone)` — timezone display helpers using native `Intl.DateTimeFormat`, no new dependency.

- [ ] **Step 1: Implement `resolveHoursForDate`**

```typescript
// lib/scheduling.ts
export const BUSINESS_TIME_ZONE = "America/Chicago";

export type AvailabilityRule = {
  dayOfWeek: number; // 0-6, Sunday-Saturday
  startTime: string; // "HH:MM:SS"
  endTime: string;
};

export type AvailabilityOverride = {
  date: string; // "YYYY-MM-DD"
  startTime: string | null;
  endTime: string | null;
  isClosed: boolean;
};

export type ResolvedHours = { startTime: string; endTime: string } | null;

// date is "YYYY-MM-DD" in the business timezone.
export function resolveHoursForDate(
  date: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
): ResolvedHours {
  const override = overrides.find((o) => o.date === date);
  if (override) {
    if (override.isClosed) return null;
    if (!override.startTime || !override.endTime) return null;
    return { startTime: override.startTime, endTime: override.endTime };
  }

  const dayOfWeek = new Date(`${date}T00:00:00`).getDay();
  const rule = rules.find((r) => r.dayOfWeek === dayOfWeek);
  if (!rule) return null;
  return { startTime: rule.startTime, endTime: rule.endTime };
}
```

- [ ] **Step 2: Implement time-range overlap helper and buffer expansion**

```typescript
type Span = { start: number; end: number }; // minutes since local midnight

function timeToMinutes(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}
```

- [ ] **Step 3: Implement `computeOpenSlots`**

```typescript
export type TimeSlot = { startTime: string; endTime: string }; // "HH:MM"

export type ExistingBooking = {
  startMinutes: number; // minutes since local midnight on the target date
  endMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
};

export type BlockedTime = { startTime: string; endTime: string };
export type BusyBlock = { startMinutes: number; endMinutes: number };

export type SchedulingLimits = {
  minNoticeHours: number;
  maxAdvanceDays: number;
  dailyCap: number | null;
  startTimeIntervalMinutes: number;
};

export function computeOpenSlots(params: {
  date: string; // "YYYY-MM-DD"
  now: Date;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  rules: AvailabilityRule[];
  overrides: AvailabilityOverride[];
  blockedTimes: BlockedTime[];
  existingBookings: ExistingBooking[];
  busyBlocks: BusyBlock[];
  confirmedBookingsCountForDay: number;
  limits: SchedulingLimits;
}): TimeSlot[] {
  const window = resolveHoursForDate(params.date, params.rules, params.overrides);
  if (!window) return [];

  if (params.limits.dailyCap !== null && params.confirmedBookingsCountForDay >= params.limits.dailyCap) {
    return [];
  }

  const windowStart = timeToMinutes(window.startTime);
  const windowEnd = timeToMinutes(window.endTime);
  const step = params.limits.startTimeIntervalMinutes;

  const blockedSpans: Span[] = params.blockedTimes.map((b) => ({
    start: timeToMinutes(b.startTime),
    end: timeToMinutes(b.endTime),
  }));
  const busySpans: Span[] = params.busyBlocks.map((b) => ({
    start: b.startMinutes,
    end: b.endMinutes,
  }));
  const bookingSpans: Span[] = params.existingBookings.map((b) => ({
    start: b.startMinutes - b.bufferBeforeMinutes,
    end: b.endMinutes + b.bufferAfterMinutes,
  }));

  const nowLocal = toBusinessLocalParts(params.now);
  const minNoticeMinutes = params.limits.minNoticeHours * 60;
  const maxAdvanceMinutes = params.limits.maxAdvanceDays * 24 * 60;
  const minutesFromNowToStartOfDate = minutesBetween(nowLocal, params.date);

  const slots: TimeSlot[] = [];
  for (let start = windowStart; start + params.durationMinutes <= windowEnd; start += step) {
    const end = start + params.durationMinutes;
    const occupied: Span = {
      start: start - params.bufferBeforeMinutes,
      end: end + params.bufferAfterMinutes,
    };

    if (blockedSpans.some((s) => overlaps(occupied, s))) continue;
    if (busySpans.some((s) => overlaps(occupied, s))) continue;
    if (bookingSpans.some((s) => overlaps(occupied, s))) continue;

    const minutesFromNow = minutesFromNowToStartOfDate + start;
    if (minutesFromNow < minNoticeMinutes) continue;
    if (minutesFromNow > maxAdvanceMinutes) continue;

    slots.push({
      startTime: minutesToTime(start),
      endTime: minutesToTime(end),
    });
  }

  return slots;
}

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function toBusinessLocalParts(date: Date): { date: string; minutes: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

// Minutes from "now" (business-local) to the start of `targetDate` at
// local midnight — can be negative if targetDate is today or in the past.
function minutesBetween(now: { date: string; minutes: number }, targetDate: string): number {
  const nowDate = new Date(`${now.date}T00:00:00`);
  const target = new Date(`${targetDate}T00:00:00`);
  const dayDiffMinutes = Math.round((target.getTime() - nowDate.getTime()) / 60000);
  return dayDiffMinutes - now.minutes;
}
```

- [ ] **Step 4: Implement client-timezone display helper**

```typescript
export function formatSlotForDisplay(
  date: string,
  time: string,
  timeZone: string,
): string {
  const utcGuess = new Date(`${date}T${time}:00`);
  // The business-local wall-clock time interpreted in BUSINESS_TIME_ZONE,
  // then rendered in the caller's timeZone.
  const businessOffsetMs = getTimeZoneOffsetMs(utcGuess, BUSINESS_TIME_ZONE);
  const actualUtc = new Date(utcGuess.getTime() - businessOffsetMs);
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(actualUtc);
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint lib`

- [ ] **Step 6: Manual verification — write a throwaway script**

Create `/tmp/scheduling-check.mjs` (not committed) that imports the compiled logic conceptually by pasting a few `computeOpenSlots` calls with hand-built fixtures (a Monday 9am-5pm rule, a 60-minute appointment type, no blocks/bookings) and `console.log`s the result — confirm slots run from 09:00 to 16:00 in 30-minute steps (last slot must leave room for the 60-minute duration). Add a blocked time 12:00-13:00 and confirm slots touching that range disappear. Delete the throwaway script after.

- [ ] **Step 7: Commit**

```bash
git add lib/scheduling.ts
git commit -m "Add pure slot-computation library"
```

---

---

## Task 3: Appointment types — admin API and UI

**Files:**
- Create: `app/api/admin/appointment-types/route.ts`
- Create: `app/api/admin/appointment-types/[id]/route.ts`
- Create: `app/admin/appointment-types/page.tsx`
- Create: `app/admin/appointment-types/AppointmentTypeForm.tsx`
- Create: `app/admin/appointment-types/AppointmentTypeList.tsx`
- Modify: `app/admin/layout.tsx` (add nav link)

**Interfaces:**
- Produces: `GET/POST /api/admin/appointment-types`, `PATCH/DELETE /api/admin/appointment-types/[id]`. Later tasks (client booking flow) read `appointment_types` directly via a separate public endpoint (Task 9), not this admin one.

- [ ] **Step 1: Admin API — list and create**

```typescript
// app/api/admin/appointment-types/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("appointment_types")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("appointment_types list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ appointmentTypes: data });
}

type CreatePayload = {
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  requiresPayment: boolean;
  color: string;
};

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.name !== "string" ||
    !b.name.trim() ||
    typeof b.durationMinutes !== "number" ||
    b.durationMinutes <= 0 ||
    typeof b.bufferBeforeMinutes !== "number" ||
    b.bufferBeforeMinutes < 0 ||
    typeof b.bufferAfterMinutes !== "number" ||
    b.bufferAfterMinutes < 0 ||
    typeof b.priceCents !== "number" ||
    b.priceCents < 0 ||
    typeof b.requiresPayment !== "boolean" ||
    typeof b.color !== "string"
  ) {
    return null;
  }
  return {
    name: b.name.trim(),
    durationMinutes: b.durationMinutes,
    bufferBeforeMinutes: b.bufferBeforeMinutes,
    bufferAfterMinutes: b.bufferAfterMinutes,
    priceCents: b.priceCents,
    requiresPayment: b.requiresPayment,
    color: b.color,
  };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid appointment type." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: maxRow } = await supabase
    .from("appointment_types")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? -1) + 1;

  const { data, error } = await supabase
    .from("appointment_types")
    .insert({
      name: payload.name,
      duration_minutes: payload.durationMinutes,
      buffer_before_minutes: payload.bufferBeforeMinutes,
      buffer_after_minutes: payload.bufferAfterMinutes,
      price_cents: payload.priceCents,
      requires_payment: payload.requiresPayment,
      color: payload.color,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (error) {
    console.error("appointment_types insert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ appointmentType: data }, { status: 201 });
}
```

- [ ] **Step 2: Admin API — edit and archive**

```typescript
// app/api/admin/appointment-types/[id]/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

type UpdatePayload = Partial<{
  name: string;
  durationMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  priceCents: number;
  requiresPayment: boolean;
  color: string;
  active: boolean;
  sortOrder: number;
}>;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const body = (await request.json().catch(() => null)) as UpdatePayload | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.durationMinutes !== undefined) update.duration_minutes = body.durationMinutes;
  if (body.bufferBeforeMinutes !== undefined) update.buffer_before_minutes = body.bufferBeforeMinutes;
  if (body.bufferAfterMinutes !== undefined) update.buffer_after_minutes = body.bufferAfterMinutes;
  if (body.priceCents !== undefined) update.price_cents = body.priceCents;
  if (body.requiresPayment !== undefined) update.requires_payment = body.requiresPayment;
  if (body.color !== undefined) update.color = body.color;
  if (body.active !== undefined) update.active = body.active;
  if (body.sortOrder !== undefined) update.sort_order = body.sortOrder;

  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("appointment_types")
    .update(update)
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) {
    console.error("appointment_types update failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }
  return Response.json({ appointmentType: data });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 4: Admin UI — list page and form**

```typescript
// app/admin/appointment-types/page.tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import AppointmentTypeList from "./AppointmentTypeList";

export function generateMetadata(): Metadata {
  return { title: "Admin — Appointment Types" };
}

export default async function AppointmentTypesPage() {
  const supabase = getSupabaseClient();
  const { data: appointmentTypes, error } = await supabase
    .from("appointment_types")
    .select("*")
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("appointment_types list failed:", error);
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Appointment Types</h1>
      </div>
      <AppointmentTypeList initialTypes={appointmentTypes ?? []} />
    </div>
  );
}
```

`AppointmentTypeList.tsx` is a `"use client"` component: renders each type as a row (color swatch, name, `${duration}min @ $price`, Edit button toggling an inline `AppointmentTypeForm`, Archive/Activate toggle calling `PATCH .../[id]` with `{active: !type.active}`), plus a "New Type" button that opens a blank `AppointmentTypeForm`. `AppointmentTypeForm.tsx` is a controlled form (name, duration, buffer before/after, price in dollars converted to cents on submit, requires-payment checkbox, color input) posting to `POST /api/admin/appointment-types` or `PATCH .../[id]` depending on whether it's editing an existing row, then calling `router.refresh()` on success — same pattern as `AddSlotForm.tsx` in the current codebase.

- [ ] **Step 5: Add nav link**

In `app/admin/layout.tsx`, add `{ href: "/admin/appointment-types", label: "Appointment Types" }` to the `NAV_LINKS` array, after `/admin/availability`.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 7: Manual test**

Log into `/admin`, navigate to `/admin/appointment-types`, create a type ("Test Headshot", 30 min, 0/0 buffers, $50, requires payment on), confirm it appears in the list, edit it (change price to $75), confirm the update sticks, archive it (confirm it's marked inactive, not deleted). Delete the test row directly via SQL afterward: `delete from appointment_types where name = 'Test Headshot';`.

- [ ] **Step 8: Commit**

```bash
git add app/api/admin/appointment-types app/admin/appointment-types app/admin/layout.tsx
git commit -m "Add appointment types admin API and UI"
```

---

## Task 4: Availability rules (recurring weekly template) — admin API and UI

**Files:**
- Create: `app/api/admin/availability-rules/route.ts`
- Create: `app/admin/availability/WeeklyHoursEditor.tsx`

**Interfaces:**
- Consumes: `resolveHoursForDate`'s `AvailabilityRule` type shape from Task 2.
- Produces: `GET/PUT /api/admin/availability-rules` — `PUT` replaces the entire weekly template atomically (delete-all + insert-all in one request), since the UI edits all seven days as one form, not row by row.

- [ ] **Step 1: API — get and replace the weekly template**

```typescript
// app/api/admin/availability-rules/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("availability_rules")
    .select("day_of_week, start_time, end_time")
    .order("day_of_week", { ascending: true });

  if (error) {
    console.error("availability_rules list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ rules: data });
}

type RuleInput = { dayOfWeek: number; startTime: string; endTime: string };

function parseRules(body: unknown): RuleInput[] | null {
  if (!Array.isArray(body)) return null;
  const rules: RuleInput[] = [];
  for (const item of body) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).dayOfWeek !== "number" ||
      typeof (item as Record<string, unknown>).startTime !== "string" ||
      typeof (item as Record<string, unknown>).endTime !== "string"
    ) {
      return null;
    }
    const r = item as unknown as RuleInput;
    if (r.dayOfWeek < 0 || r.dayOfWeek > 6) return null;
    if (r.endTime <= r.startTime) return null;
    rules.push(r);
  }
  return rules;
}

// Replaces the whole weekly template — the "I have regular hours every
// week" editor always submits all enabled days at once, so a delete-all
// + insert-all is simpler and less error-prone than diffing.
export async function PUT(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const rules = parseRules(await request.json().catch(() => null));
  if (!rules) {
    return Response.json({ error: "Invalid rules payload." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { error: deleteError } = await supabase
    .from("availability_rules")
    .delete()
    .gte("day_of_week", 0);
  if (deleteError) {
    console.error("availability_rules delete failed:", deleteError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (rules.length > 0) {
    const { error: insertError } = await supabase.from("availability_rules").insert(
      rules.map((r) => ({
        day_of_week: r.dayOfWeek,
        start_time: r.startTime,
        end_time: r.endTime,
      })),
    );
    if (insertError) {
      console.error("availability_rules insert failed:", insertError);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
  }

  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 3: UI — weekly hours editor**

`WeeklyHoursEditor.tsx` (`"use client"`): a "I have regular hours every week" checkbox; when checked, renders 7 rows (Sunday–Saturday) each with an enabled toggle + start/end time inputs. On submit, builds the `RuleInput[]` array from enabled days only and `PUT`s it. Fetches current rules on mount via `GET /api/admin/availability-rules` to pre-populate. This component is rendered inside the availability editor assembled in Task 8 — build it standalone here, wire it in later.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 5: Manual test**

Render `WeeklyHoursEditor` in a throwaway page (or via a temporary render in `/admin/availability/page.tsx` if Task 8 hasn't assembled the real editor yet) — set Monday-Friday 9:00-17:00, submit, confirm via SQL: `select * from availability_rules order by day_of_week;` shows exactly 5 rows. Re-submit with only Tuesday enabled, confirm the table now has exactly 1 row (proving replace, not append).

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/availability-rules app/admin/availability/WeeklyHoursEditor.tsx
git commit -m "Add recurring weekly availability rules API and editor"
```

---

## Task 5: Availability overrides and the monthly calendar view

**Files:**
- Create: `app/api/admin/availability-overrides/route.ts`
- Create: `app/admin/availability/MonthlyOverrideCalendar.tsx`
- Create: `app/admin/availability/DayOverrideEditor.tsx`

**Interfaces:**
- Consumes: `resolveHoursForDate` from Task 2, `WeeklyHoursEditor`'s rules data shape from Task 4.
- Produces: `GET /api/admin/availability-overrides?month=YYYY-MM` — returns resolved hours (override-or-template) for every day in the month, plus each day's blocked-time count, in one response (avoids one query per calendar cell). `PUT /api/admin/availability-overrides/[date]` — set or clear an override for one date.

- [ ] **Step 1: API — resolved month view**

```typescript
// app/api/admin/availability-overrides/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { resolveHoursForDate } from "@/lib/scheduling";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

function daysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    days.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate(),
      ).padStart(2, "0")}`,
    );
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const monthParam = new URL(request.url).searchParams.get("month");
  if (!monthParam || !/^\d{4}-\d{2}$/.test(monthParam)) {
    return Response.json({ error: "month must be YYYY-MM." }, { status: 400 });
  }
  const [year, month] = monthParam.split("-").map(Number);
  const dates = daysInMonth(year, month);
  const firstDate = dates[0];
  const lastDate = dates[dates.length - 1];

  const supabase = getSupabaseClient();
  const [{ data: rules }, { data: overrides }, { data: blocked }] = await Promise.all([
    supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
    supabase
      .from("availability_overrides")
      .select("date, start_time, end_time, is_closed")
      .gte("date", firstDate)
      .lte("date", lastDate),
    supabase
      .from("blocked_times")
      .select("date")
      .gte("date", firstDate)
      .lte("date", lastDate),
  ]);

  const rulesShaped = (rules ?? []).map((r) => ({
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
  const overridesShaped = (overrides ?? []).map((o) => ({
    date: o.date,
    startTime: o.start_time,
    endTime: o.end_time,
    isClosed: o.is_closed,
  }));
  const blockedCounts = new Map<string, number>();
  for (const b of blocked ?? []) {
    blockedCounts.set(b.date, (blockedCounts.get(b.date) ?? 0) + 1);
  }

  const days = dates.map((date) => ({
    date,
    hours: resolveHoursForDate(date, rulesShaped, overridesShaped),
    hasOverride: overridesShaped.some((o) => o.date === date),
    blockedCount: blockedCounts.get(date) ?? 0,
  }));

  return Response.json({ days });
}
```

- [ ] **Step 2: API — set or clear a single date's override**

Append to the same file:

```typescript
type OverridePayload =
  | { isClosed: true }
  | { isClosed: false; startTime: string; endTime: string }
  | { clear: true };

function parseOverridePayload(body: unknown): OverridePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (b.clear === true) return { clear: true };
  if (b.isClosed === true) return { isClosed: true };
  if (
    b.isClosed === false &&
    typeof b.startTime === "string" &&
    typeof b.endTime === "string" &&
    b.endTime > b.startTime
  ) {
    return { isClosed: false, startTime: b.startTime, endTime: b.endTime };
  }
  return null;
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  const payload = parseOverridePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid override payload." }, { status: 400 });
  }

  const supabase = getSupabaseClient();

  if ("clear" in payload) {
    const { error } = await supabase.from("availability_overrides").delete().eq("date", date);
    if (error) {
      console.error("availability_overrides delete failed:", error);
      return Response.json({ error: "Something went wrong." }, { status: 500 });
    }
    return Response.json({ ok: true });
  }

  const row =
    payload.isClosed === true
      ? { date, is_closed: true, start_time: null, end_time: null }
      : { date, is_closed: false, start_time: payload.startTime, end_time: payload.endTime };

  const { error } = await supabase.from("availability_overrides").upsert(row, { onConflict: "date" });
  if (error) {
    console.error("availability_overrides upsert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 4: UI — monthly calendar**

`MonthlyOverrideCalendar.tsx` (`"use client"`): month navigation (prev/next arrows + "Month Year" label, mirroring the Acuity reference), fetches `GET /api/admin/availability-overrides?month=...` on mount and on month change, renders a 7-column grid where each day cell shows the resolved hours (`"Closed"` or `"9:00am–5:00pm"`) and, if `blockedCount > 0`, a `"N blocked times"` link. Clicking a day cell opens `DayOverrideEditor` for that date.

`DayOverrideEditor.tsx` (`"use client"`): given a `date`, shows radio options "Use regular hours" (calls the override endpoint with `{clear: true}`), "Custom hours" (start/end inputs, submits `{isClosed: false, startTime, endTime}`), "Closed" (submits `{isClosed: true}`). On success, calls a passed-in `onSaved` callback so the parent calendar can refetch.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 6: Manual test**

With Task 4's Monday–Friday 9-5 template still in place, open the calendar for the current month, click a Wednesday, set custom hours 10:00–14:00, save — confirm the cell now shows "10:00am–2:00pm" and a re-fetch of `GET .../availability-overrides?month=...` reflects it. Click a Saturday (normally closed via the template), mark it "Custom hours" 10-2, confirm it now shows as open. Clear both overrides afterward via "Use regular hours," confirm `select count(*) from availability_overrides;` returns 0.

- [ ] **Step 7: Commit**

```bash
git add app/api/admin/availability-overrides app/admin/availability/MonthlyOverrideCalendar.tsx app/admin/availability/DayOverrideEditor.tsx
git commit -m "Add per-date availability overrides API and monthly calendar UI"
```


---

## Task 6: Blocked time — admin API and UI

**Files:**
- Create: `app/api/admin/blocked-times/route.ts`
- Create: `app/api/admin/blocked-times/[id]/route.ts`
- Create: `app/admin/availability/BlockOffTimePanel.tsx`

**Interfaces:**
- Produces: `GET /api/admin/blocked-times?date=YYYY-MM-DD` (list for a day, used by the day view in Task 8), `POST /api/admin/blocked-times` (create), `DELETE /api/admin/blocked-times/[id]`.

- [ ] **Step 1: API**

```typescript
// app/api/admin/blocked-times/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const date = new URL(request.url).searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("blocked_times")
    .select("id, date, start_time, end_time, reason")
    .eq("date", date)
    .order("start_time", { ascending: true });

  if (error) {
    console.error("blocked_times list failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ blockedTimes: data });
}

type CreatePayload = { date: string; startTime: string; endTime: string; reason: string };

function parseCreatePayload(body: unknown): CreatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string" ||
    typeof b.endTime !== "string" ||
    b.endTime <= b.startTime ||
    typeof b.reason !== "string"
  ) {
    return null;
  }
  return { date: b.date, startTime: b.startTime, endTime: b.endTime, reason: b.reason.trim() };
}

export async function POST(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parseCreatePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid blocked time." }, { status: 400 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("blocked_times")
    .insert({
      date: payload.date,
      start_time: payload.startTime,
      end_time: payload.endTime,
      reason: payload.reason || null,
    })
    .select()
    .single();

  if (error) {
    console.error("blocked_times insert failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ blockedTime: data }, { status: 201 });
}
```

```typescript
// app/api/admin/blocked-times/[id]/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const { id } = await params;
  const supabase = getSupabaseClient();
  const { error } = await supabase.from("blocked_times").delete().eq("id", id);
  if (error) {
    console.error("blocked_times delete failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 3: UI — Block Off Time panel**

`BlockOffTimePanel.tsx` (`"use client"`, mirrors the Acuity reference's slide-over): date input, start/end time inputs, an optional reason textarea, a submit button. Posts to `POST /api/admin/blocked-times`, calls an `onSaved` callback on success (parent refetches whatever's currently displaying blocked-time counts — the monthly calendar from Task 5 and the day view from Task 8).

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 5: Manual test**

Submit a block for today, 12:00-13:00, reason "Lunch". Confirm via `select * from blocked_times;`. Delete it via `DELETE /api/admin/blocked-times/[id]` (curl with the admin cookie) and confirm the table is empty again.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/blocked-times app/admin/availability/BlockOffTimePanel.tsx
git commit -m "Add blocked-time admin API and Block Off Time panel"
```

---

## Task 7: Scheduling limits — admin API and UI

**Files:**
- Create: `app/api/admin/scheduling-limits/route.ts`
- Create: `app/admin/availability/SchedulingLimitsForm.tsx`

**Interfaces:**
- Produces: `GET/PUT /api/admin/scheduling-limits` — the single-row `scheduling_limits` table.

- [ ] **Step 1: API**

```typescript
// app/api/admin/scheduling-limits/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET() {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase.from("scheduling_limits").select("*").single();
  if (error) {
    console.error("scheduling_limits read failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ limits: data });
}

type UpdatePayload = {
  minNoticeHours: number;
  maxAdvanceDays: number;
  cancelRescheduleNoticeHours: number;
  dailyCap: number | null;
  startTimeIntervalMinutes: number;
};

function parsePayload(body: unknown): UpdatePayload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.minNoticeHours !== "number" ||
    b.minNoticeHours < 0 ||
    typeof b.maxAdvanceDays !== "number" ||
    b.maxAdvanceDays < 1 ||
    typeof b.cancelRescheduleNoticeHours !== "number" ||
    b.cancelRescheduleNoticeHours < 0 ||
    (b.dailyCap !== null && (typeof b.dailyCap !== "number" || b.dailyCap < 1)) ||
    typeof b.startTimeIntervalMinutes !== "number" ||
    b.startTimeIntervalMinutes < 5
  ) {
    return null;
  }
  return {
    minNoticeHours: b.minNoticeHours,
    maxAdvanceDays: b.maxAdvanceDays,
    cancelRescheduleNoticeHours: b.cancelRescheduleNoticeHours,
    dailyCap: b.dailyCap as number | null,
    startTimeIntervalMinutes: b.startTimeIntervalMinutes,
  };
}

export async function PUT(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid scheduling limits." }, { status: 400 });
  }
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("scheduling_limits")
    .update({
      min_notice_hours: payload.minNoticeHours,
      max_advance_days: payload.maxAdvanceDays,
      cancel_reschedule_notice_hours: payload.cancelRescheduleNoticeHours,
      daily_cap: payload.dailyCap,
      start_time_interval_minutes: payload.startTimeIntervalMinutes,
    })
    .eq("id", true)
    .select()
    .single();

  if (error) {
    console.error("scheduling_limits update failed:", error);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
  return Response.json({ limits: data });
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 3: UI**

`SchedulingLimitsForm.tsx` (`"use client"`): fields for minimum notice (hours), maximum advance (days), cancel/reschedule notice (hours), an "accept until fully booked" radio vs "max per day" radio revealing a number input (`dailyCap`), and start-time interval (minutes). Fetches current values on mount, `PUT`s on submit. This is Tab 2 of the availability editor assembled in Task 8.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 5: Manual test**

Change min notice to 12 hours and daily cap to 3, save, reload the form, confirm the saved values come back (not the defaults). Reset to the defaults (24h, no cap) afterward so later tasks' manual tests aren't affected by a leftover low cap.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/scheduling-limits app/admin/availability/SchedulingLimitsForm.tsx
git commit -m "Add scheduling limits admin API and form"
```

---

## Task 8: Admin availability overview page and day view

**Files:**
- Modify: `app/admin/availability/page.tsx` (replaced wholesale — this is the cutover point for the admin's main availability page, but the *route* stays `/admin/availability`, so nothing else needs to change yet)
- Create: `app/admin/availability/AvailabilityEditor.tsx`
- Create: `app/admin/availability/DayView.tsx`
- Delete: `app/admin/availability/AddSlotForm.tsx`, `app/admin/availability/SlotActions.tsx` (old system's components — safe to delete now since nothing else references them; the old page.tsx content they supported is being replaced in this same task)

**Interfaces:**
- Consumes: `WeeklyHoursEditor` (Task 4), `MonthlyOverrideCalendar` (Task 5), `BlockOffTimePanel` (Task 6), `SchedulingLimitsForm` (Task 7).

- [ ] **Step 1: Assemble the two-tab availability editor**

`AvailabilityEditor.tsx` (`"use client"`): a modal or slide-over (match the Acuity reference's modal) with two tabs, "Set Hours of Availability" (renders `WeeklyHoursEditor` above `MonthlyOverrideCalendar`) and "Scheduling Limits" (renders `SchedulingLimitsForm`). Opened via a prop-controlled `open` boolean from the parent page.

- [ ] **Step 2: Day view**

`DayView.tsx` (`"use client"`, takes a `date` prop): fetches bookings for that date (`GET /api/admin/bookings?date=...` — a small new endpoint alongside this component: admin-only, `select * from bookings where start_time::date = $date and status in ('confirmed','pending') order by start_time`), blocked times (`GET /api/admin/blocked-times?date=...` from Task 6), and resolved hours (reuse the Task 5 month endpoint or a lighter single-date variant — add `GET /api/admin/availability-overrides/resolve?date=...` returning just `{hours: ResolvedHours}` using `resolveHoursForDate`). Renders three columns: bookings (client name, time range, appointment type), blocked times (time range, reason), and computed open slots (call `lib/scheduling.ts`'s `computeOpenSlots` directly here since this is a server-eligible computation — simplest to add a small `GET /api/admin/day-view?date=...` endpoint that returns all three in one response rather than three separate client-side fetches).

Add that combined endpoint:

```typescript
// app/api/admin/day-view/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";
import { computeOpenSlots, resolveHoursForDate } from "@/lib/scheduling";

async function requireAdmin(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value);
}

export async function GET(request: Request) {
  if (!(await requireAdmin())) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const url = new URL(request.url);
  const date = url.searchParams.get("date");
  const appointmentTypeId = url.searchParams.get("appointmentTypeId");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "date must be YYYY-MM-DD." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const [{ data: bookings }, { data: blockedTimes }, { data: rules }, { data: overrides }] =
    await Promise.all([
      supabase
        .from("bookings")
        .select("id, client_name, start_time, end_time, appointment_type_id, status")
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${date}T23:59:59Z`)
        .in("status", ["confirmed", "pending"])
        .order("start_time", { ascending: true }),
      supabase
        .from("blocked_times")
        .select("id, start_time, end_time, reason")
        .eq("date", date)
        .order("start_time", { ascending: true }),
      supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
      supabase
        .from("availability_overrides")
        .select("date, start_time, end_time, is_closed")
        .eq("date", date),
    ]);

  const hours = resolveHoursForDate(
    date,
    (rules ?? []).map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time })),
    (overrides ?? []).map((o) => ({
      date: o.date,
      startTime: o.start_time,
      endTime: o.end_time,
      isClosed: o.is_closed,
    })),
  );

  let openSlots: ReturnType<typeof computeOpenSlots> = [];
  if (appointmentTypeId && hours) {
    const { data: type } = await supabase
      .from("appointment_types")
      .select("duration_minutes, buffer_before_minutes, buffer_after_minutes")
      .eq("id", appointmentTypeId)
      .single();
    const { data: limitsRow } = await supabase.from("scheduling_limits").select("*").single();
    if (type && limitsRow) {
      openSlots = computeOpenSlots({
        date,
        now: new Date(),
        durationMinutes: type.duration_minutes,
        bufferBeforeMinutes: type.buffer_before_minutes,
        bufferAfterMinutes: type.buffer_after_minutes,
        rules: (rules ?? []).map((r) => ({ dayOfWeek: r.day_of_week, startTime: r.start_time, endTime: r.end_time })),
        overrides: (overrides ?? []).map((o) => ({
          date: o.date,
          startTime: o.start_time,
          endTime: o.end_time,
          isClosed: o.is_closed,
        })),
        blockedTimes: (blockedTimes ?? []).map((b) => ({ startTime: b.start_time, endTime: b.end_time })),
        existingBookings: [],
        busyBlocks: [],
        confirmedBookingsCountForDay: (bookings ?? []).filter((b) => b.status === "confirmed").length,
        limits: {
          minNoticeHours: limitsRow.min_notice_hours,
          maxAdvanceDays: limitsRow.max_advance_days,
          dailyCap: limitsRow.daily_cap,
          startTimeIntervalMinutes: limitsRow.start_time_interval_minutes,
        },
      });
    }
  }

  return Response.json({ hours, bookings, blockedTimes, openSlots });
}
```

- [ ] **Step 3: Rewrite the overview page**

```typescript
// app/admin/availability/page.tsx
import type { Metadata } from "next";
import AvailabilityOverviewClient from "./AvailabilityOverviewClient";

export function generateMetadata(): Metadata {
  return { title: "Admin — Availability" };
}

export default function AdminAvailabilityPage() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-10">
      <div className="mb-10">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Admin</p>
        <h1 className="font-serif text-4xl italic text-foreground">Availability</h1>
      </div>
      <AvailabilityOverviewClient />
    </div>
  );
}
```

`AvailabilityOverviewClient.tsx` (`"use client"`, new file alongside `AvailabilityEditor.tsx`): a "Block Off Time" button opening `BlockOffTimePanel`, a weekly strip showing the current week's resolved hours (reuse the Task 5 month endpoint filtered to the current week, or just call it with the current month and slice), an "Edit Availability/Limits" button opening `AvailabilityEditor`, and a date picker/link into `DayView` for a selected date.

- [ ] **Step 4: Delete old components**

```bash
git rm app/admin/availability/AddSlotForm.tsx app/admin/availability/SlotActions.tsx
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 6: Manual test**

Load `/admin/availability`: confirm the weekly strip shows Monday-Friday 9-5 (from Task 4's test data, if still set — otherwise set it now), "Block Off Time" opens the panel and a submission shows up in the day view, "Edit Availability/Limits" opens the two-tab editor and both tabs work, clicking into a specific date's day view shows blocked times and computed open slots for a test appointment type.

- [ ] **Step 7: Commit**

```bash
git add app/admin/availability app/api/admin/day-view
git commit -m "Assemble admin availability overview page and day view"
```

---

## Task 9: Public availability API

**Files:**
- Create: `lib/availabilityQuery.ts`
- Create: `app/api/availability/appointment-types/route.ts`
- Create: `app/api/availability/dates/route.ts`
- Create: `app/api/availability/slots/route.ts`

**Interfaces:**
- Consumes: `computeOpenSlots`, `resolveHoursForDate` from `lib/scheduling.ts` (Task 2).
- Produces: `lib/availabilityQuery.ts`'s `fetchSchedulingContext(date)` — the shared "pull rules/overrides/blocked/bookings/busy-cache/limits for one date" query, reused by all three public routes and by Task 11's booking-submission validation, so the exact same data-fetching logic backs both "what's open" and "is this still open" checks.

- [ ] **Step 1: Shared query helper**

```typescript
// lib/availabilityQuery.ts
import { getSupabaseClient } from "@/lib/supabase";
import {
  computeOpenSlots,
  resolveHoursForDate,
  type AvailabilityRule,
  type AvailabilityOverride,
  type SchedulingLimits,
} from "@/lib/scheduling";

export type AppointmentTypeRow = {
  id: string;
  name: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  price_cents: number;
  requires_payment: boolean;
  color: string;
};

export async function fetchActiveAppointmentTypes(): Promise<AppointmentTypeRow[]> {
  const supabase = getSupabaseClient();
  const { data, error } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("active", true)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchOpenSlotsForDate(params: {
  date: string;
  appointmentType: AppointmentTypeRow;
}): Promise<ReturnType<typeof computeOpenSlots>> {
  const supabase = getSupabaseClient();
  const { date, appointmentType } = params;

  const [{ data: rules }, { data: overrides }, { data: blocked }, { data: bookings }, { data: busy }, { data: limitsRow }] =
    await Promise.all([
      supabase.from("availability_rules").select("day_of_week, start_time, end_time"),
      supabase
        .from("availability_overrides")
        .select("date, start_time, end_time, is_closed")
        .eq("date", date),
      supabase.from("blocked_times").select("start_time, end_time").eq("date", date),
      supabase
        .from("bookings")
        .select("start_time, end_time, appointment_type_id, status")
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${date}T23:59:59Z`)
        .in("status", ["confirmed", "pending"]),
      supabase
        .from("google_busy_blocks_cache")
        .select("start_time, end_time")
        .gte("start_time", `${date}T00:00:00Z`)
        .lt("start_time", `${date}T23:59:59Z`),
      supabase.from("scheduling_limits").select("*").single(),
    ]);

  if (!limitsRow) return [];

  // Bookings' own appointment type's buffers matter for exclusion, so
  // fetch the small set of distinct types referenced that day.
  const typeIds = Array.from(new Set((bookings ?? []).map((b) => b.appointment_type_id)));
  const { data: bookingTypes } = typeIds.length
    ? await supabase
        .from("appointment_types")
        .select("id, buffer_before_minutes, buffer_after_minutes")
        .in("id", typeIds)
    : { data: [] as { id: string; buffer_before_minutes: number; buffer_after_minutes: number }[] };
  const bufferById = new Map((bookingTypes ?? []).map((t) => [t.id, t]));

  const dayStartUtc = new Date(`${date}T00:00:00Z`);
  function toMinutesSinceMidnightLocal(iso: string): number {
    // Bookings are stored as UTC instants; convert to minutes-since-local-midnight
    // in the business timezone for comparison against the (local) working window.
    const d = new Date(iso);
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(formatter.formatToParts(d).map((p) => [p.type, p.value]));
    return Number(parts.hour) * 60 + Number(parts.minute);
  }

  const rulesShaped: AvailabilityRule[] = (rules ?? []).map((r) => ({
    dayOfWeek: r.day_of_week,
    startTime: r.start_time,
    endTime: r.end_time,
  }));
  const overridesShaped: AvailabilityOverride[] = (overrides ?? []).map((o) => ({
    date: o.date,
    startTime: o.start_time,
    endTime: o.end_time,
    isClosed: o.is_closed,
  }));
  const limits: SchedulingLimits = {
    minNoticeHours: limitsRow.min_notice_hours,
    maxAdvanceDays: limitsRow.max_advance_days,
    dailyCap: limitsRow.daily_cap,
    startTimeIntervalMinutes: limitsRow.start_time_interval_minutes,
  };

  void dayStartUtc; // reserved for future cross-midnight handling; unused today

  return computeOpenSlots({
    date,
    now: new Date(),
    durationMinutes: appointmentType.duration_minutes,
    bufferBeforeMinutes: appointmentType.buffer_before_minutes,
    bufferAfterMinutes: appointmentType.buffer_after_minutes,
    rules: rulesShaped,
    overrides: overridesShaped,
    blockedTimes: (blocked ?? []).map((b) => ({ startTime: b.start_time, endTime: b.end_time })),
    existingBookings: (bookings ?? []).map((b) => {
      const type = bufferById.get(b.appointment_type_id);
      return {
        startMinutes: toMinutesSinceMidnightLocal(b.start_time),
        endMinutes: toMinutesSinceMidnightLocal(b.end_time),
        bufferBeforeMinutes: type?.buffer_before_minutes ?? 0,
        bufferAfterMinutes: type?.buffer_after_minutes ?? 0,
      };
    }),
    busyBlocks: (busy ?? []).map((b) => ({
      startMinutes: toMinutesSinceMidnightLocal(b.start_time),
      endMinutes: toMinutesSinceMidnightLocal(b.end_time),
    })),
    confirmedBookingsCountForDay: (bookings ?? []).filter((b) => b.status === "confirmed").length,
    limits,
  });
}

export function resolveHoursQuick(
  date: string,
  rules: AvailabilityRule[],
  overrides: AvailabilityOverride[],
) {
  return resolveHoursForDate(date, rules, overrides);
}
```

- [ ] **Step 2: Public routes**

```typescript
// app/api/availability/appointment-types/route.ts
import { fetchActiveAppointmentTypes } from "@/lib/availabilityQuery";

export async function GET() {
  try {
    const appointmentTypes = await fetchActiveAppointmentTypes();
    return Response.json({ appointmentTypes });
  } catch (err) {
    console.error("Failed to fetch appointment types:", err);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }
}
```

```typescript
// app/api/availability/dates/route.ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate, type AppointmentTypeRow } from "@/lib/availabilityQuery";

function daysInMonth(year: number, month: number): string[] {
  const days: string[] = [];
  const date = new Date(year, month - 1, 1);
  while (date.getMonth() === month - 1) {
    days.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    );
    date.setDate(date.getDate() + 1);
  }
  return days;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appointmentTypeId = url.searchParams.get("appointmentTypeId");
  const month = url.searchParams.get("month");
  if (!appointmentTypeId || !month || !/^\d{4}-\d{2}$/.test(month)) {
    return Response.json({ error: "appointmentTypeId and month (YYYY-MM) are required." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: type, error } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("id", appointmentTypeId)
    .eq("active", true)
    .maybeSingle();

  if (error || !type) {
    return Response.json({ error: "Appointment type not found." }, { status: 404 });
  }

  const [year, monthNum] = month.split("-").map(Number);
  const dates = daysInMonth(year, monthNum);

  const openDates: string[] = [];
  for (const date of dates) {
    const slots = await fetchOpenSlotsForDate({ date, appointmentType: type as AppointmentTypeRow });
    if (slots.length > 0) openDates.push(date);
  }

  return Response.json({ openDates });
}
```

```typescript
// app/api/availability/slots/route.ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate, type AppointmentTypeRow } from "@/lib/availabilityQuery";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const appointmentTypeId = url.searchParams.get("appointmentTypeId");
  const date = url.searchParams.get("date");
  if (!appointmentTypeId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "appointmentTypeId and date (YYYY-MM-DD) are required." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: type, error } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("id", appointmentTypeId)
    .eq("active", true)
    .maybeSingle();

  if (error || !type) {
    return Response.json({ error: "Appointment type not found." }, { status: 404 });
  }

  const slots = await fetchOpenSlotsForDate({ date, appointmentType: type as AppointmentTypeRow });
  return Response.json({ slots });
}
```

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 4: Manual test**

With Task 4's Monday-Friday 9-5 template and a test appointment type (60 min) in place: `curl "http://localhost:3000/api/availability/appointment-types"` returns the test type; `curl "http://localhost:3000/api/availability/dates?appointmentTypeId=<id>&month=<current YYYY-MM>"` returns only weekday dates; `curl "http://localhost:3000/api/availability/slots?appointmentTypeId=<id>&date=<a Monday>"` returns slots from 09:00 through 16:00.

- [ ] **Step 5: Commit**

```bash
git add lib/availabilityQuery.ts app/api/availability
git commit -m "Add public availability API (appointment types, open dates, open slots)"
```

---

## Task 10: Client booking UI — type picker, calendar, slot list

**Files:**
- Modify: `app/book/page.tsx` (replaced wholesale)
- Create: `app/book/BookingFlow.tsx` (replaces the old one)
- Create: `app/book/AppointmentTypePicker.tsx`
- Create: `app/book/BookingCalendar.tsx`
- Create: `app/book/SlotList.tsx`
- Delete: old `app/book/BookingFlow.tsx` content (replaced, not deleted as a separate step — same filename, new contents)

**Interfaces:**
- Consumes: `GET /api/availability/appointment-types`, `GET /api/availability/dates`, `GET /api/availability/slots` (Task 9); `formatSlotForDisplay` from `lib/scheduling.ts` (Task 2).
- Produces: selection state (`appointmentTypeId`, `date`, `slot`) handed to Task 12's booking form.

- [ ] **Step 1: Appointment type picker**

`AppointmentTypePicker.tsx` (`"use client"`): fetches `GET /api/availability/appointment-types` on mount, renders each as a selectable card (color swatch, name, `${duration} min`, price if `requiresPayment`). Calls `onSelect(appointmentType)` when clicked.

- [ ] **Step 2: Booking calendar**

`BookingCalendar.tsx` (`"use client"`, props: `appointmentTypeId`): month navigation (prev/next), fetches `GET /api/availability/dates?appointmentTypeId=...&month=...` on mount and month change, renders a 7-column grid for the month where dates in the returned `openDates` list are clickable buttons and all other dates are visibly disabled (greyed out, `disabled` attribute, no hover state) — matching the Acuity reference's closed/full days. Calls `onSelectDate(date)` when a date is clicked.

- [ ] **Step 3: Slot list with timezone display**

`SlotList.tsx` (`"use client"`, props: `appointmentTypeId`, `date`): fetches `GET /api/availability/slots?appointmentTypeId=...&date=...` on mount and when `date`/`appointmentTypeId` change. Detects the browser's timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`. For each slot, renders the business-local time (`formatSlotForDisplay(date, slot.startTime, "America/Chicago")`); if the detected browser timezone differs from `America/Chicago`, also renders the converted local time next to it (`formatSlotForDisplay(date, slot.startTime, browserTimeZone)`) with a label like "(your time)". Calls `onSelectSlot(slot)` when clicked.

- [ ] **Step 4: Assemble the flow**

```typescript
// app/book/page.tsx
import type { Metadata } from "next";
import { buildPageMetadata } from "@/lib/seo";
import BookingFlow from "./BookingFlow";

export function generateMetadata(): Metadata {
  return buildPageMetadata({
    title: "Book a Session",
    description: "Book a portrait, headshot, or boudoir photography session with a Columbia, Missouri photographer serving Mid-Missouri.",
    path: "/book",
  });
}

export default function BookPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-20 sm:px-10">
      <header className="mb-12 text-center">
        <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Schedule Online</p>
        <h1 className="font-serif text-4xl italic leading-tight text-foreground sm:text-5xl">
          Book a <span className="text-accent">session</span>.
        </h1>
        <p className="mt-5 text-muted">Pick a session type and an open time below. You&apos;ll get a confirmation by email right after.</p>
      </header>
      <BookingFlow />
    </div>
  );
}
```

`BookingFlow.tsx` (`"use client"`): owns the wizard state (`step: "type" | "date" | "slot" | "form"`, plus the selected `appointmentType`, `date`, `slot`). Renders `AppointmentTypePicker` → `BookingCalendar` → `SlotList` in sequence, each step's selection advancing to the next; the booking form itself (Task 12) is the final step. Includes a "change" link at each completed step to go back, matching the old `BookingFlow.tsx`'s pattern of showing the selected slot with a "Choose a different time" link.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 6: Manual test**

Load `/book`: pick the test appointment type, confirm the calendar shows only weekdays selectable, pick a weekday, confirm the slot list shows 09:00-16:00 in 30-minute steps (or whatever the test template produces), confirm the timezone line only appears if the browser isn't in Central time (test by changing the OS timezone, or trust the `Intl` logic and move on since this is hard to verify locally without changing system settings — note this as a "verify visually once deployed" follow-up in Task 24's regression pass instead of blocking here).

- [ ] **Step 7: Commit**

```bash
git add app/book
git commit -m "Rebuild client booking UI: type picker, calendar, slot list"
```

---

## Task 11: Rate limiting and booking submission API

**Files:**
- Modify: `supabase/schema.sql` (add `rate_limit_hits` table)
- Create: `lib/rateLimit.ts`
- Create: `app/api/bookings/route.ts`

**Interfaces:**
- Consumes: `fetchOpenSlotsForDate` from `lib/availabilityQuery.ts` (Task 9), `createFullPaymentCheckoutSession` (defined in Task 13 — this task stubs the call and Task 13 fills in the real function; see Step 3's note).
- Produces: `POST /api/bookings` — the client booking form (Task 12) posts here.

- [ ] **Step 1: Add the rate-limit table**

Append to `supabase/schema.sql`:

```sql
create table rate_limit_hits (
  id uuid primary key default gen_random_uuid(),
  ip text not null,
  endpoint text not null,
  created_at timestamptz not null default now()
);
create index rate_limit_hits_ip_endpoint_idx on rate_limit_hits (ip, endpoint, created_at);
```

Apply via the Supabase SQL Editor, verify with `select * from rate_limit_hits limit 1;` (0 rows, no error).

- [ ] **Step 2: Rate limit helper**

```typescript
// lib/rateLimit.ts
import { getSupabaseClient } from "@/lib/supabase";

// Postgres-backed, not in-memory — a Vercel serverless function's memory
// isn't shared across invocations or regions, so an in-memory counter
// would under-count and fail to actually throttle anything in production.
export async function checkRateLimit(params: {
  ip: string;
  endpoint: string;
  maxHits: number;
  windowMinutes: number;
}): Promise<{ allowed: boolean }> {
  const supabase = getSupabaseClient();
  const windowStart = new Date(Date.now() - params.windowMinutes * 60 * 1000).toISOString();

  const { count, error } = await supabase
    .from("rate_limit_hits")
    .select("id", { count: "exact", head: true })
    .eq("ip", params.ip)
    .eq("endpoint", params.endpoint)
    .gte("created_at", windowStart);

  if (error) {
    console.error("Rate limit check failed, failing open:", error);
    return { allowed: true };
  }

  if ((count ?? 0) >= params.maxHits) {
    return { allowed: false };
  }

  await supabase.from("rate_limit_hits").insert({ ip: params.ip, endpoint: params.endpoint });
  return { allowed: true };
}

export function getClientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}
```

- [ ] **Step 3: Booking submission API**

```typescript
// app/api/bookings/route.ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { createFullPaymentCheckoutSession } from "@/lib/stripe";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Payload = {
  appointmentTypeId: string;
  date: string;
  startTime: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  notes: string;
  honeypot: string;
};

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
    typeof b.honeypot !== "string"
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
  };
}

export async function POST(request: Request) {
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Please fill out all required fields with a valid email address." }, { status: 400 });
  }

  // Honeypot: a real client never fills this hidden field. Silently
  // pretend success so a bot doesn't learn its submission was rejected.
  if (payload.honeypot) {
    return Response.json({ ok: true, checkoutUrl: null });
  }

  const ip = getClientIp(request);
  const { allowed } = await checkRateLimit({ ip, endpoint: "bookings", maxHits: 5, windowMinutes: 10 });
  if (!allowed) {
    return Response.json({ error: "Too many requests. Please try again shortly." }, { status: 429 });
  }

  const supabase = getSupabaseClient();
  const { data: type, error: typeError } = await supabase
    .from("appointment_types")
    .select("id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color")
    .eq("id", payload.appointmentTypeId)
    .eq("active", true)
    .maybeSingle();

  if (typeError || !type) {
    return Response.json({ error: "That appointment type is no longer available." }, { status: 404 });
  }

  // Re-validate against current availability at submit time — the
  // client's list may be stale by the time they submit.
  const openSlots = await fetchOpenSlotsForDate({ date: payload.date, appointmentType: type });
  if (!openSlots.some((s) => s.startTime === payload.startTime)) {
    return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
  }

  const startIso = businessLocalToUtcIso(payload.date, payload.startTime);
  const endIso = businessLocalToUtcIso(
    payload.date,
    addMinutesToTime(payload.startTime, type.duration_minutes),
  );

  const status = type.requires_payment ? "pending" : "confirmed";
  const { data: booking, error: insertError } = await supabase
    .from("bookings")
    .insert({
      appointment_type_id: type.id,
      client_name: payload.clientName,
      client_email: payload.clientEmail,
      client_phone: payload.clientPhone || null,
      start_time: startIso,
      end_time: endIso,
      status,
      notes: payload.notes || null,
      pending_expires_at: type.requires_payment ? new Date(Date.now() + 30 * 60 * 1000).toISOString() : null,
    })
    .select()
    .single();

  if (insertError) {
    // Postgres exclusion-violation error code — someone else claimed this
    // exact time between our slot-list check above and this insert.
    if (insertError.code === "23P01") {
      return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
    }
    console.error("bookings insert failed:", insertError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (!type.requires_payment) {
    // Confirmation email, Google Calendar push: wired in Tasks 14 and 17.
    return Response.json({ ok: true, checkoutUrl: null, bookingToken: booking.booking_token });
  }

  try {
    const session = await createFullPaymentCheckoutSession({
      bookingId: booking.id,
      amountCents: type.price_cents,
      appointmentTypeName: type.name,
      clientEmail: payload.clientEmail,
    });
    return Response.json({ ok: true, checkoutUrl: session.url });
  } catch (err) {
    console.error("Failed to create booking checkout session:", err);
    await supabase.from("bookings").update({ status: "canceled" }).eq("id", booking.id);
    return Response.json({ error: "Something went wrong starting checkout." }, { status: 500 });
  }
}

function businessLocalToUtcIso(date: string, time: string): string {
  const naive = new Date(`${date}T${time}:00`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(naive).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  const offsetMs = asUtc - naive.getTime();
  return new Date(naive.getTime() - offsetMs).toISOString();
}

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
```

This task calls `createFullPaymentCheckoutSession`, which doesn't exist yet — Task 13 adds it to `lib/stripe.ts`. **Implement this task's Step 3 through the point of calling that function, then stub it locally** (`async function createFullPaymentCheckoutSession(): Promise<{url: string}> { throw new Error("not implemented until Task 13"); }` at the top of this file) so `tsc`/`eslint` pass and the non-payment path (`requires_payment: false`) can be fully tested now. Task 13 removes the stub and imports the real one.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 5: Manual test — free appointment type end-to-end**

Create a test appointment type with `requiresPayment: false`. `curl -X POST http://localhost:3000/api/bookings` with a valid payload for an open slot. Confirm `status: 200`, and `select * from bookings where client_name = 'Test Client';` shows `status = 'confirmed'`. Submit the identical payload again immediately — confirm it's rejected with a 409 (exclusion constraint firing, not just the pre-check, since the pre-check would also correctly catch it — to prove the *constraint* is what's really enforcing this, temporarily comment out the `openSlots.some(...)` pre-check, resubmit, confirm the insert itself still fails with a 409 via `insertError.code === "23P01"`, then restore the pre-check).

- [ ] **Step 6: Manual test — honeypot and rate limit**

Submit with `honeypot: "anything"` — confirm `200` with `checkoutUrl: null` and **no** row inserted into `bookings`. Submit 6 valid requests in a row from the same IP within 10 minutes — confirm the 6th returns 429.

- [ ] **Step 7: Clean up test data**

```sql
delete from bookings where client_name = 'Test Client';
delete from rate_limit_hits;
```

- [ ] **Step 8: Commit**

```bash
git add supabase/schema.sql lib/rateLimit.ts app/api/bookings
git commit -m "Add rate limiting and the booking submission API"
```

---

## Task 12: Booking form UI and confirmation page

**Files:**
- Create: `app/book/BookingForm.tsx`
- Modify: `app/book/BookingFlow.tsx` (wire in the form as the final step)
- Modify: `app/book/confirmed/page.tsx` (adjust copy — no longer mentions a session agreement, since this system has no contract-signing step)

**Interfaces:**
- Consumes: `POST /api/bookings` (Task 11).

- [ ] **Step 1: Booking form with honeypot**

```typescript
// app/book/BookingForm.tsx
"use client";

import { useState, type FormEvent } from "react";

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

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (status === "loading") return;
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentTypeId, date, startTime, ...form }),
      });
      const data: { checkoutUrl?: string | null; error?: string } = await response.json();

      if (!response.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
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
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={status === "loading"}
        className="w-full border border-foreground py-3 text-xs uppercase tracking-[0.3em] text-foreground transition-colors hover:bg-foreground hover:text-background disabled:opacity-50"
      >
        {status === "loading" ? "Please wait…" : "Confirm Booking"}
      </button>
    </form>
  );
}
```

- [ ] **Step 2: Wire into `BookingFlow.tsx`**

Extend the wizard's `step` state to include `"form"`, reached after a slot is selected in `SlotList`. Render `BookingForm` with the selected `appointmentTypeId`/`date`/`slot.startTime`, and `onBack` returning to the `"slot"` step.

- [ ] **Step 3: Update the confirmation page copy**

```typescript
// app/book/confirmed/page.tsx — replace the body paragraph
<p className="mt-4 text-muted">
  Check your email for your booking confirmation, including a private
  link where you can reschedule or cancel later if you need to.
</p>
```

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 5: Manual test**

Full click-through on `/book` for a free (non-payment) test appointment type: pick type → date → slot → fill form → submit → redirected to `/book/confirmed`. Confirm the booking row exists with `status = 'confirmed'`. Clean up: `delete from bookings where client_name = 'Test Client';`.

- [ ] **Step 6: Commit**

```bash
git add app/book
git commit -m "Add booking form and wire it into the client booking flow"
```

---

## Task 13: Stripe full-payment checkout and webhook

**Files:**
- Modify: `lib/stripe.ts` (add `createFullPaymentCheckoutSession`)
- Modify: `app/api/bookings/route.ts` (remove the Task 11 stub, import the real function)
- Create: `lib/bookingsWebhook.ts`
- Create: `app/api/webhooks/stripe-bookings/route.ts`
- Modify: `.env.example` (add `STRIPE_WEBHOOK_SECRET_BOOKINGS`)

**Interfaces:**
- Produces: `createFullPaymentCheckoutSession(params): Promise<Stripe.Checkout.Session>` in `lib/stripe.ts`, alongside the existing `createDepositCheckoutSession`/`createRescheduleFeeCheckoutSession` (untouched — this is additive, the old functions keep serving the old live system until Task 25's cutover).

- [ ] **Step 1: Add the checkout-session function**

Append to `lib/stripe.ts`:

```typescript
export async function createFullPaymentCheckoutSession(params: {
  bookingId: string;
  amountCents: number;
  appointmentTypeName: string;
  clientEmail: string;
}): Promise<Stripe.Checkout.Session> {
  const stripe = getStripeClient();
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    customer_email: params.clientEmail,
    line_items: [
      {
        price_data: {
          currency: "usd",
          unit_amount: params.amountCents,
          product_data: { name: params.appointmentTypeName },
        },
        quantity: 1,
      },
    ],
    metadata: { purpose: "booking_payment", bookingId: params.bookingId },
    success_url: `${SITE_URL}/book/confirmed`,
    cancel_url: `${SITE_URL}/book`,
    expires_at: Math.floor(Date.now() / 1000) + HOLD_SECONDS,
  });
}
```

- [ ] **Step 2: Remove the Task 11 stub**

In `app/api/bookings/route.ts`, delete the local stub function and change the import to:

```typescript
import { createFullPaymentCheckoutSession } from "@/lib/stripe";
```

- [ ] **Step 3: Webhook handler logic**

```typescript
// lib/bookingsWebhook.ts
import type Stripe from "stripe";
import { getSupabaseClient } from "@/lib/supabase";
import { sendBookingPaymentConfirmedEmail } from "@/lib/email";
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";

export async function handleBookingCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<{ retry: boolean }> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return { retry: false };

  const supabase = getSupabaseClient();

  // Idempotent: only the first delivery of this event actually flips
  // status, matching the existing bookingWebhooks.ts pattern for the old
  // system. A retried delivery finds status already 'confirmed' and no-ops.
  const { data: booking, error } = await supabase
    .from("bookings")
    .update({
      status: "confirmed",
      payment_intent_id: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id,
      amount_paid_cents: session.amount_total,
      pending_expires_at: null,
    })
    .eq("id", bookingId)
    .eq("status", "pending")
    .select("*, appointment_types(name)")
    .maybeSingle();

  if (error) {
    console.error("Failed to confirm booking from webhook:", error);
    return { retry: true };
  }
  if (!booking) {
    // Already confirmed (duplicate delivery) or the row is gone — either
    // way, nothing left to do.
    return { retry: false };
  }

  try {
    await sendBookingPaymentConfirmedEmail(booking);
  } catch (err) {
    console.error("Confirmation email failed (booking still confirmed):", err);
  }

  try {
    const eventId = await pushBookingToGoogleCalendar(booking);
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", bookingId);
    }
  } catch (err) {
    console.error("Google Calendar push failed (booking still confirmed):", err);
  }

  return { retry: false };
}

export async function handleBookingCheckoutExpired(session: Stripe.Checkout.Session): Promise<void> {
  const bookingId = session.metadata?.bookingId;
  if (!bookingId) return;

  const supabase = getSupabaseClient();
  await supabase.from("bookings").update({ status: "canceled" }).eq("id", bookingId).eq("status", "pending");
}
```

Note: `sendBookingPaymentConfirmedEmail` (Task 14) and `pushBookingToGoogleCalendar` (Task 17) don't exist yet. **Stub both** at the top of this file the same way Task 11 stubbed the checkout function, so this task's own verification (webhook flips `pending`→`confirmed`) doesn't depend on later tasks:

```typescript
async function sendBookingPaymentConfirmedEmailStub(..._args: unknown[]) {}
async function pushBookingToGoogleCalendarStub(..._args: unknown[]): Promise<string | null> { return null; }
```

Use the stubs in place of the real imports for now; Task 14 and Task 17 each replace one stub with the real import (never both at once, so `git blame` stays meaningful).

- [ ] **Step 4: Webhook route**

```typescript
// app/api/webhooks/stripe-bookings/route.ts
import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { handleBookingCheckoutCompleted, handleBookingCheckoutExpired } from "@/lib/bookingsWebhook";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET_BOOKINGS;

  if (!signature || !webhookSecret) {
    return new Response("Missing signature.", { status: 400 });
  }

  const stripe = getStripeClient();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return new Response("Invalid signature.", { status: 400 });
  }

  let retry = false;
  if (event.type === "checkout.session.completed") {
    ({ retry } = await handleBookingCheckoutCompleted(event.data.object as Stripe.Checkout.Session));
  } else if (event.type === "checkout.session.expired") {
    await handleBookingCheckoutExpired(event.data.object as Stripe.Checkout.Session);
  }

  if (retry) {
    return new Response("Transient error, please retry.", { status: 500 });
  }
  return Response.json({ received: true });
}
```

- [ ] **Step 5: Env var**

Add to `.env.example`:

```
# Second Stripe webhook endpoint, separate from STRIPE_WEBHOOK_SECRET —
# the new booking system's endpoint (/api/webhooks/stripe-bookings) is
# distinct from the old one until the Task 25 cutover.
STRIPE_WEBHOOK_SECRET_BOOKINGS=
```

Add the real test-mode value to `.env.local` (not committed) the same way the original Stripe integration did: `stripe listen --forward-to localhost:3000/api/webhooks/stripe-bookings` in a separate terminal, copy the printed `whsec_...` value.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 7: Manual test — full payment flow end-to-end**

With `stripe listen` running and forwarding to the new endpoint: create a test appointment type with `requiresPayment: true`, $5 price. Book it through `/book`, complete Stripe Checkout with the test card `4242 4242 4242 4242`. Confirm the webhook fires (visible in the `stripe listen` terminal), and `select status, payment_intent_id, amount_paid_cents from bookings where client_name = 'Test Client';` shows `confirmed`, a `pi_...` id, and `500`.

- [ ] **Step 8: Manual test — abandoned checkout**

Start a booking for the paid test type, don't complete Checkout. Use `stripe trigger checkout.session.expired` (or wait for real expiry) and confirm the booking row's `status` flips to `canceled`.

- [ ] **Step 9: Clean up test data**

```sql
delete from bookings where client_name = 'Test Client';
```

- [ ] **Step 10: Commit**

```bash
git add lib/stripe.ts lib/bookingsWebhook.ts app/api/webhooks/stripe-bookings app/api/bookings/route.ts .env.example
git commit -m "Add full-payment Stripe checkout and webhook for the new booking system"
```

---

## Task 14: Confirmation emails

**Files:**
- Modify: `lib/email.ts` (add `sendFreeBookingConfirmedEmail` for free bookings, `sendBookingPaymentConfirmedEmail` for paid ones)
- Modify: `app/api/bookings/route.ts` (call the free-path email directly)
- Modify: `lib/bookingsWebhook.ts` (replace the email stub with the real import)

**Interfaces:**
- Consumes: `escapeHtml`, `FROM_ADDRESS`-equivalent pattern already in `lib/email.ts`; `formatCents` from `lib/format.ts`.

- [ ] **Step 1: Add the two email functions**

Append to `lib/email.ts` (uses the same `Resend`/`escapeHtml`/try-catch-return-ok-or-error shape as every existing function in this file):

```typescript
type BookingForEmail = {
  client_name: string;
  client_email: string;
  start_time: string;
  end_time: string;
  booking_token: string;
  appointment_types: { name: string } | { name: string }[] | null;
};

function appointmentTypeName(booking: BookingForEmail): string {
  const rel = booking.appointment_types;
  if (!rel) return "your appointment";
  return Array.isArray(rel) ? (rel[0]?.name ?? "your appointment") : rel.name;
}

export async function sendFreeBookingConfirmedEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `You're confirmed for ${typeName} on ${when}.`,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>You're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}

export async function sendBookingPaymentConfirmedEmail(
  booking: BookingForEmail & { amount_paid_cents: number | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const paidLine = booking.amount_paid_cents
    ? `Payment of ${formatCents(booking.amount_paid_cents)} received — you're all set.`
    : "You're all set.";
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "You're booked!",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `You're confirmed for ${typeName} on ${when}.`,
        paidLine,
        "",
        "Need to reschedule or cancel? Use your private booking link:",
        manageUrl,
        "",
        "See you soon,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>You're confirmed for ${escapeHtml(typeName)} on ${escapeHtml(when)}.</p>
        <p>${escapeHtml(paidLine)}</p>
        <p>Need to reschedule or cancel? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you soon,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

Add `formatCents` to the existing `import { formatTimeRange, formatDate, formatCents } from "@/lib/format";` line at the top of the file if it isn't already imported there (it is — this file already imports it for the old cancellation email).

- [ ] **Step 2: Wire the free-path email into the booking route**

In `app/api/bookings/route.ts`, replace the comment `// Confirmation email, Google Calendar push: wired in Tasks 14 and 17.` with:

```typescript
try {
  await sendFreeBookingConfirmedEmail({ ...booking, appointment_types: { name: type.name } });
} catch (err) {
  console.error("Confirmation email failed (booking still confirmed):", err);
}
```

Add the import: `import { sendFreeBookingConfirmedEmail } from "@/lib/email";`.

- [ ] **Step 3: Replace the webhook's email stub**

In `lib/bookingsWebhook.ts`, remove `sendBookingPaymentConfirmedEmailStub` and change the import to:

```typescript
import { sendBookingPaymentConfirmedEmail } from "@/lib/email";
```

Update the call site from `sendBookingPaymentConfirmedEmailStub(booking)` to `sendBookingPaymentConfirmedEmail(booking)`.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 5: Manual test**

Repeat Task 11's free-booking test and Task 13's paid-booking test; confirm an email actually arrives at the test address for each, with the correct appointment type name, time, and (for the paid one) amount. Clean up test bookings afterward.

- [ ] **Step 6: Commit**

```bash
git add lib/email.ts lib/bookingsWebhook.ts app/api/bookings/route.ts
git commit -m "Add booking confirmation emails for free and paid paths"
```

---

## Task 15: Safety-net sweep for stuck pending bookings

**Files:**
- Create: `scripts/scheduling.mjs`
- Modify: `package.json` (add `scheduling:sweep-pending` script)

**Interfaces:**
- Produces: `npm run scheduling:sweep-pending` — mirrors the existing `bookings:sweep-pending` CLI in shape, simpler in substance since the new `bookings` table has no "restore vs release" duality (a `pending` row's own existence *is* the hold; expiring it is just one `UPDATE`).

- [ ] **Step 1: Sweep script**

```javascript
// scripts/scheduling.mjs
// Safety net for `bookings` rows stuck in 'pending' past
// pending_expires_at — normally released by the
// checkout.session.expired webhook (see lib/bookingsWebhook.ts), this
// covers the case where that webhook delivery was ever missed.
//
// Usage (via the npm script — already loads .env.local):
//   npm run scheduling:sweep-pending

import { createClient } from "@supabase/supabase-js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Run via the npm script, which loads .env.local automatically.`);
    process.exit(1);
  }
  return value;
}

const supabase = createClient(
  requireEnv("SUPABASE_URL").replace(/\/rest\/v1\/?$/, ""),
  requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

async function sweepPending() {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("status", "pending")
    .lt("pending_expires_at", now)
    .select("id");

  if (error) {
    console.error("Sweep failed:", error.message);
    process.exit(1);
  }
  console.log(`Canceled ${data?.length ?? 0} stuck pending booking(s).`);
}

const command = process.argv[2];
if (command === "sweep-pending") {
  await sweepPending();
} else {
  console.error("Usage: node scripts/scheduling.mjs sweep-pending");
  process.exit(1);
}
```

- [ ] **Step 2: Add the npm script**

In `package.json`'s `scripts`, add (alongside the existing `bookings:sweep-pending`):

```json
"scheduling:sweep-pending": "node --env-file=.env.local scripts/scheduling.mjs sweep-pending"
```

- [ ] **Step 3: Type-check and lint**

Run: `npx eslint scripts` (this is a plain `.mjs` script, not part of the `tsc` project — lint only)

- [ ] **Step 4: Manual test**

Manually insert a stuck pending row: `insert into bookings (appointment_type_id, client_name, client_email, start_time, end_time, status, pending_expires_at) select id, 'Sweep Test', 'test@example.com', now() + interval '1 day', now() + interval '1 day 1 hour', 'pending', now() - interval '1 hour' from appointment_types limit 1;`. Run `npm run scheduling:sweep-pending`, confirm it reports 1 canceled and `select status from bookings where client_name = 'Sweep Test';` shows `canceled`. Clean up: `delete from bookings where client_name = 'Sweep Test';`.

- [ ] **Step 5: Commit**

```bash
git add scripts/scheduling.mjs package.json
git commit -m "Add safety-net sweep CLI for stuck pending bookings"
```

---

## Task 16: Google Calendar OAuth connection

**Files:**
- Modify: `package.json` (add `googleapis` dependency)
- Create: `lib/googleCalendar.ts`
- Create: `app/api/admin/google/connect/route.ts`
- Create: `app/api/admin/google/callback/route.ts`
- Create: `app/api/admin/google/status/route.ts`
- Modify: `app/admin/availability/AvailabilityOverviewClient.tsx` (add a "Connect Google Calendar" card)
- Modify: `.env.example`

**Interfaces:**
- Produces: `getGoogleOAuthClient()`, `getStoredGoogleTokens()`, `saveGoogleTokens(tokens)` in `lib/googleCalendar.ts` — Task 17 and Task 18 both build on these.

- [ ] **Step 1: Install `googleapis`**

Run: `npm install googleapis`

- [ ] **Step 2: OAuth client helper**

```typescript
// lib/googleCalendar.ts
import { google } from "googleapis";
import { getSupabaseClient } from "@/lib/supabase";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

export function getGoogleOAuthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_OAUTH_CLIENT_ID"),
    requireEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    requireEnv("GOOGLE_OAUTH_REDIRECT_URI"),
  );
}

const SCOPES = ["https://www.googleapis.com/auth/calendar"];

export function getGoogleAuthUrl(): string {
  const client = getGoogleOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // forces a refresh_token even on a re-connect
    scope: SCOPES,
  });
}

export async function exchangeCodeAndStoreTokens(code: string): Promise<void> {
  const client = getGoogleOAuthClient();
  const { tokens } = await client.getToken(code);
  const supabase = getSupabaseClient();
  const { error } = await supabase
    .from("google_calendar_sync")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? undefined,
      token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      connected: true,
    })
    .eq("id", true);
  if (error) throw error;
}

// Returns an authenticated client, refreshing the access token first if
// it's expired — googleapis' OAuth2 client does this automatically once
// given both tokens, but only if we hand it the stored refresh_token.
export async function getAuthenticatedGoogleClient() {
  const supabase = getSupabaseClient();
  const { data: sync } = await supabase.from("google_calendar_sync").select("*").single();
  if (!sync?.connected || !sync.refresh_token) return null;

  const client = getGoogleOAuthClient();
  client.setCredentials({
    access_token: sync.access_token ?? undefined,
    refresh_token: sync.refresh_token,
    expiry_date: sync.token_expires_at ? new Date(sync.token_expires_at).getTime() : undefined,
  });

  client.on("tokens", async (tokens) => {
    // googleapis fires this when it silently refreshes an expired access
    // token — persist the new one so we're not re-refreshing every call.
    if (tokens.access_token) {
      await supabase
        .from("google_calendar_sync")
        .update({
          access_token: tokens.access_token,
          token_expires_at: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
        })
        .eq("id", true);
    }
  });

  return client;
}
```

- [ ] **Step 3: Connect and callback routes**

```typescript
// app/api/admin/google/connect/route.ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getGoogleAuthUrl } from "@/lib/googleCalendar";

export async function GET() {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  redirect(getGoogleAuthUrl());
}
```

```typescript
// app/api/admin/google/callback/route.ts
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { exchangeCodeAndStoreTokens } from "@/lib/googleCalendar";

export async function GET(request: Request) {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const code = new URL(request.url).searchParams.get("code");
  if (!code) {
    return Response.json({ error: "Missing authorization code." }, { status: 400 });
  }
  try {
    await exchangeCodeAndStoreTokens(code);
  } catch (err) {
    console.error("Google OAuth token exchange failed:", err);
    return Response.json({ error: "Failed to connect Google Calendar." }, { status: 500 });
  }
  redirect("/admin/availability?googleConnected=1");
}
```

```typescript
// app/api/admin/google/status/route.ts
import { cookies } from "next/headers";
import { ADMIN_ACCESS_COOKIE, isValidAccessToken } from "@/lib/adminAccess";
import { getSupabaseClient } from "@/lib/supabase";

export async function GET() {
  const cookieStore = await cookies();
  if (!isValidAccessToken(cookieStore.get(ADMIN_ACCESS_COOKIE)?.value)) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const supabase = getSupabaseClient();
  const { data } = await supabase.from("google_calendar_sync").select("connected, last_synced_at").single();
  return Response.json({ connected: data?.connected ?? false, lastSyncedAt: data?.last_synced_at ?? null });
}
```

- [ ] **Step 4: Env vars**

Add to `.env.example`:

```
# Google Calendar OAuth2 — from Google Cloud Console > APIs & Services >
# Credentials. Redirect URI must be added there too and must exactly
# match GOOGLE_OAUTH_REDIRECT_URI (including http vs https and trailing
# slash).
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/admin/google/callback
```

- [ ] **Step 5: Admin UI card**

In `AvailabilityOverviewClient.tsx`, add a small card: fetches `GET /api/admin/google/status` on mount; if not connected, shows a "Connect Google Calendar" link to `/api/admin/google/connect`; if connected, shows "Connected" plus last-synced time (populated once Task 18's cron runs).

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 7: Manual test — real OAuth connection**

This needs a real Google Cloud project: create one (or reuse an existing personal one), enable the Google Calendar API, create an OAuth 2.0 Client ID (Web application), add `http://localhost:3000/api/admin/google/callback` as an authorized redirect URI, and add yourself as a test user if the app is in "Testing" publishing status. Put the client ID/secret in `.env.local`. Click "Connect Google Calendar" in the admin UI, complete Google's consent screen with **your own personal Google account** (the one whose calendar this should sync), confirm redirect back to `/admin/availability?googleConnected=1` and the card now shows "Connected". Verify via SQL: `select connected, refresh_token is not null as has_refresh_token from google_calendar_sync;` — both `true`.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/googleCalendar.ts app/api/admin/google app/admin/availability/AvailabilityOverviewClient.tsx .env.example
git commit -m "Add Google Calendar OAuth2 connection flow"
```

---

## Task 17: Push bookings to Google Calendar; remove on cancellation

**Files:**
- Modify: `lib/googleCalendar.ts` (add `pushBookingToGoogleCalendar`, `deleteGoogleCalendarEvent`)
- Modify: `lib/bookingsWebhook.ts` (replace the Google Calendar stub with the real import)
- Modify: `app/api/bookings/route.ts` (push to calendar on the free-confirm path too)

**Interfaces:**
- Produces: `pushBookingToGoogleCalendar(booking): Promise<string | null>` (returns the created event ID, or `null` if Calendar isn't connected — never throws for "not connected," only for a genuine API failure), `deleteGoogleCalendarEvent(eventId): Promise<void>`. Task 21 (Cancel API) calls `deleteGoogleCalendarEvent`.

- [ ] **Step 1: Push and delete functions**

Append to `lib/googleCalendar.ts`:

```typescript
type BookingForCalendar = {
  client_name: string;
  notes: string | null;
  start_time: string;
  end_time: string;
  appointment_types: { name: string } | { name: string }[] | null;
};

function typeNameFor(booking: BookingForCalendar): string {
  const rel = booking.appointment_types;
  if (!rel) return "Appointment";
  return Array.isArray(rel) ? (rel[0]?.name ?? "Appointment") : rel.name;
}

export async function pushBookingToGoogleCalendar(booking: BookingForCalendar): Promise<string | null> {
  const client = await getAuthenticatedGoogleClient();
  if (!client) return null; // not connected — not an error, just nothing to do

  const calendar = google.calendar({ version: "v3", auth: client });
  const response = await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: `${typeNameFor(booking)} — ${booking.client_name}`,
      description: booking.notes ?? undefined,
      start: { dateTime: booking.start_time },
      end: { dateTime: booking.end_time },
    },
  });
  return response.data.id ?? null;
}

export async function deleteGoogleCalendarEvent(eventId: string): Promise<void> {
  const client = await getAuthenticatedGoogleClient();
  if (!client) return;
  const calendar = google.calendar({ version: "v3", auth: client });
  try {
    await calendar.events.delete({ calendarId: "primary", eventId });
  } catch (err) {
    // Event already gone (manually deleted from Calendar, or never
    // created because Calendar wasn't connected at booking time) — not
    // fatal, cancellation must still succeed.
    console.error("Failed to delete Google Calendar event (continuing):", err);
  }
}
```

Add the import at the top: `import { google } from "googleapis";`.

- [ ] **Step 2: Replace the webhook's Calendar stub**

In `lib/bookingsWebhook.ts`, remove `pushBookingToGoogleCalendarStub` and change the import to:

```typescript
import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
```

Update the call site from `pushBookingToGoogleCalendarStub(booking)` to `pushBookingToGoogleCalendar(booking)`.

- [ ] **Step 3: Wire into the free-confirm path**

In `app/api/bookings/route.ts`, after the `sendFreeBookingConfirmedEmail` call in the `!type.requires_payment` branch, add:

```typescript
try {
  const eventId = await pushBookingToGoogleCalendar({ ...booking, appointment_types: { name: type.name } });
  if (eventId) {
    await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", booking.id);
  }
} catch (err) {
  console.error("Google Calendar push failed (booking still confirmed):", err);
}
```

Add the import: `import { pushBookingToGoogleCalendar } from "@/lib/googleCalendar";`.

- [ ] **Step 4: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 5: Manual test**

With Google Calendar connected (Task 16): book a free test appointment type through `/book`, confirm an event titled `"<Type Name> — Test Client"` appears on the connected Google Calendar within a few seconds, and `select google_event_id from bookings where client_name = 'Test Client';` is non-null. Repeat with the paid test type through the full Stripe flow. Manually delete both test events from Google Calendar and both booking rows from Supabase afterward.

- [ ] **Step 6: Commit**

```bash
git add lib/googleCalendar.ts lib/bookingsWebhook.ts app/api/bookings/route.ts
git commit -m "Push confirmed bookings to Google Calendar"
```

---

## Task 18: Google Calendar polling cron

**Files:**
- Modify: `lib/googleCalendar.ts` (add `pullBusyBlocks`)
- Create: `app/api/cron/sync-google-calendar/route.ts`
- Create: `vercel.ts`
- Modify: `.env.example` (add `CRON_SECRET`)

**Interfaces:**
- Note: `lib/availabilityQuery.ts`'s `fetchOpenSlotsForDate` (Task 9) already reads from `google_busy_blocks_cache` — this task is only responsible for keeping that table's contents fresh.

- [ ] **Step 1: Freebusy pull function**

Append to `lib/googleCalendar.ts`:

```typescript
export async function pullBusyBlocks(): Promise<{ synced: boolean; count: number }> {
  const client = await getAuthenticatedGoogleClient();
  if (!client) return { synced: false, count: 0 };

  const calendar = google.calendar({ version: "v3", auth: client });
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + 400 * 24 * 60 * 60 * 1000).toISOString(); // ~13 months out, comfortably past any realistic max-advance-days setting

  const response = await calendar.freebusy.query({
    requestBody: { timeMin, timeMax, items: [{ id: "primary" }] },
  });
  const busy = response.data.calendars?.primary?.busy ?? [];

  const supabase = getSupabaseClient();
  // Wholesale replace, never incremental — see the spec's rationale
  // (a deleted calendar event must not leave a stale row behind).
  const { error: deleteError } = await supabase.from("google_busy_blocks_cache").delete().gte("synced_at", "1970-01-01");
  if (deleteError) throw deleteError;

  if (busy.length > 0) {
    const { error: insertError } = await supabase.from("google_busy_blocks_cache").insert(
      busy
        .filter((b): b is { start: string; end: string } => Boolean(b.start && b.end))
        .map((b) => ({ start_time: b.start, end_time: b.end })),
    );
    if (insertError) throw insertError;
  }

  await supabase.from("google_calendar_sync").update({ last_synced_at: new Date().toISOString() }).eq("id", true);

  return { synced: true, count: busy.length };
}
```

- [ ] **Step 2: Cron endpoint**

```typescript
// app/api/cron/sync-google-calendar/route.ts
import { pullBusyBlocks } from "@/lib/googleCalendar";

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized.", { status: 401 });
  }

  try {
    const result = await pullBusyBlocks();
    return Response.json(result);
  } catch (err) {
    console.error("Google Calendar sync failed:", err);
    return Response.json({ error: "Sync failed." }, { status: 500 });
  }
}
```

- [ ] **Step 3: Cron schedule config**

```typescript
// vercel.ts
import type { VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  crons: [{ path: "/api/cron/sync-google-calendar", schedule: "*/5 * * * *" }],
};
```

Run: `npm install @vercel/config`

- [ ] **Step 4: Env var**

Add to `.env.example`:

```
# Verifies Vercel Cron's request to /api/cron/sync-google-calendar — any
# random secret string; Vercel sends it as `Authorization: Bearer
# <value>` automatically for its own cron invocations once this env var
# is set in the Vercel dashboard.
CRON_SECRET=
```

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 6: Manual test**

With Google Calendar connected and a test event on the calendar during business hours tomorrow: set `CRON_SECRET` in `.env.local`, run `curl -H "Authorization: Bearer <value>" http://localhost:3000/api/cron/sync-google-calendar`, confirm `{"synced":true,"count":1}` (or however many busy blocks exist). Verify `select * from google_busy_blocks_cache;` shows the event's time range. Then check `/api/availability/slots` for that date/a type overlapping the event's time — confirm the busy time no longer appears as an open slot. Delete the test Calendar event and re-run the sync, confirm the cache clears and the slot reappears.

- [ ] **Step 7: Commit**

```bash
git add lib/googleCalendar.ts app/api/cron/sync-google-calendar vercel.ts package.json package-lock.json .env.example
git commit -m "Add Google Calendar polling cron"
```

---

## Task 19: Real-time sync via Supabase Broadcast

**Files:**
- Create: `lib/realtimeBroadcast.ts` (server-side sender, REST-based — no persistent websocket needed in a serverless function)
- Create: `lib/supabaseBrowser.ts` (browser-side anon-key client, subscribe-only)
- Modify: `app/api/bookings/route.ts` (broadcast after a booking is created/confirmed)
- Modify: `lib/bookingsWebhook.ts` (broadcast after payment confirms a booking)
- Modify: `app/api/admin/availability-overrides/route.ts` (broadcast after an override changes)
- Modify: `app/api/admin/blocked-times/route.ts` (broadcast after a block is created/deleted)
- Modify: `app/book/BookingCalendar.tsx`, `app/book/SlotList.tsx` (subscribe, refetch on message)
- Modify: `app/admin/availability/AvailabilityOverviewClient.tsx`, `app/admin/availability/DayView.tsx` (subscribe, refetch on message)
- Modify: `.env.example`

**Interfaces:**
- Produces: `broadcastAvailabilityChange(payload: {date: string})` and `broadcastBookingChange(payload: {date: string})` in `lib/realtimeBroadcast.ts`, both on a shared channel name (`"scheduling"`) that every subscriber listens to — a single channel is simpler than per-concern channels here, since the browser reaction to either event is the same ("refetch what's currently displayed").

- [ ] **Step 1: Server-side broadcast sender (REST, no websocket)**

```typescript
// lib/realtimeBroadcast.ts
// Uses Supabase Realtime's REST broadcast endpoint rather than opening a
// websocket and calling .subscribe() first — a serverless function's
// lifetime is too short to reliably keep a socket open long enough for
// a normal channel.send() to flush. REST broadcast is a single HTTP
// call, fire-and-forget, and is Supabase's documented approach for
// broadcasting from server-side/edge code.

const CHANNEL = "scheduling";

async function broadcast(event: string, payload: Record<string, unknown>): Promise<void> {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;

  const projectUrl = url.replace(/\/rest\/v1\/?$/, "");
  try {
    await fetch(`${projectUrl}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ messages: [{ topic: CHANNEL, event, payload }] }),
    });
  } catch (err) {
    // Never let a broadcast failure break the mutation that triggered
    // it — worst case, a client's view is stale until its next natural
    // refetch (e.g. changing dates).
    console.error(`Realtime broadcast (${event}) failed:`, err);
  }
}

export function broadcastAvailabilityChange(payload: { date: string }): Promise<void> {
  return broadcast("availability_changed", payload);
}

export function broadcastBookingChange(payload: { date: string }): Promise<void> {
  return broadcast("booking_changed", payload);
}
```

- [ ] **Step 2: Browser-side subscribe-only client**

```typescript
// lib/supabaseBrowser.ts
// Anon key, browser-only. This client is used exclusively for Realtime
// channel subscriptions — it is never used to query a table directly,
// and the anon key has no table grants, so it couldn't even if asked to.
"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
  }
  return client;
}

export function subscribeToSchedulingChannel(
  onMessage: (event: "availability_changed" | "booking_changed", payload: { date: string }) => void,
): () => void {
  const supabase = getSupabaseBrowserClient();
  const channel = supabase
    .channel("scheduling")
    .on("broadcast", { event: "availability_changed" }, ({ payload }) =>
      onMessage("availability_changed", payload as { date: string }),
    )
    .on("broadcast", { event: "booking_changed" }, ({ payload }) =>
      onMessage("booking_changed", payload as { date: string }),
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
```

- [ ] **Step 3: Env vars**

Add to `.env.example`:

```
# Public — safe to expose to the browser. Used only for Realtime
# Broadcast subscriptions (lib/supabaseBrowser.ts); the anon key has no
# table-level access, so this is not a service-role-key-in-disguise.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

(Both values come from the same Supabase project's Settings > API page as `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` — `NEXT_PUBLIC_SUPABASE_URL` is the same URL, `NEXT_PUBLIC_SUPABASE_ANON_KEY` is the separate "anon / public" key on that same page, not the service role key.)

- [ ] **Step 4: Wire broadcasts into mutation endpoints**

In `app/api/bookings/route.ts`: after the successful `insert` (both the free-confirm branch and right after creating the Checkout session for the paid branch — a `pending` row also removes that slot from other clients' view), call `await broadcastBookingChange({ date: payload.date });`.

In `lib/bookingsWebhook.ts`'s `handleBookingCheckoutCompleted`: after confirming, call `await broadcastBookingChange({ date: booking.start_time.slice(0, 10) });`. Also add the same call to `handleBookingCheckoutExpired` (an expired hold frees the slot back up — other clients should see it become available again).

In `app/api/admin/availability-overrides/route.ts`'s `POST`: after the upsert/delete, call `await broadcastAvailabilityChange({ date });`.

In `app/api/admin/blocked-times/route.ts`'s `POST` and `[id]/route.ts`'s `DELETE`: after the mutation, call `await broadcastAvailabilityChange({ date: payload.date })` (`POST`) or fetch the row's `date` before deleting it, then broadcast that (`DELETE`).

Import `broadcastAvailabilityChange`/`broadcastBookingChange` from `@/lib/realtimeBroadcast` in each modified file.

- [ ] **Step 5: Client-side subscriptions**

In `BookingCalendar.tsx` and `SlotList.tsx`: add a `useEffect` that calls `subscribeToSchedulingChannel` on mount, and on any message, re-runs the component's existing fetch (whichever endpoint it already calls) if the broadcast's `date` matches (for `SlotList`) or unconditionally (for `BookingCalendar`, since any change could affect which dates are open). Clean up the subscription (call the returned unsubscribe function) on unmount.

In `AvailabilityOverviewClient.tsx` and `DayView.tsx`: same pattern — subscribe on mount, refetch on any message, unsubscribe on unmount.

- [ ] **Step 6: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 7: Manual test — two-tab live sync**

Open `/book` in two separate browser tabs, both on the same open date's slot list. In the admin UI (a third tab), block off one of the visible time slots. Confirm both `/book` tabs' slot lists update within a couple seconds **without a manual refresh**. Then, in one `/book` tab, complete a free test booking — confirm the *other* `/book` tab's slot list loses that slot live, and the admin's day view (a fourth tab, or the same admin tab navigated there) shows the new booking without a refresh. Clean up all test data afterward.

- [ ] **Step 8: Commit**

```bash
git add lib/realtimeBroadcast.ts lib/supabaseBrowser.ts app/api/bookings/route.ts lib/bookingsWebhook.ts app/api/admin/availability-overrides app/api/admin/blocked-times app/book app/admin/availability .env.example
git commit -m "Add Supabase Realtime Broadcast for live admin/client sync"
```

---

## Task 20: `/manage/[token]` page

**Files:**
- Modify: `app/manage/[token]/page.tsx` (replaced wholesale)
- Create: `app/manage/[token]/ManageBooking.tsx` (replaces the old one)

**Interfaces:**
- Consumes: `bookings`/`appointment_types`/`scheduling_limits` tables. Produces the UI that Task 21 (cancel) and Task 22 (reschedule) wire their API calls into.

- [ ] **Step 1: Page — fetch booking and notice-window state**

```typescript
// app/manage/[token]/page.tsx
import type { Metadata } from "next";
import { getSupabaseClient } from "@/lib/supabase";
import ManageBooking from "./ManageBooking";

export function generateMetadata(): Metadata {
  return { title: "Manage Your Booking", robots: { index: false, follow: false } };
}

function NotFound() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Booking</p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">Not found</h1>
      <p className="mt-4 text-muted">
        This link doesn&rsquo;t match an active booking. It may already have been rescheduled or
        cancelled — contact us if you need help.
      </p>
    </div>
  );
}

function Finalizing() {
  return (
    <div className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col items-center justify-center px-6 py-24 text-center sm:px-10">
      <p className="mb-3 text-xs uppercase tracking-[0.3em] text-muted">Booking</p>
      <h1 className="font-serif text-3xl italic text-foreground sm:text-4xl">Finalizing…</h1>
      <p className="mt-4 text-muted">We&rsquo;re confirming your payment. This usually takes a few seconds — refresh in a moment.</p>
    </div>
  );
}

export default async function ManagePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*, appointment_types(name, duration_minutes)")
    .eq("booking_token", token)
    .in("status", ["confirmed", "pending"])
    .maybeSingle();

  if (error) {
    console.error("Failed to load booking for /manage:", error);
  }
  if (!booking) return <NotFound />;
  if (booking.status === "pending") return <Finalizing />;

  const { data: limits } = await supabase.from("scheduling_limits").select("cancel_reschedule_notice_hours").single();
  const noticeHours = limits?.cancel_reschedule_notice_hours ?? 24;
  const hoursUntil = (new Date(booking.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
  const withinWindow = hoursUntil >= noticeHours;

  return <ManageBooking booking={booking} withinWindow={withinWindow} />;
}
```

- [ ] **Step 2: Client component — booking details, contact fallback, or actions**

`ManageBooking.tsx` (`"use client"`): shows the appointment type name, formatted time range (`formatTimeRange`), and notes if any. If `withinWindow` is `false`, shows a message ("This booking is inside our cancellation window — please contact us directly to make changes") plus a `mailto:`/`tel:` link to the business's contact info (reuse `BUSINESS` from `lib/seo.ts`). If `withinWindow` is `true`, shows "Cancel" and "Reschedule" buttons — both stubbed as disabled/no-op in this task (Task 21 and Task 22 wire them up).

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app`

- [ ] **Step 4: Manual test**

Book a free test appointment far enough in the future to be within the notice window; visit `/manage/<its booking_token>`, confirm details display and Cancel/Reschedule buttons show. Manually set `scheduling_limits.cancel_reschedule_notice_hours` to a very large number (e.g. `100000`) temporarily, reload the same page, confirm it now shows the contact-info fallback instead. Reset the limit back to 24 afterward. Clean up the test booking.

- [ ] **Step 5: Commit**

```bash
git add app/manage
git commit -m "Rebuild /manage/[token] page for the new booking system"
```

---

## Task 21: Cancellation API

**Files:**
- Create: `app/api/manage/[token]/cancel/route.ts`
- Modify: `app/manage/[token]/ManageBooking.tsx` (wire the Cancel button)

**Interfaces:**
- Consumes: `deleteGoogleCalendarEvent` (Task 17), `broadcastBookingChange` (Task 19).

- [ ] **Step 1: Cancel route**

```typescript
// app/api/manage/[token]/cancel/route.ts
import { getSupabaseClient } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { deleteGoogleCalendarEvent } from "@/lib/googleCalendar";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = getSupabaseClient();

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("*")
    .eq("booking_token", token)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error || !booking) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }

  const { data: limits } = await supabase.from("scheduling_limits").select("cancel_reschedule_notice_hours").single();
  const noticeHours = limits?.cancel_reschedule_notice_hours ?? 24;
  const hoursUntil = (new Date(booking.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < noticeHours) {
    return Response.json({ error: "This booking is too close to cancel online — please contact us directly." }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("bookings")
    .update({ status: "canceled" })
    .eq("id", booking.id)
    .eq("status", "confirmed");
  if (updateError) {
    console.error("Cancellation update failed:", updateError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (booking.google_event_id) {
    await deleteGoogleCalendarEvent(booking.google_event_id);
  }

  if (booking.payment_intent_id) {
    try {
      const stripe = getStripeClient();
      await stripe.refunds.create({ payment_intent: booking.payment_intent_id });
    } catch (err) {
      // Cancellation always succeeds even if the refund call fails —
      // same non-negotiable rule as the previous booking system. Flagged
      // for manual follow-up via the admin day view, which shows every
      // canceled booking's payment_intent_id.
      console.error(`Refund failed for booking ${booking.id}, needs manual follow-up:`, err);
    }
  }

  await broadcastBookingChange({ date: booking.start_time.slice(0, 10) });

  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Wire the Cancel button**

In `ManageBooking.tsx`, the Cancel button `POST`s to `/api/manage/${token}/cancel`; on success, shows a "Your booking has been canceled" confirmation state in place of the details/actions.

- [ ] **Step 3: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 4: Manual test — within-window cancellation, paid booking**

Book a paid test appointment (real Stripe test-mode payment) far enough out to be within the notice window. Cancel it via `/manage/[token]`. Confirm: `bookings.status = 'canceled'`, the Google Calendar event is gone (if Calendar is connected), and in the Stripe Dashboard (test mode > Payments) the charge shows refunded.

- [ ] **Step 5: Manual test — outside-window blocked**

Temporarily set `cancel_reschedule_notice_hours` very high again, confirm `POST .../cancel` on an otherwise-cancelable booking returns 403. Reset the limit afterward.

- [ ] **Step 6: Clean up test data**

```sql
delete from bookings where client_name = 'Test Client';
```

- [ ] **Step 7: Commit**

```bash
git add app/api/manage app/manage/[token]/ManageBooking.tsx
git commit -m "Add cancellation API with notice-window gate and full refund"
```

---

## Task 22: Reschedule API

**Files:**
- Modify: `supabase/schema.sql` (add the `reschedule_booking` RPC function)
- Modify: `lib/email.ts` (add `sendBookingRescheduledEmail`)
- Create: `app/api/manage/[token]/reschedule/route.ts`
- Modify: `app/manage/[token]/ManageBooking.tsx` (wire the Reschedule button — reuses `BookingCalendar`/`SlotList` from Task 10 to pick a new time)

**Interfaces:**
- Produces: `reschedule_booking(p_booking_token, p_new_start, p_new_end)` Postgres function — the RPC-based atomic cancel-old-insert-new described in Global Constraints.

- [ ] **Step 1: RPC function**

Append to `supabase/schema.sql`:

```sql
-- Atomic reschedule: cancels the current confirmed booking and inserts a
-- replacement in one transaction. If the new insert violates the
-- exclusion constraint (someone else just took that time), the whole
-- transaction — including the cancellation — rolls back, so the client
-- never ends up with neither booking.
create or replace function reschedule_booking(
  p_booking_token uuid,
  p_new_start timestamptz,
  p_new_end timestamptz
) returns bookings
language plpgsql
as $$
declare
  v_old bookings;
  v_new bookings;
begin
  select * into v_old from bookings
    where booking_token = p_booking_token and status = 'confirmed'
    for update;

  if not found then
    raise exception 'booking_not_found_or_not_confirmed';
  end if;

  update bookings set status = 'canceled' where id = v_old.id;

  insert into bookings (
    appointment_type_id, client_name, client_email, client_phone,
    start_time, end_time, status, notes, booking_token,
    payment_intent_id, amount_paid_cents
  ) values (
    v_old.appointment_type_id, v_old.client_name, v_old.client_email, v_old.client_phone,
    p_new_start, p_new_end, 'confirmed', v_old.notes, v_old.booking_token,
    v_old.payment_intent_id, v_old.amount_paid_cents
  ) returning * into v_new;

  return v_new;
end;
$$;
```

Apply via the Supabase SQL Editor; verify with `select proname from pg_proc where proname = 'reschedule_booking';` returning one row.

- [ ] **Step 2: Reschedule confirmation email**

Append to `lib/email.ts` (same shape as `sendFreeBookingConfirmedEmail` from Task 14, different subject/copy):

```typescript
export async function sendBookingRescheduledEmail(
  booking: BookingForEmail,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not set." };

  const when = formatTimeRange(booking.start_time, booking.end_time);
  const typeName = appointmentTypeName(booking);
  const manageUrl = `${SITE_URL}/manage/${booking.booking_token}`;
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [booking.client_email],
      subject: "Your appointment has been rescheduled",
      text: [
        `Hi ${booking.client_name},`,
        "",
        `Your ${typeName} appointment is now scheduled for ${when}.`,
        "",
        "Need to make another change? Use your private booking link:",
        manageUrl,
        "",
        "See you then,",
        BUSINESS.name,
      ].join("\n"),
      html: `
        <p>Hi ${escapeHtml(booking.client_name)},</p>
        <p>Your ${escapeHtml(typeName)} appointment is now scheduled for ${escapeHtml(when)}.</p>
        <p>Need to make another change? Use your private booking link:</p>
        <p><a href="${manageUrl}">${manageUrl}</a></p>
        <p>See you then,<br />${escapeHtml(BUSINESS.name)}</p>
      `,
    });
    if (error) return { ok: false, error: error.message ?? "Resend error." };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown error." };
  }
}
```

- [ ] **Step 3: Reschedule route**

```typescript
// app/api/manage/[token]/reschedule/route.ts
import { getSupabaseClient } from "@/lib/supabase";
import { fetchOpenSlotsForDate } from "@/lib/availabilityQuery";
import { deleteGoogleCalendarEvent, pushBookingToGoogleCalendar } from "@/lib/googleCalendar";
import { sendBookingRescheduledEmail } from "@/lib/email";
import { broadcastBookingChange } from "@/lib/realtimeBroadcast";

type Payload = { date: string; startTime: string };

function parsePayload(body: unknown): Payload | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (
    typeof b.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.date) ||
    typeof b.startTime !== "string"
  ) {
    return null;
  }
  return { date: b.date, startTime: b.startTime };
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = parsePayload(await request.json().catch(() => null));
  if (!payload) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const supabase = getSupabaseClient();
  const { data: current, error } = await supabase
    .from("bookings")
    .select("*, appointment_types(name, duration_minutes, buffer_before_minutes, buffer_after_minutes, price_cents, requires_payment, color)")
    .eq("booking_token", token)
    .eq("status", "confirmed")
    .maybeSingle();

  if (error || !current) {
    return Response.json({ error: "Booking not found." }, { status: 404 });
  }

  const { data: limits } = await supabase.from("scheduling_limits").select("cancel_reschedule_notice_hours").single();
  const noticeHours = limits?.cancel_reschedule_notice_hours ?? 24;
  const hoursUntil = (new Date(current.start_time).getTime() - Date.now()) / (1000 * 60 * 60);
  if (hoursUntil < noticeHours) {
    return Response.json({ error: "This booking is too close to reschedule online — please contact us directly." }, { status: 403 });
  }

  const type = Array.isArray(current.appointment_types) ? current.appointment_types[0] : current.appointment_types;
  const openSlots = await fetchOpenSlotsForDate({ date: payload.date, appointmentType: { ...type, id: current.appointment_type_id } });
  if (!openSlots.some((s) => s.startTime === payload.startTime)) {
    return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
  }

  const startIso = combineDateTimeInBusinessTz(payload.date, payload.startTime);
  const endIso = combineDateTimeInBusinessTz(
    payload.date,
    addMinutes(payload.startTime, type.duration_minutes),
  );

  const { data: newBooking, error: rpcError } = await supabase.rpc("reschedule_booking", {
    p_booking_token: token,
    p_new_start: startIso,
    p_new_end: endIso,
  });

  if (rpcError) {
    if (rpcError.code === "23P01") {
      return Response.json({ error: "That time is no longer available. Please pick another." }, { status: 409 });
    }
    console.error("reschedule_booking RPC failed:", rpcError);
    return Response.json({ error: "Something went wrong." }, { status: 500 });
  }

  if (current.google_event_id) {
    await deleteGoogleCalendarEvent(current.google_event_id);
  }
  try {
    const eventId = await pushBookingToGoogleCalendar({ ...newBooking, appointment_types: type });
    if (eventId) {
      await supabase.from("bookings").update({ google_event_id: eventId }).eq("id", newBooking.id);
    }
  } catch (err) {
    console.error("Google Calendar push failed after reschedule:", err);
  }

  try {
    await sendBookingRescheduledEmail({ ...newBooking, appointment_types: type });
  } catch (err) {
    console.error("Reschedule confirmation email failed:", err);
  }

  await broadcastBookingChange({ date: current.start_time.slice(0, 10) });
  await broadcastBookingChange({ date: payload.date });

  return Response.json({ ok: true });
}

// Same conversion helper as app/api/bookings/route.ts — duplicated
// rather than shared to avoid a premature cross-route dependency for
// two call sites; extract to lib/scheduling.ts if a third appears.
function combineDateTimeInBusinessTz(date: string, time: string): string {
  const naive = new Date(`${date}T${time}:00`);
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(naive).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return new Date(naive.getTime() - (asUtc - naive.getTime())).toISOString();
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = time.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
```

- [ ] **Step 4: Wire the Reschedule button**

In `ManageBooking.tsx`, clicking "Reschedule" reveals `BookingCalendar` + `SlotList` (Task 10's components, reused here filtered to the booking's existing `appointment_type_id` — no type picker, since reschedule stays within the same type per Global Constraints), and picking a new slot `POST`s to `/api/manage/${token}/reschedule` with `{date, startTime}`. On success, reload the page (the token is unchanged, so `/manage/[token]` now shows the new time).

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib`

- [ ] **Step 6: Manual test — successful reschedule**

Book a free test appointment within the notice window. Reschedule it to a different open slot via `/manage/[token]`. Confirm: the old `bookings` row is `canceled`, a new row exists with the same `booking_token` and `status = 'confirmed'`, the Google Calendar event moved (old one gone, new one at the new time, if Calendar is connected), and a reschedule email arrived.

- [ ] **Step 7: Manual test — race safety**

With two terminal windows: hold a slot open by starting (but not finishing) one reschedule request against it in a debugger/breakpoint if convenient, or more simply, fire two `curl` reschedule requests at the exact same target slot back-to-back and confirm exactly one succeeds with `200` and the other gets `409`, with the losing request's original booking still intact (`select status from bookings where booking_token = '<token>';` shows exactly one `confirmed` row throughout).

- [ ] **Step 8: Clean up test data**

```sql
delete from bookings where client_name = 'Test Client';
```

- [ ] **Step 9: Commit**

```bash
git add supabase/schema.sql lib/email.ts app/api/manage app/manage/[token]/ManageBooking.tsx
git commit -m "Add reschedule API with atomic cancel-and-insert"
```

---

## Task 23: `.env.example` completeness audit

**Files:**
- Modify: `.env.example`

**Interfaces:** none — this is a verification/documentation task, not new functionality.

- [ ] **Step 1: Audit against every env var introduced in Tasks 1-22**

Confirm `.env.example` has an entry (with a comment explaining where to get the value, matching the file's existing style) for each of: `STRIPE_WEBHOOK_SECRET_BOOKINGS` (Task 13), `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI` (Task 16), `CRON_SECRET` (Task 18), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Task 19). Each was already added incrementally in its own task — this step is a final read-through of the whole file to catch anything missed, not a first-time addition.

- [ ] **Step 2: Confirm every var also exists in Vercel**

Run: `npx vercel env ls production` and cross-check against the list above — anything in `.env.local` but missing from Vercel Production will work locally and silently fail in production. Add any missing ones: `npx vercel env add <NAME> production` (piping the value in via stdin, never typing it into a command argument — same discipline as the original Stripe setup).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "Audit .env.example for completeness against the new booking system"
```

---

## Task 24: Full regression pass and production verification

**Files:** none — this task is entirely verification, no code changes expected (fix forward in this same task if something's actually broken; don't defer fixes to a later task).

- [ ] **Step 1: Local regression — every flow, back to back**

In the worktree's local dev server, run through, in order, cleaning up test data between each: appointment type CRUD, weekly hours template, per-date override (including "mark closed"), blocked time (create + delete), scheduling limits (each field), free booking end-to-end, paid booking end-to-end (Stripe test mode), abandoned checkout expiry, sweep-pending CLI, Google Calendar connect, booking push to Calendar, Calendar busy-block pull blocking a slot, real-time two-tab sync (admin edit → client updates; client books → other client and admin update), cancellation (within window, refund issued, Calendar event removed) and (outside window, blocked), reschedule (within window, success) and (outside window, blocked), reschedule race-safety.

- [ ] **Step 2: Type-check and lint the whole project**

Run: `npx tsc --noEmit && npx eslint app lib components scripts`

- [ ] **Step 3: Deploy the worktree branch to a Vercel preview**

Push the branch, let Vercel build a preview deployment (or run `npx vercel deploy` for an explicit preview URL). Confirm the build succeeds — this is the first time the new system's code has actually been built for production, and it needs its own Google OAuth redirect URI variant for the preview URL (add the preview URL's callback to the Google Cloud Console's authorized redirect URIs, and set `GOOGLE_OAUTH_REDIRECT_URI` in Vercel's Preview environment accordingly) plus all the same env vars as Task 23 set for Production, set for Preview too.

- [ ] **Step 4: Live verification on the preview deployment**

Repeat the core flows from Step 1 against the real preview URL: one real Google Calendar OAuth connection (using the actual personal Google account), one real Stripe test-mode payment through the full booking flow, one real cancellation with refund, one real reschedule, confirm the cron endpoint works when curled directly (Vercel Cron itself won't fire against a preview deployment, but the endpoint logic is what's under test here, not Vercel's scheduler). Clean up all test data from the production Supabase database afterward — this preview deployment points at the same real database as production.

- [ ] **Step 5: Fix forward**

Any bug found in Steps 1-4 is fixed directly in this task, in the same worktree, before moving to Task 25 — this task isn't complete until every flow above passes cleanly.

- [ ] **Step 6: Commit any fixes**

```bash
git add -A
git commit -m "Fix issues found during full regression pass"
```

(Skip this step if Steps 1-4 found nothing to fix.)

---

## Task 25: Cutover — retire the old booking system, go live

**Files:**
- Delete: old `booking_slots`-era files no longer referenced — `lib/booking.ts`, `lib/bookingWebhooks.ts`, `app/api/webhooks/stripe/route.ts` (the *old* deposit/reschedule-fee webhook — the new one is `app/api/webhooks/stripe-bookings/route.ts` and stays), `app/api/book/route.ts`, `app/api/manage/[token]/reschedule/route.ts` and `.../cancel/route.ts` if they still exist under the old implementation (they were already replaced in Tasks 21-22, so this is a check, not necessarily a new deletion), `scripts/bookings.mjs`, the `bookings:sweep-pending` npm script (superseded by `scheduling:sweep-pending`)
- Modify: `supabase/schema.sql` (drop `booking_slots`)
- Modify: `.env.example` (remove `STRIPE_WEBHOOK_SECRET` if nothing else references it — check first; if the old webhook route is deleted in this task, the old secret is no longer needed)
- Modify: Stripe Dashboard (delete the old test-mode and live-mode webhook endpoints pointing at `/api/webhooks/stripe`)

**Interfaces:** none — this task only removes things, using every interface built in Tasks 1-24 as-is.

- [ ] **Step 1: Confirm nothing still depends on the old system**

```bash
grep -rn "booking_slots\|bookingWebhooks\|lib/booking\"" app lib scripts --include="*.ts" --include="*.tsx" --include="*.mjs"
```

Every remaining hit should be inside the files this task is about to delete, not in anything staying. If something unexpected references the old system, stop and investigate before deleting anything.

- [ ] **Step 2: Delete old files**

```bash
git rm lib/booking.ts lib/bookingWebhooks.ts app/api/webhooks/stripe/route.ts app/api/book/route.ts scripts/bookings.mjs
```

Remove the `"bookings:sweep-pending"` line from `package.json`'s `scripts`.

- [ ] **Step 3: Drop the old table**

Append to `supabase/schema.sql` (this file is an append-only migration log, matching how every prior change in this codebase was made — don't rewrite history, add a new statement):

```sql
drop table if exists booking_slots;
```

Apply via the Supabase SQL Editor **only after** confirming (Step 1) nothing reads from it anymore and Task 24's regression pass is clean. Verify: `select table_name from information_schema.tables where table_name = 'booking_slots';` returns zero rows.

- [ ] **Step 4: Clean up Stripe**

In the Stripe Dashboard (both test mode and live mode), delete the webhook endpoint pointing at `/api/webhooks/stripe` (the old one) — the new one at `/api/webhooks/stripe-bookings` stays. Remove `STRIPE_WEBHOOK_SECRET` from `.env.example`, `.env.local`, and Vercel (Production and Preview) if Step 2 removed its only consumer.

- [ ] **Step 5: Type-check and lint**

Run: `npx tsc --noEmit && npx eslint app lib components scripts`

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Cut over: retire the old booking_slots system entirely"
```

- [ ] **Step 7: Follow `superpowers:finishing-a-development-branch`**

Merge, push, and deploy to production per that skill's menu — same integration flow used for the previous booking-deposits work. Set every env var from Task 23 in Vercel Production (not just Preview) before or immediately after deploying, and add the production Google OAuth redirect URI to the Google Cloud Console's authorized redirect URIs list.

- [ ] **Step 8: One real production booking, start to finish**

After deploying: one real live-mode booking through `zkjfilms.com/book` (matching the depth of verification the original Stripe deposit system got) — real payment (small test amount if the appointment type used has a low price, or use a $1 test appointment type created and archived just for this), confirm the webhook fires in production, the Google Calendar event appears on the real connected calendar, the confirmation email arrives, and the `/manage/[token]` link works. Refund the payment and delete the test booking/Calendar event afterward.

---
