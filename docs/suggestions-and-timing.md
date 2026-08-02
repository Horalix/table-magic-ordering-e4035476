# Suggestions and timing

How the app decides what to suggest, and how it estimates a wait.

Enforcement lives in `supabase/migrations/20260801090100_learning_recommendations.sql`,
`20260802090600_eta_and_context.sql` and `20260802090700_smart_suggestions.sql`,
covered by `supabase/tests/recommendations.test.ts` and `eta-and-suggestions.test.ts`.

---

## 1. The one rule

**A number the system cannot back up is not shown.**

Everything below follows from that. It is why the ETA is a range, why
`confidence: 'none'` is a real answer that renders nothing, why acceptance
rates are Bayesian-smoothed, and why the uplift figure has a holdout behind it.

A confidently wrong estimate is worse than no estimate, because the guest starts
counting.

---

## 2. How long things take

Two sources, in order of preference:

| source | when used |
| --- | --- |
| `observed` | ≥ 5 completed services, median of `ready_at − started_at` |
| `menu` | `menu_items.prep_minutes`, set by a manager |
| `unknown` | neither — **no estimate is shown at all** |

Median, not mean: a ticket left open across a shift change is not a cooking
time, and one of them would drag a mean permanently. Samples over two hours are
discarded outright.

Below five services the observed figure is noise, so the menu setting wins.
Acting on one sample would make the estimate swing wildly between orders.

`refresh_prep_stats(days)` recomputes. **Menu intelligence → "Are our prep times
honest?"** shows the manager where the setting and reality disagree by three
minutes or more.

## 3. Kitchen load

`kitchen_load()` returns, per station, the outstanding item count and the
**backlog in minutes** — the unit a cook thinks in. Nine drinks and nine steaks
are different nights.

`load_factor = backlog_minutes / restaurant_settings.kitchen_capacity_minutes`.

Capacity is a single configurable number (default 25), not a headcount
calculation. Nobody tells this system how many cooks are on tonight, and
inventing a divisor would produce a precise-looking figure built on a guess.
**Tune it against real service — it scales every ETA.**

## 4. The estimate

`guest_order_eta(order_id)` returns a range, a confidence, and what it is based
on.

```
low  = slowest dish + (backlog ahead / capacity) + manual delay
high = (slowest dish × 1.35) + same
```

- **Slowest dish, not the sum.** A burger and a coffee arrive together, in
  burger time.
- **Backlog excludes the order's own lines.** A table is not quoted a longer
  wait because of the food it just ordered.
- **`kitchen_delay_minutes` still applies on top.** It exists for what no model
  sees — one cook off sick.

| confidence | meaning |
| --- | --- |
| `high` | every dish has real history |
| `medium` | menu settings only |
| `low` | at least one dish on the order is unknown |
| `none` | nothing to estimate from — **the UI shows nothing** |

---

## 5. What gets suggested

Score, all normalised to 0–1 before weighting (weights configurable in
**Service & suggestions**):

| signal | default | source |
| --- | --- | --- |
| curated | 40% | an explicit rule someone wrote |
| observed | 25% | lift from real baskets |
| learned | 25% | smoothed acceptance, **per daypart** |
| margin | 10% | `margin_score`, internal, never shown |
| exploration | 15% | decays with impressions, hashed per session |

minus a **capacity penalty** — see below.

### Dayparts

`morning` (<11), `lunch` (<16), `afternoon` (<18), `evening` (<23), `late`.

Acceptance is learned per `(pair, placement, daypart)` **and** all-day. The
daypart row is used where it has support; the all-day row is the fallback.
Coffee is a good suggestion at 09:00 and a poor one at 22:00, and a single
all-day rate is wrong at both ends.

Keeping *only* dayparts would split a pair's evidence five ways and leave every
bucket too thin to learn from — hence both.

### Capacity penalty

Bites only past `load_factor > 1`, scaled by how slow the dish is relative to a
ten-minute yardstick, capped at 0.35.

**Bar items are never penalised.** Pouring a drink does not compete with the
pass, and under load a drink is exactly the right thing to offer.

### Hard filters — scoring cannot override these

1. Not already in the cart.
2. Orderable now (`is_available` **and** inside its time window).
3. Not from a subcategory already in the cart, unless it is an upgrade, add-on
   or after-meal suggestion.
4. Retired: shown ≥ `reco_retire_after_impressions` and accepted below
   `reco_min_acceptance`.
5. **Diet.** If every line in the cart is vegetarian/vegan, only conforming
   items may be suggested.
6. **Allergens.** Anything carrying an allergen the guest has filtered out is
   excluded.

A diet is inferred **only when the cart contains food**. A cart holding one
black coffee is technically 100% vegan; reading that as a declaration would
quietly hide every meat dish from someone who has ordered nothing but a drink.

### Basket completion

A cart-**shape** rule, distinct from item-to-item pairing: a cart with food and
no drink gets a drink suggested.

The affinity table structurally cannot do this — it only knows which items
appear *together*, so it can never notice something absent.

## 6. Substitution

`guest_get_substitutes(item_id)` — for when something has run out.

1. A curated `alternative` rule.
2. Same subcategory, within 40% on price.
3. Nothing.

Third is a real outcome. An unrelated dish offered as a substitute is worse than
an honest "sorry, that is off tonight".

## 7. Is any of it working?

> **The measurement described below has been substantially rebuilt.** It was
> assigned per session but analysed per order, counted tips as uplift, and
> re-bucketed its own history when the holdout dial moved. See
> [measuring-upsell.md](measuring-upsell.md) for what it does now.


`reco_holdout_pct` (0–50) withholds suggestions from a deterministic slice of
sessions. **Menu intelligence → "How much of that is really the suggestions?"**
compares the two groups and reports `reliable: false` below 100 orders a side.

Attribution is measured in money that actually arrived — `suggestion_conversions`
is written server-side at order time against the server-computed line price, not
from clicks. A client claiming a suggestion it never saw can over-credit an
internal dashboard; it cannot affect a total.
