# Cross-Site Linking (zkjfilms.com ↔ latenightlistening.com ↔ thegccstudio.com) — Design

**Goal:** Link zkjfilms.com to Late Night Listening (a recurring ambient/drone listening event series) and to GCC Studio (the physical studio space brand, at the same address already in the footer), without either becoming the predominant focus of this site. A companion spec in the `late-night-listening` repo (`docs/superpowers/specs/2026-08-26-cross-site-linking-and-events-page-design.md`) covers the reciprocal side.

## Why this shape

Three distinct brands are involved, confirmed with the site owner before design:

- **zkjfilms.com** (this repo) — Zach's personal photography/film/podcast brand. The richest, most-trafficked site of the three.
- **GCC Studio** (`thegccstudio.com`) — the physical studio-space brand. Live today, **out of scope to edit** — link target only.
- **Late Night Listening** (`latenightlistening.com`) — a recurring event series hosted at GCC Studio.

The owner chose an asymmetric link structure: zkjfilms.com gets an explicit nav item for Late Night Listening (since this is the higher-traffic, more content-rich site doing the cross-promotion), while Late Night Listening's own nav stays single-purpose (no reciprocal nav item — see its spec). Both sites get a footer mention of each other, plus contextual mentions where genuinely relevant (the Music service page here).

The studio address already lives in this site's footer (`2101 W Broadway Ave, Suite 208` — GCC Studio's address) but currently only links to Google Maps directions. This design adds an explicit link to the GCC Studio site alongside it, since that's the natural, already-existing place a visitor would look for "what is this space."

## New constants (`lib/seo.ts`)

```ts
export const LATE_NIGHT_LISTENING_URL = "https://latenightlistening.com";
export const GCC_STUDIO_URL = "https://www.thegccstudio.com";
```

Added near the existing `SITE_URL`/`SOCIALS` constants. Not added to `BUSINESS.sameAs` — `sameAs` is schema.org's mechanism for *the same entity's* other profiles (its social accounts), and Late Night Listening / GCC Studio are distinct brands, not other profiles of Zach K. Johnson. Mixing them in would misrepresent the structured data.

## Navbar (`components/Navbar.tsx`)

Add a new entry to the `links` array (`:7-15`):

```ts
{ href: LATE_NIGHT_LISTENING_URL, label: "Events" },
```

Placed after `"Contact"`, before nothing (last item), or after `"Podcast"` — owner's call on exact position at implementation time; functionally it doesn't matter since `next/link`'s `<Link>` renders a plain external anchor for an absolute `https://` href automatically (no prefetch, no client-side routing attempted) — no special-casing needed alongside the existing `/photos` dropdown check, since the check is keyed on `link.href !== "/photos"`. Same-tab navigation (no `target="_blank"`) — this is a primary nav destination in the shared ecosystem, not an aside.

`HERO_ROUTES` and `usePathname()`-based active-state logic are unaffected — both are scoped to internal routes only.

## Footer (`components/Footer.tsx`)

Two additions:

1. **GCC Studio link**, next to the existing studio-address block (`:70-96`). Add a distinct link line *above* the address (not merged into the address's existing Google Maps link, to avoid two different destinations on one piece of text):

   ```tsx
   <a
     href={GCC_STUDIO_URL}
     target="_blank"
     rel="noopener noreferrer"
     className="block text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
   >
     GCC Studio
   </a>
   ```

   The existing Google Maps address link stays exactly as-is below it.

2. **Late Night Listening mention**, added to the third column (Studio Hours / Booking, `:98-121`) as a small new subsection, matching the existing label/link pattern:

   ```tsx
   <p className="mt-6 text-xs uppercase tracking-[0.3em] text-muted">Also</p>
   <a
     href={LATE_NIGHT_LISTENING_URL}
     target="_blank"
     rel="noopener noreferrer"
     className="mt-3 inline-block text-sm text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-accent"
   >
     Late Night Listening — ambient events at the studio
   </a>
   ```

Both new footer links use `target="_blank" rel="noopener noreferrer"`, matching the existing `SOCIAL_LINKS` pattern (`:34-44`) — these are secondary/aside mentions, unlike the nav item.

## Contextual link: Music service page

`ServiceLandingPage` renders `service.description` as plain text (`components/ServiceLandingPage.tsx:53`) — there's no rich-text/HTML rendering today, so a link can't be embedded inline in existing copy without a template change. Rather than force a plain-text-only mention (which wouldn't actually be clickable, undercutting the point), add one small, optional field to the `Service` type:

```ts
// lib/services.ts
export type Service = {
  // ...existing fields
  relatedLink?: { label: string; href: string };
};
```

Rendered conditionally in `ServiceLandingPage.tsx`, directly under the description block, only when present:

```tsx
{service.relatedLink && (
  <a
    href={service.relatedLink.href}
    target="_blank"
    rel="noopener noreferrer"
    className="mt-2 inline-block text-sm text-muted underline decoration-border underline-offset-4 transition-colors hover:text-accent"
  >
    {service.relatedLink.label}
  </a>
)}
```

`MUSIC_SERVICE` (`lib/services.ts:162-176`) sets it:

```ts
relatedLink: {
  label: "See it in action → Late Night Listening",
  href: LATE_NIGHT_LISTENING_URL,
},
```

No other service (`HEADSHOTS_SERVICE`, `CREATIVE_PORTRAITS_SERVICE`, `BOUDOIR_SERVICE`) sets this field — it's optional and unused by them, not a forced addition across all four.

## Out of scope

- **Editing thegccstudio.com** — not this repo's codebase. Recommended follow-up for the owner: get GCC Studio's own site linking back to both zkjfilms.com and latenightlistening.com, since it's the shared venue hub all three brands point toward. Not actionable here.
- **schema.org Event markup** for Late Night Listening sessions (would enable Google Events rich results) — a real SEO opportunity surfaced during this design, but nontrivial (per-session `Event` JSON-LD, `location` referencing GCC Studio's address) and belongs in the `late-night-listening` repo, not here. Worth a follow-up spec if the owner wants it.
- **Adding LNL/GCC to `BUSINESS.sameAs`** — explicitly rejected above; flagging again here so it isn't done later under a generic "add more SEO links" impulse.
- Any change to Headshots/Creative Portraits/Boudoir copy or the `Service` type's required fields.
- Measuring cross-site traffic (e.g., checking referrer data in each site's existing Vercel Analytics) — both sites already have Analytics installed; no code change needed to *start* measuring, so there's nothing to build, just something the owner can look at later.

## Testing

No automated test suite in this repo. Verification: `tsc --noEmit`, `npm run lint`, `npm run build`; manually confirm the new "Events" nav link appears on desktop and mobile menus and opens Late Night Listening in the same tab; confirm both new footer links open in a new tab with correct `rel`; confirm the Music page's new "See it in action" link renders and the other three service pages are unaffected (no `relatedLink` block appears for them).
