# Two restaurants — putting it live

What is built on `feature/two-restaurants` (docs/two-restaurants.md), and the
order it goes live in. Each step leaves La Soul working exactly as today, so
there is no rush between them and no step needs the restaurant closed.

| | What | How | La Soul sees |
|---|---|---|---|
| 1 | **The app** | Merge the branch into `main`; Netlify deploys it | Nothing, except the admin header now says the restaurant's name. The owner gets a La Soul / Vera Italia switch in the admin. Vera Italia's website is at `/veraitalia/`, saying "Opening soon". |
| 2 | **The database**: the two-restaurant migrations, Vera Italia's menu, and suggestions per restaurant | Lovable runs `docs/migration-runner.sql` (pinned commit, MD5-checked) — the prompt is in `docs/lovable-migration-prompt.md` | Nothing. An app that names no restaurant is La Soul throughout; Vera Italia's 25 dishes are Vera Italia's only. |
| 3 | **Three edge functions**: `create-waiter`, `delete-waiter`, `cloudprnt` | Lovable redeploys them from `main`, in the same prompt | Nothing. New waiters are created for the restaurant of the admin creating them; printers print their own restaurant's header. |
| 4 | **Vera Italia opens** | `live: true` in `src/lib/venues.ts` — **done 30 October 2026**, once Lovable had applied steps 2 and 3: its menu is at veraitalia.net/menu/veraitalia/, linked from its website and listed for search. Still to do in the admin, switched to Vera Italia: its tables and room QR code, its staff, its printers. (`public.venues.is_live` is a record only; nothing reads it.) | Nothing. |

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
   - `SELECT venue_id, count(*) FROM public.reco_learning GROUP BY 1;` and the
     same for `public.suggestion_priors` — what the suggestions learned so far
     is La Soul's (`…0001`) only (docs/two-restaurants.md, "Suggestions").

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
   `src/lib/seo/site-url.ts` (done 30 October 2026, the day veraitalia.net
   answered). La Soul's site forwards `/veraitalia/` and `/menu/veraitalia/…`
   to veraitalia.net — Netlify on a first visit, the app itself on a phone its
   service worker answers — and stops listing them in its sitemap; Vera
   Italia's QR codes are printed with veraitalia.net. **Print its QR codes
   from now on, not before.**
5. **The "Powered by Netlify" badge:** Netlify shows it on new Free-plan
   projects. Turn it off in the project: *Project configuration → General →
   Powered by Netlify badge*. No redeploy needed.

**3. Lovable:** nothing more for the domain. The prompt in
`docs/lovable-migration-prompt.md` is the same; the staff functions answer any
address already, and the card-payment functions (switched off) take
veraitalia.net from `supabase/functions/_shared/http.ts` whenever they are
next deployed.

**4. First in Sarajevo — search, maps and AI answers**

Someone looking for "the best Italian restaurant in Sarajevo" ("najbolji
italijanski restoran Sarajevo", "pizza Sarajevo") is answered in three
places, and each is won differently:

- **The map** — three restaurants on a Google map above every result. Google
  ranks them by its Business Profile: how relevant (category, name, menu), how
  near the searcher, and how prominent — the number, rating and freshness of
  its Google reviews above all. No website can win this on its own.
- **The results under it** — today mostly lists: TripAdvisor, tourismbih.com,
  sarajevo.travel, Wanderlog, Foursquare, Culture Trip. veraitalia.net ranks
  for its own name, its dishes and "Italian restaurant Sarajevo" once Google
  trusts it; being *on* those lists is what reaches the rest.
- **AI answers** (ChatGPT, Gemini, Perplexity, Copilot) — they repeat what
  those lists, Bing, Google Maps and the reviews say, and quote the website
  for facts: what it serves, where, the prices.

**What the website already does** (`src/lib/seo/vera-seo.ts`,
`src/components/vera/copy.ts`): every title, description and the page itself
say *Italian restaurant in Sarajevo* — in English, Bosnian ("italijanski
restoran u Sarajevu") and Arabic, with hreflang between them; a `Restaurant`
in Sarajevo (linked to Sarajevo on Wikidata) with its cuisine, KM/BAM price
range, menu, logo and photographs, and its address, hours, phone and
profiles the day they are given; the whole menu as `Menu → MenuSection →
MenuItem`, every dish priced, with its own page, breadcrumbs and "in
Sarajevo" in its title; a FAQ in three languages that answers "Where can I
eat Neapolitan pizza in Sarajevo?" and "What sets Vera Italia apart from other
Italian restaurants in Sarajevo?" from the menu; `llms.txt` and
`llms-full.txt` for AI engines; Sarajevo's geo tags; a sitemap with
photographs; a 1200×630 link preview. It never calls itself "the best": a
claim like that is worth nothing to Google, and the reviews say it far better.

**What only the owner can do, most important first:**

1. **Google Business Profile** — create or claim "Vera Italia" at
   business.google.com and verify it. The name exactly as on the door
   (adding "best", "pizza" or "Sarajevo" to the name gets profiles
   suspended). Primary category *Italian restaurant*, then *Pizza
   restaurant*; the exact address, phone and hours; website
   `https://veraitalia.net/`; menu `https://veraitalia.net/menu/veraitalia/`;
   the website's dish and room photographs, the oven, and the entrance with
   its sign; the attributes that are true (dine-in, vegetarian options, the
   payments it takes). Then a photo or post every week.
2. **Reviews** — the biggest single reason one restaurant shows above
   another. Once the profile exists, send its review link (*Ask for reviews*
   in the profile): it goes in `reviewUrl` in `src/lib/venues.ts`, and every
   guest who rates their visit in the app is then offered "Leave a Google
   review" — every guest, whatever they rated, as Google requires. Answer
   every review, in its language. Never pay for reviews or offer anything for
   one.
3. **The facts, to me** — the street address, phone, hours, the Google Maps
   link and Instagram. They go in `src/lib/venues.ts`, and the website, its
   structured data, its FAQ ("Where is Vera Italia?", "When is it open?") and
   llms.txt all say them at once — written exactly as on the Google profile.
4. **Google Search Console** — add a *Domain* property `veraitalia.net` (a
   DNS TXT record), submit `https://veraitalia.net/sitemap.xml`, and request
   indexing of `/`, `/bs/` and `/ar/`. **Bing Webmaster Tools** — *Import from
   Google Search Console*; Bing's index is what ChatGPT search and Copilot
   read.
5. **The lists** — a listing on **TripAdvisor** (claim it; tourists and AI
   answers lean on it), **tourismbih.com** and **sarajevo.travel** (both
   take restaurant submissions), **Foursquare** (it feeds Apple Maps and
   others), **Apple Business Connect** (Apple Maps, Siri) and **Bing
   Places** — the same name, address and phone, written the same way
   everywhere, all linking to veraitalia.net.
6. **Being written about** — Sarajevo food writers, local portals and
   Instagram accounts, and the "best restaurants in Sarajevo" lists: an
   invitation to taste the menu is how a new restaurant gets onto them, and a
   link from them to veraitalia.net is what Google counts.
7. **Instagram and Facebook** — "Vera Italia · Sarajevo" with the website in
   the bio; the dishes and the room, regularly.

It is open (`live: true`, step 4 of the table above, 30 October 2026): its
menu, four courses and 25 dish pages are in the sitemap and open to search.
Nothing in any of it is La Soul's, and nothing the owner has not given is
said.

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
  A link to its menu or a course previews as Vera Italia.

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
