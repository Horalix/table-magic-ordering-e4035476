# Monri Payments Architecture

## Recommended Flow

Use Monri Components for dine-in card payments. Components keep card fields hosted by Monri in the browser, so card data does not touch the app backend. The backend only creates a payment and returns the `client_secret` needed by the Monri browser SDK.

1. Guest places an order with `guest_place_order`.
2. Frontend calls `monri-create-payment` with `order_id`, `session_id`, and `session_token`.
3. Edge Function verifies the session token against the order session.
4. Edge Function creates a Monri payment using `POST /v2/payment/new`.
5. Frontend initializes Monri Components with `authenticity_token` and `client_secret`.
6. Monri handles card input and 3DS in the browser.
7. Monri calls `monri-webhook`.
8. Webhook verifies the `WP3-callback` digest and updates `payment_transactions` plus `orders.payment_status`.

## Server Secrets

Store these as Supabase Edge Function secrets:

- `MONRI_MERCHANT_KEY`
- `MONRI_AUTHENTICITY_TOKEN`
- `MONRI_ENVIRONMENT` as `test` or `production`
- `MONRI_CALLBACK_URL`
- Optional `MONRI_CURRENCY`, default `BAM`

Never expose `MONRI_MERCHANT_KEY` to the browser. The browser can receive the authenticity token and client secret needed by Components.

## Digest Rules

Payment creation signs:

```text
sha512(merchant_key + timestamp + authenticity_token + full_path + body)
```

Webhook verification signs:

```text
sha512(merchant_key + raw_body)
```

The webhook must verify against the raw request body before parsing JSON.

## Current Implementation

Implemented now:

- `payment_transactions` ledger table.
- `monri-create-payment` Edge Function.
- `monri-webhook` Edge Function.
- `startCardPayment` client helper behind `VITE_MONRI_ENABLED=true`.

Still needed before live card payments:

- Render Monri Components in the checkout success/payment step.
- Add success/cancel UX for 3DS return.
- Configure production merchant credentials after Monri test approval.
- Decide whether La Soul wants `purchase` immediately or `authorize` plus later capture.

## Go-live checklist

When Monri test credentials arrive, this should take minutes:

1. **Set Edge Function secrets** (Supabase → Edge Functions → Secrets):
   `MONRI_MERCHANT_KEY`, `MONRI_AUTHENTICITY_TOKEN`, `MONRI_ENVIRONMENT=test`,
   `MONRI_CALLBACK_URL=https://<project>.functions.supabase.co/monri-webhook`,
   optional `MONRI_CURRENCY=BAM`.
2. **Deploy** the `monri-create-payment` and `monri-webhook` Edge Functions.
3. **Register the webhook URL** (the `MONRI_CALLBACK_URL`) in the Monri merchant dashboard.
4. **Enable the front-end**: set `VITE_MONRI_ENABLED=true` and rebuild/redeploy.
   The checkout "Pay now · card" then opens the Monri Components card form
   (`src/components/guest/MonriCardForm.tsx`); the webhook flips
   `orders.payment_status` to `paid`.
5. **Test** with a Monri sandbox card; verify a row in `payment_transactions`
   and `orders.payment_status='paid'` after the callback.
6. **Go production**: flip `MONRI_ENVIRONMENT=production` (+ production
   credentials) once Monri approves the live account.

> The front-end card form follows Monri's documented Components API but has not
> been run against a live account — verify field mounting and `confirmPayment`
> behavior against the sandbox during step 5, and adjust
> `MonriCardForm.confirmPayment` payload if your account needs extra customer/3DS
> fields.

## Official References

- Monri Components: https://ipg.monri.com/en/documentation/components
- Monri Payment API: https://ipg.monri.com/en/documentation/payment_api
- Monri Redirect: https://ipg.monri.com/en/documentation/form
- Monri Transaction Management: https://ipg.monri.com/en/documentation/transaction-management

