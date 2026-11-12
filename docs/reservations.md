# Table reservations

A guest asks for a table on the restaurant's website. The restaurant's admin
confirms or declines. The guest sees the answer on their own page within
seconds. Nothing is promised by a machine: a request is a request until a
person at the restaurant answers it.

Off at both restaurants until an admin switches it on (Admin → Reservations).

## What a guest does

1. Opens `lasoul.net/reserve` or `veraitalia.net/reserve`. The home page shows
   **Reserve a table** only while the restaurant takes requests online.
2. Picks a day, a time and how many, and leaves a name and a phone number. The
   days and times offered are the restaurant's: its own date and clock, its
   first and last time, its notice. In Bosnian, English or Arabic.
3. Lands on their own page (`/reserve/<id>?t=<key>`), which says **We have
   your request** and asks the database again every five seconds. When the
   admin answers, the page changes by itself: **Your table is confirmed**, or
   **We cannot take this reservation**, with the restaurant's line if it wrote
   one. After eight minutes without an answer it says to call, with the code
   to mention.
4. Can cancel from that page until the time of the reservation.

The page's address holds the key to it. Whoever has the link can read and
cancel that one request, and nothing else. It is kept on the guest's phone so
`/reserve` can lead back to an open request.

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

- **No text message to the guest or the owner.** SMS needs an account with a
  provider and costs money per message; the alert here is free. The alert
  function is the place to add it.
- **No table plan.** The admin decides whether there is room; the system does
  not count seats or assign tables.
- **No deposit.**

## Where it lives

| Piece | File |
| --- | --- |
| Tables, rules, functions, the reminder | `supabase/migrations/20261113090000_reservations.sql` |
| Alerts | `supabase/functions/_shared/notify-staff.ts`, `staff-push.ts`, `public/sw-push.js` |
| Booking page, guest's page | `src/pages/ReservePage.tsx`, `src/pages/ReservationPage.tsx` |
| Admin | `src/pages/admin/AdminReservations.tsx` |
| The Manager app | `public/manifest-manager*.webmanifest`, `scripts/manager-icons.mjs`, `src/hooks/useVenue.ts` |
| Days, times, wording | `src/lib/reservations.ts`, `src/lib/reservation-copy.ts` |
| Tests | `supabase/tests/reservations.test.ts`, `src/lib/reservations.test.ts`, `e2e/reservations.spec.ts` |

## Turning it on

1. Apply the migration and redeploy `notify-staff` (the **Next** prompt in
   `docs/lovable-migration-prompt.md`).
2. Admin → Reservations: set the times, the largest group and the phone
   number, and save.
3. Turn on **Alert this phone** on the phone that should ring (on an iPhone,
   from the Manager app on the Home Screen), and **Send a test**.
4. Switch **Take reservation requests on the website** on. Ask for a table
   yourself from another phone, answer it, and cancel it.
