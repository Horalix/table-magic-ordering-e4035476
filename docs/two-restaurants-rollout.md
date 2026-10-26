# Two restaurants — putting it live

What is built on `feature/two-restaurants` (docs/two-restaurants.md), and the
order it goes live in. Each step leaves La Soul working exactly as today, so
there is no rush between them and no step needs the restaurant closed.

| | What | How | La Soul sees |
|---|---|---|---|
| 1 | **The database**: both migrations | Lovable runs `docs/migration-runner.sql` (pinned commit, MD5-checked) | Nothing. An app that names no restaurant is La Soul throughout. |
| 2 | **Three edge functions**: `create-waiter`, `delete-waiter`, `cloudprnt` | Lovable redeploys them from `main` | Nothing. New waiters are created for the restaurant of the admin creating them; printers print their own restaurant's header. |
| 3 | **The app** | Merge the branch into `main`; Netlify deploys it | Nothing, except the admin header now says the restaurant's name. The owner gets a La Soul / Vera Italia switch in the admin. |
| 4 | **Vera Italia itself** | Its menu, photos, colors, logo, tables, staff; then `live: true` in `src/lib/venues.ts` | Nothing. Vera Italia's addresses answer "not found" until then. |

Steps 2 and 3 need step 1 first: the new functions write the restaurant of a
waiter, which the database only has after step 1. Step 3 is safe on either
side of step 1 (a database without the second restaurant ignores what the
app sends), but goes after step 2 so creating a waiter never fails.

## Step 1 in detail

1. **Preflight** — `docs/migration-preflight.sql`, read-only. Every row must
   be true; it checks the live database is the one the migrations expect
   (37 tables, the settings row, the functions the migrations replace).
2. **Apply** — `docs/migration-runner.sql`, step by step as its header says.
   It downloads the two files from GitHub at commit `796a062`, checks each
   file's MD5, and runs each in one transaction; a failure changes nothing.
3. **Check**, read-only:
   - `SELECT slug, name, is_live FROM public.venues ORDER BY slug;` —
     `lasoul` live, `veraitalia` not.
   - `SELECT venue_id, count(*) FROM public.orders GROUP BY 1;` — one row,
     La Soul's id (`a5000000-…0001`).
   - `SELECT role, venue_id IS NULL AS owner, count(*) FROM public.user_roles GROUP BY 1, 2;`
     — every admin is an owner (`true`), every staff row has a restaurant.

Then open the admin, the kitchen and the waiter screens and place one test
order: all of it is La Soul's as before.

## Who gets which account

- **The owner** — every admin account that exists today becomes an owner
  (an admin of no one restaurant). Nothing to do.
- **A Vera Italia admin** — a `user_roles` row `('admin', Vera Italia's id)`
  for their account. The owner can add it; a restaurant admin cannot make
  owners or admins of the other restaurant (the database refuses).
- **Vera Italia waiters and kitchen** — the owner, with the admin switched to
  Vera Italia, adds them in Admin → Waiters; a Vera Italia admin adds them to
  Vera Italia whatever the switch says.

Accounts and passwords are created by the owner in the app or in Lovable,
never in a prompt or a chat.

## Still to decide before Vera Italia opens

- Its menu, prices, photos, colors, fonts, logo, address, phone and hours.
- Its tables and room QR code (Admin → QR Codes, switched to Vera Italia).
- Its printers (Admin → Printing, switched to Vera Italia): its own poll URLs.
- Whether its website lives at its own domain or under this one.
- Split the suggestion engine's learned totals per restaurant
  (docs/two-restaurants.md, "Still shared").
