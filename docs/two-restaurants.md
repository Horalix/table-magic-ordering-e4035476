# Two restaurants, one system — La Soul and Vera Italia

The owner of La Soul opens a second restaurant, **Vera Italia**. Both live in
this one app and one database, each with its own website, menu, tables, staff,
printers, reports and look, and **nothing crosses between them**: a guest at a
Vera Italia table cannot order from La Soul's menu, a La Soul waiter never sees
a Vera Italia table, and each restaurant's admin sees only their own.

Built on the branch `feature/two-restaurants`; La Soul runs unchanged on
`main` until every phase is tested.

## Who sees what

| Account | Role row in `user_roles` | Sees and manages |
|---|---|---|
| **Super admin** (the owner) | `admin`, `venue_id` empty | Both restaurants; a switch in the admin; settings for both |
| **Restaurant admin** | `admin`, `venue_id` = their restaurant | Only their restaurant |
| **Waiter, kitchen** | `staff`, `venue_id` = their restaurant | Only their restaurant's tables, orders and screens |
| **Guest** | none | Only the restaurant whose table they scanned |

Every admin account that exists today becomes a **super admin** — they could
already see everything. Restaurant admins are created per restaurant.

## How "nothing crosses" is guaranteed

In the database, not in the screens, so no missed filter and no hand-made
request gets around it:

1. **Every restaurant-owned row has a `venue_id`.** Rows that belong to
   something else **inherit** it and cannot be given another: a dish takes its
   section's, a section its category's, a table session its table's, an order
   its session's, an order line its order's, a call or bill request its
   session's.
2. **Nothing may mix two restaurants.** The database refuses an order line for
   a dish from the other restaurant, a combo option from the other menu, a
   table in the other restaurant's section, a waiter assigned to the other
   restaurant's section or table.
3. **Access rules check the row's restaurant.** "Staff may read orders"
   became "staff *of this order's restaurant* may"; the same for every admin
   rule. The super admin passes for both.
4. **Signed-in writes are checked again** on every restaurant-owned table,
   whatever function they come through: a signed-in user changes a row only
   if they work at its restaurant. (Functions that bypass the access rules are
   covered by this.)
5. **Guests start from a QR code.** A table's own code names its table, and
   through it its restaurant; a room code names its restaurant. Everything a
   guest does after that runs inside that one restaurant.

Public pages stay public: anyone may read either restaurant's website and menu,
as today. Only ordering and everything behind it is separated.

### Which restaurant a request is about

`current_venue()` answers it, in this order:

1. **What the request already proved.** A guest's table session or QR code,
   a printer's token, a ticket's order: the function that checked it sets
   the restaurant for the rest of the request.
2. **The restaurant the app is showing**, in the `x-venue` header: the menu's
   address (`/menu/veraitalia/`), the guest's table, or the restaurant the
   owner picked in the admin. A signed-in user gets it only for a restaurant
   they work at; anyone else's phone asking for the other one gets their own.
3. **Where a waiter or restaurant admin works.**
4. La Soul.

So a La Soul waiter needs nothing set up — the database knows where they work
— and an app that sends no header at all (today's) is La Soul throughout.

### Suggestions

No dish is ever suggested at the other restaurant: every suggestion is a dish
of the guest's own menu. And since `20261030130000_suggestions_per_restaurant.sql`
nothing a suggestion is measured against is shared either:

- the learned counters (`reco_learning`) carry their restaurant — the visit
  and per-kind totals every learned pair is compared with included — and the
  learner, the rebuild and every reader count and read one restaurant's;
- pair strength at order and visit grain (`menu_item_affinity`,
  `session_item_affinity`, `subcategory_affinity`, `item_section_share`) is
  computed per restaurant, against that restaurant's own orders and visits;
- how often guests take a suggestion (`suggestion_priors`) is per restaurant,
  with its own fallback per placement.

So one restaurant's guests move nothing of the other's suggestions
(`supabase/tests/suggestions-per-restaurant.test.ts`).

**What Vera Italia's guests are suggested** (`20261031090000_vera_suggestions.sql`).
Anything that is not the owner's own pairing must pass the "goes with" rules
(`reco_fit`), which are La Soul's café rules: a drink with food, fries with a
burger, a salad with pasta, coffee and dessert after the meal. Vera Italia has
no drinks, desserts or coffee, so until this migration its guests were
suggested nothing — not even after weeks of orders. Now:

- **its house pairings**, written in `scripts/vera-italia/menu.json`
  (`pairings`) and generated into the migration by fixed id
  (`node scripts/vera-italia/pairings-sql.mjs`): pasta and risotto → the
  grilled chicken, then a salad; a classic pizza → grilled vegetables, a
  bruschetta or the feta dip; a white-cream pizza → a caprese, grilled
  vegetables or a bruschetta; the rib-eye platter (fries, salad and bread
  already on it) → the caprese, then a starter to share
  (`20261031120000_reco_quality.sql` moved the caprese first). Ordinary
  rules: the owner can switch them off or change them in Admin → Service &
  suggestions;
- **Italian section names are understood**: Insalate are salads, Antipasti
  starters, Extras an extra — so "a salad with pasta" covers every pizza,
  pasta, risotto and the steak too, and what Vera Italia's tables teach the
  engine comes through;
- **the chicken is not hidden by a guessed diet**: every pasta and risotto is
  vegetarian, and one in the cart used to read as "this table is vegetarian".
  An add-on the owner chose for the dish is now exempt; a guest who switched
  the vegetarian filter on still never sees it.

Nothing is offered while the table waits or after the meal — those moments
offer drinks, coffee and dessert, which Vera Italia does not serve; once it
adds them (with their meal role set), they work as at La Soul.

Suggestion rules (`menu_item_recommendations`) carry their restaurant like
every other restaurant-owned row: a rule is the restaurant of the dish it
suggests, cannot mix the two, and staff read — admins change — only the rules
of the restaurant they are looking at and work at. Guests are unaffected: the
ranker reads the rules as their owner. `supabase/tests/vera-suggestions.test.ts`
checks all of it, and that La Soul's suggestions are exactly what they were.
A "goes with" row (`reco_fit`, `reco_clash`) may also belong to one
restaurant (`venue_id`; empty, as every row so far, means both), so one
added for Vera Italia never changes La Soul (`supabase/tests/reco-quality.test.ts`).

## What is per restaurant

| | Was | Now |
|---|---|---|
| Table numbers | unique overall | unique per restaurant — both can have a table 7 |
| Order numbers (#001…) | one counter per day | one per restaurant per day |
| Daily close | one per day | one per restaurant per day |
| Settings (ordering on/off, service hours, printing, suggestions, holds…) | one row, `id = 1` | one row per restaurant |
| Room QR code | one | one per restaurant |
| Home-screen featured dishes | 3 overall | 3 per restaurant |

La Soul's restaurant id is fixed (`a5000000-0000-4000-8000-000000000001`) and
every existing row belongs to it, so La Soul's data and behaviour do not
change. Vera Italia is created alongside (`…0002`, slug `veraitalia`), not
live until switched on.

## Phases

1. **Foundation** (`20261028090000_two_restaurants_foundation.sql`): the
   restaurants, `venue_id` everywhere with inheritance and the mixing guards,
   per-restaurant uniqueness and settings, roles with a restaurant, the access
   rules, the signed-in write check, and the five functions that depend on the
   changed uniqueness (QR codes, the room code, order numbers, the daily
   close). Everything else keeps reading La Soul's settings, so La Soul works
   exactly as before.
2. **Functions** (`20261028100000_two_restaurants_context.sql`): every
   request works inside one restaurant (below). Guest ordering, suggestions,
   the kitchen boards, printers, staff actions, reports, analytics, the daily
   close and the scheduled clean-up read their own restaurant's settings and
   data; the scheduled jobs go through each restaurant in turn. Something
   added without naming a restaurant (a table, a dish, a printer) belongs to
   the restaurant of the request.
3. **The app**: the restaurant switch for the super admin, admin and staff
   screens scoped to a restaurant, creating staff and admins per restaurant,
   QR codes per restaurant, guest menus by address (`/menu/veraitalia/`).
4. **Vera Italia itself**: its website, menu, colors, fonts and logo, from the
   photos and menu the owner sends.

Each phase lands with tests that try to cross between the restaurants and must
be refused, and the whole existing suite still passing.

## Applying to the live database

The same way as every migration before: through Lovable with
`docs/migration-runner.sql` (the file is fetched from GitHub at a pinned
commit and checked by its MD5), phase by phase. Phase 1 changes nothing La
Soul can see; it is safe to apply before the app knows about Vera Italia.
