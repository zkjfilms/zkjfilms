# Generate + One-Time Use Shortcuts for Discount Codes

## Context

Creating a discount code today means typing a code string by hand and, if it's meant for single use, remembering to also set the usage limit to 1 in a separate field (`app/admin/discount-codes/DiscountCodeForm.tsx`). This adds two small, independent shortcuts to that same form to make minting a one-off code (e.g. handing a specific client a single-use voucher) faster, without changing the underlying discount-codes feature (schema, API, redemption enforcement) at all.

## 1. "Generate" button (random code string)

A button next to the Code input, client-side only, no server round-trip:

- Generates an 8-character code from the charset `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uppercase letters and digits, excluding `0`/`O`, `1`/`I`/`L` — characters easily confused when read aloud or handwritten). 32 possible characters × 8 positions ≈ 40 bits of entropy, comfortably collision-safe for this volume.
- Uses `crypto.getRandomValues` (available in all browsers this app targets) to pick each character, not `Math.random`.
- Fills the Code field with the result. Clicking again re-rolls and replaces it. The admin can still edit the result by hand, or ignore the button entirely and type their own code.
- No pre-submit uniqueness check is added — the existing `409 "That code already exists."` response (from the unique constraint on `discount_codes.code`) already handles the astronomically rare collision case; the admin just clicks Generate again.

## 2. "One-time use" checkbox

A checkbox near the Usage limit field:

- When checked, fills the Usage limit field with `1`.
- It's a one-time prefill, not a locked mode: unchecking it or editing the number afterward behaves exactly like editing that field normally today. No new form state, no new validation path — it sets the same `maxRedemptions` string state the input already reads from.
- Independent of the Generate button: a random code can stay multi-use, and a hand-typed code can be marked one-time. Neither control affects the other.

## 3. What doesn't change

- Both additions live in `DiscountCodeForm.tsx`, the single component already used for both create and edit — no new files, no new API routes, no schema changes.
- Discount type, value, expiration, and appointment-type restrictions are still entirely admin-chosen, same as today.
- The actual single-use *enforcement* already exists and is unaffected: `max_redemptions: 1` combined with the atomic `increment_discount_code_redemption` RPC's conditional update already guarantees a code can't be over-redeemed, regardless of whether its value of `1` was typed by hand or filled in by this checkbox.

## Testing

No test framework in this codebase. Verification is `tsc`/`eslint` plus a manual check in the browser: click Generate a few times and confirm the code field fills with readable 8-character strings using only the allowed charset; check "One-time use" and confirm the Usage limit field shows `1`; submit a generated one-time code and confirm it saves and displays correctly in the list (`1/1 used` behavior already works, unchanged). No live-database logic changes, so no Supabase-side verification is needed beyond the existing create-code flow already being exercised.
