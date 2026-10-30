# Two restaurants — putting it live

What is built on `feature/two-restaurants` (docs/two-restaurants.md), and the
order it goes live in. Each step leaves La Soul working exactly as today, so
there is no rush between them and no step needs the restaurant closed.

| | What | How | La Soul sees |
|---|---|---|---|
| 1 | **The database**: the two-restaurant migrations and Vera Italia's menu | Lovable runs `docs/migration-runner.sql` (pinned commit, MD5-checked) | Nothing. An app that names no restaurant is La Soul throughout; Vera Italia's 25 dishes are Vera Italia's only. |
| 2 | **Three edge functions**: `create-waiter`, `delete-waiter`, `cloudprnt` | Lovable redeploys them from `main` | Nothing. New waiters are created for the restaurant of the admin creating them; printers print their own restaurant's header. |
| 3 | **The app** | Merge the branch into `main`; Netlify deploys it | Nothing, except the admin header now says the restaurant's name. The owner gets a La Soul / Vera Italia switch in the admin. Vera Italia's website is at `/veraitalia/`, saying "Opening soon". |
| 4 | **Vera Italia opens** | Its tables and room QR code, its staff, its printers; then `live: liveFromEnv(…)` → `live: true` in `src/lib/venues.ts`, and `UPDATE public.venues SET is_live = true WHERE slug = 'veraitalia'` | Nothing. Until then Vera Italia's menu address answers "not found" and its website links to no menu. |

Steps 2 and 3 need step 1 first: the new functions write the restaurant of a
waiter, which the database only has after step 1. Step 3 is safe on either
side of step 1 (a database without the second restaurant ignores what the
app sends), but goes after step 2 so creating a waiter never fails.

## Step 1 in detail

1. **Preflight** — `docs/migration-preflight.sql`, read-only. Every row must
   be true; it checks the live database is the one the migrations expect
   (37 tables, the settings row, the functions the migrations replace).
2. **Apply** — `docs/migration-runner.sql`, step by step as its header says.
   It downloads the three files from GitHub at the commit pinned in its
   header, checks each file's MD5, and runs each in one transaction; a
   failure changes nothing.
3. **Check**, read-only:
   - `SELECT slug, name, is_live FROM public.venues ORDER BY slug;` —
     `lasoul` live, `veraitalia` not.
   - `SELECT venue_id, count(*) FROM public.orders GROUP BY 1;` — one row,
     La Soul's id (`a5000000-…0001`).
   - `SELECT venue_id, count(*) FROM public.menu_items GROUP BY 1;` — La
     Soul's dishes under `…0001`, 25 under `…0002`.
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

## Vera Italia — what is ready

- **The menu**: 25 dishes in four courses (`scripts/vera-italia/menu.json` →
  the migration), names and descriptions in English, Bosnian and Arabic,
  prices from the owner's sheet, three featured dishes. Grilled chicken
  (+2 KM, for any pasta or risotto) is its own dish under Pasta & Risotto →
  Extras, so it is ordered and charged like any other.
- **The photographs**: every dish from the kitchen's own photos of 29 October,
  re-shot with gpt-image-2.5 (`scripts/vera-photos.mjs`) — the same dish,
  plate, table and room, with a photographer's light, lens and retouching —
  and finished with grain and sharpening (`scripts/vera-italia/import-photos.mjs`).
- **The logo**: an arch monogram (VI) over VERA ITALIA / CUCINA ITALIANA, a
  one-line wordmark and the app icons, drawn with gpt-image-2.5
  (`scripts/vera-italia/logo.mjs`, `brand-assets.mjs` → `public/brand/vera/`).
- **The look**: travertine, espresso, terracotta, brass and olive, Cormorant
  Garamond, the arch of the dining room's niches on every photograph — on
  Vera Italia's menu, its table pages and its website (`src/components/vera/`,
  `src/pages/vera/VeraSite.tsx`).

## Vera Italia — still needed from the owner

- **Allergens confirmed by the kitchen.** They are read from the recipes in
  `menu.json`; the pesto dishes are marked as containing nuts (pine nuts are
  usual in pesto), and the steak platter's Caesar dressing as eggs.
- **Address, phone, opening hours, Google Maps link, Instagram** — they go in
  `src/lib/venues.ts`; the website's "Visit" section and the menu's footer
  show them as soon as they are there.
- **Its Google review link** (`reviewUrl` in `src/lib/venues.ts`) — until then
  Vera Italia's guests are thanked for a rating without being sent to La
  Soul's listing.
- **Image credits.** The OpenAI account ran out of credits on 30 October
  before the rib-eye platter and the three photographs of the room were
  re-shot: they are the originals, graded by hand. With credits:
  `node scripts/vera-photos.mjs ribeye-platter`,
  `node scripts/vera-italia/room-photos.mjs`, then `import-photos.mjs`,
  `npm run images` and `site-images.mjs`.
- Its tables and room QR code (Admin → QR Codes, switched to Vera Italia), its
  printers (Admin → Printing, switched to Vera Italia: their own poll URLs).
- Whether its website keeps `/veraitalia/` or gets a domain of its own.
- Split the suggestion engine's learned totals per restaurant
  (docs/two-restaurants.md, "Still shared").
