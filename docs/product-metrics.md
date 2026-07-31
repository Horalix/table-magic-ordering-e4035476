# Product metrics

The measurement framework. Every commercial change is judged against these, not
against how good it looks in a demo.

**Principle:** a feature succeeds only when it increases *completed, profitable,
correctly fulfilled* orders **without** increasing complaints, refunds, order
errors or staff workload. Clicks are not a result.

---

## How the data is collected

Two sources, deliberately separated:

| Source | What it answers | Where |
|---|---|---|
| **Operational tables** (`orders`, `order_items`, `payment_transactions`, `order_ticket_events`, `audit_log`) | What actually happened, and what money moved | `completed_orders`, `day_reconciliation()` |
| **`analytics_events`** | What the guest *did* on the way there | `src/lib/analytics.ts` → `record_analytics_events` |

Money questions are never answered from analytics events, and behaviour
questions are never answered from orders alone. Mixing them is how a funnel
starts disagreeing with the till.

### Privacy position

- First-party only. No third-party trackers, no advertising pixels, no cookies.
- No cross-visit identity. `visit_id` is a random per-tab value in
  `sessionStorage`; it is not derived from anything about a person and is not
  linked to an order.
- No free text ever. Item notes, guest names, comments and payment data are
  blocked twice: by the scalar-only property type and blocked-key list in
  `src/lib/analytics.ts`, and again in SQL, where non-scalar property values
  are stripped before insert.
- Unknown event names are dropped rather than stored, so the vocabulary below
  is the complete list of what can exist.

### Event vocabulary

```
Discovery      menu_viewed · category_viewed · search_performed ·
               search_no_results · item_viewed
Cart           item_added · cart_item_removed · cart_viewed
Suggestions    suggestion_shown · suggestion_accepted · suggestion_dismissed
Checkout       checkout_opened · checkout_submitted · order_placed · order_failed
Payment        payment_started · payment_confirmed · payment_failed ·
               payment_delayed · payment_switched_to_table
Post-order     tab_viewed · reorder_tapped · waiter_called · bill_requested ·
               feedback_submitted
```

---

## Ordering funnel

Denominators matter more than numerators. Each rate below names its own.

| Metric | Definition | Source | Target |
|---|---|---|---|
| Menu visits | `menu_viewed` events | analytics | — |
| Valid table sessions | distinct `table_sessions` opened | orders DB | — |
| Product views | `item_viewed` | analytics | — |
| Add-to-cart rate | visits with ≥1 `item_added` ÷ `menu_viewed` | analytics | ≥ 45% |
| Cart creation rate | visits reaching `cart_viewed` ÷ visits with `item_added` | analytics | ≥ 80% |
| Checkout start rate | `checkout_opened` ÷ `cart_viewed` | analytics | ≥ 70% |
| Checkout completion rate | `order_placed` ÷ `checkout_opened` | analytics | ≥ 85% |
| Card payment completion | `payment_confirmed` ÷ `payment_started` | analytics + DB | ≥ 90% once live |
| Pay-at-table completion | orders `paid` with method `cash`/`pos_terminal` ÷ all such orders | DB | ≥ 98% |
| Order abandonment | visits with `item_added` and no `order_placed` ÷ visits with `item_added` | analytics | ≤ 30% |
| Payment abandonment | `payment_started` with no resolution within 30 min | DB (`stuck_payments`) | ≈ 0 |

Because the app is used at a table, the funnel is **not** the same as
e-commerce: a guest who browses and then orders verbally is not a lost sale.
Treat abandonment as a signal to investigate, not as lost revenue.

---

## Sales metrics

| Metric | Definition | Source |
|---|---|---|
| Average order value | `avg(total)` over `completed_orders` | `day_reconciliation().average_order` |
| Median order value | `percentile_cont(0.5)` over `completed_orders.total` | SQL |
| Items per order | `sum(quantity) ÷ count(orders)` | `order_items` |
| Revenue per table | `sum(total)` grouped by `table_session_id` | SQL |
| Revenue per guest | revenue per table ÷ session members | SQL |
| Tip rate | orders with `tip_amount > 0` ÷ completed orders | DB |
| Average tip | `avg(tip_amount)` where `> 0`, and separately as % of items | DB |
| Dessert / drink / side attachment | orders containing ≥1 item in that category ÷ orders containing a main | `order_items` × `subcategories` |
| Add-on attachment | as above for `add_on` recommendations | DB + analytics |
| Suggestion acceptance | `suggestion_accepted` ÷ `suggestion_shown`, split by placement and type | analytics |
| Repeat-order rate in visit | sessions with ≥2 released orders ÷ sessions with ≥1 | DB |

Attachment should be measured **per placement** (`cart` vs `after_meal`) and
**per recommendation type**. A single blended number hides the fact that
after-meal coffee converts several times better than a cart-stage side.

---

## Operations metrics

| Metric | Definition |
|---|---|
| Time to kitchen acceptance | `confirmed_at − released_to_kitchen_at` |
| Preparation time | `ready_at − preparing_at` |
| Time to ready | `ready_at − released_to_kitchen_at` |
| Time to served | `served_at − ready_at` |
| Late-order percentage | orders where time-to-ready > 20 min ÷ released orders |
| Time to waiter acknowledgement | `waiter_calls.resolved_at − created_at` |
| Order-error rate | cancelled-after-production ÷ released orders |
| Cancelled-order rate | `cancelled_orders ÷ (completed + cancelled)` |
| Refund rate | refunded amount ÷ gross |
| Print failure rate | `order_ticket_events` with `status = 'failed'` ÷ tickets |
| Duplicate-print rate | tickets with `attempts > 1` ÷ tickets — target **0** |
| Fiscalization completion | `fiscalization_status = 'fiscalized'` ÷ completed orders |
| Table-session duration | `closed_at − opened_at` |
| Table turnover | sessions per table per service |

---

## Retention metrics

| Metric | Definition |
|---|---|
| Feedback completion rate | `feedback_submitted` ÷ sessions with a served order |
| Positive rating rate | ratings ≥ 4 ÷ all ratings |
| Review-link click rate | clicks ÷ ratings ≥ 4 |
| Repeat-visit rate | **not measured** — see below |
| Return-order rate | second order in the same session ÷ sessions |

Repeat visits are deliberately *not* tracked. Doing so honestly would require a
durable per-person identifier, which is not proportionate for a restaurant menu
and would need explicit consent. If loyalty is introduced later it must be
opt-in and separate from ordering; the interfaces allow for it, nothing collects
for it today.

---

## Reliability metrics

| Metric | Source | Target |
|---|---|---|
| Frontend error rate | Sentry | < 0.5% of sessions |
| Edge Function error rate | Supabase logs | < 0.5% |
| Payment callback failure rate | `payment_callback_events` outcome ≠ approved/duplicate | < 1% |
| Callback rejections (amount/currency mismatch) | `day_reconciliation().callback_problems` | **0** |
| Realtime disconnect rate | kitchen connection pill time-not-live | < 2% of service time |
| Order creation failure rate | `order_failed` ÷ `checkout_submitted` | < 1% |
| Duplicate-order rate | same session, same items, < 60 s apart | ≈ 0 |
| Pending-payment aging | `stuck_payments` older than 30 min | 0 at close |
| Uptime | external monitor | ≥ 99.5% |

---

## Useful queries

```sql
-- Today, the whole picture, with correct denominators.
SELECT public.day_reconciliation(CURRENT_DATE);

-- Suggestion performance by placement and type, last 14 days.
SELECT props->>'placement' AS placement,
       props->>'type'      AS type,
       count(*) FILTER (WHERE event = 'suggestion_shown')    AS shown,
       count(*) FILTER (WHERE event = 'suggestion_accepted') AS accepted,
       round(100.0 * count(*) FILTER (WHERE event = 'suggestion_accepted')
             / NULLIF(count(*) FILTER (WHERE event = 'suggestion_shown'), 0), 1) AS accept_pct
  FROM public.analytics_events
 WHERE event LIKE 'suggestion_%' AND occurred_at > now() - interval '14 days'
 GROUP BY 1, 2
 ORDER BY shown DESC;

-- Checkout funnel by visit, last 7 days.
WITH v AS (
  SELECT visit_id,
         bool_or(event = 'item_added')        AS added,
         bool_or(event = 'checkout_opened')   AS opened,
         bool_or(event = 'order_placed')      AS placed
    FROM public.analytics_events
   WHERE occurred_at > now() - interval '7 days'
   GROUP BY visit_id
)
SELECT count(*) FILTER (WHERE added)  AS carts,
       count(*) FILTER (WHERE opened) AS checkouts,
       count(*) FILTER (WHERE placed) AS orders,
       round(100.0 * count(*) FILTER (WHERE placed) / NULLIF(count(*) FILTER (WHERE added), 0), 1) AS conversion_pct
  FROM v;

-- Attachment: orders containing a main that also contain a drink.
WITH o AS (
  SELECT co.id,
         bool_or(c.name = 'Food')   AS has_food,
         bool_or(c.name = 'Drinks') AS has_drink
    FROM public.completed_orders co
    JOIN public.order_items oi ON oi.order_id = co.id
    JOIN public.menu_items mi  ON mi.id = oi.menu_item_id
    JOIN public.subcategories s ON s.id = mi.subcategory_id
    JOIN public.categories c    ON c.id = s.category_id
   WHERE co.created_at > now() - interval '30 days'
   GROUP BY co.id
)
SELECT round(100.0 * count(*) FILTER (WHERE has_food AND has_drink)
             / NULLIF(count(*) FILTER (WHERE has_food), 0), 1) AS drink_attachment_pct
  FROM o;
```

---

## Guardrails

No experiment ships, and no "win" is accepted, if any of these move the wrong
way:

- order abandonment ↑
- refunds or cancellations ↑
- order-error rate ↑
- median time-to-ready ↑
- complaint / low-rating rate ↑
- first-useful-menu time ↑ by more than 100 ms
- suggestion dismissal rate > 80% for a given placement (that is annoyance, not
  merchandising)
