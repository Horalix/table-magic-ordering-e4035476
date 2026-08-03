# La Soul — Operations Runbook

Practical guide to keeping the system healthy in production. For the guest and
staff-facing "how do I do X", see `docs/restaurant-staff-training.md`.

---

## 1. Backups (Supabase)

- **Enable backups**: Supabase Dashboard → Database → Backups. On the **Pro
  plan** you get daily backups; turn on **Point-in-Time Recovery (PITR)** for
  restaurant-grade safety (restore to any moment).
- **Test a restore once** before go-live so you trust the process.
- The repo holds all schema as `supabase/migrations/*` — that is the schema
  source of truth. The data is not in the repo; the backups are the only copy.

## 2. Error monitoring (Sentry)

- Create a Sentry project (React) → copy its **DSN**.
- Set `VITE_SENTRY_DSN` and redeploy. Errors then appear with stack traces and
  session replay on error.
- Without a DSN, monitoring is simply off — nothing breaks.

## 3. Uptime monitoring

- Monitor the guest menu URL and the `monri-webhook` function URL, 1–5 min
  interval, alerting by email or Telegram.
- A webhook outage is the expensive one: guests get charged and the order never
  reaches the kitchen. It self-heals when the function returns (Monri retries,
  and replay protection makes that safe), but you want to know.

## 4. Cross-links

| Topic | Document |
|---|---|
| What was wrong and why each fix exists | `docs/master-product-audit.md` |
| Order lifecycle, permissions, effects | `docs/order-state-machine.md` |
| Card payments: prerequisites, sandbox matrix, cutover, emergency disable | `docs/monri-go-live.md` |
| Security posture, remaining risks, incident response | `docs/security-review.md` |
| Fiscal workflow and what needs the accountant | `docs/fiscalization-workflow.md` |
| Metrics, denominators, queries | `docs/product-metrics.md` |
| Merchandising and the 30-day plan | `docs/growth-and-merchandising.md` |
| Item bumping, stations, undo, ticket printing | `docs/kitchen-and-printing.md` |
| How suggestions are chosen and waits estimated | `docs/suggestions-and-timing.md` |
| Proving what the suggestions earned | `docs/measuring-upsell.md` |
| Test suites and how to add to them | `docs/testing-guide.md` |
| Step-by-step go-live and rollback | `docs/launch-checklist.md` |
| Floor-staff guide (printable) | `docs/restaurant-staff-training.md` |

---

## 5. The emergency brakes

All in **Admin → Service & suggestions**. All take effect immediately, no
deploy, and all are enforced **server-side** — an old cached app build cannot
work around them.

| Switch | Effect |
|---|---|
| **Accept orders** | Off: guests see your pause message and are told to ask a waiter. `guest_place_order` refuses. Existing orders continue normally. |
| **Pay at the table** | Off: removes cash and terminal as guest choices. |
| **Online card payment** | Off: the database refuses card orders. In-flight payments still resolve correctly. |
| **Suggestions** | Off: no suggestion anywhere. |
| **Kitchen delay (minutes)** | Above 0, guests are warned dishes may take longer. Use it instead of pausing during a rush. |

Use "kitchen delay" before you use "accept orders off". A warned guest still
orders; a blocked guest asks a waiter, which is more work for you.

---

## 6. Routine checks

**Every service**
- Kitchen screen shows the green **Live** pill.
- The printer device is the only one with the printer icon lit.
- No tickets in the "failed to print" counter.

**Every close** — Admin → Daily Report
- "Needs attention before close" is empty.
- Cash drawer = **Cash**; terminal batch = **POS terminal**; Monri report =
  **Card online**. Each separately — never add them up before checking.
- Every order marked fiscalized.

**Weekly**
- Skim Sentry for recurring errors.
- Confirm a recent backup exists.
- Review low ratings.

**Monthly**
- Review suggestion acceptance by placement and delete anything under 5%.
- Rotate QR tokens if there has been any incident.
- Re-read the remaining risks in `docs/security-review.md`.

---

## 6b. The trading day

Every operational "today" — reconciliation, shift close, the sales report, the
waiter rota — runs on the **Sarajevo** day via `business_day()`, not on UTC.

This matters because the restaurant serves past midnight. Sarajevo is UTC+2 in
summer, so 00:30 local is 22:30 UTC the *previous* day. When the two
definitions disagreed:

- a close at 01:15 reported an `expected_cash` missing everything sold since
  midnight, so the drawer was over by the late-night trade every night;
- that trade was reconciled by no close at all, because the previous day had
  been signed off hours before those orders existed;
- at 02:00 local, mid-service, every waiter lost their section and new tables
  stopped being auto-assigned.

If you ever query reconciliation by hand, use `public.day_reconciliation()`
with no argument, or pass a date from `public.business_day()`. Passing
`CURRENT_DATE` asks for the UTC day and reintroduces the bug.

```sql
-- correct
SELECT public.day_reconciliation();
SELECT public.day_reconciliation(public.business_day() - 1);  -- yesterday

-- wrong between local midnight and 02:00
SELECT public.day_reconciliation(CURRENT_DATE);
```

Shift closes already written keep their original snapshots — a signed-off day
is a record, and the fix does not rewrite history. If a past close shows a
surplus roughly equal to a night's after-midnight takings, this was why.

One exception, left alone on purpose: `order_code_counters` still rolls on
`CURRENT_DATE`. Order numbering has fiscalisation implications and neither
boundary is obviously right for a service that runs past midnight; decide it
against the actual requirement.

---

## 6c. Orders that never finished

The nightly job closes **unpaid** orders left unserved for more than
`restaurant_settings.stale_order_hours` (6 by default). Two kinds: card
attempts that were abandoned before payment, which never reached the kitchen at
all, and unpaid orders nobody served. Neither involves money, so closing them
costs nothing and stops them being reported as outstanding forever.

It will **not** close a paid order. Paid-but-never-served is nearly always a
forgotten tap rather than missing food, and cancelling it would drop the order
out of `completed_orders` — quietly reducing that day's revenue and making a
refund look owed for a meal that was eaten. Those appear here instead:

```sql
SELECT * FROM public.orders_needing_attention();
```

Paid ones sort first, with the table number, so somebody can go and ask. Once
you know the food went out, close it normally from Admin → Orders.

The guest's **table session is left open** on purpose. It has its own idle
expiry, and someone still sitting there should not lose their tab because one
card attempt failed.

To run it by hand:

```sql
SELECT public.close_stale_orders();     -- uses the configured window
SELECT public.close_stale_orders(12);   -- or an explicit one, minimum 2 hours
```

---

## 7. Failure modes

Designed for, and what actually happens.

### Internet outage at the restaurant
- **Guest:** told clearly the order was **not** sent and nothing was charged.
  Their cart is preserved.
- **Kitchen:** the connection pill turns red and the screen polls every 15 s.
  Orders placed before the outage are safe in the database.
- **You:** take orders on paper. Do **not** ask a guest to retry a card payment
  during an outage.

### Supabase outage
- The app cannot load the menu or place orders. Guests see errors rather than
  false success.
- Nothing is lost: no order is ever "half placed", because the total, the items
  and the release all happen in one transaction.
- Fall back to paper. When it returns, the kitchen screen repopulates.

### Monri outage (once card payments are live)
- Turn **Online card payment** off in Admin. Pay-at-table keeps working.
- Payments already in flight resolve when Monri returns; replay protection means
  the retried callbacks are safe.
- Guests mid-payment see "still confirming — do not pay again" with their order
  number. **Do not take a second payment from them.** Check
  `payment_callback_events` for that order before doing anything.

### Printer outage
- The kitchen screen keeps working; read tickets from it.
- Failed tickets are counted in the header and each shows a **Reprint** button.
- Reconnect the printer and reprint. Duplicate printing is prevented by the
  database claim, so reprinting is safe.

### Realtime disconnect
- The pill turns red and polling takes over at 15 s.
- No duplicate events: every refresh re-reads state rather than replaying.
- If it stays red, reload. If it stays red after a reload, the problem is the
  network or Supabase.

### Kitchen device crashes
- Reload. State is in the database, not the device.
- Already-printed tickets will **not** reprint (the claim is in the database,
  not in the tab). Use **Reprint** if you actually need a second copy.

### A payment is charged but the order is not in the kitchen
```sql
SELECT id, order_code, total, status, payment_status
  FROM orders
 WHERE status IN ('awaiting_payment','payment_failed')
   AND payment_status = 'paid';
```
Check `payment_callback_events` for that order. If the money is genuinely ours
and the amount matches:
```sql
SELECT public.release_order_to_kitchen('<order id>');   -- idempotent, audited
```
If the amount does **not** match, do not release. Refund and re-take.

---

## 8. Common fixes

| Symptom | Cause | Fix |
|---|---|---|
| Guest "can't place order" | Expired session | Re-scan the table QR. Orders are capped at 10 per session. |
| Guest can browse but not order | Session lost | The app now reads the session from the device, not the URL — if it persists, the session was closed at the bill. Re-scan. |
| Kitchen not printing | Device not designated, or printing disabled | Printer icon lit on one device; Admin → Printing enabled; Chrome `--kiosk-printing` for silent |
| "Card payment is not available right now" | Online card off (expected today) | See `docs/monri-go-live.md` |
| An order shows "Online payment pending" for a long time | Callback never arrived | Check the webhook logs. Do **not** mark it paid manually. |
| Daily report does not match the drawer | Cash recorded as terminal or vice versa | Check `audit_log` for `payment.recorded_*` on those orders |
| A guest was charged twice | Should be impossible | `SELECT * FROM payment_transactions WHERE order_id = …` — more than one `approved` is a duplicate. Refund via Monri, then `record_order_refund`. Capture the timeline and open an issue. |
| Suggestions are not showing | Switched off, or nothing curated and no order history | Admin → Service & suggestions |

---

## 9. Useful SQL

```sql
-- Today, everything, with correct denominators.
SELECT public.day_reconciliation(CURRENT_DATE);

-- Money that started and never landed.
SELECT order_code, total, created_at, status
  FROM orders
 WHERE status IN ('awaiting_payment','payment_failed')
   AND created_at > now() - interval '1 day';

-- Everything that happened to one order.
SELECT created_at, action, actor_user_id, reason
  FROM audit_log WHERE entity_id = '<order id>' ORDER BY created_at;

-- Tickets that failed to print today.
SELECT order_id, attempts, last_error, updated_at
  FROM order_ticket_events
 WHERE status = 'failed' AND updated_at > CURRENT_DATE;

-- Provider callbacks we rejected.
SELECT created_at, outcome, detail, monri_order_number
  FROM payment_callback_events
 WHERE outcome NOT IN ('approved_released','approved_already_released','duplicate','pending')
 ORDER BY created_at DESC LIMIT 50;
```
