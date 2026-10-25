# Launch checklist — La Soul

From where things stand (25 October 2026) to the whole floor ordering from
their phones. **Part 2 is the rehearsal sheet: print it and take it to La
Soul.**

The app is live at **https://lasoulapp.netlify.app**: the website, the menu,
ordering at the table, the waiter and kitchen screens, the floor monitor and
the whole admin. It passes 1,169 automated tests and 486 browser tests, but it
has **not yet run a real service** on real phones, a real kitchen tablet and a
real printer. That is what the rehearsal is for.

Every screen name and button below is what the app actually says. The staff
screens are in English; guests see their own language.

---

## Part 1 — Before the rehearsal (manager, a laptop, 1–2 hours)

Sign in at **/admin/login** with the manager's email and password. Everything
here is in the admin menu on the left (on a phone: **More**).

### Accounts

- [ ] **Manager password.** Reset it in Lovable (Cloud → Users) if nobody
      knows it, then sign in at `/admin/login`.
- [ ] **Waiters** → **Add Waiter**, once per waiter: *Display name*,
      *Username*, *Password (6+ chars)*, *Floor PIN (4 digits, auto if
      blank)* → **Create**.
      Waiters sign in at `/waiter/login` with the username and password; the
      PIN is only for the shared floor monitor. Give each waiter their login
      in person. If you leave the PIN blank, the generated one shows for 8
      seconds — write it down.
- [ ] **One more account for the kitchen tablet(s)**, the same way: e.g.
      display name *Kitchen*, username `kitchen`. The tablet signs in with it
      at `/waiter/login`, then opens `/kitchen`. Do not leave the manager's
      account signed in on a shared tablet: it can change prices and settings.

### Tables, sections and tonight's floor

- [ ] **Tables** → *How many tables do you have?* → **Generate tables**. The
      numbers must match the numbers on the real tables.
- [ ] **Sections** → *New section name* → **Add section** for each area
      (e.g. Terrace, Inside). Tap a table chip → **Move table N to…**.
- [ ] **Tonight** → tap a section → tap the waiters who cover it → **Done**.
      **This is per day** (the trading day runs to 05:00) and must be done
      before every service. Without it every table lands under *No waiter
      yet* on the waiter phones.

### Menu

- [ ] **Menu**: check every price (tap a price to change it), and that
      anything not on offer is **Sold out**.
- [ ] Pencil icon → *Edit item* → **Allergens** on everything with nuts,
      dairy, gluten, eggs or sesame, and a **Photo** on the best sellers →
      **Save changes**.
- [ ] Seven mojito descriptions still say "cocktail". Change them to
      "alcohol-free mojito" (or ask me to).

### Printer

- [ ] Write down the printer's **make and model** — it also decides how
      fiscal receipts can be automated later.
- [ ] **Printing** → **Network printers** (Epson with *Server Direct Print*,
      or Star with *CloudPRNT*): *Add a network printer* → name, station
      (Kitchen / Bar / Kitchen + bar), paper (80 mm / 58 mm) → **Add
      printer** → open **Address & setup steps**, enter that address on the
      printer → wait for **Online** → **Test print**.
- [ ] *Or*, with no network printer: **Or print from a tablet** → Bluetooth or
      USB → **Send a test ticket**.
- [ ] *Printing on* and *Print new orders by themselves* switched on, *Copies
      per ticket* set → **Save settings**.

### Service settings — Service & suggestions

- [ ] **Accept orders from guests**: on. **Pay at the table**: on.
- [ ] **Online card payment (Monri)**: **off**. It stays off until Monri is
      set up (Part 5); switched on, guests are charged for real.
- [ ] **Service hours** (*Opens* / *Closes*): the real hours. Orders placed
      outside them are held until a waiter confirms them. **If you rehearse
      outside opening hours, widen the hours for the evening** and set them
      back afterwards — otherwise every rehearsal order is held.
- [ ] **New tables at once**: 8. Fine for the rehearsal; raise it if large
      groups are seated at once.
- [ ] **Show suggestions to guests**: on.

### QR codes

- [ ] **QR Codes** → **A4 Sheet** → **Print**: one test sheet for the
      rehearsal is enough. Scan one with a phone before printing more.
- [ ] Choose for the real launch: **Per table** codes (the guest lands on
      their table — recommended) or one **Venue QR** (the guest types the
      table number).
- [ ] A printed code contains the address the admin was open on. Print the
      final batch once **lasoul.net** is connected and open the admin there
      (Part 5); codes printed from lasoulapp.netlify.app keep working through
      Netlify's redirect, but are one hop slower.

### Devices

- [ ] **Kitchen tablet**: charger in, screen set to never sleep, volume up.
      Sign in → `/kitchen` → pick the station (*All*, or *Kitchen* and *Bar*
      on two tablets). Tap **Test sound**. Only if there is **no** network
      printer: turn on the printer icon (*Use this device as the ticket
      printer*) on **exactly one** device per station.
- [ ] **Each waiter phone**: sign in at `/waiter/login`, add it to the home
      screen, set a long screen timeout, tap once to enable sound. **A waiter
      only gets alerts while the waiter screen is open** — there are no push
      notifications.
- [ ] *Optional* — a wall or counter tablet on `/waiter/monitor` (*La Soul ·
      Floor*): each waiter taps their name and PIN to see their tables.
- [ ] **Two guest phones**: one iPhone, one Android, at least one on mobile
      data rather than the restaurant Wi-Fi.
- [ ] Every staff screen shows the green **Live** pill.
- [ ] Every waiter and the kitchen have read the staff guide, in English
      (`docs/restaurant-staff-training.md`) or Bosnian
      (`docs/restaurant-staff-training.bs.md`).

### Before guests, not before the rehearsal

- [ ] **Error reporting.** It is off on the live site: nobody hears about a
      crash on a guest's phone. Create a Sentry project (React), put its DSN
      in Netlify → Site configuration → Environment variables →
      `VITE_SENTRY_DSN`, and redeploy. **⚠** needs a Sentry account.
- [ ] **Uptime monitor** on `https://lasoulapp.netlify.app/menu/lasoul/`,
      1–5 minute checks, alerts by email. **⚠**

---

## Part 2 — The rehearsal (print this)

**Who:** a manager (laptop, admin), one waiter (phone), the kitchen (tablet +
printer), two "guests" (phones). About 90 minutes. Order cheap things —
coffee, water, one dish.

**When:** a day **before** the first real service. There is no test mode:
rehearsal orders are real orders, and reports are per day, so the rehearsal
day's numbers are simply the rehearsal's. Clean-up is at the end.

**Write down:** the seconds in step 9, anything that confused anyone, and a
screenshot of anything that looked wrong.

Date: ______________ Started: ______ Finished: ______

### A. Arriving at the table — Guest 1, table 1

1. - [ ] Scan table 1's QR → *Connecting you to your table…* → **Welcome!**
         → type a name → **Continue** → the menu, with *Table 1 · Change
         table* at the top. On mobile data: under about 2 seconds.
2. - [ ] Globe button (top right) → **Bosanski** → **العربية**: Arabic reads
         right to left and nothing is cut off → back to English. (The
         language button is on the menu and category pages only.)
3. - [ ] Search: "burger", then a Bosnian dish name → results with **Add**.
         (Dish names are searched in all three languages; descriptions only
         in English.)
4. - [ ] Open a dish → allergens are shown → **+ Add a note** → **Add to
         order · … KM** → the cart bar shows **View Order**.

### B. A second phone joins — Guest 2, same table

5. - [ ] Guest 2 scans the **same** QR, types a name → *Waiting for the
         table to let you in…*
6. - [ ] Within about 5 seconds Guest 1 sees *"[name] wants to join your
         table"* → **Accept** → Guest 2 is in the menu.

### C. The first order — the speed test (the most important part)

7. - [ ] Guest 1: **View Order** → a suggestion under *Complete your order*
         → tap **X** → it does not come back.
8. - [ ] **Send order · … KM** → *Order sent to the kitchen*, an order
         number, *We'll bring it to table 1.*
9. - [ ] **Kitchen:** *New order* banner and chime, and the ticket prints
         **once** (a separate bar ticket if there is a drink). Tap **Got it**.
         **Waiter phone:** the order appears under *In the kitchen* (or, if
         table 1 is in nobody's section, under *No waiter yet* → **Take** →
         *Table 1 is yours*).
         Seconds from tapping Send to: kitchen ______ waiter ______
10. - [ ] **Kitchen:** **Start** → **Ready** on each line (or **Start all** /
          **All ready**) → the waiter phone vibrates and chimes, the card says
          *Ready to run* → waiter **Mark served**.
11. - [ ] Guest 1: **Track your order** → the bar moves *Received → Preparing
          → Ready → Served* within a few seconds of each step.
12. - [ ] Kitchen: tap **Ready** on something by mistake → **Undo** (it works
          for 90 seconds).

### D. A second order on the same tab

13. - [ ] Guest 2 orders a drink → it shows on the kitchen's *Bar* view, not
          on *Kitchen*; a bar ticket prints. Guest 1's **Your Tab** shows both orders, both names and
          one total.

### E. Calling the waiter and paying

14. - [ ] Guest 1, menu home: **Call Waiter** → *Waiter notified*. Waiter
          phone: chime and vibration, a card *Needs you* → **Done**.
15. - [ ] Waiter: **Free table** on table 1 → it refuses: *Table 1 still owes
          … KM*. (Nobody can free a table that has not paid.)
16. - [ ] Guest 1: **Your Tab** → **Request Bill** → *Bill requested*, then
          the rating question. Waiter phone: *Wants the bill*.
17. - [ ] Waiter: **Cash** → *Table 1: take … KM in cash?* → **Yes, … KM
          received** → *Recorded as paid in cash*.
18. - [ ] Waiter: **Free table** → **Free table 1?** → **Free table**. Guest
          phones: their session has ended; to order again they must scan.

### F. A second table, paid on the terminal

19. - [ ] Guest 2 scans **table 2's** QR, orders one thing → the waiter
          records it with **Terminal** → *Recorded as paid on the terminal*.
          Every order arrives as *Owes · cash* while online card payment is
          off; the waiter records how the guest really paid.

### G. A held order (on purpose)

20. - [ ] On a table no staff member has touched yet (e.g. table 3): order
          over 60 KM in one go. Guest sees *Order received — Your waiter will
          confirm it in a moment*. Kitchen and waiter: *Needs confirming* with
          *Large first order*; **nothing prints**.
21. - [ ] Waiter: **Confirm** → *Table 3 confirmed — sent to the kitchen* →
          it prints. Kitchen: **Void** → reason "Rehearsal" → **Void order**
          (so nobody cooks it).

### H. When things go wrong

22. - [ ] Manager: **Service & suggestions** → *Accept orders from guests*
          off → **Stop orders**. Within a minute the guest's cart says
          *Ordering is paused*, and **Send order** is greyed out. Switch it
          back on.
23. - [ ] Guest phone: Wi-Fi **and** mobile data off → **Send order** →
          *Your order was not sent. Nothing was charged…* → back online →
          **Send order** → the kitchen gets it **exactly once**.
24. - [ ] Kitchen tablet: Wi-Fi off for 30 seconds → *Offline · retrying*.
          A guest orders meanwhile. Wi-Fi on → **Live**, and the order is
          there.
25. - [ ] Printer: switch it off → a guest orders → switch it back on → the
          ticket comes out **once**. If the kitchen shows *Did not print* or
          *PRINTER STUCK*, tap **Reprint** / **Retry** (also under Printing →
          *Print queue*). No ticket lost, none printed twice.

### I. Closing — the manager

26. - [ ] **Orders** → **Mark fiscalized** on one paid order → *Fiscal
          receipt number* → **Record receipt**. (Practice only: do **not**
          ring rehearsal orders into the real fiscal device.)
27. - [ ] **Daily Report**: *Cash* and *POS terminal* each match what the
          waiter recorded; read *Needs attention before close*.
28. - [ ] *Close the day*: type the system's own amounts → *Cash balances.*
          → **Close the day**. (It can be redone; it changes no orders.)

### J. Clean-up — before the first real service

29. - [ ] **Orders** → the red cancel icon on every rehearsal order → reason
          "Rehearsal" → **Cancel order** (orders already in the kitchen or
          paid need the manager's account). Cancelled orders leave the sales
          figures; a paid one shows "needs a refund" — that is expected here.
30. - [ ] **Tables** → **Free** any table still open.
31. - [ ] **Service hours** back to the real hours, if you widened them.

### Do not press during the rehearsal

| Button | Why |
|---|---|
| QR Codes → **New code** | Kills every printed venue code at once |
| **Online card payment (Monri)** | Guests are charged for real |
| Tables → bin icon (**Delete table**) | Ends the session and removes its orders |
| Waiters → **Remove** | Deletes that waiter's login for good |
| Menu → **Re-translate All** → **Overwrite all** | Replaces corrected Bosnian and Arabic text |
| Printing → **New address** / **Remove printer** | The printer stops receiving tickets |
| Service → **Start measuring at N%** | Hides suggestions from some real tables |

Notes:

&nbsp;

&nbsp;

&nbsp;

---

## Part 3 — Soft launch (the first 2–3 services)

- [ ] One section only, one service. A manager keeps `/kitchen` and the
      **Daily Report** open throughout.
- [ ] Before each service: **Tonight**, the **Live** pills, a **Test print**.
- [ ] Every app order is rung into the restaurant's certified fiscal POS, then
      **Mark fiscalized** with the receipt number. The accountant confirms
      this workflow in writing (`docs/fiscalization-workflow.md`). **⚠**
- [ ] At close: drawer = **Cash**, terminal batch = **POS terminal**, each
      checked on its own → **Close the day**.
- [ ] Zero duplicate prints; nothing left in *Needs confirming*; *Needs
      attention before close* empty.
- [ ] Write down what staff found confusing and send it to me — fix the
      wording, not the staff.

## Part 4 — The whole floor

- [ ] All sections live.
- [ ] Sentry receiving errors and someone reads them; the uptime monitor
      alerting someone. **⚠**
- [ ] Week-1 numbers written down as the baseline (`docs/product-metrics.md`).
- [ ] The routine checks in `docs/operations-runbook.md` §6: every service,
      every close, weekly, monthly.

## Part 5 — Later, waiting on others

- [ ] **lasoul.net** → Netlify, then one line of code, Search Console, Bing,
      the Google Business Profile and Instagram (`docs/seo-and-domain.md`).
      Then print the final QR codes from the admin opened on lasoul.net.
- [ ] **Monri online card payment** (`docs/monri-go-live.md`): an online
      merchant account, online MID/TID and a card-not-present agreement from
      the bank, sandbox credentials; then the two Monri functions redeployed
      (the prompt is in `docs/lovable-migration-prompt.md`), the 16 sandbox
      cases, and one real low-value payment and refund. Only after the floor
      has run well for a week. **⚠**
- [ ] **Fiscal receipts sent automatically** from the app: the fiscal
      printer's make and model and its service company's documentation
      (`docs/fiscalization-bih.md`). **⚠**
- [ ] **Italia Verde** at `/menu/italiaverde`: its menu, logo, photos,
      address and hours.
- [ ] **From the owners:** confirm the hours (11:00–21:00), one business name
      everywhere, interior photos and a short "who we are".

---

## Rollback

Fastest first. None of these needs a code change.

| To stop | Do | Effect |
|---|---|---|
| **Online card payments** | Service & suggestions → *Online card payment (Monri)* off | Immediate. Payments already in progress still resolve; pay-at-table unaffected |
| **All guest ordering** | Service & suggestions → *Accept orders from guests* off | Guests see the pause message and ask a waiter; the server refuses orders. Existing orders continue |
| **A rush** | Service & suggestions → *Kitchen delay notice (minutes)* | Guests are warned it may take longer, and still order. Use before stopping orders |
| **Suggestions** | Service & suggestions → *Show suggestions to guests* off | No suggestions anywhere |
| **Printing** | Kitchen → printer icon off, or Printing → *Printing on* off | The kitchen screen keeps working |
| **A bad website or app update** | Netlify → Deploys → the previous deploy → *Publish deploy* | About a minute; the database is untouched |

Emergencies, outage by outage: `docs/operations-runbook.md` §7.

### For a developer: rolling back the order-integrity trigger

The payment-safety migrations only add things, so a front-end rollback alone is
safe and almost always the right move. If the `enforce_order_integrity`
trigger itself must go (it is the one thing that can refuse a write older code
expected to succeed — see `docs/order-state-machine.md`):

```sql
DROP TRIGGER IF EXISTS enforce_order_integrity ON public.orders;
-- and to restore it:
CREATE TRIGGER enforce_order_integrity
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_order_integrity();
```

Without it, illegal status changes and direct writes to money columns become
possible again. On the live database this goes through Lovable, like any SQL.

## Definition of done

- Every order reaches the kitchen and the waiter within seconds, and prints
  once.
- The cash drawer and the terminal batch match the Daily Report exactly,
  three services running.
- Every app order is on the fiscal device, and marked so in the app.
- Staff can say what every label means without looking it up.
- A guest can order, pay and get their food without asking anyone how the app
  works.
