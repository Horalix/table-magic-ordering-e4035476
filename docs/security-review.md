# Security review

Scope: the whole repository at branch `production-hardening`, plus the Supabase
schema it defines. This records what was fixed, what remains, and what only a
human with dashboard access can do.

---

## Threat model in one paragraph

Guests are **anonymous** and always will be — requiring an account to order
would be worse for the restaurant than any risk it mitigates. So the trust
boundary is: a guest proves they are at a table by holding
`(session_id, session_token)`, and every guest action goes through a narrow
`SECURITY DEFINER` RPC that validates that pair. Guests have **no** direct table
access. Staff authenticate with Supabase Auth and are governed by RLS plus, now,
a financial-integrity trigger. The payment provider is treated as an untrusted
network peer whose signature we verify and whose numbers we re-check.

---

## Fixed in this branch

### Money and state integrity

| Issue | Fix |
|---|---|
| Card orders were released to the kitchen before payment | `awaiting_payment` state; `release_order_to_kitchen()` is the only door, guarded by `released_to_kitchen_at IS NULL` |
| Callback trusted any signed payload | `monri_apply_callback` verifies amount **and** currency against the registered attempt before approving |
| Callbacks were replayable | `payment_callback_events` unique on `(provider, event_hash)`; a byte-identical retry is inert |
| Callbacks could move status backwards | Monotonic ladder via `payment_status_rank()`; a late `pending` cannot un-pay a paid order |
| Every tap created a chargeable attempt | `monri_register_attempt` reuses a live attempt for the same order **and** amount |
| Any staff client could write `payment_status`, `total`, `fiscalized` | `enforce_order_integrity` trigger rejects direct writes to all financial columns unless inside an authorised `SECURITY DEFINER` call |
| Any client could make illegal status transitions | Same trigger validates against `order_transition_allowed()` |
| Orders could be hard-deleted from the admin UI | Replaced with `cancel_order(reason)`; the financial record survives |
| No record of who did what | Append-only `audit_log`; `INSERT`/`UPDATE`/`DELETE` revoked from `anon` and `authenticated` |

### Application and transport

| Issue | Fix |
|---|---|
| Edge Functions used `Access-Control-Allow-Origin: *` while accepting a guest session token | Allow-listed via `ALLOWED_ORIGINS`; the webhook grants no CORS at all (it is server-to-server) |
| Provider error bodies were forwarded to the browser | Logged server-side; the client gets an opaque code |
| `.env` was tracked in git | Untracked, `.env*` ignored, `.env.example` kept |
| No secret gate | `npm run scan:secrets` fails on credential-shaped literals and on any reference to `MONRI_MERCHANT_KEY` / `SUPABASE_SERVICE_ROLE_KEY` from `src/` |
| E2E could reach the live project | `.env.e2e` points the test build at a non-existent host; the service worker is blocked so nothing escapes interception |
| A non-array RPC response crashed the whole guest app | `TablePresence` (mounted globally) now guards its input |

### Analytics

Anonymous clients can write events, so the endpoint is hardened:

- unknown event names are dropped, not stored — the vocabulary is a closed list
  in SQL;
- non-scalar property values are stripped before insert, which structurally
  prevents a payload, a note or a token being recorded;
- batch size capped at 25, and 500 events per visit per hour;
- `analytics_events` is not directly writable by `anon` (verified by test).

### Already correct before this work — and preserved

These were done well and were deliberately not disturbed:

- Guests have **no** table-level grants; `REVOKE ... FROM anon` on every
  operational table.
- All `SECURITY DEFINER` functions set `search_path = public`.
- Realtime publishes explicit column lists for `tables` and `table_sessions`,
  so `qr_token`, session `token` and `host_client_id` never enter the WAL
  stream.
- `waiters.pin_hash` has `SELECT` revoked; the UI reads a generated `has_pin`
  boolean.
- Raw provider payloads in `payment_transactions` are admin-only.
- Waiter PIN verification happens in a `SECURITY DEFINER` RPC, not in the
  client.

---

## Remaining risks

| Risk | Severity | Why it remains | Mitigation |
|---|---|---|---|
| **QR token rotation is manual** | Medium | Tokens are 32 random bytes and per-table, which is strong, but a photographed QR stays valid until an admin rotates it | Rotate from Admin → QR Codes after any incident; consider scheduled rotation |
| **A shared table session is shared by design** | Medium | Anyone who joins a table can see the whole tab and order onto it — that is the product | Join requests need approval (or a 30 s auto-approve); sessions close at bill time |
| **`lasoul.financial_ctx` is transaction-scoped, not call-scoped** | Low | A future `SECURITY DEFINER` function that sets it and then calls untrusted SQL in the same transaction would extend the elevation | Only set it immediately before the guarded write; reviewed in every RPC here |
| **No rate limiting on guest RPCs beyond per-session caps** | Low–Medium | Supabase does not rate-limit RPC by default; current caps are 10 orders/session, 40 lines/order, 500 analytics events/visit/hour | Add a Supabase/Cloudflare rate limit in front of `/rest/v1/rpc/` before high-traffic launch |
| **Service-role key lives in Edge Function secrets** | Inherent | Required for the payment functions | Never expose it; rotate if a function's logs are ever shared |
| **`get_popular_items` is anon-callable** | Low | It aggregates order quantities only, no identities | Acceptable; it is menu-level data |
| **No CAPTCHA on session creation** | Low | An attacker with a valid table QR could open sessions | Table tokens are the gate; monitor `table_sessions` volume |

---

## Manual actions required (dashboard, not code)

These cannot be done from this repository and are **not** done:

1. **Rotate the Supabase anon key** if the previously committed `.env` was ever
   pushed to a public remote. The key is client-safe by design, but rotating is
   cheap and removes the question.
2. **Enable Leaked Password Protection** — Supabase → Authentication →
   Providers → Password.
3. **Enforce MFA on the Supabase and Netlify accounts.**
4. **Enable Point-in-Time Recovery** — Supabase → Database → Backups. Test one
   restore before go-live.
5. **Delete any deployed `seed-data` function** if one still exists in the
   project (it is not in this repo).
6. **Set `ALLOWED_ORIGINS`** as an Edge Function secret before the domain
   changes to `order.lasoul.net`.
7. **Review the Supabase project's exposed schemas** — only `public` should be
   in the API's schema list.
8. **Rotate every table QR token** once, after go-live, so that any token
   printed during development is dead.

---

## Secret rotation

| Secret | Where | Rotate when |
|---|---|---|
| `MONRI_MERCHANT_KEY` | Supabase Edge Function secrets | On any suspicion; immediately if it ever appears in a log, screenshot or repo |
| `MONRI_AUTHENTICITY_TOKEN` | Same | With the merchant key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | If Edge Function logs are shared externally |
| Supabase anon key | Same | Low urgency (public by design) |
| Table `qr_token` | Admin → QR Codes | After go-live, and after any incident |
| Waiter PINs | Admin → Waiters | On staff change |

---

## Incident response

**A payment is charged but the order never reached the kitchen.**
1. Find it: `SELECT * FROM orders WHERE status IN ('awaiting_payment','payment_failed') AND payment_status = 'paid'`.
2. Read the provider's side: `payment_callback_events` for that `order_id`.
3. If the money is genuinely ours, release it: `SELECT public.release_order_to_kitchen('<id>')` — idempotent, audited.
4. If the amount does not match, do **not** release. Refund and re-take.

**A duplicate charge.**
1. `SELECT * FROM payment_transactions WHERE order_id = '<id>'` — more than one `approved` is a duplicate.
2. Refund the later one in the Monri dashboard.
3. Record it: `record_order_refund(order_id, amount, 'card_online', 'duplicate charge', true, '<monri ref>')`.
4. This should be impossible; if it happens, capture the timeline before anything else and open an issue.

**Suspected credential exposure.**
1. Rotate the affected secret first, ask questions second.
2. Turn off online card payment (Admin → Service & suggestions).
3. Review `audit_log` for the exposure window.
4. Review `payment_callback_events` for `unknown_transaction` outcomes.

**A staff account is compromised.**
1. Supabase → Authentication → delete the user's sessions, then the user.
2. `SELECT * FROM audit_log WHERE actor_user_id = '<uid>' ORDER BY created_at DESC` — everything they touched is recorded.
3. Reverse any incorrect payment records via the same audited RPCs (never by direct SQL).

---

## Verification

```bash
npm run scan:secrets                                    # credential gate
npx vitest run supabase/tests/payment-safety.test.ts    # 41 integration tests
npx vitest run supabase/tests/                          # 65 total
npm run verify                                          # typecheck, lint, tests, scan, build
```

The integration suite explicitly asserts: the guest cannot control the total,
the guest cannot mark an order paid, an invalid or expired session is rejected,
a sold-out item is rejected, a card order stays out of the kitchen, a valid
callback releases exactly once, a duplicate callback is inert, a wrong amount or
currency does not release, only staff can record payment, and only a manager can
refund.
