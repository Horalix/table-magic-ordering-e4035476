# Table reservations

A guest asks for a table on the restaurant's website. The restaurant's admin
confirms or declines. The guest sees the answer on their own page within
seconds. Nothing is promised by a machine: a request is a request until a
person at the restaurant answers it.

Off at both restaurants until an admin switches it on: **Admin → Ordering &
service → Table reservations**, or the same switch on **Admin →
Reservations**. Nothing else has to be done: the website shows it at once,
and search engines are told by themselves ("Where guests find it").

## What a guest does

1. Opens `lasoul.net/reserve` or `veraitalia.net/reserve`. The home page shows
   **Reserve a table** only while the restaurant takes requests online, and
   answers "Can I reserve a table?" among its questions ("Where guests find
   it", below).
2. Picks a day, a time and how many, each with one tap (days as a row of
   dates, times by part of the day, guests as numbers), and leaves a name and
   a phone number. The days and times offered are the restaurant's: its own
   date and clock, its first and last time, its notice. One line says what is
   being asked for before it is sent. In Bosnian, English or Arabic.
3. Lands on their own page (`/reservation/<id>?t=<key>`), which says **We have
   your request** and asks the database again every five seconds. When the
   admin answers, the page changes by itself: **Your table is confirmed**, or
   **We cannot take this reservation**, with the restaurant's line if it wrote
   one. After eight minutes without an answer it says to call, with the code
   to mention.
4. Once confirmed, can put the table in their calendar and open the way to
   the restaurant from that page.
5. Can cancel from that page until the time of the reservation.

The page's address holds the key to it. Whoever has the link can read and
cancel that one request, and nothing else. It is kept on the guest's phone so
`/reserve` can lead back to an open request. It is not under `/reserve/`: that
is the booking page, which search engines list, and a guest's own page is
kept out of search results, caches and referrers (`public/_headers`).

## Where guests find it

No app to install: a guest reserves on a web page, reached from wherever they
already look for the restaurant. A separate "reservation app" would have to be
found, downloaded and opened by someone who wants one table once; nobody does
that for one restaurant. (The restaurant's side is the Manager app, below.)

**While reservations are on**, everything a person, a search engine or an AI
assistant reads says so, and says the same thing
(`src/lib/seo/reservations.ts`):

| Where | What it says |
| --- | --- |
| The website (`/`, `/bs/`, `/ar/`) | **Reserve a table** by the address and phone, and "Can I reserve a table?" among the questions |
| The booking page (`/reserve/`) | Its own title ("Reserve a table at La Soul, Sarajevo"), description and address; how it works in three steps; four questions answered (is it confirmed at once, cancelling, large groups, cost), in Bosnian, English and Arabic |
| Structured data (schema.org) | The restaurant `acceptsReservations` at that address and offers a `ReserveAction`; the booking page's questions as `FAQPage`. This is what Google, Bing and maps read |
| `sitemap.xml` | The booking page, so it is crawled without waiting to be discovered |
| `llms.txt`, `llms-full.txt` | "Reservations: ask for a table online at …", for ChatGPT, Perplexity, Claude and the like |

**While they are off**, none of that is there: no link, no question, no
action, no line for AI assistants, no sitemap entry, and the booking page
itself asks search engines to leave it out (`noindex`). Nothing promises a
table the restaurant does not give online.

The website follows the switch at once: the link and the question appear the
moment an admin turns reservations on. What search engines and AI assistants
read is written when the site is published, and **the sites publish
themselves again after a switch changes**: each build says what it believed
(`/site-state.json`), twice an hour that is compared with what the database
says now, and where they differ both sites are published again
(`.github/workflows/republish.yml`, `scripts/republish-check.mjs`). So within
the hour of switching reservations on, the booking page is listed; nobody has
to publish by hand. The same goes for "Menu only". To publish at once: GitHub
→ Actions → **Republish the sites after a switch** → Run workflow. It never
publishes twice for the same thing; if a publish did not help, the run fails
and GitHub tells the repository's owner.

**What only the restaurant can do**, and what brings most guests:

- **Google Maps listing** (Google Business Profile): add the booking page as
  the listing's reservation link. Most people who search a restaurant's name
  see that listing before its website.
- **Instagram bio**: the same link.
- **A QR code to the booking page** on the door, the menu or a table card,
  for a guest who wants to come back.

Admin → Reservations shows the link with a **Copy** button.

## What the admin does

**Admin → Reservations** (`/admin/reservations`), per restaurant:

- **Waiting for your answer**, first: who, when, how many, their phone number
  (tap to call), their note. **Confirm** or **Decline**, with an optional line
  for the guest ("By the window", "Full at 20:00, 21:15 is free").
- **Confirmed**, day by day, with the number of tables and guests. **Cancel**
  asks first and reminds you to call the guest.
- **Declined, cancelled and past.** A request declined by mistake can still be
  confirmed while its time is ahead.
- **Online reservations:** the switch, the page guests use, and the rules:
  first and last time, largest group, how many days ahead, the notice you
  need, the phone guests can call, a line guests read before they ask.

Only admins of the restaurant (and the owner) see requests and answer them: a
guest's name and phone number are not shown to waiter or kitchen accounts.
Every answer is in the audit log.

The page asks for news every ten seconds while it is open, and the menu entry
shows how many are waiting on every admin page.

## Being told at once

On Admin → Reservations, **Alert this phone** registers the phone or computer
for reservation alerts (Web Push, as the waiters' lock-screen alerts are):

- a new request rings it at once, locked or not: *New reservation · Sat 15
  Nov, 19:30* with the guest's name and how many (no phone number: a lock
  screen is read by whoever picks the phone up);
- if nobody has answered after five minutes it rings once more: *Still
  waiting*;
- if a guest cancels a table that was confirmed it rings: *Cancelled by the
  guest … the table is free again*;
- a tap opens Admin → Reservations.

Each admin turns it on on their own phone; the owner can turn it on for both
restaurants. And on every admin page, a line at the top says how many guests
are waiting, one tap from the answer.

## The Manager app (iPhone and Android)

The admin, added to a phone's Home Screen, is its own app: **La Soul
Manager** or **Vera Italia Manager**, with its own icon, opening the admin
full screen. It is the same admin, so everything a manager does is in it:
reservations, today's numbers, the menu, orders, reports.

**iPhone** (iOS 16.4 or later). This is the only way an iPhone rings for a
reservation: Apple allows web notifications only from a Home Screen app.

1. In **Safari**, open `lasoul.net/admin` (or `veraitalia.net/admin`).
2. Tap **Share**, then **Add to Home Screen**. The name is **Manager**.
3. Open **Manager** from the Home Screen and sign in (the Home Screen app
   keeps its own sign-in).
4. Go to **Reservations**, turn on **Alert this phone**, tap **Allow**, then
   **Send a test** and lock the phone: it arrives within about ten seconds.
5. Settings → Notifications → Manager: sounds and lock screen on. Focus
   modes silence it like any other app; allow Manager in the ones you use.

**Android.** In Chrome, open the admin, then the menu → **Add to Home
screen** / **Install app**. Then the same steps 3 and 4.

There is no App Store app. One would need an Apple developer account, a Mac
to build it and Apple's review; the Home Screen app needs none of that and
rings the same way.

A request nobody answers is not declined by the system: it stays waiting, and
reads **not answered in time** once its time has passed.

## Telling the guest

The guest's page shows the answer within seconds. For a guest who has closed
it, the admin sends a message from their own phone: after **Confirm**,
**Decline** or **Cancel**, **Tell the guest** shows the message, written in
the language the guest asked in (Bosnian, English or Arabic), with one tap
for each way to send it:

- **WhatsApp**: opens the chat with the message written; tap send.
- **Viber**: copies the message and opens the chat; paste and send.
- **Text message**: opens the phone's Messages with the number and the text.
- **Copy**, for anything else.

It comes from the restaurant's own number, so the guest can answer it.
Nothing is sent by the system and nothing costs anything beyond the phone's
own plan. **Message** on a confirmed table brings the same panel back later.
The words are in `src/lib/reservation-copy.ts` (`msg_…`).

## The rules that keep the list honest

- Outside the restaurant's hours, closer than its notice, further ahead than
  it takes, or for more people than its largest group: refused, with the
  phone number to call.
- One phone number: at most three open requests, six in a day.
- More than forty requests in an hour at one restaurant: turned away for a
  while ("try again in a few minutes, or call us").
- A hidden field no person fills in: a robot that fills it is told "sent" and
  nothing is kept.
- The same request sent twice is one request.

## What it does not do (yet)

- **No message sent by the system itself.** The admin sends it with one tap
  ("Telling the guest"). Automatic texts through a provider were priced on 12
  November 2026: Twilio charges $0.51 for each text to a Bosnian number.
  Automatic WhatsApp messages from the restaurant's own business number cost
  a few cents at most and are the way to add it.
- **No table plan.** The admin decides whether there is room; the system does
  not count seats or assign tables.
- **No deposit.**

## Where it lives

| Piece | File |
| --- | --- |
| Tables, rules, functions, the reminder | `supabase/migrations/20261113090000_reservations.sql` |
| Alerts | `supabase/functions/_shared/notify-staff.ts`, `staff-push.ts`, `public/sw-push.js` |
| Booking page, guest's page | `src/pages/ReservePage.tsx`, `src/pages/ReservationPage.tsx` |
| What search engines and AI assistants are told | `src/lib/seo/reservations.ts`, `scripts/seo-prerender.ts`, `src/hooks/useReservationsOffered.ts` |
| Admin | `src/pages/admin/AdminReservations.tsx` |
| The Manager app | `public/manifest-manager*.webmanifest`, `scripts/manager-icons.mjs`, `src/hooks/useVenue.ts` |
| Days, times, wording | `src/lib/reservations.ts`, `src/lib/reservation-copy.ts` |
| Messages to the guest, the calendar entry | `src/lib/reservation-messages.ts` |
| Publishing again after a switch | `.github/workflows/republish.yml`, `scripts/republish-check.mjs`, `siteState` in `scripts/seo-prerender.ts` |
| Tests | `supabase/tests/reservations.test.ts`, `src/lib/reservations.test.ts`, `src/lib/seo/reservations.test.ts`, `e2e/reservations.spec.ts` |

## Turning it on

1. The migration is applied and `notify-staff` redeployed (12 November 2026,
   `docs/lovable-migration-prompt.md`).
2. Admin → Reservations: set the times, the largest group and the phone
   number, and save.
3. Turn on **Alert this phone** on the phone that should ring (on an iPhone,
   from the Manager app on the Home Screen), and **Send a test**.
4. Switch **Take reservation requests on the website** on. Ask for a table
   yourself from another phone, answer it, and cancel it.
5. Search engines and AI assistants are told by themselves: within the hour
   the sites are published again ("Where guests find it"), and the build's
   log says `booking page (open, listed)`. `npm run indexnow --
   https://lasoul.net` (or the Vera Italia address) then tells Bing the same
   day instead of at its next visit.
6. Add the booking page's link to the Google Maps listing and the Instagram
   bio ("Where guests find it").
