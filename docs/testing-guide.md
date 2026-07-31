# Testing guide

## The suites

| Suite | Command | Runtime | What it protects |
|---|---|---|---|
| Unit | `npm test` (subset) | ~3 s | Pricing helpers, tips, i18n, cart store, ticket rendering, payment badge semantics, analytics sanitisation, Monri payload parsing |
| SQL integration | `npx vitest run supabase/tests/` | ~15 s | The money rules, against a **real PostgreSQL** |
| End-to-end | `npm run test:e2e` | ~2 min | The guest journey in mobile Chrome, mobile Safari and desktop |
| Everything + gates | `npm run verify` | ~2 min | typecheck → lint → unit + integration → secret scan → production build |

Current totals: **114 unit + integration tests** (10 files) and **55 E2E specs**
(3 browser projects). All passing.

---

## SQL integration tests — how they work

`scripts/db-harness.mjs` boots **PGlite** (PostgreSQL compiled to WASM),
applies `supabase/tests/harness/00_shim.sql` (a minimal stand-in for the
Supabase-managed pieces: the `anon`/`authenticated`/`service_role` roles, an
`auth.users` table, an `auth.uid()` that reads a settable claim, a `storage`
schema and the realtime publication), then applies **every migration in
`supabase/migrations` in order**.

That means the tests exercise the real triggers, the real PL/pgSQL, the real
constraints and the real planner — not a mock. No Docker, no network, no
Supabase project.

```bash
npx vitest run supabase/tests/payment-safety.test.ts          # 41 money tests
npx vitest run supabase/tests/merchandising-analytics.test.ts # 24 commerce tests
```

Impersonate a user inside a test with `actAs(db, userId)`; it sets
`request.jwt.claim.sub`, which the shim's `auth.uid()` reads — the same
mechanism `has_role()` and `is_staff_member()` depend on in production.

### What the money suite asserts

- A guest cannot influence the total, the unit price, or the tip cap.
- A sold-out item is refused, by name.
- Quantities are clamped; negative tips floor at zero.
- A card order is created `awaiting_payment`, has **no** ticket, and does not
  appear in any kitchen query.
- Pay-at-table orders are released immediately with exactly one ticket.
- An approved callback releases the order **once**; a duplicate is inert.
- A wrong-amount or wrong-currency callback does **not** release and does not
  mark paid.
- A late `pending` callback cannot un-pay a paid order.
- A declined callback parks the order in `payment_failed`, still out of the
  kitchen.
- The guest can switch a failed card order to pay-at-table — unless a payment is
  still in flight.
- Direct writes to `payment_status` / `total` are rejected.
- Illegal status transitions are rejected; the normal flow is allowed.
- Only staff can record payment; cash and POS terminal stay distinct.
- Only a manager can cancel a paid order or refund, and never more than was paid.
- Every financial action writes an audit row naming the actor.
- Exactly one device can claim a ticket print; a failed print re-queues.

### What the commerce suite asserts

- A sold-out item is never recommended, however high its priority.
- Nothing already in the cart is recommended.
- A burger does not suggest another burger — unless the admin typed it as
  `upgrade_to` or `add_on`.
- Time windows and language restrictions are honoured.
- After-meal suggestions never leak into the cart placement.
- The internal `margin_score` never appears in a guest-facing result.
- Search finds Bosnian names and shows sold-out matches as unavailable.
- Analytics drops unknown events, strips non-scalar props, caps batches, and is
  not directly writable by `anon`.
- Reconciliation keeps the three settlement channels separate, excludes
  `awaiting_payment` and `cancelled` orders from revenue, and surfaces money
  owed and rejected callbacks.

---

## End-to-end tests

```bash
npm run test:e2e                       # all three projects
npx playwright test --project=mobile-chrome
npx playwright test --ui               # interactive
```

First run needs browsers: `npx playwright install chromium webkit`.

### Safety properties of the harness

The E2E suite **cannot** reach a real Supabase project or a real payment
endpoint, by construction:

1. The build runs with `--mode e2e`, loading `.env.e2e`, which points at
   `https://e2e.invalid`.
2. Every `/rest/v1/**` and `/functions/v1/**` request is intercepted in
   `e2e/fixtures.ts`.
3. The interception fixture is `auto: true` — Playwright fixtures are lazy, and
   a spec that forgot to destructure `state` would otherwise run with no stubs
   at all.
4. `serviceWorkers: 'block'` — the PWA worker would otherwise serve menu
   requests itself and bypass interception.

If an interception is ever missed, the request fails against a non-existent
host rather than quietly hitting production.

### What the E2E suite covers

Discovery and search; the three payment methods; no preselected tip; payment
recovery (reload mid-payment, unresolved confirmation, decline, switch to
pay-at-table); paused ordering; Arabic RTL direction and no horizontal
overflow; Bosnian `lang`; every interactive control having an accessible name;
44 px tap targets; dialog semantics and Escape-to-close; reduced motion.

---

## Adding a test

**A money rule → SQL integration test.** If a rule can be stated as "the
database must never allow X", it belongs in `supabase/tests/`, because that is
the only layer an attacker cannot skip.

**A guest-visible behaviour → E2E.** Assert what a guest would notice, not the
implementation. `getByRole` over CSS selectors.

**A pure function → unit test.**

Do not test a money rule only in the UI. The UI is the least authoritative place
it is enforced.

---

## Continuous integration

```yaml
- run: npm ci
- run: npm run verify                  # typecheck, lint, tests, secret scan, build
- run: npx playwright install --with-deps chromium webkit
- run: npm run test:e2e
```

`npm run verify` is the gate that would have caught the typecheck error this
repository shipped with — the error existed for weeks because nothing ran
`tsc`.

---

## Known gaps

- **Kitchen and waiter screens have no E2E coverage.** They need an
  authenticated staff session, which the stub harness does not model. Their
  logic is covered at the SQL layer (transitions, print claiming, payment
  recording); the UI is not.
- **No visual regression testing.** Deliberate: screenshot diffs on a
  motion-heavy interface are mostly noise.
- **No load testing.** Worth doing before a busy weekend; the realistic
  bottleneck is Realtime fan-out on the kitchen screen, not the database.
- **The Monri sandbox has not been exercised** — no credentials exist yet. Every
  callback case is covered against real SQL, but the provider handshake itself
  is untested. See `docs/monri-go-live.md` §5.
