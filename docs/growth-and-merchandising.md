# Growth and merchandising

How this product is meant to make more money without becoming worse to be a
guest of. Every mechanism here is measurable; anything that cannot be measured
is listed as a recommendation rather than shipped.

---

## The stance

A restaurant app can raise average order value in two ways. One is to nag,
preselect, interrupt and hide the skip button. The other is to do what a good
waiter does: notice what someone ordered, suggest the one thing that genuinely
goes with it, and drop it immediately if they say no.

The first works for a quarter and poisons the room. La Soul is a
neighbourhood restaurant in a city where reputation travels — so the second is
the only option, and the constraints below are enforced in code, not left to
good intentions.

### Hard rules, enforced in SQL and in components

| Rule | Where it lives |
|---|---|
| One primary suggestion at a time | `CartSuggestion` renders `visible[0]` only |
| The dismiss control is as reachable as the accept | Both are ≥44 px, side by side |
| Nothing is ever preselected | No default tip, no pre-ticked extras |
| A dismissed suggestion does not return during the visit | `dismissed` state in the component |
| Never suggest a sold-out item | `guest_get_recommendations` filters on `menu_item_orderable` |
| Never suggest what is already in the cart | Same function, `NOT (mi.id = ANY(cart))` |
| Never suggest another item from the same shelf | Same function, unless typed `upgrade_to` / `add_on` |
| Never show an internal label like "high margin" | `margin_score` is a tie-breaker; it is not in the result set (asserted by test) |
| Suggestions can be switched off entirely | `restaurant_settings.recommendations_enabled` |
| No fake scarcity, no countdowns, no "12 people are viewing" | Not built, and not to be built |

---

## The recommendation model

`menu_item_recommendations`:

```
source_item_id | source_subcategory_id | recommended_item_id
recommendation_type | priority | start_time | end_time | language | enabled
```

| Type | Meaning | Example |
|---|---|---|
| `pair_with` | Natural companion | Burger → Fries |
| `add_on` | Extra on the same item | Espresso → Extra shot |
| `upgrade_to` | Bigger/better version — *allowed* from the same category | House red → Reserve red |
| `frequently_bought_together` | Observed pairing | Pizza → Beer |
| `after_meal` | Only once food has been served | → Turkish coffee, Tiramisu |
| `alternative` | Similar option | Sold-out dish → nearest sibling |

**Fallback.** With no curated rules, the engine falls back to popular items so a
fresh install still suggests something sensible. Curated rules score +40 over
the fallback, so the moment a manager adds a real pairing it wins.

**Scoring.** `priority + 40` for curated, `10` for fallback, tie-broken by
`margin_score`, then by price ascending (a cheaper add is an easier yes).

Managed in **Admin → Service & suggestions**.

---

## Placements

| Placement | When | Intent | Why it works |
|---|---|---|---|
| **Cart** | Reviewing the order | Complete the meal — a side, a drink | The guest has decided *what*, not *how much*. Adding a 6 KM side to an 18 KM burger is a small decision. |
| **After meal** | Running tab, only once an order is `served` or `ready`, and only while no bill has been requested | Coffee, dessert, one more drink | The single highest-acceptance moment of a visit, and the one a busy waiter most often misses. |

Deliberately **not** used: a modal on page load, an interstitial between menu
and cart, anything during payment. Interrupting a guest who is paying is how you
turn a completed order into an abandoned one.

---

## Menu engineering

`menu_items` now carries:

- `merchandising_tags` — guest-facing badges (`popular`, `signature`, `new`,
  `staff_favourite`, `fast`), controlled by management
- `margin_score` (0–100) — **internal only**, never rendered
- `prep_minutes` — supports "ready quickly" and capacity-aware suggesting
- `allergens`, `portion_note` — answers the questions a product card should
- `available_from` / `available_to` — breakfast, lunch offer, late menu

Existing `dietary_tags` (vegetarian, vegan, halal, spicy, gluten-free,
dairy-free, contains nuts) are already shown on cards and are filterable.

### How to use the badges honestly

- **Popular** — only if it genuinely is. `get_popular_items` gives the real
  ranking; do not badge a slow seller as popular.
- **Signature** — the dishes La Soul wants to be known for. Two or three, not
  ten. A badge on everything is a badge on nothing.
- **New** — remove it after three weeks.
- **Staff favourite** — ask the staff. If it is invented, it will be exposed the
  first time a guest asks a waiter about it.

---

## Improvements shipped, with their hypotheses

Each is stated so it can be falsified.

| # | Change | Hypothesis | Primary metric | Guardrail | Status |
|---|---|---|---|---|---|
| 1 | Global menu search on the landing page | Guests who know what they want find it faster; fewer give up | Add-to-cart rate; `search_no_results` share | Time to first useful menu | **Shipped** |
| 2 | Context-aware cart suggestion (one, dismissible) | Relevant beats popular; attachment rises without annoyance | Drink/side attachment; suggestion acceptance | Dismissal rate < 80%; abandonment flat | **Shipped** |
| 3 | After-meal suggestion on the tab | Coffee and dessert are missed sales, not unwanted ones | Repeat-order rate in session; dessert attachment | Complaint rate; bill-request time | **Shipped** |
| 4 | Cart survives a declined card | Guests currently lose the order and give up | Checkout completion after a decline | Duplicate-order rate | **Shipped** |
| 5 | Human order code (`#047`) | Guests can talk to staff about a specific order; fewer disputes | Waiter-call rate after ordering | — | **Shipped** |
| 6 | Card-at-the-table as a distinct choice | The waiter brings the terminal on the first trip | Time to payment; trips per table | Reconciliation errors | **Shipped** |
| 7 | Itemised totals before the pay buttons | No surprise at the last step | Checkout completion | — | **Shipped** |
| 8 | Undo on cart removal | Accidental removals become recoveries | Items per order | — | **Shipped** |
| 9 | Sold-out items shown in search, labelled | A guest who searched deserves an answer | `search_no_results` rate | — | **Shipped** |
| 10 | Post-order status with a real ETA path | Guests stop asking "where is my food?" | Waiter-call rate between order and serve | — | **Partly** — tab exists, ETA not modelled |

### Recommended as experiments, not shipped

| Change | Why not yet |
|---|---|
| **Bundles / combos** | The data model is designed (see below) but building it before there is a single curated recommendation is premature. Prove attachment works first. |
| **Promotions and codes** | Discounting is the least efficient way to raise revenue and the easiest to abuse. Better merchandising first; revisit if there is a genuine off-peak problem. |
| **Loyalty** | Requires a durable identifier and explicit consent. Not proportionate today. The settings and interfaces do not preclude it later. |
| **Preselected 10% tip** | Would raise tip revenue and is a dark pattern. Only with an explicit, documented decision by the restaurant and a legal check. |
| **Category reordering by time of day** | Plausible (coffee first in the morning), but should be an A/B test with revenue-per-session as the metric, not a guess. |

---

## Bundle model, when it is time

Do not hardcode one offer. The extensible shape:

```
bundles(id, name, name_bs, name_ar, description, price,
        available_from, available_to, days_of_week,
        max_per_order, enabled)

bundle_slots(id, bundle_id, label, min_choices, max_choices, sort_order)

bundle_slot_options(id, slot_id, menu_item_id, upgrade_price)
```

Non-negotiables when it is built:

- the price is computed **server-side** from the bundle definition, never sent
  by the client;
- every chosen item is availability-checked at order time, exactly as
  `guest_place_order` already does;
- savings are shown against the true sum of the à-la-carte prices, or not shown
  at all — **never a fabricated "was" price**;
- a bundle is one line on the kitchen ticket with its components listed, so the
  kitchen is not guessing.

---

## Experimentation

A lightweight, ethical framework. Rules:

1. **Never experiment on payment correctness.** Copy, layout and placement are
   fair game; the release rule, callback verification and the state machine are
   not.
2. Every experiment declares a hypothesis, one primary metric, guardrails, a
   sample-size target and an end date **before** it starts.
3. Guardrails are absolute: abandonment, refunds, complaints, order errors, load
   time, accessibility and staff workload. If one moves the wrong way, the
   experiment ends, whatever the primary metric did.
4. Success is *completed, profitable, correctly fulfilled orders* — never
   clicks, never impressions.
5. Assignment is per **table session**, not per page view, so a group at one
   table has one consistent experience.

Suitable first experiments, in order: suggestion placement (cart vs after-meal
only), product-card layout (list vs grid default), checkout button copy, and
after-meal timing (immediately on `served` vs five minutes later).

---

## First 30 days

### Week 1 — reliability and a baseline
Do not change anything commercial. Watch: order failures, print failures,
Realtime disconnects, stuck payments, time-to-ready. Record baseline
add-to-cart, checkout completion, AOV, items per order, attachment. **You cannot
improve what you have not measured, and everything below is judged against this
week.**

### Week 2 — the menu itself
Photograph the top 20 items properly if they are not already. Write one honest
sentence per item. Set `merchandising_tags` from the real popularity data. Fill
in allergens on everything containing nuts, dairy or gluten. Check the Bosnian
and Arabic names on the ten most-ordered dishes with a native speaker. Then look
at *most viewed but least ordered* — that gap is a description or price problem.

### Week 3 — attachment
Curate 10–15 real pairings in Admin → Service & suggestions — the ones the
waiters would actually suggest. Turn on the after-meal placement. Measure
acceptance **by placement and type**. Delete anything under 5% acceptance;
it is noise to the guest and clutter to you. Compare AOV and items-per-order
against week 1.

### Week 4 — operations and the loop
Review time-to-ready by hour and find the bottleneck. Check reconciliation
discrepancies — they should be zero. Review low ratings and what they say.
Rotate every QR token. Decide, from data, whether bundles are worth building.
Write down what you learned and what you will change; then start again.

---

## What would make this fail

- Turning on ten suggestions at once — guests stop reading all of them.
- Badging everything "popular" — the badge stops meaning anything.
- Measuring acceptance without measuring dismissal.
- Shipping a conversion change in the same week as a payment change, so neither
  can be attributed.
- Deciding from one busy Saturday. Wait for a full week including a quiet
  Tuesday.
