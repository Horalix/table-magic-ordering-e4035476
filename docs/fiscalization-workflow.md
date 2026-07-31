# Fiscalization workflow (Bosnia and Herzegovina)

## The honest position first

**This application is not a certified fiscal device and does not issue fiscal
receipts.** It does not communicate with any fiscal authority, it does not hold
a fiscal certificate, and nothing in it should be presented to an inspector as a
fiscal system.

What it does is keep an accurate, auditable record of what was ordered and what
was paid, and track — per order — whether that order has been rung into the
restaurant's **certified fiscal POS**. That is a reconciliation aid, not
compliance.

**Anything below concerning legal obligation must be confirmed by the
restaurant's accountant and the approved fiscal provider.** This repository does
not state what BiH law requires; it provides the workflow and the fields to
record whatever the accountant determines is required.

---

## The operational loop

```
Guest orders in the app
  → order released to the kitchen
  → guest pays (online card, cash, or the physical POS terminal)
  → STAFF rings the sale into the certified fiscal POS
  → staff records the fiscal receipt number back in the app
  → management reconciles app totals against fiscal totals at close
```

The app never skips the third step and never pretends to have performed it.

---

## Data model

`orders` carries:

| Column | Meaning |
|---|---|
| `fiscalization_status` | `not_fiscalized` · `fiscalized` · `failed` |
| `fiscalized_at` | When it was recorded |
| `fiscalized_by` | Which staff user recorded it (`auth.users`) |
| `fiscal_receipt_number` | The receipt number from the certified device |
| `fiscal_provider_reference` | Any provider-side identifier |
| `fiscalization_error` | Why it failed, when it did |
| `fiscalized` | Legacy boolean, kept in sync for older reports |

Written only through `set_order_fiscalization(...)`, which is staff-only,
validates the status, and writes an `audit_log` row. A direct `UPDATE` to any of
these columns is rejected by the integrity trigger.

### The four states that matter operationally

| Situation | `payment_status` | `fiscalization_status` | What it means |
|---|---|---|---|
| Normal | `paid` | `fiscalized` | Done. Nothing to chase. |
| Not yet rung in | `paid` | `not_fiscalized` | **Money taken, no fiscal receipt.** The queue to clear before close. |
| Served, not settled | `unpaid` | `not_fiscalized` | Guest still at the table. Normal mid-service. |
| Device problem | `paid` | `failed` | The fiscal device rejected it. Escalate; do not close the day. |

---

## Daily procedure

**During service.** Staff ring each settled order into the fiscal POS as they
normally would. Nothing about the fiscal device changes.

**Recording it.** In **Admin → Orders**, tap **Mark fiscalized** on the order.
Where the receipt number is available, enter it — it is what makes a later
reconciliation possible rather than a guess.

**At close.** Open **Admin → Daily Report**:

- The three settlement channels are shown separately — card online, cash, POS
  terminal — because they reconcile against three different places.
- "Needs attention before close" lists money still owed, payments that started
  and never resolved, and any rejected provider callbacks.
- Any order not marked fiscalized is flagged with its value.

Compare:

| App figure | Compare against |
|---|---|
| `paid_cash` | Cash drawer count |
| `paid_pos_terminal` | POS terminal batch report |
| `paid_online` | Monri settlement report |
| `gross − refunded` | Total of fiscal receipts issued |

A discrepancy is never hidden or auto-corrected. Investigate it, then record a
note.

---

## Queries

```sql
-- Everything paid today but not yet rung into the fiscal POS.
SELECT order_code, total, payment_method, paid_at
  FROM public.completed_orders
 WHERE payment_status = 'paid'
   AND fiscalization_status <> 'fiscalized'
   AND created_at >= CURRENT_DATE
 ORDER BY paid_at;

-- Anything the fiscal device rejected.
SELECT order_code, total, fiscalization_error, fiscalized_at
  FROM public.orders
 WHERE fiscalization_status = 'failed'
 ORDER BY created_at DESC;

-- The whole day in one row.
SELECT public.day_reconciliation(CURRENT_DATE);
```

---

## If integration with a fiscal provider is ever added

The shape is already there. An integration would:

1. Call the provider from an **Edge Function**, never the browser — fiscal
   credentials must not reach a client.
2. On success, call `set_order_fiscalization(order_id, 'fiscalized',
   receipt_number, provider_reference)`.
3. On failure, call it with `'failed'` and the error, so the order surfaces in
   the queue instead of disappearing.
4. Be idempotent per order — the same protection the payment callback has, for
   the same reason.
5. Never block the kitchen. Fiscalization is about the receipt, not the food; an
   outage must not stop service.

Until an approved provider and a certificate exist, that function is not
written, and this document does not pretend otherwise.

---

## What still requires external confirmation

- Whether the current POS-plus-app workflow satisfies the restaurant's fiscal
  obligations — **accountant**.
- Which receipt identifier must be retained, and for how long — **accountant**.
- Whether a direct fiscal integration is required or merely convenient —
  **approved fiscal provider**.
- How online card payments (once live) must appear on a fiscal receipt —
  **accountant and provider together**.
