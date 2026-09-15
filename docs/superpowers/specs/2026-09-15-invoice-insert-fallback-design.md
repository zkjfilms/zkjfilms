# Invoice Local-Save Fallback Design

## Problem

`POST /api/admin/invoices` creates a real, finalized Stripe invoice before it ever
attempts to save a matching row locally. If that local insert fails — for any
reason, including schema drift, where deployed code references a column a pending
migration hasn't created yet, exactly what happened live earlier today — the
handler logs the failure and returns a `500`, with nothing else done. The Stripe
invoice is real and billable, but has no local `invoices` row, so the admin's
Void/Resend buttons (which operate on local records) can't reach it. The only
recovery path is voiding it by hand in the Stripe Dashboard.

## Goal

When the full-row insert fails, attempt one fallback insert containing only the
columns that have existed since this table's original schema, before giving up.
If that succeeds, the invoice is fully manageable from the admin UI — just
missing whichever newer optional column caused the original failure.

## Non-goals

- A generic "retry with progressively fewer columns" mechanism. Only one column
  (`session_date_time`) is optional today; building for columns that don't exist
  yet is speculative. Extend this narrow mechanism if the situation recurs.
- Any change to what gets sent to Stripe. `createInvoice()` and its `custom_fields`
  payload are unaffected — by the time either local insert runs, the Stripe
  invoice is already finalized. A degraded local row never means degraded
  client-facing invoice content.
- A manual admin recovery tool for invoices that fall through even the fallback,
  or for the one Stripe-only invoice already voided by hand earlier today. Out of
  scope for this fix; the existing "500, void manually in Stripe" path remains
  the last resort.

## Design

In `app/api/admin/invoices/route.ts`'s `POST` handler, the current single insert:

```ts
const { data: invoice, error: insertError } = await supabase
  .from("invoices")
  .insert({
    client_name: payload.clientName,
    client_email: payload.clientEmail,
    booking_id: payload.bookingId,
    stripe_invoice_id: created.stripeInvoiceId,
    stripe_customer_id: created.stripeCustomerId,
    status: "open",
    due_date: payload.dueDate,
    hosted_invoice_url: created.hostedInvoiceUrl,
    session_date_time: payload.sessionDateTime,
  })
  .select()
  .single();

if (insertError) {
  console.error("invoices insert failed (Stripe invoice already created):", insertError);
  return Response.json({ error: "Invoice created in Stripe but failed to save locally." }, { status: 500 });
}
```

becomes a full attempt, and on failure, one fallback attempt omitting
`session_date_time`:

```ts
const fullRow = {
  client_name: payload.clientName,
  client_email: payload.clientEmail,
  booking_id: payload.bookingId,
  stripe_invoice_id: created.stripeInvoiceId,
  stripe_customer_id: created.stripeCustomerId,
  status: "open" as const,
  due_date: payload.dueDate,
  hosted_invoice_url: created.hostedInvoiceUrl,
  session_date_time: payload.sessionDateTime,
};

let { data: invoice, error: insertError } = await supabase
  .from("invoices")
  .insert(fullRow)
  .select()
  .single();

if (insertError) {
  console.error("invoices insert failed for full row, retrying with core columns only:", insertError);
  const { session_date_time: _sessionDateTime, ...coreRow } = fullRow;
  const fallback = await supabase.from("invoices").insert(coreRow).select().single();
  invoice = fallback.data;
  insertError = fallback.error;
  if (invoice) {
    console.warn("Invoice saved with a degraded row (session_date_time dropped):", created.stripeInvoiceId);
  }
}

if (insertError) {
  console.error("invoices insert failed (Stripe invoice already created):", insertError);
  return Response.json({ error: "Invoice created in Stripe but failed to save locally." }, { status: 500 });
}
```

Everything after this point (`invoice_line_items` insert, `sendInvoiceEmail`,
the `201` response) is unchanged — it already only depends on `invoice.id` and
the fields it already uses, all of which exist on both the full and fallback
rows.

### Response contract

Unchanged. A successful fallback still returns `201 { invoice }`, identical in
shape to today's success response — the client (`InvoiceForm.tsx`) doesn't need
to know or care which insert path was taken. The degraded state is discoverable
via the `console.warn` line in server logs, and visibly via the admin list simply
not showing a session date/time line for that invoice (the existing
`{invoice.session_date_time && (...)}` conditional in `InvoiceList.tsx` already
handles a `null` value with no code changes needed there).

### Testing

Same constraints as the rest of this feature: `tsc`/`build`/`lint`, plus a curl
check of the unauthenticated path. The success-path behavior (both the normal
full insert and the fallback triggering) depends on a live Supabase connection
and can't be meaningfully exercised without one — note this the same way prior
tasks this session have, rather than treating its absence as a gap.
