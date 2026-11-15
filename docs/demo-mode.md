# Demo mode

A self-contained demo of the whole product — guest ordering, kitchen display,
waiter phone, floor monitor, TV menu board, reservations and the admin — for
showing to other restaurants. It runs entirely in the browser: no Supabase
project, no server, no internet. The restaurant in it is fictional (**Casa
Demo**, a Mediterranean kitchen in Sarajevo); neither real restaurant appears.

The product's name in the demo is a placeholder, **TableFlow**. To rename it,
change `PRODUCT.name` in `src/demo/brand.ts`; the restaurant's own names are in
the same file.

## Run it

```bash
npm install          # once (npm ci refuses: the lockfile was behind package.json)
npm run dev:demo     # the demo with live reload, at http://localhost:8080
```

To build it as a static site:

```bash
npm run build:demo   # writes dist-demo/
npm run preview:demo # serves dist-demo/ at http://localhost:4173
```

`dist-demo/` is plain files: host it anywhere that serves `index.html` for
unknown paths (Netlify, Vercel, `vite preview`, nginx with `try_files`). It
needs a real `http://` or `https://` address (`localhost` counts); opening
`index.html` from disk does not work, because the database runs in a worker.

Demo mode is the Vite mode `demo` (it reads `.env.demo`). Setting
`VITE_DEMO_MODE=true` in the environment of any `vite` command does the same.
The normal build (`npm run build`) is unchanged and contains none of the demo:
`__TABLEFLOW_DEMO_BUILD__` is the literal `false` there, so every import of
`src/demo` is dropped before bundling.

The very first visit takes about eight seconds (a loading screen says what it
is doing): the database is built from the migrations and ten weeks of trading
are written into it. After that it is kept in the browser and opens in under a
second.

## Use it

Open `/`. It lists every screen; each opens in a new tab, already signed in.
Nobody types a password.

| Screen | Address | Who it is | Best size |
|---|---|---|---|
| Guest | `/table/5?token=…` (from the list) | A guest at table 5 | Phone |
| Kitchen display | `/kitchen` | The kitchen tablet | Tablet / desktop |
| Waiter | `/waiter` | Amra, who has the terrace (tables 1–5) | Phone |
| Admin | `/admin` | The owner | Desktop |
| TV menu board | `/tv` | The screen at the entrance | Portrait TV |
| Floor monitor | `/waiter/monitor` | The shared screen at the pass; every waiter's PIN is `1234` | Tablet / desktop |
| Reservations | `/reserve`, answered in `/admin/reservations` | A guest booking a table | Phone |
| Side by side | `/demo/stage` | A phone and a screen in one picture, both live | Desktop, for presenting |

**Keep the tabs in one browser.** The tabs share one live restaurant: an order
sent from the guest tab is on the kitchen tab within a second, the kitchen's
"ready" is on the waiter tab, the payment is in the admin's numbers. A second
browser, a private window or another device has its own, separate copy.

A five-minute walkthrough:

1. **Guest** — add a Casa Burger and a drink, send the order, pay at the table.
   (Or pay by card: the card is filled in for you and nothing is charged. A
   card number starting `4000` is declined, to show that path.)
2. **Kitchen display** — the ticket is there. Start it, mark it ready.
3. **Waiter** — table 5 is "ready to run". Mark it served; under *My tables*
   take the payment and free the table.
4. **Admin** — the sale is in today's numbers. *Analytics*, *Menu
   intelligence*, *What the app earned*, *Daily report* and *Performance* read
   ten weeks of history.

### The demo control

Every screen has a small **Demo** tab on its left edge:

- **New guests sit down and order** — a free table is seated and orders, through
  the same functions a real guest's phone calls. Use it to make the kitchen
  chime during a presentation.
- **A busy moment** — three tables in a row.
- **A table calls the waiter** — or asks for the bill.
- **A large first order** — held for a waiter to confirm before the kitchen
  sees it (Admin → Ordering & service → holds).
- **Keep sending guests** — a new table every 40 seconds while that tab is open.
- **Reset the demo data**.

To hide the control (for screenshots): `localStorage.setItem('tableflow-demo.control', 'off')`.

### Resetting

*Reset the demo data* (in the demo control, or at the bottom of `/`) puts
everything back to the starting point in every open tab: orders, menu edits,
sign-outs, the guest's cart. It takes the same eight seconds as a first visit.
Clearing the site's data in the browser does the same.

You rarely need it. When the demo is opened again after a pause — an hour
later, next week — the tables that were sitting are settled, the time in
between is filled with the trade that would have happened, and the floor is
seated afresh, so it always looks like a restaurant in mid-service.

## What each screen shows

**Guest.** The menu in English, Bosnian and Arabic (right to left): 46 dishes
in six categories, with photographs, allergens, dietary icons, prep times;
three featured dishes, a lunch deal and a happy-hour price, two new arrivals,
one combo with choices, one dish sold out. Suggestions in the cart and on the
dish. Ordering, card or pay-at-table, live order tracking, split the bill,
call the waiter, request the bill, rate the visit.

**Kitchen display.** New / preparing / ready, by station (kitchen, bar), with
allergens, notes, waiting times and late warnings; waiter calls and bill
requests; the all-day view; history. Two simulated network printers print each
ticket a few seconds after it arrives.

**Waiter.** What needs attention, what is in the kitchen, her tables and what
they owe; accept, serve, take payment, free the table.

**Floor monitor.** Every table's state; waiters sign in with a PIN.

**Admin.** Dashboard, analytics (with last week's comparison and the
funnel), daily report and day close, menu intelligence (what to do next, menu
engineering, suggestions, prep forecast), what the app earned (a finished
four-week experiment: one table in four was shown no suggestions), promotions,
the menu editor, orders, reservations (17 seeded, three waiting for an answer),
tonight's waiters, tables, QR codes, sections, waiters, team, performance,
printing, service settings, the audit log.

## How it works

The demo's backend is the app's real database.

- **PGlite** (PostgreSQL compiled to WebAssembly) runs in a web worker
  (`src/demo/backend/db.worker.ts`) and is kept in IndexedDB. Every tab starts
  the worker; one tab's worker opens the database and the others send it their
  queries, which is what makes the tabs share one restaurant.
- On first use it applies **every migration in `supabase/migrations`**, in
  order — the same SQL production runs — on top of the test harness's stand-in
  for the Supabase-managed parts (`supabase/tests/harness/00_shim.sql`). A new
  migration is part of the demo as soon as it is committed. Order rules, holds,
  prices, row-level security and the analytics are therefore the real ones.
- `src/demo/runtime.ts` replaces `fetch` and `WebSocket` for the app's
  Supabase address only. Requests are answered by a small stand-in for
  PostgREST (`backend/postgrest.ts`: embeds, filters, counts, upserts, RPC by
  argument name, PostgREST's error codes), for sign-in (`backend/auth.ts`),
  and for the edge functions (`backend/functions.ts`). The live feed is a fake
  socket (`backend/realtime-socket.ts`) fed by a trigger on each published
  table.
- **Sign-in** is one account per area of the app (`src/demo/session.ts`):
  `/admin` is the owner, `/kitchen` the kitchen tablet, `/waiter` Amra,
  `/waiter/monitor` the floor screen — so they can be open side by side.
- **Seed** (`src/demo/seed/`): the restaurant and its menu, ten weeks of
  visits written straight into the tables (generated from the date, so a day
  is always the same day), then the live floor placed through the real
  ordering functions.

Where the demo shapes its data on purpose, so that the admin reads like a
real restaurant and not like random numbers:

- Guests "look at" dishes in the proportions they order them, except two
  dishes that are looked at and rarely ordered.
- Seeded orders are random, so every pair of dishes would count as "ordered
  together"; the demo keeps the forty strongest pairings.
- Tables that were shown suggestions order a second round and add sides more
  often than the tables of the experiment's holdout group.
- Today is a slightly better day than usual, and one day last week was slow.

What is simulated rather than real: card payments (no gateway is contacted),
ticket printers, lock-screen alerts and WhatsApp messages (reported as "not
connected"), photo uploads in the menu editor (the dish keeps its photo).

## Screenshots and the recorded walkthrough

Both scripts drive the **built** demo in a real browser (Playwright).

```bash
npm run build:demo
node scripts/demo-screens.mjs    # PNGs of every key screen + README.md index
node scripts/demo-capture.mjs    # the walkthrough as a 1080p video
```

- `demo-screens.mjs` → `C:\Users\kerim\demo-pitch\screens` (`--out` to change).
  Phone 390×844, desktop 1440×900, TV 1080×1920, at `--scale 2` (pixel
  density); `-full` files are whole pages. `--only guest,admin` takes a part.
- `demo-capture.mjs` → `C:\Users\kerim\demo-pitch\recordings\walkthrough-1080p.webm`
  (and `.mp4` when ffmpeg is installed), about two minutes: the guest orders
  on the phone, the kitchen cooks, the waiter serves and takes payment, the
  owner's dashboard and analytics. `--captions off` records it without the
  caption bar; `--pace 1.3` slows it down; `--name` names the files.

Both accept `--url http://localhost:8080` to use a demo that is already
running instead of serving `dist-demo` themselves.

### Footage for a film

```bash
node scripts/demo-footage.mjs                      # every clip
node scripts/demo-footage.mjs --only guest-open     # one clip (names = file names)
```

`demo-footage.mjs` films short clips of the demo being used (3–14 s, one
idea each) into `C:\Users\kerim\demo-pitch\footage` (`--out` to change), with
a README listing every file. Phone clips are 1170×2532, desktop and TV clips
2560×1440, all H.264 at 60 fps (`--fps`), no audio. Nothing is recorded in
real time: each frame moves the page's clock (Playwright's fake timers) and
every CSS animation on by exactly one frame, waits until the demo's database
has answered, then takes the screenshot — so there are no dropped frames and
no loading spinners however slow the machine is. The clock, in the page and
in the database worker, is set to an evening service (`--at 19:20`), so the
footage looks like dinner whatever the hour. Needs ffmpeg (on PATH or in
`FFMPEG`).

## Tests

`src/demo/backend/postgrest.test.ts` checks the request-to-SQL translation;
`src/demo/backend/backend.test.ts` builds the whole demo database in Node and
follows an order from the guest to the till through the same requests the app
sends, including holds, changed prices, a simulated card payment, sign-in and
coming back days later. `src/demo/session.test.ts` and
`src/demo/backend/realtime-socket.test.ts` cover sign-in per area and the
live feed.
