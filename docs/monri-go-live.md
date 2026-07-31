# Monri go-live

Online card payment is **disabled** and must stay disabled until every sandbox
case below passes. Two independent switches enforce that:

| Switch | Where | Effect |
|---|---|---|
| `VITE_MONRI_ENABLED` | Netlify env / `.env` | Whether the app *offers* the card button |
| `restaurant_settings.online_card_enabled` | Admin → Service & suggestions | Whether the **database** accepts a card order at all |

The server-side one is authoritative. With it off, `guest_place_order` raises
`feature_not_supported` for `card_online` and `monri_register_attempt` returns
`card_disabled` — so a cached old build with a visible button still cannot take
a payment. It defaults to `false` on a fresh database.

---

## 1. What the restaurant must obtain

These are **external blockers**. Nothing in this repository can substitute for
them, and none of them are invented here.

| Requirement | Who provides it | Notes |
|---|---|---|
| Monri **online** merchant account (WebPay / IPG) | Monri | The existing physical POS terminal relationship is **separate**. A physical terminal MID/TID does not authorise online e-commerce. |
| Online MID / TID | Acquiring bank via Monri | Ask explicitly for an e-commerce MID, not a POS one. |
| Acquiring-bank agreement covering card-not-present | Bank | Pricing, settlement account, chargeback terms. |
| `MONRI_MERCHANT_KEY` | Monri dashboard | **Secret.** Never in the repo, never a `VITE_` var. |
| `MONRI_AUTHENTICITY_TOKEN` | Monri dashboard | Public-ish (it reaches the browser to init the SDK) but still set server-side and passed through. |
| Test (sandbox) credentials | Monri | A separate pair from production. |
| Registered callback URL | Monri dashboard | Must be the deployed webhook URL below. |
| Confirmation of currency support | Monri | BAM assumed; confirm minor-unit handling (fening ×100). |

Until Monri issues sandbox credentials, everything below step 3 is blocked.
That is the current state.

---

## 2. Secrets

All server secrets go in **Supabase → Edge Functions → Secrets**. None of them
belong in `.env`, in Netlify, or in the repository — `npm run scan:secrets`
fails the build if a `MONRI_MERCHANT_KEY`-shaped value or a reference to one
appears in `src/`.

```
MONRI_MERCHANT_KEY        = <from Monri>            # secret
MONRI_AUTHENTICITY_TOKEN  = <from Monri>
MONRI_ENVIRONMENT         = test                    # then: production
MONRI_CALLBACK_URL        = https://<project>.functions.supabase.co/monri-webhook
MONRI_CURRENCY            = BAM
ALLOWED_ORIGINS           = https://order.lasoul.net,http://localhost:8080
```

Front-end (Netlify environment variables):

```
VITE_MONRI_ENABLED = false        # true only after §5 passes
```

`ALLOWED_ORIGINS` matters: the payment-start function is CORS allow-listed
rather than `*`, because it accepts a guest session token.

---

## 3. Deploy

```bash
supabase functions deploy monri-create-payment
supabase functions deploy monri-webhook
supabase db push          # applies the payment-safety migrations
```

Then, in the Monri dashboard, register the callback URL exactly as set in
`MONRI_CALLBACK_URL`.

---

## 4. How the flow works (what to expect in logs)

```
guest chooses "Pay now by card"
  → guest_place_order(card_online)         order created as awaiting_payment
                                           NO kitchen ticket, NO print
  → monri-create-payment
      → monri_register_attempt             reuses a live attempt for the same
                                           order+amount (double-tap safe)
      → POST /v2/payment/new               WP3-v2.1 digest
      → monri_record_attempt_response      client_secret stored
  → browser: Monri Components card field   card data never touches our servers
  → 3-D Secure
  → Monri → POST /monri-webhook            WP3-callback digest verified
      → monri_apply_callback
          replay?          → duplicate, no effect
          amount mismatch? → recorded, NOT released
          currency wrong?  → recorded, NOT released
          older status?    → stale, ignored
          approved         → payment_status = paid
                           → release_order_to_kitchen()  ← exactly once
  → guest app polls guest_get_order_payment and only then says "Payment received"
```

The browser's own view of the payment is never used to release food or to tell
the guest they paid.

---

## 5. Sandbox test matrix

Run every row with `MONRI_ENVIRONMENT=test` and
`restaurant_settings.online_card_enabled = true`. Record the result. **All must
pass before production.**

| # | Case | How | Expected |
|---|---|---|---|
| 1 | Successful purchase | Monri test card, correct 3-D Secure | Order → `pending`, `payment_status = paid`, exactly one ticket, guest sees "Payment received" |
| 2 | Declined card | Monri decline test card | Order stays out of the kitchen, `status = payment_failed`, guest offered retry / pay-at-table |
| 3 | 3-D Secure failure | Abandon the challenge | Same as #2, no charge |
| 4 | Double-tap Pay | Tap the button twice quickly | **One** `payment_transactions` row, one Monri order number |
| 5 | Refresh during payment | Reload mid-3DS | App recovers into the confirming screen, no second order |
| 6 | Close the browser after approval | Kill the tab post-approval | Callback still releases the order once; guest sees it on the tab |
| 7 | Duplicate callback | Replay the same callback body | `outcome = duplicate`, no second ticket, no second print |
| 8 | Wrong amount callback | Replay with a changed `amount` | `outcome = amount_mismatch`, order **not** released, appears in "needs attention" |
| 9 | Wrong currency callback | Replay with `EUR` | `outcome = currency_mismatch`, order **not** released |
| 10 | Delayed callback | Delay the callback beyond 25 s | Guest sees "still confirming — do not pay again" with the order number; never "paid", never "failed" |
| 11 | Callback for an unknown order | Fabricate an order number | `outcome = unknown_transaction`, 200 response, logged |
| 12 | Bad signature | Wrong digest | 401, nothing written |
| 13 | Monri unreachable | Block the host | Card option fails gracefully, pay-at-table still works, order not lost |
| 14 | Switch to pay-at-table after decline | Use the recovery button | Order released once, method recorded as `cash` |
| 15 | Kitchen never sees an unpaid order | Watch `/kitchen` throughout | No order appears before its callback |
| 16 | Refund (sandbox) | Refund via Monri dashboard | Refund recorded; `record_order_refund` reflects it |

Cases 7–11 can be exercised without Monri at all — they are covered by
`supabase/tests/payment-safety.test.ts`, which runs the real SQL against a real
Postgres. Run `npm test` first; the sandbox pass is then confirmation against
the live provider rather than the first time anyone tries it.

---

## 6. Production cutover

1. All 16 sandbox cases pass and are recorded.
2. Set `MONRI_ENVIRONMENT = production` and swap in the production credentials.
3. Redeploy both Edge Functions.
4. Update the callback URL in the Monri production dashboard.
5. Set `VITE_MONRI_ENABLED = true` in Netlify and redeploy the site.
6. Turn on **Admin → Service & suggestions → Online card payment**.
7. Do one **real** low-value transaction (e.g. an espresso) on a real card.
   Confirm: order released once, one ticket, `paid`, correct amount in
   `day_reconciliation()`.
8. Refund that transaction and confirm it appears correctly.
9. Only then announce it to guests.

---

## 7. Emergency disable

In order of speed:

1. **Admin → Service & suggestions → Online card payment → off.** Immediate,
   no deploy. Existing in-flight payments still resolve correctly; no new card
   orders can be created. Pay-at-table is unaffected.
2. Set `VITE_MONRI_ENABLED = false` and redeploy — removes the button.
3. Remove `MONRI_MERCHANT_KEY` from Edge Function secrets — the functions then
   return `503 card_unavailable`.

Never disable by deleting the webhook: in-flight payments would be charged and
never confirmed.

---

## 8. Reconciliation

Daily, at close:

- **Admin → Daily Report** shows card-online, cash and POS-terminal separately.
  They settle against three different places and must never be added together
  before checking each one.
- `paid_online` must equal Monri's settlement report for the day.
- `stuck_payments` must be zero. Anything left is a payment that started and
  never resolved — check `payment_callback_events` for that order.
- `callback_problems` must be zero. A non-zero value means Monri sent an amount
  or currency we did not expect; raise it with Monri before settling.

```sql
-- Everything the provider told us about one order.
SELECT created_at, outcome, detail, normalized_status, amount_minor, currency
  FROM public.payment_callback_events
 WHERE order_id = '<order id>'
 ORDER BY created_at;
```

---

## 9. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| `card_unavailable / not_configured` | Edge Function secrets missing | Supabase → Edge Functions → Secrets |
| `card_unavailable / disabled` | Server switch off | Admin → Service & suggestions |
| Guest stuck on "still confirming" | Callback never arrived | Monri dashboard callback log; `MONRI_CALLBACK_URL` correctness |
| `invalid_signature` in webhook logs | Wrong `MONRI_MERCHANT_KEY`, or a proxy altering the body | Compare environments; the digest is over the **raw** body |
| `amount_mismatch` | Provider sent a different amount | Do not release manually. Contact Monri. |
| Order paid but no ticket | Release failed after payment | `SELECT public.release_order_to_kitchen('<id>')` — it is idempotent |
| Two payment attempts for one order | Amount changed between taps | Expected: the older attempt is auto-cancelled |

---

## 10. What this document does **not** claim

- It does not claim PCI compliance. Card data is entered in Monri-hosted fields
  and never reaches this application, which is what makes SAQ-A plausible —
  confirm the actual scope with Monri and the acquiring bank.
- It does not claim the app is a certified fiscal device. See
  `docs/fiscalization-workflow.md`.
- It does not state BiH legal requirements for online card acceptance. Have the
  accountant and the bank confirm those in writing.
