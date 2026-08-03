# La Soul — QR ordering, payments and restaurant operations

Mobile-first ordering, payment and floor-operations platform for **La Soul**,
Sarajevo. Guests scan a table QR, browse in Bosnian, English or Arabic, order
from their phone, and pay at the table or (once enabled) by card. Staff get a
kitchen display, a waiter view, and an admin back office that can actually close
the day.

**Production domain:** `order.lasoul.net`
**Online card payment:** deliberately **disabled** — see
[docs/monri-go-live.md](docs/monri-go-live.md).

---

## Quick start

```bash
npm ci
cp .env.example .env        # fill in the Supabase values
npm run dev                 # http://localhost:8080
```

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Unit + SQL integration tests (457) |
| `npm run test:e2e` | Playwright, 3 browser projects (97 across 3 browsers) |
| `npm run scan:secrets` | Fails on committed credentials |
| **`npm run verify`** | **typecheck → lint → tests → secret scan → build** |

First E2E run needs browsers: `npx playwright install chromium webkit`.

---

## What this release changed

A full production-hardening pass: a five-dimension audit followed by
implementation in strict priority order — payment correctness first, conversion
last. The audit, with evidence and line references, is
[docs/master-product-audit.md](docs/master-product-audit.md).

### The headline

**A card order can no longer reach the kitchen before the money arrives.**

Previously `guest_place_order` queued a kitchen ticket for *every* order,
including card orders whose payment had not started. A guest could open the card
form, abandon it, and the kitchen would already have cooked the food. The
callback that was supposed to protect against this verified a signature and then
trusted everything else — it never checked the amount or the currency, and a
retried callback re-ran every side effect.

Now:

- Card orders are created in `awaiting_payment`. No ticket, no print, invisible
  to every kitchen and waiter query.
- `release_order_to_kitchen()` is the only door in, guarded by
  `released_to_kitchen_at IS NULL`, so it fires **exactly once**.
- The callback verifies amount **and** currency against the registered attempt
  before approving, rejects replays via a unique event-hash ledger, and enforces
  a monotonic status ladder so a late `pending` cannot un-pay a paid order.
- The browser's opinion of a payment is never used. The guest sees "Payment
  received" only after the **server** says so.

Verified by 41 integration tests that run the real migrations against a real
PostgreSQL.

### Guest experience

| Before | After |
|---|---|
| Cart was cleared the moment the card form opened — a decline lost the order | Cart survives; the held order is remembered across reloads, closed tabs and 3-D Secure round-trips |
| "Payment received" shown on the SDK's word | Three honest states: **received** / **declined, card not charged** / **still confirming — do not pay again, show order #047 to staff** |
| "Pay now by card" or "call a waiter" | Three distinct methods: pay online, cash, **card at the table** (which tells the waiter to bring the terminal) |
| Orders identified by UUID | Short speakable `order_code` (`#047`), on the guest's phone, the kitchen ticket and the printed ticket |
| Search only inside one category | Global search on the landing page, all categories, all three languages, sold-out items shown and labelled |
| Generic "popular items" upsell | One relevant, dismissible suggestion, aware of the cart, the time and availability |
| No prompt after the meal | After-meal suggestion on the running tab — only once food is served, never after the bill is requested |
| Grand total first seen at the pay buttons | Itemised subtotal, tip and total before any button |
| No undo | Undo on cart removal, including when it was the last line |
| PWA launch (`/menu`, no query string) silently demoted a guest to browse-only | Session read from the device, not the URL |

No tip is preselected. No fake scarcity, no countdowns, no guilt copy, no forced
account.

### Kitchen and floor

- **Print claiming.** `claim_ticket_print` flips the ticket atomically and
  returns `true` to one caller only. Two devices, or a reload inside the
  auto-print window, can no longer double-print. Failures are visible with a
  **Reprint** button.
- **Connection state.** A live/reconnecting pill, plus a 15-second polling
  fallback whenever the socket is not subscribed. A kitchen screen can no longer
  be silently 20 minutes stale.
- **Honest payment labels.** "Chose card" can no longer read as "paid". Every
  state carries an icon *and* words, never colour alone.
- **Cash vs POS terminal recorded separately** — they reconcile against the
  drawer and the terminal batch respectively.
- **Orders are cancelled with a reason, never deleted.** Deleting destroyed the
  financial record.
- **Urgency spelled out** (`!`, `!!`) as well as coloured.

### Management

- **Admin → Service & suggestions** — real emergency brakes, enforced
  server-side: pause ordering (with the message guests see), disable
  pay-at-table, disable online card, set a kitchen-delay notice, switch
  suggestions off. An old cached build cannot work around any of them.
- **Suggestion curation** — source item → recommended item, typed, prioritised,
  individually enableable.
- **Daily report rebuilt** — three settlement channels shown separately, plus a
  "needs attention before close" panel for money owed, payments that started and
  never resolved, and rejected provider callbacks.
- **Correct denominators** — `completed_orders` defines a sale once:
  `awaiting_payment`, `payment_failed` and `cancelled` orders are not revenue.

### Integrity, security, privacy

- **Server-side state machine.** A `BEFORE UPDATE` trigger validates every
  transition and rejects direct writes to `total`, `tip_amount`,
  `payment_status`, `payment_method`, `paid_at`, `refunded_amount`,
  `released_to_kitchen_at`, `order_code` and the fiscal fields — even from an
  authenticated staff client. Money changes only inside a `SECURITY DEFINER`
  function that opts in via a transaction-local GUC.
- **Append-only audit log** with actor, timestamp, before/after and reason.
  `INSERT`/`UPDATE`/`DELETE` are revoked from every client role.
- **Cancellations** are modelled, authorised and audited. **Refunds** are
  recorded internally with actor, reason, amount and status — there is
  **no provider refund call**; refunding a card payment today means doing it in
  the Monri dashboard and recording it here.
- **Fiscalization** upgraded from a boolean to status, actor, receipt number,
  provider reference and error, and Admin → Orders now captures the receipt
  number from the certified device. The app states plainly that it is **not** a
  certified fiscal device — see `docs/fiscalization-workflow.md`.
- **CORS allow-listed** on the payment endpoints instead of `*`; provider error
  bodies are logged, not forwarded to the browser.
- **`.env` untracked**, `.env*` ignored, and `npm run scan:secrets` fails on
  credential-shaped literals or any reference to a server-only secret from
  `src/`.
- **Analytics** is first-party, has no cookies and no cross-visit identity, and
  is structurally unable to record free text, names or payment data — blocked
  once by the type system and again in SQL.

### Bugs the new tests caught

The suites paid for themselves before they were even green:

- `guest_get_recommendations` had an ambiguous `id` reference that would have
  made every suggestion fail in production.
- `html[lang]` was only set for Arabic — a fully Bosnian page announced itself
  as English to screen readers.
- "Can this guest order?" was derived from the URL query string, so every PWA
  launch (`start_url` is `/menu`) demoted a valid session to browse-only.
- Removing the last cart line hid the Undo affordance along with the list.
- The pay-at-table confirmation displayed `0.00 KM`, reading the amount from the
  just-cleared cart.
- `TablePresence`, mounted globally for every guest, crashed the whole app if an
  RPC returned a non-array.

And in the measurement pass, where the tests were the only thing standing
between a plausible number and a wrong one:

- The **shift close** was two hours out of step with the reconciliation it read,
  so a café serving past midnight had takings no drawer count ever saw. Found
  because six tests failed at 01:35 and passed again by morning — not flakiness,
  the bug reporting itself once a day.
- A **CRLF checkout** silently disarmed every `pg_get_functiondef` rewrite: the
  search literals gained carriage returns, the stored function bodies did not,
  and every `replace()` matched nothing. The migrations would have applied
  "successfully" and done nothing. Caught only because each rewrite asserts it
  matched.
- `recent-items.ts` counted a repeat order **per line rather than per order**,
  and two of its orderings tie-broke on millisecond timestamps.
- A `suggestion_stats` primary key made `source_item_id` `NOT NULL` while the
  comment beside it said `NULL` meant "general suggestion". Dropping the PK does
  not drop the implied `NOT NULL`; both had to go.
- Three fixtures were wrong in ways that would have hidden real behaviour — a
  starter filed under Mains, a tips fixture modelling `total` backwards, and a
  test whose orders the new repeat rules correctly blocked. Each time the
  fixture was fixed, not the assertion.


### The suggestion engine

It reads the **whole visit**, not the cart. Five signals, individually weighted
in Admin → Service & suggestions:

| Signal | Where it comes from |
|---|---|
| **Curated** | Pairings management adds by hand |
| **Observed** | Market-basket **lift**, at two grains — per order for the cart, per *visit* for the after-meal moment |
| **Learned** | Acceptance per pair, placement and daypart, Bayesian-smoothed so a 1-of-1 fluke cannot outrank a proven pair |
| **Margin** | Internal only; never returned to the browser |
| **Exploration** | Decays with impressions, so a new dish gets a hearing |

Two grains matter more than it sounds. Order-level lift can only learn what
appears in one basket, so *steak now, coffee twenty minutes later* — the exact
relationship the after-meal upsell exists to exploit — was **never learnable**.
Visit-level affinity fixes that.

**Session-aware ranking.** Before scoring, the engine asks what this table has
ordered, what has actually been **served**, how long ago, what it has spent and
how many people are sitting there:

- suggestions stay near the table's own average line price — a 30 KM dish
  offered to an 18 KM table reads as a machine;
- the after-meal prompt fires off what was *served*, not what was ordered;
- repeats are **role-aware**: a second coffee is normal café behaviour and is
  allowed; a third main is not; a main still in the pan is blocked outright;
- an inferred diet is a ranking **penalty**, never a filter.

That last one was a live bug, not a hypothetical. One phone at a table of four,
someone adds a salad, and the old `cart_diet()` hard filter hid **every meat
dish from everybody**. A shared device must never speak for the table.

**Honest social proof.** A percentage is only shown from visit-grained data,
above a support threshold, quoting the **Wilson lower bound**. Below that it
says "often ordered with the steak" or stays silent. No invented scarcity, no
countdowns — not on principle alone, but because in a room where guests can see
each other's tables a visibly false claim costs more trust than the upsell earns.

**Thompson sampling — built, and switched off.** `smoothed_acceptance` returns
the posterior *mean* and throws the variance away, so a pair seen 4 times and a
pair seen 400 times are ranked as though both numbers were facts:

| | shown | accepted | scores | actually plausible |
|---|---|---|---|---|
| A | 4 | 4 | 0.294 | 8%–51% |
| B | 400 | 100 | 0.244 | 20%–29% |

A takes **100%** of the impressions forever, on four data points.
`sample_acceptance` draws from each posterior instead: A still leads — it should,
on the evidence — but at **67.9%**, so B keeps the rest and the guess resolves.
A genuinely bad pair (2% over 400 shows) wins **0.0%**, so exploring costs
nothing in exploitation.

It stays off until `bandit_readiness()` passes on real service data, then
`maybe_enable_sampling()` turns it on overnight and closes the running
experiment — because swapping the ranker mid-experiment would average two
treatments into a number describing neither.

Every guardrail is applied **after** scoring and re-asserted in tests with the
learning signals turned up: never sold out, never already in the cart, never the
same shelf unless typed as an upgrade. Learning reorders good suggestions; it
cannot introduce a bad one.

### Proving it earned anything

`/admin/impact` answers "what did this app earn us this month" in one sentence,
with a range, and is allowed to say it does not know.

The previous measurement layer was wrong in three ways that **all inflated
confidence**:

| Defect | Why it mattered |
|---|---|
| Assigned by session, analysed by **order** | Orders from one table are not independent. The standard error was understated, so the t-test could manufacture significance out of a table that ordered three times. |
| **Tips** counted as uplift | `orders.total` includes the tip. Guest generosity was being reported as a suggestion effect. |
| The experiment **re-bucketed its own history** | The holdout was a hash recomputed at read time, so moving the percentage dial silently rewrote which arm past sessions had been in. |

Now: one row per visit, `net_sales = total − tip − refunded`, arms frozen in a
ledger at session start, and nothing reported until **SRM**, **power** and
**service guardrails** all pass. A broken split is not a caveat printed under a
figure — it means there is no figure. The money projection uses the *low* end of
the interval.

Underneath is a **decision ledger**: every ranking writes what it considered,
what it chose, and — critically — a `no_suggestion` row when it chose nothing,
because without that the denominator is unknowable. Impressions are server-side
and deduped by primary key; "accepted" means *paid for*, not tapped.

### One QR for the room

La Soul prints a single code. The guest scans it and types the table they are
sitting at — **every visit**, because they will not be in the same seat next
time. Sessions expire after a configurable period of silence (default 3 hours;
the app heartbeats every minute while open), so a returning phone is asked for
its table rather than resuming a previous visit's.

The venue token is a first-class, rotatable value — "new code" is one click and
kills every printed one instantly. Per-table sticker tokens still work if you
ever want them.

Honest about the limit: with a venue QR the table number is guest-declared.
Someone can claim table 4 while sitting at table 9. That is inherent to the
single-QR product and no worse than a paper menu; what it buys is that nobody
outside the restaurant can order at all.

---

## Architecture

```
Guest (anonymous)                 Staff (Supabase Auth)
      │                                    │
      │ session_id + session_token         │ RLS by role
      ▼                                    ▼
┌─────────────────────────────────────────────────────┐
│  guest_* RPCs        │  staff RPCs  │  RLS policies  │  SECURITY DEFINER
├─────────────────────────────────────────────────────┤
│      enforce_order_integrity  (transitions + money) │  ← nothing bypasses
├─────────────────────────────────────────────────────┤
│                    PostgreSQL                       │
└─────────────────────────────────────────────────────┘
      ▲                                    ▲
      │ service role                       │
┌─────┴──────────────────┐        ┌────────┴─────────┐
│ monri-create-payment   │        │  monri-webhook   │  Edge Functions
│ (registers an attempt) │        │ (verifies, then  │
└────────────────────────┘        │  applies once)   │
                                  └──────────────────┘
```

Guests never authenticate and hold **no** table grants. Every guest action goes
through a narrow `SECURITY DEFINER` RPC that validates
`(session_id, session_token)`. Staff authenticate and are governed by RLS *plus*
the integrity trigger. The payment provider is an untrusted network peer whose
signature is verified and whose numbers are re-checked.

**Stack:** Vite · React 18 · TypeScript · Tailwind · shadcn/ui · Zustand ·
React Query · Framer Motion · Supabase (Postgres, Auth, Realtime, Edge
Functions) · Sentry · vite-plugin-pwa · Netlify.

### Routes

| Route | Who |
|---|---|
| `/menu`, `/menu/:type`, `/cart`, `/tab` | Guest |
| `/table/:tableNumber`, `/start` | Table entry |
| `/privacy` | Trust & privacy |
| `/kitchen` | Kitchen display (staff) |
| `/waiter`, `/waiter/monitor` | Waiter (PIN) |
| `/admin/*` | Admin — **impact**, dashboard, menu, tables, orders, QR, sections, tonight, printing, **service & suggestions**, **menu intelligence**, reports, audit, waiters, performance, analytics |

---

## Database

Migrations added by this release (additive and idempotent):

| Migration | Contents |
|---|---|
| `20260731090000_order_status_values.sql` | `awaiting_payment`, `payment_failed`. Split out because PostgreSQL will not let a new enum value be used in the transaction that added it. |
| `20260731090100_payment_safety.sql` | Order columns (code, release, paid-by, cancel, refund, fiscal), `audit_log`, the transition function and integrity trigger, `release_order_to_kitchen`, `guest_place_order` v3, guest payment-status and switch-to-table RPCs, service switches |
| `20260731090200_monri_callbacks_and_staff_payments.sql` | Callback event ledger, attempt registration and response recording, `monri_apply_callback`, `record_table_payment`, `staff_update_order_status`, `cancel_order`, `order_refunds` + `record_order_refund`, `set_order_fiscalization`, ticket claim/report/requeue |
| `20260731090300_merchandising_and_analytics.sql` | Menu-engineering columns, `menu_item_recommendations`, `guest_get_recommendations`, `guest_search_menu`, `analytics_events` + ingestion, `completed_orders` view, `day_reconciliation()` |
| `20260801090000_venue_qr_and_visits.sql` | Rotatable venue token, `resolve_table_for_token`, session idle expiry, `guest_resume_session`, `close_stale_sessions` |
| `20260801090100_learning_recommendations.sql` | `menu_item_affinity` + market-basket refresh, `suggestion_stats`, `suggestion_conversions`, Bayesian smoothing, holdout, the blended engine, `guest_place_order` v4 with attribution |
| `20260801090200_menu_intelligence_reporting.sql` | `menu_item_performance`, `menu_pairings`, `suggestion_performance`, `suggestion_impact`, `recommendation_engine_health`, `sold_out_impact`, `reco_holdout_comparison` |

Operations, printing and floor:

| Migration | Contents |
|---|---|
| `20260802090200_item_level_kitchen.sql` | Item status as the truth, `station`, undo, `kds_all_day` |
| `20260802090300_print_reliability.sql` | Outcome recorded from the printer, not from the click |
| `20260802090400_floor_alerts.sql` | Table alerts and the action sheet |
| `20260802090500_shift_close.sql` | Shift close, refunds UI, audit page |
| `20260802090600_eta_and_context.sql` | Prep-time learning, capacity-aware ETA |
| `20260802090700_smart_suggestions.sql` | Daypart and kitchen-load awareness |

Measurement and the engine (**not yet applied to production** — see below):

| Migration | Contents |
|---|---|
| `20260804090000_experiment_integrity.sql` | `session_outcomes` (net of tips and refunds), versioned `experiments`, frozen arm assignment, SRM, power/MDE, guardrails, session-grain `reco_holdout_comparison` |
| `20260804090100_decision_ledger.sql` | `recommendation_decisions` incl. `no_suggestion`, PK-deduped impressions, acceptance joined to paid outcomes, `rank_recommendations` split from its wrapper |
| `20260804090200_meal_roles.sql` | `meal_role` — the axis `station` could not express |
| `20260804090300_session_context.sql` | Whole-visit context, role-aware repeats, price proportionality, diet as a penalty **(fixes a live bug)** |
| `20260804090400_session_affinity.sql` | Visit-grain affinity, `wilson_lower`, evidence tiers |
| `20260804090500_maintenance.sql` | Retention with a 120-day floor, advisory-locked nightly job |
| `20260804090600_app_impact.sql` | `food_cost`, `app_impact_summary()` |
| `20260804090700_guest_profiles.sql` | Device profiles, `guest_forget_me` |
| `20260804090800_bandit_readiness.sql` | The gate |
| `20260804090900_thompson_sampling.sql` | `sample_acceptance`, the switch, nightly auto-enable |
| `20260805090000_business_day.sql` | **The trading day is Sarajevo's, not UTC's** — see below |

Full lifecycle contract: [docs/order-state-machine.md](docs/order-state-machine.md).

### The trading day

Every operational "today" — reconciliation, shift close, sales report, waiter
rota — runs on `business_day()`, the **Sarajevo** day, not UTC.

`close_shift` used to pick the day in Sarajevo and `day_reconciliation` measured
it in UTC, two hours apart in summer. For a café serving past midnight that
meant a close at 01:15 reported an `expected_cash` **missing everything sold
since midnight** — the drawer was over by exactly the late-night trade, nightly,
and those orders were reconciled by *no* close at all. At 02:00 local, mid
service, every waiter also silently lost their section.

Querying by hand? Use `day_reconciliation()` with no argument. Passing
`CURRENT_DATE` asks for the UTC day and reintroduces the bug.

### Applying migrations

The repository is the source of truth; the live database lags it. Ask Lovable to
**run the files**, never to copy their contents into a new migration — that has
already produced a duplicate set once, and several of these files rewrite an
existing function via `pg_get_functiondef` and will not survive a paraphrase.

Line endings are **content** here for the same reason; see `.gitattributes`.

---

## Testing

```bash
npm test                                              # 457 unit + integration
npx vitest run supabase/tests/payment-safety.test.ts  # 41 money tests
npx vitest run supabase/tests/business-day.test.ts    # the trading day
npm run test:e2e                                      # 97 runs across 3 browsers
npm run verify                                        # every gate
```

The SQL integration suite boots **PGlite** (PostgreSQL in WASM), applies a
minimal Supabase shim and then **every migration in order**, so the money rules
are tested against real triggers, real PL/pgSQL and a real planner — no Docker,
no network, no Supabase project.

The E2E suite is structurally unable to reach production: the build runs with
`--mode e2e` against a non-existent host, every Supabase and Edge Function call
is intercepted, the interception fixture is `auto` (Playwright fixtures are
lazy), and the service worker is blocked so it cannot serve requests around the
stubs.

Details and known gaps: [docs/testing-guide.md](docs/testing-guide.md).

---

## Environment

Client-side (`.env`, Netlify) — only `VITE_*` reaches the browser:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_PUBLISHABLE_KEY=
VITE_SENTRY_DSN=              # optional
VITE_MONRI_ENABLED=false      # true only after the sandbox matrix passes
```

Server-side (**Supabase → Edge Functions → Secrets** — never in `.env`, never
in the repo):

```
MONRI_MERCHANT_KEY            # secret
MONRI_AUTHENTICITY_TOKEN
MONRI_ENVIRONMENT             # test | production
MONRI_CALLBACK_URL
MONRI_CURRENCY                # BAM
ALLOWED_ORIGINS               # https://order.lasoul.net,http://localhost:8080
```

`VITE_MONRI_ENABLED` only decides whether the button is *offered*.
`restaurant_settings.online_card_enabled` decides whether the database will
**accept** a card order, and defaults to `false`.

---

## Documentation

| Document | Read it when |
|---|---|
| [master-product-audit.md](docs/master-product-audit.md) | You want to know what was wrong and why a fix exists |
| [order-state-machine.md](docs/order-state-machine.md) | You are touching order status or money |
| [monri-go-live.md](docs/monri-go-live.md) | Turning on card payments |
| [security-review.md](docs/security-review.md) | Security posture, remaining risks, incidents |
| [fiscalization-workflow.md](docs/fiscalization-workflow.md) | Fiscal receipts and reconciliation |
| [product-metrics.md](docs/product-metrics.md) | Deciding whether a change worked |
| [growth-and-merchandising.md](docs/growth-and-merchandising.md) | Raising order value without becoming pushy |
| [kitchen-and-printing.md](docs/kitchen-and-printing.md) | You are touching the kitchen board, stations, or the printer |
| [suggestions-and-timing.md](docs/suggestions-and-timing.md) | How suggestions get chosen, and how a wait is estimated |
| [measuring-upsell.md](docs/measuring-upsell.md) | Whether the suggestions earn their place, why the obvious ways to measure that are wrong, and when the bandit turns itself on |
| [operations-runbook.md](docs/operations-runbook.md) | Something is broken during service |
| [restaurant-staff-training.md](docs/restaurant-staff-training.md) | Print it for the floor |
| [testing-guide.md](docs/testing-guide.md) | Adding tests |
| [launch-checklist.md](docs/launch-checklist.md) | Going live, or rolling back |

---

## Still blocked externally

Nothing in this repository can resolve these:

- Monri **online** merchant account — the existing physical POS relationship
  does not authorise e-commerce.
- Online MID/TID from the acquiring bank.
- A card-not-present acquiring agreement.
- Monri sandbox credentials — until they exist, the 16-case matrix in
  `docs/monri-go-live.md` §5 cannot be run against the provider.
- Accountant confirmation of the fiscal workflow.
- An approved fiscal provider, if a direct integration is required.

Everything else is ready. Pay-at-table ordering is fully functional and safe to
run today with online card payment switched off.

---

## Contributing

1. Branch from `main`.
2. `npm run verify` must pass before you push.
3. A money rule belongs in `supabase/tests/`, not only in the UI — the UI is the
   least authoritative place it is enforced.
4. Never bypass an RPC to write an order's financial columns. The database will
   reject it, and that is the point.
