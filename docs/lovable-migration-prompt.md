# Lovable prompt — apply the pending migrations

Copy everything between the rules into Lovable. Nothing else needs to be said.

## Next: WhatsApp messages about reservations (one migration, one new function)

Send this once `main` has `feature/reservation-whatsapp` merged (the runner
is pinned to its commit 0f1a4c5). It can be sent before or after the four
WhatsApp secrets are set (docs/whatsapp-messages.md): the function reads them
whenever it runs, and until they are set nothing is sent and nothing fails.

- **The migration** (`20261114090000_reservation_messages.sql`): each
  restaurant's two choices on `restaurant_settings` (message guests on
  WhatsApp; a WhatsApp number to tell about new requests), both off;
  `reservation_messages`, one row per reservation and kind of message, which
  only the restaurant's admins read and only the function writes; two
  triggers that call the new function when a guest asks for a table and when
  a request is confirmed, declined or cancelled, and only for a restaurant
  that has messages on; and `guest_reservation_options` gains one field,
  `whatsapp`. No menu, order, payment, staff or analytics data changes.
  Nothing in it references the `auth` schema. Safe to run again.
- **One new Edge Function:** `reservation-messages` (`verify_jwt = false`,
  as `notify-staff`). It sends through Meta's WhatsApp Cloud API with four
  secrets the owner sets: `WHATSAPP_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`,
  `WHATSAPP_PHONE_ID_LASOUL`, `WHATSAPP_PHONE_ID_VERAITALIA`.
- Netlify publishes the app itself from `main`. Until this is applied, Admin
  → Reservations shows nothing about WhatsApp and everything else works as
  before. After it, messages are still **off** until an admin turns them on.

---

> **Task: apply one migration with `docs/migration-runner.sql`, then deploy
> one new Edge Function. Do not retype the migration file and do not write
> any other SQL that changes data, schema or permissions.**
>
> Make sure your checkout is the latest `main`.
>
> Nothing in the migration references the `auth` schema: user ids are plain
> uuids. If your schema rules object to anything in the file, stop before
> Step 1 and quote the line.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If it fails, stop and report the exact error; a failed
>    block changes nothing.
> 2. Check, read-only, each as its own query, and paste the raw output of
>    each. None of them calls a function of the migration:
>    ```sql
>    SELECT to_regclass('public.reservation_messages') IS NOT NULL AS messages,
>           to_regprocedure('public.reservation_messages_notify()') IS NOT NULL AS notify,
>           (SELECT prosrc LIKE '%''whatsapp''%' FROM pg_proc
>             WHERE oid = to_regprocedure('public.guest_reservation_options(text)')) AS options_say_whatsapp;
>    SELECT v.slug, rs.reservations_whatsapp_guest, rs.reservations_whatsapp_admin, rs.reservations_enabled
>      FROM public.restaurant_settings rs JOIN public.venues v ON v.id = rs.venue_id ORDER BY v.slug;
>    SELECT tgname FROM pg_trigger
>     WHERE tgrelid = 'public.reservations'::regclass AND tgname LIKE 'reservation_messages_on_%' ORDER BY 1;
>    SELECT tablename, cmd, roles FROM pg_policies WHERE tablename = 'reservation_messages' ORDER BY 1, 2;
>    SELECT has_table_privilege('anon', 'public.reservation_messages', 'SELECT') AS guests_can_read,
>           has_table_privilege('authenticated', 'public.reservation_messages', 'INSERT') AS users_can_write,
>           has_function_privilege('anon', 'public.reservation_messages_url()', 'EXECUTE') AS guests_can_call,
>           has_function_privilege('anon', 'public.guest_reservation_options(text)', 'EXECUTE') AS guests_can_ask;
>    SELECT count(*) AS messages FROM public.reservation_messages;
>    ```
>    Expected, in order: `true`, `true`, `true`. Two rows, `lasoul` and
>    `veraitalia`, each with `false` and an empty (null) number; the last
>    column is whatever each restaurant has set and is not changed by this.
>    Two triggers: `reservation_messages_on_answer` and
>    `reservation_messages_on_request`. One policy: `reservation_messages`,
>    `SELECT`, `{authenticated}`. `false`, `false`, `false`, `true`. `0`. If
>    anything differs, stop and paste what you got; do not fix it yourself.
> 3. Deploy the new Edge Function `reservation-messages` from
>    `supabase/functions/` exactly as it is in `main`, with the settings in
>    `supabase/config.toml` (`verify_jwt = false`). It imports
>    `supabase/functions/_shared/http.ts`, `reservation-messages.ts` and
>    `whatsapp.ts`. Deploy no other function. Paste the deploy result.
> 4. Call `GET https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/reservation-messages`
>    (no sign-in) and paste the answer. Expected: `{"configured":false,"templates":14}`,
>    or `"configured":true` if the owner has already set the WhatsApp
>    secrets. Either is right.
> 5. Call `POST` on the same address (no sign-in) with the JSON body
>    `{"id":"00000000-0000-4000-8000-000000000000"}` and paste the status and
>    the answer. Expected: `404` and `{"skipped":"not_found"}`. It names a
>    reservation that does not exist and changes nothing.
>
> Do not call `guest_request_reservation`, `guest_cancel_reservation`,
> `staff_decide_reservation`, `guest_reservation_options` or the function
> with any other body: a real request would message a real person. Do not
> switch reservations or WhatsApp messages on for either restaurant: that is
> its admin's to do. Do not set, read or print any `WHATSAPP_` secret. Do not
> grant anything.
>
> Files your schema-change tool writes by itself are fine (its own migration
> record, a regenerated `src/integrations/supabase/types.ts`, `.lovable`
> notes). Edit no other file by hand. Do not create or change any user
> account, password or credential, do not place an order, call a waiter or ask
> for a bill, and do not enable online card payments.

---

### After it applies: connect the numbers and try it

docs/whatsapp-messages.md, from "Connecting the numbers at Meta". In short:
the four secrets, then at each restaurant **Admin → Reservations → WhatsApp
messages → Set up the messages**, wait for **Ready**, turn on **Message
guests on WhatsApp**, and **Send a test** to your own number. Then ask for a
table from another phone with WhatsApp on it and confirm it.

---

## Done: table reservations, and the Manager app's alerts (12 November 2026)

Applied by Lovable on 12 November 2026 (the runner pinned to 8ff2bb5): the
migration, then `notify-staff` redeployed. All eight checks matched, its `GET`
answers `configured: true`, and the `POST` naming a request that does not
exist answers `404` `{"skipped":"not_found"}`. Reservations are **off** at
both restaurants until an admin turns them on (docs/reservations.md, "Turning
it on"); since then a guest's own page is at `/reservation/<id>`, not
`/reserve/<id>`. No new keys: the alerts use the three already set.

- **The migration** (`20261113090000_reservations.sql`): the restaurant's
  rules for reservations on `restaurant_settings` (off at both restaurants
  until an admin switches them on); `reservations`, one row per request, which
  guests reach only through their own request's token and only the
  restaurant's admins read; `reservation_alert_phones`, the phones of admins
  who asked to be alerted; two triggers that tell `notify-staff` about a new
  request and about a confirmed table its guest cancels; and a job every
  minute that reminds once about a request nobody has answered and marks one
  nobody answered as expired once its time has passed. No menu, order,
  payment, staff or analytics data changes. Nothing in it references the
  `auth` schema. Safe to run again.
- **One Edge Function redeployed:** `notify-staff`, which now also takes a
  request for a table and rings that restaurant's admins. Same settings
  (`verify_jwt = false`), same keys.
- Netlify publishes the app itself from `main`. Until this is applied,
  `/reserve` says online reservations are not open and Admin → Reservations
  says they are not switched on yet; everything else works as before. After
  it, reservations are still **off** until an admin turns them on
  (docs/reservations.md, "Turning it on").

---

> **Task: apply one migration with `docs/migration-runner.sql`, then redeploy
> one Edge Function. Do not retype the migration file and do not write any
> other SQL that changes data, schema or permissions.**
>
> Make sure your checkout is the latest `main`.
>
> Nothing in the migration references the `auth` schema: user ids are plain
> uuids. If your schema rules object to anything in the file, stop before
> Step 1 and quote the line.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If it fails, stop and report the exact error; a failed
>    block changes nothing.
> 2. Check, read-only, each as its own query, and paste the raw output of
>    each. None of them calls a function of the migration:
>    ```sql
>    SELECT to_regclass('public.reservations') IS NOT NULL AS reservations,
>           to_regclass('public.reservation_alert_phones') IS NOT NULL AS alert_phones,
>           to_regprocedure('public.guest_request_reservation(text,text,text,integer,date,time,text,text,text)') IS NOT NULL AS ask,
>           to_regprocedure('public.staff_decide_reservation(uuid,text,text)') IS NOT NULL AS answer;
>    SELECT v.slug, rs.reservations_enabled, rs.reservations_open, rs.reservations_close, rs.reservations_max_party
>      FROM public.restaurant_settings rs JOIN public.venues v ON v.id = rs.venue_id ORDER BY v.slug;
>    SELECT tgrelid::regclass::text AS on_table, tgname FROM pg_trigger
>     WHERE tgname LIKE 'staff_push_on_%' ORDER BY 1, 2;
>    SELECT tablename, cmd, roles FROM pg_policies
>     WHERE tablename IN ('reservations', 'reservation_alert_phones') ORDER BY 1, 2;
>    SELECT pg_get_constraintdef(oid) AS sources FROM pg_constraint WHERE conname = 'staff_push_sent_source_check';
>    SELECT has_function_privilege('anon', 'public.guest_request_reservation(text,text,text,integer,date,time,text,text,text)', 'EXECUTE') AS guests_can_ask,
>           has_function_privilege('anon', 'public.staff_decide_reservation(uuid,text,text)', 'EXECUTE') AS guests_can_answer,
>           has_function_privilege('authenticated', 'public.reservations_sweep()', 'EXECUTE') AS users_can_sweep,
>           has_table_privilege('anon', 'public.reservations', 'SELECT') AS guests_can_read_the_list,
>           has_table_privilege('authenticated', 'public.reservations', 'UPDATE') AS users_can_write_the_list;
>    SELECT count(*) AS requests FROM public.reservations;
>    SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'lasoul-reservations';
>    ```
>    Expected, in order: `true`, `true`, `true`, `true`. Two rows, `lasoul`
>    and `veraitalia`, each `false`, `11:00:00`, `21:00:00`, `10`. Six
>    triggers: `bill_requests` `staff_push_on_bill_request`; `orders`
>    `staff_push_on_order` and `staff_push_on_order_paid`; `reservations`
>    `staff_push_on_reservation` and `staff_push_on_reservation_cancelled`;
>    `waiter_calls` `staff_push_on_waiter_call`. Three policies:
>    `reservation_alert_phones` `DELETE` and `SELECT`, `reservations`
>    `SELECT`, each for `{authenticated}`. One row naming six sources:
>    `orders`, `waiter_calls`, `bill_requests`, `reservations`,
>    `reservation_reminders`, `reservation_cancellations`. `true`, `false`,
>    `false`, `false`, `false`. `0`. One row: `lasoul-reservations`,
>    `* * * * *`, `true`. If the last query alone is refused (no leave to read
>    `cron.job`), say so and go on. If anything else differs, stop and paste
>    what you got; do not fix it yourself.
> 3. Redeploy the Edge Function `notify-staff` from `supabase/functions/`
>    exactly as it is in `main`, with the settings in `supabase/config.toml`
>    (`verify_jwt = false`). It imports `supabase/functions/_shared/http.ts`,
>    `notify-staff.ts`, `staff-push.ts` and `web-push.ts`. Deploy no other
>    function. Paste the deploy result.
> 4. Call `GET https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/notify-staff`
>    (no sign-in) and say whether the answer has `"configured":true`. Do not
>    paste the key.
> 5. Call `POST` on the same address (no sign-in) with the JSON body
>    `{"table":"reservations","id":"00000000-0000-4000-8000-000000000000"}`
>    and paste the status and the answer. Expected: `404` and
>    `{"skipped":"not_found"}`, which is the new code answering (the old code
>    answers `400`). It names a request that does not exist and changes
>    nothing.
>
> Do not call `guest_request_reservation`, `guest_cancel_reservation`,
> `staff_decide_reservation`, `reservation_alerts_subscribe`,
> `reservations_sweep` or `run_scheduled_reservation_sweep`: each writes. Do
> not switch reservations on for either restaurant: that is its admin's to
> do. Do not grant anything.
>
> Files your schema-change tool writes by itself are fine (its own migration
> record, a regenerated `src/integrations/supabase/types.ts`, `.lovable`
> notes). Edit no other file by hand. Do not create or change any user
> account, password or credential, do not place an order, call a waiter or ask
> for a bill, and do not enable online card payments.

---

### After it applies: turn it on and try it

Wait until Netlify has published `main`. All of it with your own phone; no
guest is involved.

1. **Admin → Reservations.** Set the first and last time, the largest group
   and the phone guests can call, and **Save the rules**.
2. **The manager's iPhone:** in Safari open `lasoul.net/admin`, **Share → Add
   to Home Screen** (it is called **Manager**), open Manager from the Home
   Screen and sign in. On **Reservations** turn on **Alert this phone**,
   **Allow**, then **Send a test** and lock the phone: it arrives within
   about ten seconds. (Android: the same from Chrome's **Install app**.)
3. Switch **Take reservation requests on the website** on.
4. From another phone open `lasoul.net/reserve`, ask for a table tomorrow,
   and watch: the manager's phone rings, Admin → Reservations shows it under
   **Waiting for your answer**, **Confirm** it with a line, and the other
   phone's page changes to **Your table is confirmed** by itself.
5. Cancel it from the guest's page: the manager's phone rings again
   (*Cancelled by the guest*).

More in docs/reservations.md.

---

## Done: alerts that ring with the screen off, for the waiter apps (12 November 2026)

Applied by Lovable on 12 November 2026, on the second sending (pinned to
721d4b0): the migration, then `notify-staff` deployed; every check matched
and its `GET` answers `configured: true`. One check as first written called
`staff_push_url()`, which only the server may call, and Lovable rightly
stopped there: a check reads `pg_proc.prosrc` instead of calling it. What was
sent:

Send this once `main` has `fix/staff-push-plain-user-id` merged (the runner
is pinned to its commit 721d4b0), and **after you have set the three keys
yourself** (just below). Lovable never sees, makes or types a key.

Sent once already, on 12 November 2026, pinned to a80180d: Lovable confirmed
the three keys and pg_net, then stopped before Step 1 and applied nothing.
Its schema rule lets only `profiles` and `user_roles` reference `auth.users`,
and `staff_push_subscriptions.user_id` did. The migration now keeps that id as
a plain uuid, as `waiters` does.

- **The migration** (`20261112090000_staff_push.sql`): where each waiter's
  phone or tablet can be reached (`staff_push_subscriptions`; a waiter sees
  and manages only their own, and only at a restaurant they wait tables at),
  and triggers on orders, waiter calls and bill requests that tell the new
  function about each one through pg_net. No menu, order, payment, staff or
  analytics data changes. A trigger never stops an order: without pg_net, or
  if queuing the call fails, the order goes in as before, without an alert.
  Nothing in it references `auth.users`: the phones of a waiter who is
  removed are forgotten at the next order, call or bill request. Safe to run
  again.
- **One new Edge Function:** `notify-staff`, with `verify_jwt = false`
  (already in `supabase/config.toml`), because the database calls it without a
  sign-in. It reads the row itself and sends each alert once, to the table's
  waiter, or to the waiters on shift at that restaurant when the table has
  nobody. Never to the other restaurant's waiters.
- Netlify publishes the app itself from `main`. Until the function and its
  keys are live, the waiter screen (and the Android app, android/README.md)
  says *Lock-screen alerts are not switched on … yet* and everything else
  works as before.

### First, the keys (you, not Lovable)

1. On your computer, in the repository: `npm run vapid:keys`. It prints three
   lines and writes nothing.
2. In Lovable, add three **Edge Function secrets** (Cloud → Secrets; if you
   cannot find it, ask Lovable for its "add secret" form and type the values
   into that form, never into the chat):
   - `VAPID_PUBLIC_KEY`: the key on the first line;
   - `VAPID_PRIVATE_KEY`: the key on the second line;
   - `VAPID_SUBJECT`: `mailto:` and an address you read, for example
     `mailto:you@example.com` (the push services write there if something is
     wrong).
3. Close the terminal. The private key lives in that secret and nowhere else:
   not in a chat, a document or the repository. The two keys stay a pair: a
   new pair later means every waiter turns alerts on again.

---

> **Task: apply one migration with `docs/migration-runner.sql`, then deploy
> one new Edge Function. Do not retype the migration file and do not write
> any other SQL that changes data or schema.**
>
> Make sure your checkout is the latest `main`.
>
> You stopped this task once, before Step 1, because
> `staff_push_subscriptions.user_id` referenced `auth.users`. That reference
> is gone: `user_id` is now a plain uuid, and nothing in the migration
> references the `auth` schema. If your schema rules object to anything else
> in the file, stop before Step 1 again and quote the line.
>
> 1. Confirm that the Edge Function secrets `VAPID_PUBLIC_KEY`,
>    `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` exist. Report their names only:
>    never print, log, copy or store their values anywhere. If one is missing,
>    stop and show me the form to add it. Do not ask me to paste a key into
>    the chat, and do not make keys yourself.
> 2. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If it fails, stop and report the exact error; a failed
>    block changes nothing.
> 3. Check, read-only, and paste the raw output of each:
>    ```sql
>    SELECT to_regclass('public.staff_push_subscriptions') IS NOT NULL AS phones,
>           to_regclass('public.staff_push_sent') IS NOT NULL AS sent,
>           to_regprocedure('public.staff_push_subscribe(text,jsonb,uuid)') IS NOT NULL AS subscribe,
>           public.staff_push_url() AS url;
>    SELECT tgrelid::regclass::text AS on_table, tgname FROM pg_trigger
>     WHERE tgname LIKE 'staff_push_on_%' ORDER BY 1, 2;
>    SELECT cmd, roles FROM pg_policies WHERE tablename = 'staff_push_subscriptions' ORDER BY cmd;
>    SELECT count(*) AS phones FROM public.staff_push_subscriptions;
>    ```
>    Expected: `true`, `true`, `true` and
>    `https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/notify-staff`
>    (if that is not this project's Edge Functions address, stop and say so);
>    four triggers: `bill_requests` `staff_push_on_bill_request`, `orders`
>    `staff_push_on_order` and `staff_push_on_order_paid`, `waiter_calls`
>    `staff_push_on_waiter_call`; four policies, `DELETE`, `INSERT`, `SELECT`
>    and `UPDATE`, each for `{authenticated}`; `0` phones.
> 4. Deploy the new Edge Function `notify-staff` from `supabase/functions/`
>    exactly as it is in `main`, with the settings in `supabase/config.toml`
>    (`verify_jwt = false`). It imports `supabase/functions/_shared/http.ts`,
>    `notify-staff.ts`, `staff-push.ts` and `web-push.ts`. Deploy no other
>    function. Paste the deploy result.
> 5. Call `GET https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/notify-staff`
>    (no sign-in) and paste the answer. Expected:
>    `{"configured":true,"publicKey":"B…"}`; the public key is not a secret.
>    `{"configured":false}` means a secret is missing or the two keys are not
>    one pair: say which of the three names exist, nothing more.
>
> Files your schema-change tool writes by itself are fine (its own migration
> record, a regenerated `src/integrations/supabase/types.ts`, `.lovable`
> notes). Edit no other file by hand. Do not create or change any user
> account, password or credential, do not place an order, call a waiter or ask
> for a bill, and do not enable online card payments.

---

### After it applies: test it on a tablet

Wait until Netlify has published `main`. Use a waiter account of your own.
No order is needed: **Send a test** rings exactly the way an order does.

1. On the tablet, in Chrome, open `lasoul.net/waiter-app/` (Vera Italia:
   `veraitalia.net/waiter-app/`), download and install the app
   (android/README.md, "Setting up a tablet").
2. Wait a minute with the tablet online, then open the app: the waiter
   sign-in, with **no address bar**. Sign in.
3. Tap the **Alerts on lock screen** switch, then **Allow** on Android's own
   prompt (*Allow La Soul Waiter to send you notifications?*). It says **On**.
   If the site asks instead, close the app, wait a minute and open it again
   (android/README.md).
4. Tap **Send a test** and lock the tablet at once. Within about ten seconds
   it rings with the app's chime and shows **Test alert** on the lock screen.
   Tap it: the waiter screen opens.
5. A real one: scan a table's code on a second phone, take the table on the
   tablet, lock the tablet, and tap **Call Waiter** on the phone. **Calling
   you · Table N** rings within a couple of seconds. Clear it and free the
   table.

No sound: the tablet's notification volume, Do Not Disturb, and Settings →
Apps → the app → Notifications → **Orders, calls and bills**. More in
docs/operations-runbook.md, "Lock-screen alerts don't arrive".

---

## Done: tables closed at the end of the work day (10 November 2026)

Applied by Lovable on 10 November 2026: 3 functions, the setting, and the
`lasoul-close-tables` job. What was sent:

Send this once `main` has `feature/close-all-tables` merged (the runner is
pinned to its commit e959ede).

- **`20261110120000_close_all_tables.sql`**: Close all tables, the end-of-day
  notice on the waiter phone, the floor and the admin, the "Work day ends at"
  setting (Admin → Ordering & service), and the overnight close of settled
  tables whose guests have gone (pg_cron, 03:10 UTC, where it is installed).
  A table that still owes money is never closed by it. Until this is applied,
  the notice and the button do not appear; nothing else changes.
- No Edge Function changes.

---

> **Task: apply one migration with `docs/migration-runner.sql`. Do not retype
> the migration file and do not write any other SQL that changes data or
> schema.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If one fails, stop and report the exact error; a failed
>    block changes nothing.
> 2. Check, read-only, and paste the raw output:
>    ```sql
>    SELECT (SELECT count(*) FROM pg_proc
>             WHERE pronamespace = 'public'::regnamespace
>               AND proname IN ('staff_close_all_tables', 'staff_open_tables', 'close_tables_overnight')) AS functions,
>           (SELECT count(*) FROM information_schema.columns
>             WHERE table_schema = 'public' AND table_name = 'restaurant_settings'
>               AND column_name = 'day_ends_at') AS setting;
>    ```
>    Expected: `functions = 3` and `setting = 1`. Then, on its own:
>    `SELECT count(*) FROM cron.job WHERE jobname = 'lasoul-close-tables';`
>    Expected `1`. If that fails because pg_cron is not installed, say so and
>    stop there: the rest is still correct.
> 3. Change no file. No Edge Function needs redeploying.
>
> Do not call `staff_close_all_tables`, `close_tables_overnight` or
> `run_scheduled_table_close`: each closes live tables. `staff_open_tables`
> only reads them, and the app calls it; leave it too. Do not
> insert, change or delete any row. Do not create or change any user account,
> password or credential, do not change any Auth setting, and do not enable
> online card payments.

---

## Done: one person can run both restaurants (6 November 2026)

Applied by Lovable on 6 November 2026: the old one-admin-role rule is gone,
the two new rules are in place, roles stayed at 4, and `manage-admins` was
redeployed. What was sent:

Send this once `main` has `feature/admin-both-restaurants` merged (the runner
is pinned to its commit 2d419ee).

- **`20261106120000_admin_of_both_restaurants.sql`**: `user_roles` allowed one
  admin role per account (unique on user and role), so the owner could not
  make the same person the admin of La Soul and of Vera Italia. The rule
  becomes one row per account, role and restaurant, and still one owner row
  per account. Nothing is deleted or changed: every row that exists already
  fits. Until this is applied, Team's **Both** says the database needs this
  update.
- **Function**: `manage-admins`, whose `appoint` now takes one restaurant or
  both. Until it is redeployed, Team's **Both** says the function needs
  redeploying, and appoints no one.
- The generated types are unchanged; the app does not need them regenerated.

---

> **Task: apply one migration with `docs/migration-runner.sql`, then
> redeploy one Edge Function. Do not retype the migration file and do not
> write any other SQL that changes data or schema.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If one fails, stop and report the exact error; a failed
>    block changes nothing.
> 2. Check, and paste the raw output:
>    ```sql
>    SELECT (SELECT count(*) FROM pg_constraint
>             WHERE conrelid = 'public.user_roles'::regclass AND conname = 'user_roles_user_id_role_key') AS old_rule,
>           (SELECT count(*) FROM pg_indexes
>             WHERE schemaname = 'public' AND tablename = 'user_roles'
>               AND indexname IN ('user_roles_one_per_restaurant', 'user_roles_one_without_restaurant')) AS new_rules,
>           (SELECT count(*) FROM public.user_roles) AS roles;
>    ```
>    Expected: `old_rule = 0`, `new_rules = 2`, and `roles` the same number
>    as before step 1 (run the last line on its own first to know it).
> 3. Redeploy the Edge Function `manage-admins` from `supabase/functions/`,
>    with the settings in `supabase/config.toml`. It imports from
>    `supabase/functions/_shared/` (`venue-access.ts`, `remove-login.ts`).
>    Paste the deploy result.
> 4. Change no file.
>
> Do not call `manage-admins` to test it: it creates and deletes real
> accounts. Do not insert, change or delete any row of `user_roles`. Do not
> create or change any user account, password or credential, do not change
> any Auth setting, and do not enable online card payments.

---

## Done: Delete on the menu can be undone, and Team's Remove (5 November 2026)

The user ran it on 5 November 2026: the `deleted_at` column and
`menu_deleted_asked()` answer on the live project. Lovable's check output was
not pasted. What was sent:

Send this once `main` has `feature/menu-undo` merged. It also carries the
Team redeploy below, in case that was not sent yet; redeploying twice is
harmless.

- **`20261105120000_menu_undo.sql`**: Delete in Admin → Menu puts a course,
  section or dish in the restaurant's bin instead of erasing it. Guests stop
  seeing it at once, past orders keep its name, and the toast's Undo, or
  Restore in "Recently deleted", puts back exactly what went. A dish that has
  been on an order can now be deleted too; the database used to refuse it.
  Until this is applied, Admin → Menu deletes as before (final, asks first).
- **`20261105120100_la_soul_deleted_dishes_to_bin.sql`**: the nine La Soul
  dishes deleted on 5 November (Grilled Chicken Slider, La Soul Fries, Chicken
  Strips, Mozzarella Sticks Combo, Mozzarella Sticks, Chicken Strips Combo,
  Shopska Salad, Puff Truffle Egg, Arabic Coffee White) go into La Soul's bin
  with their names, translations, prices and photos, unseen by guests. The
  manager restores the ones that belong on the menu.
- **Functions**: `manage-admins` and `delete-waiter`, as in the Team section
  below.
- The generated types may be regenerated; the app does not need them.

---

> **Task: apply two migrations with `docs/migration-runner.sql`, then
> redeploy two Edge Functions. Do not retype the migration files and do not
> write any other SQL that changes data or schema.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the downloads, expect 2 rows),
>    Step 2 (expect 2 rows, all `arrived_exactly = true`), then Step 3, its
>    two blocks in order (1 of 2, then 2 of 2). If one fails, stop and report
>    the exact error; a failed block changes nothing.
> 2. Check, and paste the raw output:
>    ```sql
>    SELECT (SELECT count(*) FROM pg_proc
>             WHERE pronamespace = 'public'::regnamespace
>               AND proname IN ('admin_delete_menu_entry', 'admin_restore_menu_entry', 'menu_deleted_asked')) AS functions,
>           (SELECT count(*) FROM public.menu_items
>             WHERE venue_id = 'a5000000-0000-4000-8000-000000000001' AND deleted_at IS NOT NULL) AS la_soul_in_bin,
>           (SELECT count(*) FROM public.menu_items
>             WHERE venue_id = 'a5000000-0000-4000-8000-000000000001' AND deleted_at IS NULL) AS la_soul_on_menu;
>    ```
>    Expected: `functions = 3`, `la_soul_in_bin = 9`, and `la_soul_on_menu`
>    the same number as before step 1 (154 on 5 November, unless the menu was
>    changed since).
> 3. Redeploy the Edge Functions `manage-admins` and `delete-waiter` from
>    `supabase/functions/`, with the settings in `supabase/config.toml`. Both
>    import from `supabase/functions/_shared/`, which includes
>    `remove-login.ts`. Paste the deploy result.
> 4. You may regenerate `src/integrations/supabase/types.ts`. Change no other
>    file.
>
> Do not call `admin_delete_menu_entry` or `admin_restore_menu_entry` to test
> them: each changes the live menu. Do not call `manage-admins` or
> `delete-waiter` either: they delete real accounts. Do not create or change
> any user account, password or credential, do not change any Auth setting,
> and do not enable online card payments.

---

## Included above: removing accounts from Team (two functions, no SQL)

Part of the prompt above. On its own, it was:

- **`manage-admins`** gets `remove`: the owner deletes any account's sign-in
  from Team, anyone's but their own, with its roles and waiter rows at both
  restaurants. Its `list` now also shows sign-ins left with no role, and when
  each account last signed in.
- **`delete-waiter`**: removing a waiter who had ever acknowledged a call or a
  bill, or closed a shift, left their sign-in behind without saying so,
  because five history columns name the account without `ON DELETE`. Both
  functions now clear those names first (`_shared/remove-login.ts`); the
  calls, bills and shift closes stay.
- No migration, no SQL, no types to regenerate. Until this is deployed, Team's
  Remove says "the manage-admins function needs redeploying" and changes
  nothing.

---

> **Task: redeploy two Edge Functions. Do not write or run any SQL, and do not
> change the schema.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Redeploy the Edge Functions `manage-admins` and `delete-waiter` from
>    `supabase/functions/`, with the settings in `supabase/config.toml`. Both
>    import from `supabase/functions/_shared/`, which includes the new file
>    `remove-login.ts`. Paste the deploy result.
> 2. Do not call either function to test it: `remove` and `delete-waiter`
>    delete real accounts.
>
> Do not create or change any user account, password or credential, do not
> change any Auth setting, and do not enable online card payments.

---

## Done: "Generate a new code" for the QR codes (4 November 2026)

Lovable applied it on 4 November 2026: both functions show `uses_core = true`
and `uses_pgcrypto = false`. Neither was called. What was sent:

Send this once `main` has `fix/qr-codes-without-pgcrypto` merged (the runner
is pinned to its commit 2472909).

- **The migration** (`20261103130000_qr_tokens_core_random.sql`) fixes Admin
  → QR codes → "Generate a new code", which answered `function
  gen_random_bytes(integer) does not exist`. Both QR rotations (the room's
  and a table's) now make their code with Postgres's own `gen_random_uuid()`.
  Nothing else changes: no data, no grants, no signatures. Safe to run again.
- No Edge Function changes, no types to regenerate.

---

> **Task: apply one migration with `docs/migration-runner.sql`. Do not retype
> the migration file and do not write any other SQL.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If it fails, stop and report the exact error; a failed
>    block changes nothing.
> 2. Check, and paste the raw output:
>    ```sql
>    SELECT p.proname,
>           p.prosrc LIKE '%gen_random_uuid%'  AS uses_core,
>           p.prosrc LIKE '%gen_random_bytes%' AS uses_pgcrypto
>      FROM pg_proc p
>     WHERE p.pronamespace = 'public'::regnamespace
>       AND p.proname IN ('rotate_venue_qr_token', 'rotate_table_qr_token')
>     ORDER BY 1;
>    ```
>    Expected: two rows, each `uses_core = true` and `uses_pgcrypto = false`.
>
> Do not call `rotate_venue_qr_token` or `rotate_table_qr_token` to test
> them: each replaces a printed QR code. Do not create or change any user
> account, password or credential, do not change any Auth setting, and do
> not enable online card payments.

---

## Done: "Menu only" — the menu and nothing else (3 November 2026)

Lovable applied it and regenerated the types on 3 November 2026 (c330f8d).
The runner for it was pinned to commit 2043942.

- **The migration** (`20261103120000_menu_only.sql`) adds one switch per
  restaurant, `restaurant_settings.menu_only`, off for both. With it on, guests
  get the menu and nothing else, and the database refuses a new table, order,
  waiter call or bill request at that restaurant. Switch it on in **Admin →
  Service → Menu only**. No menu, order, staff or analytics data changes. It
  is safe to run again: the column is `IF NOT EXISTS`, and each function and
  trigger is replaced.
- No Edge Function changes. Netlify publishes the app itself from `main`.

---

> **Task: apply one migration with `docs/migration-runner.sql`. Do not retype
> the migration file and do not write any other SQL.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If it fails, stop and report the exact error; a failed
>    block changes nothing.
> 2. Check, and paste the raw output of each:
>    ```sql
>    SELECT venue_id, menu_only FROM public.restaurant_settings ORDER BY venue_id;
>    SELECT tgrelid::regclass AS on_table FROM pg_trigger
>     WHERE tgname = 'zz_menu_only' AND NOT tgisinternal ORDER BY 1;
>    SELECT public.guest_get_service_status() ? 'menu_only' AS told;
>    ```
>    Expected: both restaurants with `menu_only = false`; the four tables
>    `table_sessions`, `orders`, `waiter_calls`, `bill_requests` (in any
>    order); and `true`.
> 3. Regenerate `src/integrations/supabase/types.ts` so `restaurant_settings`
>    has `menu_only`.
>
> Do not switch `menu_only` on (the owner does that in the admin), do not
> create or change any user account, password or credential, do not change
> any Auth setting (the minimum password length stays 10), and do not enable
> online card payments.

---

## Done: suggestions a head waiter would sign, and resetting passwords (1 November 2026)

Send this once `main` has the runner for this one migration (merged from
`feature/reco-quality`), the staff-accounts change (`create-waiter` with
`reset_password`, merged from `feature/staff-seo-waiter`) and the owner's
resets (`manage-admins` with `reset_password`, merged from
`feature/team-passwords`).

- **The migration:** guests at both restaurants get better suggestions. No
  menu, order, ticket, staff or analytics data changes. The one exception is
  three of Vera Italia's rib-eye pairing priorities, and only where the owner
  has not already edited them. It is safe to run again if it has already run:
  every function is `CREATE OR REPLACE`, every column `IF NOT EXISTS`, and the
  three priorities move only from their first value.
- **Two Edge Functions:**
  - `create-waiter` checks the 10-character password minimum, gives clear
    error codes, cleans up a half-created sign-in, and adds the Waiters
    page's **Password** button (`reset_password`);
  - `manage-admins` adds the Team page's **Password** button: the owner gives
    any restaurant admin, waiter or kitchen tablet a new password (never an
    owner's).

  Until they are redeployed, both pages work, except that a **Password**
  button says the function needs redeploying.
- Netlify publishes the app itself from `main`, so nothing needs republishing
  in Lovable.

---

> **Task: apply one migration with `docs/migration-runner.sql`, then deploy
> two Edge Functions. Do not retype the migration file and do not write any
> other SQL.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the download, expect 1 row),
>    Step 2 (expect 1 row, `arrived_exactly = true`), then Step 3, its one
>    block (1 of 1). If it fails, stop and report the exact error; a failed
>    block changes nothing. If it prints the notice `learned counters not
>    recounted here`, that is expected: the nightly refresh recounts them.
>    Say so.
> 2. Check, and paste the raw output of each:
>    ```sql
>    SELECT to_regprocedure('public.reco_rank_scored(uuid[],text,text,integer,uuid,text[],integer[])') IS NOT NULL AS ranker,
>           to_regprocedure('public.reco_kind_group(text)') IS NOT NULL AS groups;
>    SELECT table_name FROM information_schema.columns
>     WHERE table_schema = 'public' AND column_name = 'venue_id'
>       AND table_name IN ('reco_fit', 'reco_clash') ORDER BY 1;
>    SELECT id, priority FROM public.menu_item_recommendations
>     WHERE id IN ('b7a1e000-0000-4000-8000-000000000013',
>                  'b7a1e000-0000-4000-8000-000000000014',
>                  'b7a1e000-0000-4000-8000-000000000015') ORDER BY id;
>    SELECT venue_id, count(*) FROM public.menu_item_recommendations GROUP BY 1 ORDER BY 1;
>    ```
>    Expected: `true`, `true`; `reco_clash` and `reco_fit`; priorities 45,
>    55, 75 in that order; and the same rule counts per restaurant as before
>    (Vera Italia's `…0002` has 15).
> 3. Deploy the Edge Functions `create-waiter` and `manage-admins` from
>    `supabase/functions/` exactly as they are in `main`, with the settings in
>    `supabase/config.toml`. Both import `supabase/functions/_shared/venue-access.ts`,
>    which changed too. Deploy no other function. Paste the deploy result.
>
> Do not create or change any user account, password or credential, do not
> change any Auth setting (the minimum password length stays 10), and do not
> enable online card payments.

---

## Done: Vera Italia's suggestions, separation of the two restaurants, the owner's view (31 October 2026)

Five migrations, five Edge Functions and the Auth password minimum, applied
and deployed by Lovable on 31 October 2026. It then regenerated
`src/integrations/supabase/types.ts` and added `venue_id` to AdminWaiters'
query. The prompt as sent:

---

> **Task: apply five migrations with `docs/migration-runner.sql`, deploy five
> Edge Functions, and set one Auth setting. Do not retype the migration files
> and do not write any other SQL.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the downloads, expect 5 rows),
>    Step 2 (expect 5 rows, all `arrived_exactly = true`), then Step 3 — its
>    five blocks one at a time, in order (1 of 5 … 5 of 5). If anything fails,
>    stop and report the exact error; a failed block changes nothing. If
>    block 3 prints the notice `menu-images policies NOT changed`, run that
>    file's section 2 again as the storage owner and say so.
> 2. Deploy these Edge Functions from `supabase/functions/` with the settings
>    in `supabase/config.toml`: `create-waiter`, `delete-waiter`,
>    `translate-menu`, `migrate-images`, and the new `manage-admins`. Paste the
>    deploy result.
> 3. In Authentication settings, set the minimum password length to 10.
>    Leave public sign-ups off.
> 4. Check, and paste the raw output of each:
>    ```sql
>    SELECT count(*) AS rules, count(DISTINCT source_subcategory_id) AS sections
>      FROM public.menu_item_recommendations WHERE venue_id = 'a5000000-0000-4000-8000-000000000002';
>    SELECT venue_id, count(*) FROM public.menu_item_recommendations GROUP BY 1;
>    SELECT venue_id, print_header FROM public.restaurant_settings ORDER BY venue_id;
>    SELECT proname FROM pg_proc WHERE pronamespace = 'public'::regnamespace
>       AND prosrc ~* 'has_role\s*\(\s*auth\.uid\(\)\s*,\s*''admin''';
>    SELECT qual FROM pg_policies WHERE tablename = 'user_roles' AND policyname = 'Admins can manage roles';
>    SELECT count(*) FROM public.session_experiment_assignment a
>      JOIN public.table_sessions s ON s.id = a.session_id
>      JOIN public.experiments e ON e.id = a.experiment_id WHERE e.venue_id <> s.venue_id;
>    SELECT to_regprocedure('public.owner_overview(date)') IS NOT NULL AS overview,
>           to_regprocedure('public.menu_venue()') IS NOT NULL AS menu_venue,
>           to_regprocedure('public.guest_order_eta(uuid)') IS NULL AS old_eta_gone;
>    ```
>    Expected: 15 rules over 5 sections for Vera Italia (`…0002`), La Soul's
>    (`…0001`) count the same as before; La Soul's header unchanged and Vera
>    Italia's `Vera Italia`; only `is_staff_member`; a rule containing
>    `role <> 'admin'`; `0`; `true`, `true`, `true`.
>
> Do not create or change any user account, password or credential, and do
> not enable online card payments.

---

## Done: two restaurants — La Soul and Vera Italia (30 October 2026)

Four migrations (the two restaurants, Vera Italia's menu, suggestions per
restaurant) and three Edge Functions, applied and redeployed by Lovable on
30 October 2026; Vera Italia's menu was checked against the live database
the same evening. The prompt as sent:

---

> **Task: apply four migrations with `docs/migration-runner.sql`, then
> redeploy three Edge Functions. Do not retype the migration files and do not
> write any other SQL.**
>
> Make sure your checkout is the latest `main`.
>
> 1. Run `docs/migration-preflight.sql` (read-only) and paste the result;
>    every row should be true. If one is false, stop and report it.
> 2. Run `docs/migration-runner.sql` step by step, each step as its own query:
>    Step 0 (pg_net installed), Step 1 (queue the downloads, expect 4 rows),
>    Step 2 (expect 4 rows, all `arrived_exactly = true`), then Step 3 — its
>    four blocks one at a time, in order (1 of 4, 2 of 4, 3 of 4, 4 of 4). If
>    anything fails, stop and report the exact error; a failed block changes
>    nothing.
> 3. Check, and paste the raw output of each:
>    ```sql
>    SELECT slug, name, is_live FROM public.venues ORDER BY slug;
>    SELECT venue_id, count(*) FROM public.orders GROUP BY 1;
>    SELECT venue_id, count(*) FROM public.menu_items GROUP BY 1;
>    SELECT role, venue_id IS NULL AS owner, count(*) FROM public.user_roles GROUP BY 1, 2;
>    SELECT venue_id, count(*) FROM public.reco_learning GROUP BY 1;
>    SELECT venue_id, count(*) FROM public.suggestion_priors GROUP BY 1;
>    ```
>    Expected: `lasoul` live and `veraitalia` not; every order under
>    `a5000000-0000-4000-8000-000000000001`; La Soul's dishes under `…0001`
>    and 25 under `…0002`; every admin row an owner (`true`), every staff row
>    with a restaurant (`false`); everything the suggestions have learned so
>    far under `…0001` (La Soul's) only.
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
