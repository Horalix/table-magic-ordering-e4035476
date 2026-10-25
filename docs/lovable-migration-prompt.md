# Lovable prompt — apply the pending migrations

Copy everything between the rules into Lovable. Nothing else needs to be said.

Last updated: **25 October 2026**, for thirty-two migrations from
`20260804090300` to `20261026110000`.

> **What is actually live.** Checked against the production API on
> 24 October 2026: functions from the 3 August batch exist (for example
> `reco_policy_version()`), but nothing from `20260804090300` onwards does —
> `business_day()`, `bandit_readiness()`, `app_impact_summary()` and
> `orders_needing_attention()` are all missing. The nine-file prompt further
> down was written but never run. Several of those nine files were corrected
> on 24 October before ever being applied, so use the files as they are now.

> **Deploy order matters.** Apply these BEFORE publishing the frontend from
> the same branch. The guest app falls back safely if `guest_place_order` is
> still the old version, but the staff screens call `staff_close_session()`,
> `funnel_summary()` and `staff_performance()`, which only exist afterwards.

> **First attempt, 24 October 2026 (evening).** Lovable stopped at the first
> file with `rewrite (d) diet filter did not match`; nothing was applied. The
> live copy of `rank_recommendations` does not contain the SQL comments the
> repository version has, and that one search literal included them. The
> rewrite now matches the code itself, with or without those comments, and a
> read-only preflight (step 1 below) checks every other search literal against
> the live database before anything is changed.

---

## Step 1 — the preflight (read-only, changes nothing)

> **Task: run one read-only query and paste the full result. Do not apply any
> migration yet, and do not write or change any SQL.**
>
> Run the contents of `docs/migration-preflight.sql` exactly as written. It only
> calls `pg_get_functiondef()` and compares text; it changes nothing. Paste
> every row of the result.

Every row should say `found = true`. A `false` row names the migration and line
whose search text is not in the live function — send it back before going on.

## Step 2 — the prompt

> **Task: apply thirty-two existing migration files to Supabase, in order. Do not
> write any new SQL.**
>
> These files are already in the repository under `supabase/migrations/`:
>
> ```
> 20260804090300_session_context.sql
> 20260804090400_session_affinity.sql
> 20260804090500_maintenance.sql
> 20260804090600_app_impact.sql
> 20260804090700_guest_profiles.sql
> 20260804090800_bandit_readiness.sql
> 20260804090900_thompson_sampling.sql
> 20260805090000_business_day.sql
> 20260805090100_stale_orders.sql
> 20261024120000_menu_prices_and_new_items.sql
> 20261024130000_suggestion_guardrails.sql
> 20261024140000_staff_safety.sql
> 20261024150000_analytics_fixes.sql
> 20261024160000_guest_ordering_safety.sql
> 20261024170000_analytics_safe_reads.sql
> 20261024180000_house_pairings.sql
> 20261024190000_order_abuse_guards.sql
> 20261025090000_unit_margin.sql
> 20261025100000_reco_learning_v3.sql
> 20261025110000_reco_measurement.sql
> 20261025120000_item_availability_days.sql
> 20261025121000_menu_engineering.sql
> 20261025122000_sales_decomposition.sql
> 20261025123000_item_trends.sql
> 20261025124000_service_alerts.sql
> 20261025125000_reco_funnel.sql
> 20261025126000_management_insights.sql
> 20261025127000_prep_history.sql
> 20261025140000_menu_translations.sql
> 20261025150000_menu_corrections.sql
> 20261025160000_reco_profit.sql
> 20261026110000_reco_adaptive.sql
> ```
>
> **Run each file, in that exact order, exactly as written.** Read each one from
> disk and execute its contents. Do not retype it, summarise it, "clean it up",
> or create files with new timestamps containing the same logic.
>
> Why this matters more than usual:
>
> 1. **Many of these files change an existing database function in place.**
>    They fetch its current definition with `pg_get_functiondef()` and replace
>    exact pieces of text. A paraphrase by even one character makes the
>    replacement miss. Every rewrite checks that it matched and raises an
>    exception if it did not, so a mistake fails loudly — but it fails.
> 2. **Line endings are content.** The `.sql` files must stay LF. A `.gitattributes`
>    rule pins this; do not override it.
> 3. **Order is load-bearing.** Later files rewrite functions that earlier ones
>    create or rename.
>
> **If a file fails, stop.** Report the exact error text and the file name, and
> do not continue or attempt a workaround. A partial apply is recoverable; a
> guessed fix on top of one is not.
>
> **Do not create, modify or bootstrap any user account, password, PIN or
> credential.** No `crypt()`, no `encrypted_password`, no inserts into
> `auth.users`. If something appears to need one, stop and say so.
>
> **When you are done, run these checks and paste the raw output:**
>
> ```sql
> -- 1. new functions exist (expect 10 rows)
> SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
>  WHERE n.nspname = 'public'
>    AND proname IN ('business_day','bandit_readiness','app_impact_summary','run_daily_maintenance',
>                    'reco_role_fits','staff_close_session','funnel_summary','staff_performance',
>                    'analytics_uuid','orders_needing_attention')
>  ORDER BY proname;
>
> -- 2. ordering is idempotent (expect one row, with _client_order_id last)
> SELECT pg_get_function_arguments(p.oid) FROM pg_proc p
>  WHERE p.proname = 'guest_place_order';
>
> -- 3. the trading day ends at 05:00 Sarajevo time
> SELECT public.business_day() AS trading_day,
>        (now() AT TIME ZONE 'Europe/Sarajevo') AS sarajevo_now;
>
> -- 4. the new price list (expect Americano 6.00, Breakfast Platter for Two 35.00, Espresso 3.00)
> SELECT name, price FROM public.menu_items
>  WHERE name IN ('Americano', 'Espresso', 'Breakfast Platter for Two') ORDER BY name;
>
> -- 5. the four new dishes (expect 4 rows)
> SELECT m.name, s.name AS section, m.price
>   FROM public.menu_items m JOIN public.subcategories s ON s.id = m.subcategory_id
>  WHERE m.name IN ('Chemex Hot','Healthy Beef Burger','Healthy Chicken Burger','Banana Pudding');
>
> -- 6. the nightly job is scheduled (expect 1 row; if 0, pg_cron is not enabled — say so)
> SELECT jobname, schedule FROM cron.job WHERE jobname = 'lasoul-daily-maintenance';
>
> -- 7. sampling must still be OFF (expect false, then v3-profit and 12:00:00)
> SELECT reco_sampling_enabled, public.reco_policy_version(), reco_alcohol_from
>   FROM public.restaurant_settings WHERE id = 1;
>
> -- 8. fake-order protection is in place (expect 60.00, 10, 150.00, 3, and a row
> --    for the index; if the index row is missing, paste the NOTICE text too)
> SELECT hold_first_order_km, hold_first_order_items, hold_unpaid_km, hold_burst_sessions
>   FROM public.restaurant_settings WHERE id = 1;
> SELECT indexname FROM pg_indexes WHERE indexname = 'table_sessions_one_active_per_table';
> ```
>
> If check 6 errors because the `cron` schema does not exist, that is not a
> failure of the migrations — report it and stop there.

---

## After it applies

- **Prices**: 65 items move to the October list and four dishes appear.
  Arabic Coffee White is deliberately not touched: the old menu site showed
  15 KM on the card and 25 KM in the pop-up, and it stays at 15 KM until
  someone confirms otherwise in Admin → Menu. A price changed by hand in the
  meantime is left alone.
- **Ordering** survives a lost response (no second ticket), refuses dishes
  outside their serving hours in Sarajevo time, names the dish it refused, and
  allows up to 30 rounds per table.
- **Suggestions** stop pairing a main with a main, only offer dessert or coffee
  after the meal, follow the guest's diet filters, and the engine relearns
  every night. Check the `meal_role reclassified` notice and spot-check roles in
  Admin → Menu.
- **Staff**: a table that still owes money cannot be freed; refunded orders
  cannot be marked paid again; the trading day (rota, reports, shift close)
  runs until 05:00.
- **Analytics**: charts bucket by Sarajevo trading day; one malformed event can
  no longer blank a screen; Menu Intelligence stops listing each pair six
  times; the Analytics page gains an ordering funnel.
- **Owner insights** (`20261025120000`–`20261025127000`, new read-only
  functions plus one small table): the Dashboard leads with the three things
  most worth doing this week in KM, and says whether today is normal (pace
  against the same weekday, unusual days, slow kitchen or bar tickets).
  Analytics opens with one sentence on why sales moved. Menu Intelligence gains
  the menu-engineering matrix (stars, plowhorses, puzzles, dogs), one
  suggestion funnel and the full list of cards. A trigger starts recording when
  a dish is marked sold out or back on, so dishes are judged only on the days
  they were on sale; history before that is estimated, and the page says so.
  The Daily Report shows tomorrow's prep list only once it beats "same as last
  week" on the last six same weekdays.
- **Suggestions a waiter would make** (`20261025160000`): a suggestion
  must belong before it is ranked — one of your pairings, or something that
  goes with what is on the table (a drink with food, fries with a burger, a
  salad with pasta, coffee or dessert after the meal, a croissant with a
  morning coffee). Never a second main or side, no cake before 11:00, no
  croissant in the evening, nothing sweet with a frappé; if nothing belongs
  the card stays empty. Among what belongs, the one that earns most leads.
  A table of three with burgers and no drinks is offered three drinks, with
  "Just one" a tap away; the running tab offers a drink while the food is
  coming. The notice `house pairings: N moved towards margin` says how many
  seeded pairings were nudged (only ones you have not edited).
- **House pairings**: suggestions start from what a La Soul waiter would
  offer (fries with a burger, churros with a hot chocolate, an espresso after
  dessert) as curated rules you can edit or switch off in Admin → Service &
  suggestions, and a curated pair can no longer add a second drink or main.
- **Suggestions v3** (`20261025100000`, `20261025110000`): the engine learns
  from the server's own record — a suggestion counts as seen once, and as
  taken only when the order was paid for — instead of from browser taps.
  Pairs need to beat chance on a pessimistic reading before they are used, old
  orders fade instead of dropping off after 90 days, and a dish with no
  history is suggested from what its section sells at this time of day.
  Suggestions are ranked by expected profit (how often taken × margin, using
  food costs where entered and the role defaults otherwise). A dish the table
  has seen and passed over is offered less. No alcoholic drink is suggested
  before 12:00 (Admin → Service & suggestions), to a table with a kids' dish,
  or to a guest filtering for halal. The policy version becomes `v3-profit`,
  so a holdout experiment running at the time is closed — start a new one
  (50% for three to four weeks; see `docs/measuring-upsell.md`). The impact
  comparison gains attach rates and an adjusted figure that needs far fewer
  days. The migration relearns once as it runs; look for the `menu
  intelligence refreshed` notice.
- **Fake orders**: a pay-at-table order that looks wrong — a big first order
  (over 60 KM or 10 portions), a table over 150 KM unpaid, several tables
  opening at once, a second session on one table, someone who joined without
  approval, or an order outside service hours — no longer prints. It waits
  under **Needs confirming** on the kitchen screen, waiter phone and floor
  monitor (with a chime) for Confirm, Reject or Block table. Once staff have
  done anything for a table, nothing more from it is held. Joining a table is
  only auto-approved when nobody there has had the menu open for two minutes.
  **Set the service hours** (and adjust the numbers) in Admin → Service &
  suggestions → Fake-order protection; until then there is no hours check.
  If the migration printed a NOTICE about skipping
  `table_sessions_one_active_per_table`, some table still has two open guest
  sessions: close them from the floor and create the index by hand.
- **If pg_cron is not available**: enable it under Database → Extensions and
  re-run the `DO $cron$` block at the end of `20261024130000`, or have any
  scheduler call `run_daily_maintenance` with the service_role key once a night.

Card payments stay off. The `kerim@lasoul.net` password still needs rotating by
hand — it reached a public repository and git history is permanent.

---

## History — the 3 August prompt (never run, superseded above)

Last updated: **3 August 2026**, for the nine migrations from
`20260804090300` to `20260805090100`.

> **Already applied.** The first three of the original batch — experiment
> integrity, the decision ledger and meal roles — are live. Lovable recorded
> them under its own timestamps (`20260803002004`, `20260803002115`,
> `20260803002144`); the contents matched mine exactly, so the duplicates were
> removed from the repository and Lovable's filenames kept, since those are the
> ones the database's migration history knows about.

---

## The prompt

> **Task: apply nine existing migration files to Supabase. Do not write any
> new SQL.**
>
> These nine files are already in the repository under `supabase/migrations/`,
> in this order:
>
> ```
> 20260804090300_session_context.sql
> 20260804090400_session_affinity.sql
> 20260804090500_maintenance.sql
> 20260804090600_app_impact.sql
> 20260804090700_guest_profiles.sql
> 20260804090800_bandit_readiness.sql
> 20260804090900_thompson_sampling.sql
> 20260805090000_business_day.sql
> 20260805090100_stale_orders.sql
> ```
>
> **Run each file, in that exact order, exactly as written.** Read each one from
> disk and execute its contents. Do not retype it, do not summarise it into a
> new migration, do not "clean it up", and do not create files with new
> timestamps containing the same logic.
>
> This matters more than it usually does, for three specific reasons:
>
> 1. **Four of these files modify an existing database function in place.** They
>    fetch the current definition with `pg_get_functiondef()` and perform exact
>    string replacement on it. If the text is paraphrased by even one character,
>    the replacement finds nothing. Each rewrite asserts that it matched and
>    raises an exception if it did not, so a paraphrase will fail loudly rather
>    than silently — but it will fail.
>
> 2. **Line endings are content in these files.** They must stay as LF. A CRLF
>    conversion adds carriage returns to the search strings while the function
>    bodies stored in Postgres have none, and every replacement misses. There is
>    a `.gitattributes` pinning this; please do not override it.
>
> 3. **Order is load-bearing.** `20260804090300` rewrites a function that the
>    already-applied decision-ledger migration renamed, and `20260804090900`
>    rewrites one from `20260804090300`. Running them out of order will fail.
>
> **If a file fails, stop.** Report the exact error text and the file name, and
> do not continue to the next file or attempt a workaround. A partial apply is
> recoverable; a guessed fix on top of a partial apply is not.
>
> **Do not create, modify or bootstrap any user account, password, PIN or
> credential.** No `crypt()`, no `encrypted_password`, no inserts into
> `auth.users`. If something appears to need one, stop and say so instead.
>
> **When you are done, run these five checks and paste the raw output:**
>
> ```sql
> -- 1. every new function exists
> SELECT proname FROM pg_proc p
>   JOIN pg_namespace n ON n.oid = p.pronamespace
>  WHERE n.nspname = 'public'
>    AND proname IN ('business_day','business_day_range','sample_acceptance',
>                    'acceptance_for_ranking','maybe_enable_sampling',
>                    'bandit_readiness','rank_recommendations','session_context',
>                    'refresh_session_affinity','guest_forget_me',
>                    'app_impact_summary','run_daily_maintenance')
>  ORDER BY proname;
>
> -- 2. the ranker actually picked up the sampling hook (should return 1 row)
> SELECT 1 FROM pg_proc p
>   JOIN pg_namespace n ON n.oid = p.pronamespace
>  WHERE n.nspname = 'public' AND p.proname = 'rank_recommendations'
>    AND pg_get_functiondef(p.oid) LIKE '%acceptance_for_ranking%';
>
> -- 3. the trading day and the UTC date, side by side
> SELECT public.business_day() AS trading_day, CURRENT_DATE AS utc_date;
>
> -- 4. sampling must be OFF
> SELECT reco_sampling_enabled, public.reco_policy_version()
>   FROM public.restaurant_settings WHERE id = 1;
>
> -- 5. the gate should report not-ready, with counts of zero
> SELECT public.bandit_readiness();
> ```
>
> Expected: check 4 returns `false` and `v1-fixed-ranker`. Check 5 returns
> `"ready": false`. Both are correct — the new ranking policy is deliberately
> dormant until there is real service data behind it. If check 4 says `true`,
> something is wrong; tell me.
>
> Check 3 will show two different dates if you run it between local midnight and
> 02:00. That is expected and is the whole point of `20260805090000`.

---

## What these nine change, in one line each

| File | Effect |
|---|---|
| `..090300_session_context` | The ranker reads the whole visit; **fixes a live bug** where one guest's salad hid every meat dish from the whole table |
| `..090400_session_affinity` | Learns pairings across rounds, not only within one order; social proof quotes a lower bound or stays silent |
| `..090500_maintenance` | Retention with a 120-day floor, on an advisory-locked nightly job |
| `..090600_app_impact` | `app_impact_summary()` behind `/admin/impact` |
| `..090700_guest_profiles` | Device profiles and real deletion |
| `..090800_bandit_readiness` | The gate |
| `..090900_thompson_sampling` | The sampler, off, plus the nightly job that enables it when the gate passes |
| `..0805090000_business_day` | **Money.** The trading day is Sarajevo's, not UTC's |
| `..0805090100_stale_orders` | Closes unpaid orders open for hours; will not touch a paid one |

## After it applies

Three things change visibly:

- **`/admin/impact`** starts working. It will say it has no causal result yet,
  which is correct — no experiment is running. Start one from that page when
  you want the measurement to begin.
- **Shift close** starts including trade after midnight. If a past close showed
  a surplus roughly the size of a night's late takings, this is why it did.
- **Old open orders get closed** the first night maintenance runs — the ones
  showing hundreds of hours of wait. Only unpaid ones; anything paid is listed
  by `orders_needing_attention()` for a person to confirm.

Nothing about ordering, payment or the kitchen changes.

## What is *not* in this batch

Card payments stay off. No account, password or credential is touched. The
`kerim@lasoul.net` password still needs rotating by hand — it reached a public
repository and git history is permanent.
