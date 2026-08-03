# Lovable prompt — apply the pending migrations

Copy everything between the rules into Lovable. Nothing else needs to be said.

Last updated: **3 August 2026**, for the twelve migrations from
`20260804090000` to `20260805090100`.

---

## The prompt

> **Task: apply twelve existing migration files to Supabase. Do not write any
> new SQL.**
>
> These twelve files are already in the repository under `supabase/migrations/`,
> in this order:
>
> ```
> 20260804090000_experiment_integrity.sql
> 20260804090100_decision_ledger.sql
> 20260804090200_meal_roles.sql
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
> 1. **Five of these files modify an existing database function in place.** They
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
> 3. **Order is load-bearing.** `20260804090300` rewrites a function that
>    `20260804090100` renames. Running them out of order will fail.
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

## What these twelve change, in one line each

| File | Effect |
|---|---|
| `..090000_experiment_integrity` | Uplift is measured per visit, net of tips and refunds, with the holdout arm frozen in a ledger instead of recomputed on read |
| `..090100_decision_ledger` | Every ranking decision is recorded, including when it chose to suggest nothing |
| `..090200_meal_roles` | Adds `meal_role` — starter, main, dessert, drink — which `station` could not express |
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
