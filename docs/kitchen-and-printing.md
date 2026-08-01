# The kitchen, the bar, and the printer

Enforcement lives in `supabase/migrations/20260802090200_item_level_kitchen.sql`
and `20260802090300_print_reliability.sql`, covered by
`supabase/tests/kitchen-items.test.ts`, `print-reliability.test.ts` and
`src/lib/print-queue.test.ts`.

---

## 1. Item status is the truth

`order_items.status` is authoritative. `orders.status` is a **derived
projection** of it.

| every line is | the order becomes |
| --- | --- |
| `ready` | `ready` |
| any `preparing` or `ready` | `preparing` |
| otherwise | unchanged |

The derivation can only move an order **forward**, so the payment-gated
transitions and `enforce_order_integrity` in
[order-state-machine.md](order-state-machine.md) are never weakened by it.

`served` is never derived. A runner carries the whole tray, so per-item served
is bookkeeping nobody would do; it is set once, at order level.

**Load-bearing invariant.** `staff_update_order_status` writes `orders.status`
*first*, then cascades to lines. The derivation trigger therefore computes a
value equal to what is already there and matches zero rows. That statement
order is what prevents infinite recursion — do not reorder it.

## 2. Stations

`menu_items.station` is `kitchen` or `bar`, denormalised onto `order_items` at
insert — the same reasoning as `unit_price`, so re-categorising a dish next
month does not rewrite last week's tickets.

A KDS device picks its station once (`kitchen:station` in `localStorage`) and
keeps it. A station board hides orders with nothing for that station.

Drinks need no coursing logic: bar lines are on the bar board from the moment
they are placed.

## 3. Undo

Time-boxed by `restaurant_settings.kitchen_undo_seconds` (default 90, range
0–300), measured from the stamp of the stage being left.

It is a **separate RPC**, not a relaxed transition table:

- `order_transition_allowed` is `IMMUTABLE`, so it cannot express "within 60
  seconds";
- `enforce_order_integrity` checks it even under `financial_ctx`, so backwards
  edges added there would be reachable from *every* direct staff UPDATE.

Instead `order_revert_allowed` plus a `lasoul.revert_ctx` GUC that only
`staff_revert_order_status` sets. A plain UPDATE still cannot walk an order
backwards; there is a test for exactly that.

Undoing a **served and paid** order requires a manager.

## 4. All day

`kds_all_day(_station)` aggregates outstanding quantities in SQL.

This is deliberately **not** a client-side rollup over the board. The board is
capped at 300 rows, so a client rollup is provably wrong past that — and the
failure is silent. A missing order card is visible; an undercounted "8× Fries"
is not, and that is the number the cook batches against.

Ids come back **split by status** (`pending_ids`, `open_ids`). Sending a single
list would let "start all" walk an already-plated dish backwards through the
undo window.

---

## 5. Printing

### The ticket lifecycle

```
queued ──claim──▶ claimed ──report(ok)────▶ printed
                     │
                     ├──report(fail)──────▶ failed ──claim──▶ claimed
                     │
                     └──90s, no report────▶ failed   (swept)
```

`claim_ticket_print` sets **`claimed`**, not `printed`. A claim is an intention;
only the device that actually printed may report `printed`.

`requeue_stale_ticket_prints()` runs from every open kitchen screen on a 60s
timer. No `pg_cron`, no extension: it is idempotent, and if no kitchen device is
open there is nothing to print to anyway.

### Verified vs unverified

| kind | meaning |
| --- | --- |
| `print_verified = true` | The printer was asked (DLE EOT) and confirmed. |
| `print_verified = false` | Bytes were written at a device that cannot be asked. |
| `print_verified = null` | The attempt failed, or predates the distinction. |

Devices are classified **once, at connect**, by actually probing them — not by
trusting that a notify characteristic exists, since plenty of modules expose one
and never send anything down it. That classification is what makes silence
interpretable: from a printer that can talk it is a fault; from one that cannot
it is just silence.

The UI says `Printing · Star58 (unverified)` rather than pretending.

### The queue

`src/lib/print-queue.ts`. One job at a time, 20-second timeout.

A GATT write to a printer that has been switched off **never settles and never
rejects**. On timeout the queue marks itself `stuck`, shows
`PRINTER STUCK — n waiting`, and **stops draining** — a hung connection needs a
reconnect, not a retry, and continuing would feed every remaining ticket into
the same hole. The backlog is kept, not discarded; a human fixes the printer and
presses Retry.

### Ticket content

- `#047` — the order code, matching the board. The only string a human can
  reconcile between paper and screen.
- **REPRINT band with both times.** The original time is the part that works: a
  reprint indistinguishable from the original gets cooked twice.
- **No prices** on kitchen or bar tickets. Money on a line-cook ticket invites
  it being handed to a guest. The payment *word* stays — a cook does need to
  know an order is unpaid.
- **Allergens per line**, not as a banner. Banding every ticket containing a
  sesame bun trains staff to ignore the band.
- Station-filtered: a bar ticket has only bar lines, and an order with nothing
  for a station produces no ticket for it rather than a blank one.

---

## 6. Before go-live — manual, non-negotiable

These cannot be automated and each one has a matching code path that is
otherwise untested against reality:

1. **Pull the paper roll mid-service.** The ticket must report failure and offer
   Reprint.
2. **Power the printer off mid-queue.** Expect `PRINTER STUCK` within 20
   seconds, and the queue to hold rather than drain.
3. **Reprint something and look at it from two metres.** If you cannot tell it
   from the original, the band is not working.
4. **Cold-boot the kitchen tablet and touch nothing.** Place an order. If it
   does not make a sound, the autoplay unlock has regressed — this is the
   primary alerting mechanism.
5. **Two printer devices, one order.** Exactly one ticket.
