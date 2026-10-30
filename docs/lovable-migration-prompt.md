# Lovable prompt — apply the pending migrations

Copy everything between the rules into Lovable. Nothing else needs to be said.

## Next: two restaurants — La Soul and Vera Italia (docs/two-restaurants-rollout.md)

Send this **after** `feature/two-restaurants` is merged into `main`: the
runner, the preflight and the three functions are only on `main` from then.
La Soul keeps working exactly as today through every step; Vera Italia stays
switched off (its menu answers "not found") until it opens.

---

> **Task: apply three migrations with `docs/migration-runner.sql`, then
> redeploy three Edge Functions. Do not retype the migration files and do not
> write any other SQL.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-preflight.sql` (read-only) and paste the result;
>    every row should be true. If one is false, stop and report it.
> 2. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the downloads, expect 3 rows),
>    Step 2 (expect 3 rows, all `arrived_exactly = true`), then Step 3 — its
>    three blocks one at a time, in order (1 of 3, 2 of 3, 3 of 3). If anything
>    fails, stop and report the exact error; a failed block changes nothing.
> 3. Check, and paste the raw output of each:
>    ```sql
>    SELECT slug, name, is_live FROM public.venues ORDER BY slug;
>    SELECT venue_id, count(*) FROM public.orders GROUP BY 1;
>    SELECT venue_id, count(*) FROM public.menu_items GROUP BY 1;
>    SELECT role, venue_id IS NULL AS owner, count(*) FROM public.user_roles GROUP BY 1, 2;
>    ```
>    Expected: `lasoul` live and `veraitalia` not; every order under
>    `a5000000-0000-4000-8000-000000000001`; La Soul's dishes under `…0001`
>    and 25 under `…0002`; every admin row an owner (`true`), every staff row
>    with a restaurant (`false`).
> 4. Redeploy the Edge Functions `create-waiter`, `delete-waiter` and
>    `cloudprnt` from `supabase/functions/` with the settings in
>    `supabase/config.toml` (`cloudprnt` has `verify_jwt = false`). Paste the
>    deploy result.
>
> Do not create or change any user account, password or credential, do not
> set Vera Italia live, and do not enable online card payments.

---

## Separate, if not sent yet: the mojito wording, and two functions (no migration)

1. **Seven mojitos say "cocktail"** in all three languages (Classic, Mango,
   Peach, Raspberry, Strawberry, Passion Fruit, Blue Ocean) — on a fully halal,
   alcohol-free menu. The other mocktails already say "alcohol-free". The
   UPDATE below makes them "alcohol-free mojito" / "bezalkoholni mojito" /
   "موهيتو … خالٍ من الكحول"; it was run against copies of the live
   descriptions first, and it touches only those seven rows. The prerendered
   dish pages pick the new wording up on the next Netlify deploy.
2. **Two Monri functions.** Lovable deployed them from `a78ada4`, before
   `https://lasoulapp.netlify.app` joined their CORS list, so a card payment
   started on the Netlify site would be refused. Not urgent while card payment
   is off; it must be done before Monri goes live.

---

> **Task: two small things, in order. Do not write any other SQL and do not
> change the schema.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run this exactly as written, as one query, and paste the raw output
>    (expect `UPDATE 7`):
>    ```sql
>    UPDATE public.menu_items
>       SET description    = replace(description, 'cocktail', 'alcohol-free mojito'),
>           description_bs = replace(description_bs, 'koktel', 'bezalkoholni mojito'),
>           description_ar = replace(replace(description_ar,
>                              'كوكتيل منعش', 'موهيتو منعش خالٍ من الكحول'),
>                              'كوكتيل كلاسيكي', 'موهيتو كلاسيكي خالٍ من الكحول')
>     WHERE name ILIKE '%mojito%'
>       AND description ILIKE '%cocktail%'
>       AND description NOT ILIKE '%alcohol-free%';
>    ```
> 2. Redeploy the Edge Functions `monri-create-payment` and `monri-webhook`
>    from `supabase/functions/` with the settings in `supabase/config.toml`
>    (`monri-webhook` has `verify_jwt = false`). Paste the deploy result.
>
> Do not create or change any user account, password or credential, and do not
> enable online card payments.

---

## Done: one migration and two functions (25 October 2026)

The whole October batch is live (Lovable applied the 26 files through the
runner on 25 October; all twelve checks passed). Pending:
`20261027090000_waiter_take_table.sql` (a waiter can take a table nobody has;
"several tables at once" holds from 8 tables instead of 3), and a redeploy of
`monri-create-payment` and `monri-webhook` (the webhook must run with
`verify_jwt = false`, and both share the new CORS list, which now includes
`https://lasoulapp.netlify.app`).

The website and app themselves are hosted on **Netlify**
(`lasoulapp.netlify.app`), which builds and deploys every push to `main` on
its own; Lovable's Publish → Update only refreshes Lovable's own preview
address. Lovable is still what applies migrations and deploys Edge Functions.

---

> **Task: apply one migration with `docs/migration-runner.sql`, then redeploy two
> Edge Functions. Do not retype the migration file and do not write new SQL.**
>
> Make sure your checkout includes the latest `main`. Everything up to and
> including `20261026130000_combo_station_tickets.sql` is already applied — do
> not run any of it again.
>
> 1. Run `docs/migration-preflight.sql` (read-only) and paste the result; every
>    row should be true.
> 2. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download), Step 2 (expect one
>    row, `arrived_exactly = true`), Step 3 (the one apply block). If anything
>    fails, stop and report the exact error.
> 3. Check, and paste the raw output:
>    ```sql
>    SELECT to_regprocedure('public.staff_take_table(uuid)') IS NOT NULL AS take_table,
>           (SELECT hold_burst_sessions FROM public.restaurant_settings WHERE id = 1) AS burst;
>    ```
>    Expect `true` and `8` (or whatever value was set by hand before).
> 4. Redeploy the Edge Functions `monri-create-payment` and `monri-webhook` from
>    `supabase/functions/` with the settings in `supabase/config.toml`
>    (`monri-webhook` has `verify_jwt = false`). Paste the deploy result.
>
> Do not create or change any user account, password or credential, and do not
> enable online card payments.

---

## History

Last updated: **26 October 2026**, for twenty-six migrations from
`20261024130000` to `20261026130000`, applied through
`docs/migration-runner.sql`.

> **Applied up to `20261024120000_menu_prices_and_new_items.sql`, and why the
> rest goes through a runner.** Lovable applied business_day, stale_orders and
> the October prices, then stopped on purpose: it cannot run a file from disk,
> only retype it into its database tool, and the remaining 26 files are 735 KB
> (menu_translations alone 185 KB). One character had already slipped (an
> Arabic comma in Banana Pudding's Bosnian description, which it corrected).
> `docs/migration-runner.sql` (generated by `npm run migrations:runner`) makes
> the database fetch each file itself from this public repository at a pinned
> commit (pg_net) and run it only when the MD5 of what arrived equals the file
> as committed; what is typed is a few short blocks, and a slip fails before
> anything runs. `supabase/tests/migration-runner.test.ts` runs those exact
> blocks as an ordinary owner role and requires the same schema as applying
> the files directly.

> **Applied up to `20260804090900_thompson_sampling.sql`.** Lovable applied
> maintenance through thompson_sampling (its `drizzle/migrations/0001`–`0005`
> copies match the repository files exactly) and stopped at
> `20260805090000_business_day.sql` with `"array_agg" is an aggregate
> function` (42809); that file rolled back whole. Its rota rewrite filtered
> `pg_proc` with `pg_get_functiondef(p.oid) LIKE …`, which the live planner
> evaluated before the schema filter, on aggregates too. Since `b896eda` it
> matches on `prosrc`, and `migration-privileges.test.ts` forbids
> `pg_get_functiondef()` in a filter. The batch now starts at business_day.

> **Also applied: `20260804090400_session_affinity.sql`.** Lovable applied it
> and stopped at the next file, `20260804090500_maintenance.sql`, with
> `permission denied to set parameter "lasoul.scheduled_job"` (42501); that
> file rolled back whole. Two scheduler functions set their mark as a
> function attribute (`SET lasoul.scheduled_job = 'on'`), which needs a
> superuser. Since `0b946b2` they set it at run time with `set_config`, and
> `supabase/tests/migration-privileges.test.ts` applies the whole batch as an
> ordinary owner role, as Lovable does. The batch now starts at maintenance.

> **Already applied: `20260804090300_session_context.sql`.** Lovable's
> preflight on 25 October showed its four replaced search texts gone, and the
> production API confirms what it creates exists (`after_meal_moment()`,
> `session_context()`, `restaurant_settings.after_meal_prompt_minutes`)
> while the next files' functions (`business_day()`, `bandit_readiness()`)
> do not. The batch therefore starts at `20260804090400_session_affinity.sql`.

> **Grants, and their order.** Lovable refuses a table that relies on
> Supabase's old default grants, and wants CREATE TABLE → GRANT/REVOKE →
> ENABLE ROW LEVEL SECURITY → CREATE POLICY. Since `5b64aa5` every table these
> files create states its access directly after its CREATE TABLE;
> `supabase/tests/migration-grants.test.ts` enforces both. The preflight's
> search texts are unaffected (81/81 on the run before that commit).

> **What was live on 24 October.** Checked against the production API on
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

> **Task: apply the remaining twenty-six migrations with
> `docs/migration-runner.sql`. Do not retype any migration file, and do not
> write any new SQL.**
>
> Everything up to and including `20261024120000_menu_prices_and_new_items.sql`
> is already applied — do not run any of it again.
>
> You don't need to copy the migration files. `docs/migration-runner.sql` has
> the database download each of the 26 files itself, from this repository at
> one pinned commit, and run a file only when the MD5 of what arrived equals
> the MD5 of the file as committed (pinned in the runner). All you copy is
> short blocks; if you mistype one, it fails before anything runs. Each Step 3
> block runs one whole file in one transaction.
>
> Run it as its header says, each step as its own query:
>
> 1. **Step 0** — confirm `pg_net` is installed. If not, run
>    `CREATE EXTENSION IF NOT EXISTS pg_net;` once. If that is refused, stop
>    and say so.
> 2. **Step 1** — queue the 26 downloads, once.
> 3. **Step 2** — expect 26 rows, all `arrived_exactly = true`. Wait a few
>    seconds and repeat if not; if a row stays false, run Step 1 again; if it
>    is still false, stop and say which.
> 4. **Step 3** — run the 26 blocks one per query, in order.
>
> **If a block fails, stop.** Report the exact error text and the file name, and
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
>
> -- 9. sales and combos are priced by the server (expect 5 rows, then true)
> SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
>  WHERE n.nspname = 'public'
>    AND proname IN ('menu_item_sale_price','menu_item_unit_price','guest_get_combos','admin_save_combo','price_order_lines')
>  ORDER BY proname;
> SELECT position('price_order_lines' in pg_get_functiondef(p.oid)) > 0 AS uses_price_order_lines
>   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
>  WHERE n.nspname = 'public' AND p.proname = 'guest_place_order';
>
> -- 10. the engine learns from every table (expect 3 trigger rows; the cron row
> --     only if pg_cron is enabled)
> SELECT tgname FROM pg_trigger WHERE tgname LIKE 'trg_reco_learn%' ORDER BY tgname;
> SELECT jobname, schedule FROM cron.job WHERE jobname = 'lasoul-learning-refresh';
>
> -- 11. halal: no item can be marked alcohol (expect 1 row, and 0)
> SELECT conname FROM pg_constraint WHERE conname = 'menu_items_no_alcohol';
> SELECT count(*) AS alcohol_items FROM public.menu_items WHERE meal_role::text = 'alcohol';
>
> -- 12. menu text corrections landed (expect butter, vinegar, Cappuccino)
> SELECT name, left(description, 60) AS description FROM public.menu_items
>  WHERE name IN ('Butter Croissant', 'Shopska Salad', 'Cappuccino') ORDER BY name;
> ```
>
> If check 6 or check 10's cron query errors because the `cron` schema does not
> exist, that is not a failure of the migrations — report it and carry on with
> the remaining checks.
>
> **Finally, deploy the `cloudprnt` Edge Function** from
> `supabase/functions/cloudprnt/` (it is new; `supabase/config.toml` sets
> `verify_jwt = false` for it, because printers poll it without a login) and
> paste the deploy result.

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
