# La Soul — Master Product Audit

**Date:** 2026-07-31
**Scope:** full repository (`src/`, `supabase/`, `docs/`, build + deploy config)
**Baseline commit:** `03907fb` (main)
**Audit branch:** `production-hardening`

This document is the single source of truth for what is wrong, how bad it is, and
what we did about it. Findings are graded **P0 → P3** and each carries problem,
evidence, business/guest/staff impact, fix, effort and expected result.

---

## 0. Baseline measurements (before any change)

Recorded on a clean `npm ci` of the baseline commit:

| Check | Command | Result |
|---|---|---|
| Install | `npm ci` | ✅ 798 packages |
| Typecheck | `tsc -p tsconfig.app.json --noEmit` | ❌ **1 error** — `src/lib/i18n.ts(133,3) TS1117` duplicate `'continue'` key |
| Lint | `npm run lint` | ✅ 0 errors, 7 warnings (all `react-refresh/only-export-components` in shadcn primitives) |
| Unit tests | `npm run test` | ✅ 22 passing / 6 files |
| Build | `npm run build` | ✅ 27.4 s, PWA precache 115 entries / 1.65 MB |
| E2E tests | — | ❌ **none exist** (`playwright` is a devDependency but there is no config, no spec, no script) |
| `npm run typecheck` | — | ❌ **script missing** |

**Largest bundles:** `charts-vendor` 398 kB (recharts — admin only, correctly split),
`supabase-vendor` 213 kB, `react-vendor` 201 kB, `motion-vendor` 136 kB.
The guest entry path is well split; the guest never downloads recharts.

**Architecture as found:** Vite + React 18 + TS, Tailwind + shadcn, Supabase
(Postgres + Auth + Realtime + Edge Functions), Zustand for cart/session, React
Query for server state, Framer Motion, Sentry (opt-in via DSN), vite-plugin-pwa.
Guests are anonymous and never authenticate: every guest action goes through a
`SECURITY DEFINER` RPC that validates `(session_id, session_token)`. Staff and
admin authenticate with Supabase Auth and are governed by RLS. **This shape is
correct and was preserved** — the failures are in the payment/state layer, not the
architecture.

---

## 1. Technical quality

### P0-1 — Card orders reach the kitchen before payment is confirmed

**Problem.** `guest_place_order` creates every order with `status = 'pending'` and
then unconditionally calls `enqueue_order_ticket(v_order.id, 'kitchen')` — for card
orders too. The kitchen display fetches all orders with
`status in ('pending','confirmed','preparing','ready')` with no payment filter, and
auto-prints anything `pending` created in the last 60 s.

**Evidence.**
- `supabase/migrations/20260620180000_printing_tipping_reports.sql:125-149` — insert with
  `payment_status = 'pending'` for card, then `enqueue_order_ticket(...)` on line 149.
- `src/pages/KitchenDisplay.tsx:195` — `.in('status', ['pending','confirmed','preparing','ready'])`.
- `src/pages/KitchenDisplay.tsx:156-167` — auto-print loop keyed only on `o.status !== 'pending'`.

**Business impact.** Direct, unbounded revenue loss. A guest opens the card form,
abandons it, and the kitchen has already cooked and plated the food. At La Soul's
average ticket this is one full order of food and labour per abandonment.

**Guest impact.** None visible — which is exactly why it will not be caught early.

**Staff impact.** Kitchen produces food nobody has paid for; the waiter discovers
it only when the guest leaves. Erodes trust in the system.

**Fix.** Introduce a real, server-enforced order lifecycle. Card orders are created
in a new `awaiting_payment` status, are not enqueued for printing, and are excluded
from every kitchen/waiter query. A verified Monri callback is the only thing that
can call `release_order_to_kitchen()`.

**Effort.** M (migration + edge function + two UI queries). **Expected result.** Zero
unpaid card orders produced. **Implement immediately** — not an experiment.

---

### P0-2 — The payment callback does not verify amount or currency

**Problem.** `monri-webhook` verifies the HMAC-ish digest and then trusts the rest
of the payload completely. It looks up the transaction by `order_number` and writes
`payment_status = 'paid'` without ever comparing the callback's `amount` and
`currency` to the amount we asked for.

**Evidence.** `supabase/functions/monri-webhook/index.ts:95-121` — selects only
`id, order_id`; no `amount_minor` / `currency` comparison anywhere in the file.

**Business impact.** An approved-for-1-KM callback marks a 120-KM order paid. Even
without an attacker, a provider-side partial capture or currency mismatch silently
becomes "paid" in our books and corrupts every revenue report and reconciliation.

**Fix.** Load `amount_minor` + `currency` on the transaction; require exact match
before approving; on mismatch record `status = 'error'` with a reason and **do not**
release the order. Add currency normalisation and an explicit mismatch audit row.

**Effort.** S. **Expected result.** Financial truth. **Implement immediately.**

---

### P0-3 — Callback is not idempotent and allows backwards transitions

**Problem.** Every callback overwrites `payment_transactions.status` and
`orders.payment_status` with whatever it carries. Monri retries callbacks. A
duplicate `approved` re-runs all side effects; a late `pending` after an `approved`
downgrades a paid order back to pending; a stray `refunded` flips a live order.

**Evidence.** `supabase/functions/monri-webhook/index.ts:104-121` — unconditional
`update`, no status guard, no processed-callback ledger.

**Business impact.** Double kitchen releases, double prints, and orders that
oscillate between paid and unpaid in reports.

**Fix.** A dedicated `payment_callback_events` ledger keyed by a deterministic
event hash (unique) + a `monri_apply_callback` RPC that (a) rejects replays, (b)
enforces a one-way status lattice (`created → pending → approved → refunded`,
terminal `declined/cancelled/error`), and (c) releases the order to the kitchen
**exactly once** via a guarded `UPDATE ... WHERE status = 'awaiting_payment'`.

**Effort.** M. **Expected result.** Callback storms are harmless. **Implement immediately.**

---

### P0-4 — Every checkout tap creates a new payment attempt

**Problem.** `monri-create-payment` unconditionally inserts a new
`payment_transactions` row. Double-tap, refresh-and-retry, or a flaky network
produces multiple live `monri_order_number`s for one order. If two of them are paid
the guest is charged twice and we have no linkage to detect it.

**Evidence.** `supabase/functions/monri-create-payment/index.ts:85-98`.

**Business impact.** Double charges → chargebacks, refunds, reputational damage in
a small city where word travels.

**Fix.** Reuse a live attempt (`created`/`pending`) for the same order *and the same
amount*; only create a new attempt when the amount changed or the previous attempt
reached a terminal state. Return the existing `client_secret`.

**Effort.** S. **Expected result.** One live attempt per order. **Implement immediately.**

---

### P0-5 — The UI claims "Payment received" on the browser's word

**Problem.** `MonriCardForm.pay()` reads the SDK's client-side result and, on
`approved`, calls `onSuccess()`, which sets `cardPaid` and renders **"Payment
received"** with a green tick. The backend may not have received the callback yet
— or may reject it (wrong amount, replay, signature failure).

**Evidence.** `src/components/guest/MonriCardForm.tsx:131-133`;
`src/pages/CartPage.tsx:374-380`.

**Business impact.** A guest who is told "paid" and walks out while the callback
fails is an unrecoverable loss and a dispute.

**Guest impact.** Worse in the other direction too: there is no "still confirming"
state, so a slow callback looks like a failure and the guest pays twice at the till.

**Fix.** The SDK result only ends the card *form*. Confirmation comes from polling a
new `guest_get_order_payment` RPC that reads server state. Three honest states:
**confirming → received → still confirming, do not pay again (show order #NNNN to
staff)**.

**Effort.** M. **Expected result.** No false payment success. **Implement immediately.**

---

### P0-6 — The cart is destroyed before the card is charged

**Problem.** On the card path `clearCart()` runs the moment the Monri form opens.
A declined card, a closed sheet, or a reload leaves the guest with an empty cart and
an unpaid order.

**Evidence.** `src/pages/CartPage.tsx:184`.

**Guest impact.** The single largest abandonment driver in the flow: "my card failed
and the app deleted my order".

**Fix.** Clear the cart only after the server confirms the order was accepted
(pay-at-table) or the payment is confirmed/released (card). On decline, keep the
cart and offer *retry* or *pay at table*.

**Effort.** S. **Expected result.** Recoverable failures. **Implement immediately.**

---

### P0-7 — `.env` is committed to git

**Problem.** `.gitignore` has no `.env` rule and `git ls-files` shows `.env` tracked
(added in commit `a9a74eb`).

**Evidence.** `git ls-files | grep ^.env` → `.env`, `.env.example`.

**Assessment.** The file currently holds only `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PROJECT_ID` and the **anon publishable key** — all three are
client-side public values by design, so this is *not* a live credential leak. It is
still P0-grade hygiene: the file is the natural place someone will paste a real
secret, and the next commit would publish it.

**Fix.** Ignore `.env*` (keeping `.env.example`), untrack the file, document the
required values, and add a repo secret-scan script.

**Effort.** S. **Expected result.** No path from "developer edits .env" to
"secret on GitHub". **Implement immediately.**

---

### P1-8 — Duplicate kitchen prints are prevented only by an in-memory `Set`

**Problem.** `printedRef` is a `useRef(new Set())` in the kitchen page. Refresh the
tab within 60 s of an order and it prints again. Designate two devices as printers
and both print. A crash-and-recover reprints the backlog edge cases.

**Evidence.** `src/pages/KitchenDisplay.tsx:136,157-158`.

**Staff impact.** Duplicate tickets are the classic cause of double-cooked dishes.

**Fix.** Move the claim to the database: `claim_ticket_print(ticket_id, device_id)`
atomically flips `order_ticket_events.status` `queued → printed` and returns whether
*this* device won the claim. Failure paths mark `failed` and expose a **Reprint**
action. Keep the local `Set` as a cheap first gate.

**Effort.** M. **Expected result.** One ticket, one print, across devices and reloads.

---

### P1-9 — No server-side order state machine

**Problem.** Staff clients call `supabase.from('orders').update({ status })`
directly. RLS checks *who* may write, never *what* transition is legal. Any staff
client (or a stale tab, or a bug) can move `served → pending`, resurrect a
`cancelled` order, or set `payment_status` to anything.

**Evidence.** `src/pages/KitchenDisplay.tsx:320`;
`supabase/migrations/...security_pos_monri.sql:973-976` (`FOR ALL` policy, no CHECK on transitions).

**Fix.** A `BEFORE UPDATE` trigger validating a transition table, plus a
`payment_status` column guard so only `SECURITY DEFINER` functions may change money
fields. Documented in `docs/order-state-machine.md`.

**Effort.** M. **Expected result.** Reports and kitchen state cannot be corrupted.

---

### P1-10 — Realtime has no fallback, no reconnect signal

**Problem.** Kitchen and waiter screens subscribe once and assume the socket lives
forever. On a Wi-Fi blip the screen silently stops updating; nothing tells staff.

**Evidence.** `src/pages/KitchenDisplay.tsx:275-317` — `.subscribe()` with no status
callback, no polling fallback, no visible connection state.

**Staff impact.** The worst possible failure: a kitchen screen that *looks* fine and
is 20 minutes stale during service.

**Fix.** Subscribe with a status callback, surface a connection pill
(`Live / Reconnecting / Offline`), and poll every 15 s whenever not `SUBSCRIBED`.

**Effort.** S. **Expected result.** Staff always know whether the screen is live.

---

### P1-11 — Typecheck error shipped on `main`

`src/lib/i18n.ts` declares `'continue'` twice; TS1117. The build does not fail
(esbuild strips it) so it went unnoticed — which is the real problem: there is no
`typecheck` script and therefore no gate.

### P2-12 — Dead code

`src/lib/menu-data.ts` (150 lines of hardcoded 2024 menu, prices in EUR-ish values)
is imported nowhere. It is a trap: someone will "fix a price" there.

### P2-13 — No E2E harness

Playwright is installed but there is no config, no spec, no script. The critical
flows (QR → order → payment → kitchen) are untested end to end.

### P2-14 — Duplicate migrations

`20260620090000_security_pos_monri.sql` and `20260620111154_*.sql` are
near-identical 1,100-line files, as are `20260620132815_*` and
`20260620160000_security_audit_fixes.sql`. Idempotent, so harmless to run, but they
double the surface anyone must read to understand current schema.

---

## 2. Restaurant operations

### P1-15 — No way to record how a table actually paid

**Problem.** The model has `payment_method ∈ {card, cash}`. "Cash" is used to mean
"pay at the table", which in practice is **either** cash **or** the physical Monri
POS terminal. Nothing lets a waiter record which one happened, or that it happened
at all.

**Business impact.** End-of-day reconciliation is impossible: the cash drawer and
the POS terminal batch cannot be matched to orders. Management cannot see what is
still owed.

**Fix.** Split into `payment_method ∈ {card_online, cash, pos_terminal}` (legacy
values mapped forward) and add `record_table_payment(order_id, method, amount,
note)` — staff-only, audit-logged, with a `paid_at` / `paid_by` trail.

**Effort.** M. **Expected result.** A closable day.

### P1-16 — Fiscalization is a boolean

`orders.fiscalized boolean` + `fiscalized_at`. No actor, no receipt number, no
failure state. `AdminOrders` toggles it optimistically with no audit trail.
BiH fiscal law requires a receipt reference that can be reconciled. Extended to
`fiscalization_status / fiscalized_by / fiscal_receipt_number /
fiscal_provider_reference / fiscalization_error`, with the honest position that this
app is **not** a certified fiscal device — documented in
`docs/fiscalization-workflow.md`.

### P1-17 — No end-of-day reconciliation

`AdminReports` sums orders by payment method but counts **any** order, including
`awaiting_payment` and failed-card orders, as revenue. There is no shift concept, no
close acknowledgement, no discrepancy view, no immutable log.

### P2-18 — No refund or cancellation model

Nothing records why an order was cancelled, who did it, or whether money moved.

### P2-19 — Waiter workflow gaps

`WaiterDashboard` shows a `PaymentBadge` and nothing else: no "mark paid", no bill
completion, no late-table surfacing, no distinction between "guest chose card" and
"card actually paid" (the badge shows `Card · pending` which staff read as "card").

---

## 3. Guest experience

### P1-20 — The guest is never told what happens after they order

The success screen says "order confirmed" and shows a tick. There is no order
number, no ETA, no live status, no way back to a specific order. `RunningTabPage`
exists but nothing routes the guest there after checkout.

### P1-21 — No order reference the guest can quote

Orders are UUIDs. When something goes wrong the guest cannot tell a waiter *which*
order. Fixed with a short human `order_code` (e.g. `A47`) generated server-side and
shown on the confirmation, the tab, the kitchen ticket and the printed ticket.

### P1-22 — Tip UI is decent but the total is presented late

Tip presets are `0 / 5 / 10 / 15 %` with **no preselection** — ethically correct and
kept as-is. But the checkout sheet is the first place the guest sees the grand
total, and the "no refund" microcopy (`no_refund_short`) sits directly under the
price where it reads as a warning at the worst moment.

### P2-23 — Search is absent

There is no search anywhere in the guest app. On a menu of this size (6 drink
subcategories + 5 food + desserts) search is the single highest-value discovery
feature.

### P2-24 — Product detail is thin

`MenuItemDetail` (162 lines) shows image, name, description, price, notes,
quantity. No allergens, no portion info, no modifiers, no pairing.

### P2-25 — Arabic RTL is partial

`dir` is handled and icons rotate for `ar`, but the Monri card form is forced to
`locale: 'en'` for Arabic (`MonriCardForm.tsx:88`) and several layouts use
`ml-auto` / `-ml-2` rather than logical properties.

### P2-26 — Accessibility gaps

Touch targets are mostly ≥44 px (good). But: order status is communicated by colour
alone in the kitchen kanban; modals are hand-rolled `motion.div`s without focus
traps or `role="dialog"`; several icon-only buttons lack labels; `aria-live` is
never used for async results.

---

## 4. Commercial performance

### P1-27 — Recommendations are not recommendations

`UpsellRow` shows "popular items overall, minus what's in the cart". It is not
aware of *what* is in the cart, the time of day, the guest's language, or whether
the item is even sensible with the order. A guest ordering a burger may be offered
another burger.

**Fix.** A real relationship model (`menu_item_recommendations`: source →
recommended, typed `pair_with / upgrade_to / frequently_bought_together /
after_meal / alternative / add_on`, with priority, time window, language and
enable flag), a category-based fallback, availability filtering, and a single
primary suggestion per surface. Admin-configurable.

### P1-28 — No post-order sell

After the food arrives there is no prompt for coffee, dessert or another drink —
the highest-margin, highest-acceptance moment in the entire visit, and the one that
a good human waiter never misses.

### P2-29 — No merchandising signal on the menu

No "popular", "signature", "new" or "staff favourite" badges. Dietary tags exist
(`menu_items.dietary_tags`) and are shown, which is good. There is no way for
management to promote an item.

### P2-30 — No measurement of anything commercial

There is no event tracking at all. Add-to-cart rate, checkout start, abandonment,
upsell acceptance — all unknown. **Every commercial change below is therefore
unfalsifiable until this is fixed**, which is why analytics is sequenced before the
experiments.

### P3-31 — No bundles, no promotions, no loyalty

Correctly absent for now. Recommended as later phases with a documented model
rather than speculative code.

---

## 5. Brand quality

**Strengths — preserved.** The sage/cream palette (`#7E9B79` on `#F7F4EC`), serif
display + sans body pairing, `card-lux` elevation system, and the restrained hero
with the animated letterforms are genuinely good and read as premium and
specifically *La Soul*, not template. Motion is tasteful and mostly transform-only.

**Issues.**
- **P2-32** — Motion does not respect `prefers-reduced-motion` anywhere.
- **P2-33** — The success screen's double ping-ring animation is the most elaborate
  motion in the app and sits on the least appropriate screen (the guest wants
  information, not celebration).
- **P3-34** — Kitchen/admin surfaces drift from the guest brand into generic
  dashboard styling.
- **P3-35** — Copy is inconsistent between languages: several Bosnian strings are
  noticeably more terse than their English counterparts, and Arabic uses "رمز QR"
  where Arabic speakers say "رمز الاستجابة السريعة" in formal contexts.

---

## Findings summary

| ID | Grade | Area | Title | Status |
|---|---|---|---|---|
| P0-1 | P0 | Payment | Card orders reach kitchen unpaid | **Fixed** |
| P0-2 | P0 | Payment | Callback skips amount/currency verification | **Fixed** |
| P0-3 | P0 | Payment | Callback not idempotent, allows regressions | **Fixed** |
| P0-4 | P0 | Payment | Duplicate payment attempts per order | **Fixed** |
| P0-5 | P0 | Payment | UI claims paid on client result | **Fixed** |
| P0-6 | P0 | Conversion | Cart destroyed before charge | **Fixed** |
| P0-7 | P0 | Security | `.env` tracked in git | **Fixed** |
| P1-8 | P1 | Kitchen | In-memory duplicate-print guard | **Fixed** |
| P1-9 | P1 | Integrity | No server-side state machine | **Fixed** |
| P1-10 | P1 | Reliability | Realtime has no fallback/indicator | **Fixed** |
| P1-11 | P1 | Build | Typecheck error, no typecheck gate | **Fixed** |
| P1-15 | P1 | Operations | Cannot record cash vs POS payment | **Fixed** |
| P1-16 | P1 | Operations | Fiscalization is a boolean | **Fixed** |
| P1-17 | P1 | Operations | No end-of-day reconciliation | **Fixed** |
| P1-20 | P1 | Guest | No post-order clarity | **Fixed** |
| P1-21 | P1 | Guest | No human order reference | **Fixed** |
| P1-27 | P1 | Revenue | Recommendations not context-aware | **Fixed** |
| P1-28 | P1 | Revenue | No post-order sell | **Fixed** |
| P2-12 | P2 | Maintainability | Dead `menu-data.ts` | **Fixed** |
| P2-13 | P2 | Testing | No E2E harness | **Fixed** (harness + specs) |
| P2-14 | P2 | Maintainability | Duplicate migrations | Documented, not rewritten |
| P2-18 | P2 | Operations | No refund/cancellation model | **Fixed** (model + adapter; provider call gated) |
| P2-19 | P2 | Waiter | Waiter payment clarity | **Fixed** |
| P2-23 | P2 | Discovery | No search | **Fixed** |
| P2-24 | P2 | Discovery | Thin product detail | Partially — allergens/pairing added |
| P2-25 | P2 | i18n | Arabic RTL gaps | **Fixed** (locale passthrough + logical props) |
| P2-26 | P2 | A11y | Colour-only status, modal semantics | **Fixed** |
| P2-30 | P2 | Analytics | No measurement | **Fixed** |
| P2-32 | P2 | Motion | No reduced-motion support | **Fixed** |
| P3-31 | P3 | Revenue | Bundles/promotions/loyalty | Deferred — modelled in docs |
| P3-34/35 | P3 | Brand | Staff UI drift, copy polish | Partially |

---

## Sequencing rationale

We deliberately did **not** start with revenue features. The order was:

1. **Stop losing money** (P0-1 … P0-4) — payment correctness.
2. **Stop lying to the guest** (P0-5, P0-6) — payment honesty.
3. **Make state trustworthy** (P1-9, P1-8, P1-10) — so every number downstream means
   something.
4. **Make the day closable** (P1-15 … P1-17) — operations.
5. **Measure** (P2-30) — so step 6 is falsifiable.
6. **Then sell** (P1-27, P1-28, P2-23) — discovery and attachment.

A conversion improvement layered on a payment system that can release unpaid food
is not an improvement; it is a faster way to lose money.
