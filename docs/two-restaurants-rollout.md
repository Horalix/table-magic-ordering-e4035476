# Two restaurants — putting it live

What is built on `feature/two-restaurants` (docs/two-restaurants.md), and the
order it goes live in. Each step leaves La Soul working exactly as today, so
there is no rush between them and no step needs the restaurant closed.

| | What | How | La Soul sees |
|---|---|---|---|
| 1 | **The app** | Merge the branch into `main`; Netlify deploys it | Nothing, except the admin header now says the restaurant's name. The owner gets a La Soul / Vera Italia switch in the admin. Vera Italia's website is at `/veraitalia/`, saying "Opening soon". |
| 2 | **The database**: the two-restaurant migrations and Vera Italia's menu | Lovable runs `docs/migration-runner.sql` (pinned commit, MD5-checked) — the prompt is in `docs/lovable-migration-prompt.md` | Nothing. An app that names no restaurant is La Soul throughout; Vera Italia's 25 dishes are Vera Italia's only. |
| 3 | **Three edge functions**: `create-waiter`, `delete-waiter`, `cloudprnt` | Lovable redeploys them from `main`, in the same prompt | Nothing. New waiters are created for the restaurant of the admin creating them; printers print their own restaurant's header. |
| 4 | **Vera Italia opens** | Its tables and room QR code, its staff, its printers; then `live: liveFromEnv(…)` → `live: true` in `src/lib/venues.ts`, and `UPDATE public.venues SET is_live = true WHERE slug = 'veraitalia'` | Nothing. Until then Vera Italia's menu address answers "not found" and its website links to no menu. |

Lovable works from `main`, where the runner and the functions only are once
the branch is merged, so the merge comes first. That is safe: a database
without the second restaurant ignores what the app sends, and La Soul is the
only restaurant until step 2. Step 3 needs step 2 first (the new functions
write the restaurant of a waiter, which the database only has after it);
between the merge and step 3 a waiter is created the old way, for La Soul.

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

## Vera Italia's own site — veraitalia.net

One repository, two Netlify sites. La Soul's site (lasoul.net; today
lasoulapp.netlify.app) is built as it is now. Vera Italia's is a second
Netlify site built from the **same repository and branch** with one extra
setting, `VITE_HOME_VENUE=veraitalia` (`src/lib/home-venue.ts`). On it, `/`,
`/bs/` and `/ar/` are Vera Italia's website, a bare `/menu` is its menu, the
installed app is its own, and the sitemap, robots.txt, llms.txt and every
canonical address are veraitalia.net's. Both serve the whole app (menus,
ordering, staff screens) against the one database. Search engines see two
separate websites; nothing of La Soul's is on Vera Italia's, and the other
way round.

**1. The Netlify site** (the owner, in Netlify):

1. *Add new site → Import an existing project → GitHub →*
   `Horalix/table-magic-ordering-e4035476`.
2. *Branch to deploy:* `main` once the pull request is merged. To look at it
   before then, use `feature/two-restaurants` and switch to `main` after the
   merge (*Site configuration → Build & deploy → Branches*).
3. *Build command* and *Publish directory*: the same as La Soul's site
   (La Soul's site → *Site configuration → Build & deploy → Build settings*).
4. *Environment variables* (*Site configuration → Environment variables*):
   the same `VITE_SUPABASE_URL`, `VITE_SUPABASE_PROJECT_ID`,
   `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SENTRY_DSN` and `VITE_MONRI_ENABLED`
   as La Soul's site, plus **`VITE_HOME_VENUE` = `veraitalia`**. (Set them as
   shared team variables and both sites read the same ones.)
5. *Site name:* `veraitalia` → `veraitalia.netlify.app`. Deploy, and open it:
   Vera Italia's website must be at `/`.

**2. The domain:**

1. Vera Italia's Netlify site → *Domain management → Add a domain* →
   `veraitalia.net`; make it the **primary domain** (Netlify then sends
   `www.veraitalia.net` to it).
2. DNS, either:
   - **Netlify DNS** (simplest): Netlify shows four name servers; at the
     registrar where veraitalia.net was bought, replace its name servers with
     those four. Or
   - **The registrar's DNS**: the records Netlify shows — an `A` record for
     `veraitalia.net` to Netlify's load balancer (`75.2.60.5` at the time of
     writing) and a `CNAME` for `www` to `veraitalia.netlify.app`.
3. *Domain management → HTTPS*: Netlify issues the certificate once DNS
   answers (minutes to a few hours). Open `https://veraitalia.net/`.
4. **Then, in the code:** `OWN_SITE_LIVE.veraitalia = true` in
   `src/lib/seo/site-url.ts`. La Soul's site then forwards `/veraitalia/` and
   `/menu/veraitalia/…` to veraitalia.net, and Vera Italia's QR codes are
   printed with veraitalia.net. **Print its QR codes after this.**

**3. Lovable:** nothing more for the domain. The prompt in
`docs/lovable-migration-prompt.md` is the same; the staff functions answer any
address already, and the card-payment functions (switched off) take
veraitalia.net from `supabase/functions/_shared/http.ts` whenever they are
next deployed.

**4. Search, maps and AI answers** (the owner, once it has an address):

1. **Google Search Console** — add a *Domain* property `veraitalia.net` (a
   DNS TXT record), submit `https://veraitalia.net/sitemap.xml`, and request
   indexing of `/`, `/bs/` and `/ar/`.
2. **Bing Webmaster Tools** — *Import from Google Search Console*. Bing's index
   is what ChatGPT search and Copilot read.
3. **Google Business Profile** — "Vera Italia", primary category *Italian
   restaurant* (add *Pizza restaurant*), the exact address, phone and hours,
   website `https://veraitalia.net/`, menu link
   `https://veraitalia.net/menu/veraitalia/`, and the dish and room
   photographs. This is what Google Maps, "near me" searches and AI answers
   about restaurants lean on most.
4. **Apple Business Connect** (Apple Maps, Siri), **Bing Places**,
   **TripAdvisor**, **Instagram** and **Facebook** — the same name, address
   and phone, written the same way everywhere, all linking to veraitalia.net.
5. The address, phone, hours, Google Maps link, Instagram and review link go
   in `src/lib/venues.ts`: the website, its structured data, its FAQ ("Where
   is Vera Italia?", "When is it open?") and llms.txt all take them from
   there.
6. When it opens, `live: true` (step 4 of the table above): its menu, four
   courses and 25 dish pages join the sitemap and search.

What the site already gives search engines and AI engines
(`src/lib/seo/vera-seo.ts`): the website in English, Bosnian and Arabic with
hreflang; a `Restaurant` with its cuisine, price range (KM/BAM), menu, logo,
photographs and, once known, address, hours, phone and profiles; the whole
menu as `Menu → MenuSection → MenuItem`, every dish priced in BAM, marked
vegetarian where it is, with its own page and breadcrumbs; a FAQ answered from
the menu in three languages; `llms.txt` and `llms-full.txt`; a sitemap with
photographs; and a 1200×630 link-preview image (`public/site/vera/og.jpg`).
Nothing in it is La Soul's, and nothing the owner has not given is said.

## Vera Italia — what is ready

- **The menu**: 25 dishes in four courses (`scripts/vera-italia/menu.json` →
  the migration), names and descriptions in English, Bosnian and Arabic,
  prices from the owner's sheet, three featured dishes. Grilled chicken
  (+2 KM, for any pasta or risotto) is its own dish under Pasta & Risotto →
  Extras, so it is ordered and charged like any other.
- **The photographs**: every dish from the kitchen's own photos of 29 October,
  re-shot with gpt-image-2.5 (`scripts/vera-photos.mjs`) in the style the
  owner chose on 30 October — the same dish and plate, straight overhead on
  travertine in soft window light, the whole plate in frame with stone all
  round it — and finished with grain and sharpening
  (`scripts/vera-italia/import-photos.mjs`).
  The owner's three photographs of the room, re-shot the same way as an
  interior photographer would (`scripts/vera-italia/room-photos.mjs` →
  `site-images.mjs`), are the website's.
- **The logo**: an arch monogram (VI) over VERA ITALIA / CUCINA ITALIANA, a
  one-line wordmark and the app icons, drawn with gpt-image-2.5
  (`scripts/vera-italia/logo.mjs`, `brand-assets.mjs` → `public/brand/vera/`).
- **The look**: editorial — ivory paper, ink, brass rules, Cormorant
  Garamond in large italics; the menu laid out like a printed one (course
  names as words, a dotted leader to each price), every dish photograph
  square and whole — on Vera Italia's menu, its table pages and its website
  (`src/components/vera/`, `src/pages/vera/VeraSite.tsx`).
- **On the phone**: its own toolbar colour, home-screen icon and name, and
  "Add to Home Screen" installs a Vera Italia app that opens its menu
  (`public/manifest-veraitalia.webmanifest`, `brand` in `src/lib/venues.ts`).
  A link to its menu or a course previews as Vera Italia; those pages ask
  search engines to leave them out until it opens.

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
- Its tables and room QR code (Admin → QR Codes, switched to Vera Italia), its
  printers (Admin → Printing, switched to Vera Italia: their own poll URLs).
- Its own site at veraitalia.net (bought 30 October 2026): the steps in
  "Vera Italia's own site" above.
- Split the suggestion engine's learned totals per restaurant
  (docs/two-restaurants.md, "Still shared").
