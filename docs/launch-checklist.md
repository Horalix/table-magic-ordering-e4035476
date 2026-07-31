# Launch checklist

From the current state to live restaurant use. Do these in order — later steps
assume earlier ones.

Legend: ☐ to do · **⚠** cannot be done from this repository (needs a person with
dashboard/bank access).

---

## Phase 0 — before anything is deployed

- ☐ Read `docs/master-product-audit.md`. It says what was wrong and why each
  fix exists.
- ☐ `npm ci && npm run verify` on a clean checkout. Must be green:
  typecheck, lint (0 errors), 114 tests, secret scan, production build.
- ☐ `npx playwright install chromium webkit && npm run test:e2e` — 55 specs.
- ☐ Confirm `.env` is **not** tracked: `git ls-files | grep '^\.env$'` returns
  nothing.

---

## Phase 1 — database

- ☐ Take a backup / confirm PITR is on before migrating. **⚠**
- ☐ `supabase db push`. The new migrations are additive and idempotent; the
  enum values are split into their own migration because PostgreSQL will not
  let a new enum value be used in the transaction that added it.
- ☐ Verify the new objects exist:
  ```sql
  SELECT proname FROM pg_proc
   WHERE proname IN ('release_order_to_kitchen','monri_apply_callback',
                     'record_table_payment','day_reconciliation',
                     'guest_get_recommendations','claim_ticket_print');
  -- expect 6 rows
  SELECT tgname FROM pg_trigger WHERE tgname = 'enforce_order_integrity';
  ```
- ☐ Confirm the safe default landed:
  ```sql
  SELECT online_card_enabled, ordering_enabled FROM restaurant_settings WHERE id = 1;
  -- expect: false, true
  ```
- ☐ Spot-check that legacy card orders were migrated:
  ```sql
  SELECT count(*) FROM orders WHERE payment_method = 'card';  -- expect 0
  ```

---

## Phase 2 — Supabase configuration **⚠**

- ☐ Edge Function secrets: `ALLOWED_ORIGINS` (include
  `https://order.lasoul.net`), and — only when they exist — the `MONRI_*` set.
- ☐ Enable Point-in-Time Recovery, and test one restore.
- ☐ Enable Leaked Password Protection (Auth → Providers → Password).
- ☐ Enforce MFA on the Supabase account.
- ☐ Confirm only the `public` schema is exposed to the API.
- ☐ Deploy the functions:
  ```bash
  supabase functions deploy monri-create-payment
  supabase functions deploy monri-webhook
  ```

---

## Phase 3 — front-end deployment **⚠**

- ☐ Netlify environment variables:
  ```
  VITE_SUPABASE_URL, VITE_SUPABASE_PROJECT_ID, VITE_SUPABASE_PUBLISHABLE_KEY
  VITE_SENTRY_DSN          (recommended)
  VITE_MONRI_ENABLED=false (stays false until Monri sandbox passes)
  ```
- ☐ SPA redirect: `public/_redirects` already contains `/* /index.html 200`.
  Confirm a deep link works in production, e.g.
  `https://order.lasoul.net/table/7?token=…` served directly (not via an
  in-app navigation).
- ☐ Point DNS at Netlify for `order.lasoul.net`; confirm HTTPS and the
  automatic HTTP→HTTPS redirect.
- ☐ Load `https://order.lasoul.net/menu` on a real phone. Check the PWA install
  prompt, and that a hard reload does not show a stale build.

---

## Phase 4 — restaurant setup

- ☐ Admin → Tables: every table exists with the right number.
- ☐ Admin → QR Codes: **rotate every token**, then print fresh QR codes. Any
  token printed during development must be dead.
- ☐ Admin → Sections and Waiters: sections defined, waiters created with PINs.
- ☐ Admin → Menu: prices correct, availability correct, images present on the
  top 20 items, allergens filled in on anything with nuts, dairy or gluten.
- ☐ Admin → Printing: paper width, header, footer, copies.
- ☐ Kitchen device: open `/kitchen`, enable the printer on **one** device, turn
  sound on, confirm the pill reads **Live**.
- ☐ Admin → Service & suggestions: ordering **on**, pay-at-table **on**, online
  card **off**.

---

## Phase 5 — dress rehearsal (before any guest)

Run a full order at a real table, with staff, on real devices.

- ☐ Scan a table QR → menu loads in under 2 s on 4G.
- ☐ Search finds a dish by name in Bosnian and in English.
- ☐ Add items, see one relevant suggestion, dismiss it — it does not return.
- ☐ Checkout: itemised total correct, no tip preselected.
- ☐ Order with **Cash** → appears in the kitchen instantly, prints once, has an
  order number.
- ☐ Order with **Card at the table** → kitchen shows "Owes · bring terminal".
- ☐ Move it New → Confirmed → Preparing → Ready → Served.
- ☐ Record **Paid cash** on one, **Paid terminal** on the other.
- ☐ Order again from the same phone → joins the same tab.
- ☐ Second phone joins the table → approval prompt appears on the first.
- ☐ Request the bill → waiter is notified → resolving closes the session.
- ☐ Admin → Daily Report: cash and terminal in separate columns, both correct,
  nothing in "needs attention".
- ☐ Mark both fiscalized; the warning clears.
- ☐ Switch to Arabic: layout mirrors, nothing overflows, checkout works.
- ☐ Switch to Bosnian: copy reads naturally to a native speaker.
- ☐ Turn Wi-Fi off mid-order: the guest is told the order was **not** sent.
- ☐ Pause ordering in Admin: the guest app blocks checkout and explains why.
  Turn it back on.

---

## Phase 6 — soft launch

- ☐ One section only, one service.
- ☐ A manager watches `/kitchen` and Admin → Daily Report throughout.
- ☐ At close, reconcile: drawer vs **Cash**, terminal batch vs **POS terminal**.
  Both must match exactly.
- ☐ Zero duplicate prints, zero stuck payments, zero callback problems.
- ☐ Collect what staff found confusing. Fix the copy, not the staff.
- ☐ Repeat for two or three services before opening it to the whole floor.

---

## Phase 7 — full launch

- ☐ All sections live.
- ☐ Uptime monitor on the menu URL and the webhook URL. **⚠**
- ☐ Sentry receiving events; someone owns the alerts. **⚠**
- ☐ Staff guide printed and by the pass
  (`docs/restaurant-staff-training.md`).
- ☐ Week-1 baseline metrics recorded (`docs/product-metrics.md`).

---

## Phase 8 — online card payment (separate, later, blocked)

Do not attempt this until the whole of Phase 7 has been stable for at least a
week.

- ☐ **⚠** Monri **online** merchant account exists (the physical POS
  relationship is not sufficient).
- ☐ **⚠** Online MID/TID issued by the acquiring bank.
- ☐ **⚠** Card-not-present acquiring agreement signed.
- ☐ **⚠** Sandbox credentials received.
- ☐ All 16 cases in `docs/monri-go-live.md` §5 pass and are recorded.
- ☐ Production credentials, `MONRI_ENVIRONMENT=production`, functions
  redeployed, callback URL registered.
- ☐ `VITE_MONRI_ENABLED=true`, site redeployed.
- ☐ Admin → Service & suggestions → Online card payment **on**.
- ☐ One real low-value transaction end to end, then refunded, both reconciling
  correctly.

---

## Rollback

Fastest first. Nothing here needs a deploy except where noted.

| To stop | Do | Effect |
|---|---|---|
| **Online card payments** | Admin → Service & suggestions → off | Immediate. In-flight payments still resolve; no new card orders. Pay-at-table unaffected. |
| **All guest ordering** | Admin → Service & suggestions → Accept orders → off | Guests see the pause message and are told to ask a waiter. The server refuses orders, so nothing slips through. Existing orders continue normally. |
| **Suggestions** | Admin → Service & suggestions → off | No suggestion anywhere. Nothing else changes. |
| **Printing** | Kitchen → printer icon off, or Admin → Printing → disable | Kitchen screen keeps working. |
| **A bad front-end deploy** | Netlify → Deploys → publish the previous one | ~1 minute. The database is unaffected. |
| **The whole app** | Netlify → pause the site | Staff take orders on paper. Data already in the database is safe. |

### Rolling back a migration

The payment-safety migrations are additive: they add columns, tables, functions
and one trigger. Nothing is dropped, so a front-end rollback alone is safe and
is almost always the right move.

If the **trigger** itself must go (it is the only thing that can reject a write
the old code expected to succeed):

```sql
DROP TRIGGER IF EXISTS enforce_order_integrity ON public.orders;
```

That restores the old permissive behaviour immediately. Understand what you are
giving up: illegal transitions and direct writes to money columns become
possible again. Re-create it with:

```sql
CREATE TRIGGER enforce_order_integrity
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_integrity();
```

To revert `guest_place_order` to releasing card orders immediately — **do not
do this while online card payments are enabled**, it is the exact bug the whole
branch exists to fix — restore the prior definition from
`supabase/migrations/20260620180000_printing_tipping_reports.sql`.

---

## Definition of done

- Zero unpaid card orders have reached the kitchen.
- Zero duplicate prints.
- The cash drawer and the terminal batch match the report, exactly, three
  services running.
- Staff can explain what every payment label means without looking it up.
- A guest can order, pay and get their food without asking anyone how the app
  works.
