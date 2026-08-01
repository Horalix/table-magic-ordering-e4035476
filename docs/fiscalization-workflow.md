# Fiscalization workflow — Sarajevo (Federation of Bosnia and Herzegovina)

## Read this part first

**This application is not a certified fiscal device.** It does not issue fiscal
receipts, it holds no fiscal memory, it is not registered with the Tax
Administration, and it must never be shown to an inspector as a fiscal system.

What it is: an ordering and payment record that tracks, per order, whether that
sale has been rung into the restaurant's **certified fiscal device**, and stores
the resulting **receipt number** so the day can be reconciled.

**I am not your accountant and this document is not legal advice.** Sarajevo is
in the Federation of BiH, whose fiscalization regime is set by the Federal
fiscal-systems legislation and administered by the **Porezna uprava FBiH**, and
which requires sales to be recorded through a **certified fiscal device supplied
by an authorised distributor**. The specifics — which device, which reports,
what must be retained and for how long, and how an online card payment must
appear on a fiscal receipt — must be confirmed in writing by:

- the restaurant's **accountant (knjigovođa)**, and
- the **authorised fiscal-system distributor** who supplied the device.

Everything below is the operational workflow this app supports. Where it touches
a legal obligation it says so and points at the person who must confirm it.

> **Note on the wider country:** Republika Srpska operates a separate fiscal
> regime, and the Brčko District a third. La Soul is in Sarajevo, so the FBiH
> regime applies. If a second location ever opens outside the Federation, this
> document does not transfer.

---

## The loop

```
Guest orders in the app
  → order released to the kitchen
  → guest pays (cash, the physical POS terminal, or — later — online card)
  → STAFF ring the sale into the certified fiscal device
  → staff record the fiscal receipt number back in the app
  → management reconcile app totals against the device's daily report
```

The app never skips step four and never pretends to have performed it.

---

## What the app stores

On `orders`:

| Column | Meaning |
|---|---|
| `fiscalization_status` | `not_fiscalized` · `fiscalized` · `failed` |
| `fiscal_receipt_number` | **The receipt number from the certified device.** This is the field that makes reconciliation possible rather than a guess. |
| `fiscal_provider_reference` | Any additional identifier the device or provider gives |
| `fiscalized_at` / `fiscalized_by` | When, and which staff user recorded it |
| `fiscalization_error` | Why it failed, when it did |
| `fiscalized` | Legacy boolean, kept in sync for older reports |

Written only through `set_order_fiscalization(...)` — staff-only, status
validated, and audit-logged. A direct `UPDATE` to any of these columns is
rejected by the integrity trigger, so the record cannot be quietly edited.

### The four states that matter on the floor

| Situation | `payment_status` | `fiscalization_status` | Meaning |
|---|---|---|---|
| Normal | `paid` | `fiscalized` | Done. Nothing to chase. |
| **Not yet rung in** | `paid` | `not_fiscalized` | **Money taken, no fiscal receipt.** The queue to clear before close. |
| Still at the table | `unpaid` | `not_fiscalized` | Normal mid-service. |
| Device problem | `paid` | `failed` | The device rejected it. Escalate; do not close the day. |

---

## Daily procedure

**During service.** Ring each settled order into the fiscal device exactly as
you do today. Nothing about the device changes.

**Recording it.** Admin → Orders → **Mark fiscalized**. The app asks for the
receipt number from the device. Enter it. If it genuinely is not to hand you can
leave it blank, but an order marked fiscalized with no number cannot be matched
to anything later — treat that as a gap to fill, not a normal outcome.

**At close.** Admin → Daily Report:

| App figure | Compare against |
|---|---|
| **Cash** | The cash drawer count |
| **POS terminal** | The terminal's batch report |
| **Card online** | The Monri settlement report (when live) |
| Gross − refunded | The fiscal device's **daily report** (dnevni izvještaj) |

Anything under "Needs attention before close" — money owed, payments that
started and never resolved, rejected provider callbacks — is cleared before the
day is signed off. A discrepancy is investigated and noted, never adjusted away.

---

## Queries

```sql
-- Paid today, not yet rung into the fiscal device.
SELECT order_code, total, payment_method, paid_at
  FROM public.completed_orders
 WHERE payment_status = 'paid'
   AND fiscalization_status <> 'fiscalized'
   AND created_at >= CURRENT_DATE
 ORDER BY paid_at;

-- Marked fiscalized but with no receipt number — unmatchable at audit.
SELECT order_code, total, fiscalized_at, fiscalized_by
  FROM public.orders
 WHERE fiscalization_status = 'fiscalized'
   AND (fiscal_receipt_number IS NULL OR btrim(fiscal_receipt_number) = '')
   AND created_at >= CURRENT_DATE;

-- Anything the device rejected.
SELECT order_code, total, fiscalization_error, fiscalized_at
  FROM public.orders
 WHERE fiscalization_status = 'failed'
 ORDER BY created_at DESC;

-- The whole day.
SELECT public.day_reconciliation(CURRENT_DATE);
```

---

## Online card payments and the fiscal receipt

When Monri goes live, an online card payment is money received **before** the
guest is at the till. How that must appear on a fiscal receipt — the payment
method recorded on the device, and the timing relative to the sale — is exactly
the kind of detail that differs between interpretations.

**Do not guess it.** Ask the accountant and the fiscal distributor, in writing,
before enabling online card payments, and record their answer here. Until then,
online card payment stays off — which it is (`docs/monri-go-live.md`).

---

## If a direct fiscal integration is ever built

The shape is ready. An integration would:

1. Call the provider from an **Edge Function**, never the browser — fiscal
   credentials must not reach a client.
2. On success: `set_order_fiscalization(order_id, 'fiscalized', receipt_number,
   provider_reference)`.
3. On failure: the same call with `'failed'` and the error, so the order
   surfaces in the queue instead of disappearing.
4. Be **idempotent per order** — the same protection the payment callback has,
   for the same reason: a retried request must not produce a second receipt.
5. **Never block the kitchen.** Fiscalization concerns the receipt, not the
   food; a device outage must not stop service.

That function is not written, because no approved provider integration or
certificate exists. This document does not pretend otherwise.

---

## Still to be confirmed externally

| Question | Who answers it |
|---|---|
| Does the current device + app workflow satisfy the restaurant's obligations? | Accountant |
| Which identifier must be retained, and for how long? | Accountant |
| Is a direct integration required, or is manual entry acceptable? | Authorised fiscal distributor |
| How must an online card payment appear on the fiscal receipt? | Accountant **and** distributor together |
| What must be produced at inspection, and from which system? | Accountant |

Until each of these has a written answer, treat the app as what it is: an
accurate record of orders and payments that helps you drive the certified
device — not a substitute for it.
