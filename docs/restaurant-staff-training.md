# Staff guide — La Soul ordering

For waiters and the kitchen. Read it before the rehearsal, print it, and keep a
copy by the pass. The staff screens are in English; guests see the menu in
Bosnian, English or Arabic. Words in **bold** are exactly what is on the
screen.

---

## Your screens

All at **lasoulapp.netlify.app** (lasoul.net later).

| Who | Opens | Signs in with |
|---|---|---|
| Waiter | `/waiter/login`, then stays on `/waiter` | Username and password from the manager |
| Kitchen and bar tablet | `/waiter/login` with the kitchen account, then `/kitchen` | The kitchen account (e.g. `kitchen`) |
| Floor screen (optional) | `/waiter/monitor` | Any staff account; each waiter taps their name and 4-digit **Floor PIN** |
| Manager | `/admin/login` | Email and password |

Add your screen to the phone's home screen so it opens like an app.

---

## Before every service

**Manager**
- **Tonight**: tap each section and the waiters who cover it → **Done**. Do it
  every day. If it is not done, every table shows up under *No waiter yet*.

**Waiters**
- Sign in, open `/waiter`, and **leave it open**. Your phone only beeps and
  buzzes while this screen is open — there are no notifications when it is
  closed or the screen is locked.
- Set the screen to stay on as long as possible.
- If it says **Alerts are silent — tap to enable sound**, tap it.

**Kitchen and bar**
- Tablet charging, set to never sleep (if it says **Screen may sleep — set the
  tablet to never sleep**, change that in the tablet's settings), volume up.
- Pick the station: **All**, **Kitchen** or **Bar**.
- Tap **Test sound**. If it says **Sound blocked — tap to enable**, tap it.
  Sound switches back on by itself whenever the page is reloaded.
- **Printer:** if the restaurant has a network printer, do nothing — it prints
  by itself. Without one, turn on the printer icon on **one** tablet per
  station only.

**Everyone:** the pill next to your name or the order count should be green.

| Pill | Means | Do |
|---|---|---|
| **Live** | Everything arrives instantly | Nothing |
| **Connecting…** | Starting up | Wait a few seconds |
| **Offline · retrying** | No connection. The screen keeps trying every 15 seconds and no order is lost | Check the Wi-Fi. More than a minute: reload the page, then tell the manager |

---

## How an order travels

1. The guest sends the order from their phone.
2. Normally it goes **straight to the kitchen**: a *New order* banner and a
   chime, and the ticket prints. Some orders wait for a waiter to confirm
   first — see *Orders that need confirming* below.
3. The kitchen taps **Start**, then **Ready**.
4. The waiter's phone buzzes: *Ready to run*. Take it out, tap **Mark served**.
5. The guest asks for the bill from their phone, or calls you over.
6. You take the money and record it: **Cash** or **Terminal**.
7. When the table has paid and gone: **Free table**.

Guests do not pay in the app (online card payment is not switched on yet).
Every order arrives as **Owes · cash**; you record how the guest really paid.

---

## Waiters — your phone

At the top: your name, how many tables you have, the pill, **Floor** (the floor
screen), the sound button and **Sign out**. Under it: **Owed** (money your
tables still owe), **In kitchen**, **Oldest wait**.

Then, from top to bottom:

| Section | What is in it |
|---|---|
| **Needs confirming** | Orders waiting for you before the kitchen sees them |
| **Attention needed** | Food that is ready first, then waiter calls, then bill requests. Empty: *All caught up* |
| **In the kitchen** | Your tables' orders being made |
| **No waiter yet** | Tables with guests that are on nobody's section — **Take** one to make it yours |
| **My tables** | Your tables, what each owes, **Cash** / **Terminal** and **Free table** |

**A new order** appears under *In the kitchen*. Tap **Accept** to show the
guest a waiter has seen it (optional — the kitchen does not wait for it).

**Food is ready** — a long buzz and a chime, and the order sits at the top as
*Ready to run*. Take it out, then **Mark served**.

**A waiter call** — chime and buzz, a card *Needs you*. Go to the table, then
tap **Done**. It reminds you every 75 seconds until someone clears it.

**A bill request** — a card *Wants the bill*. Bring the bill and take payment
(below). **Bill given** just clears the request; the table stays open.

**A table nobody has** — if a call or order comes from a table with no waiter,
you see *No waiter on table N* with **Take table**. Tap it: *Table N is yours*.
If someone was quicker, it says who has it.

### Taking payment

1. On the table's row (*Owes … KM*), tap **Cash** or **Terminal**.
2. Check the question: *Table 7: take 24.00 KM in cash?*
3. Tap **Yes, 24.00 KM received** — or, on a bill request, **24.00 KM received
   + free table 7** if they are leaving.

**Use the right button.** Cash is matched against the drawer and Terminal
against the card machine's batch at the end of the night; mixed up, the day
will not balance. A payment recorded here cannot be undone from the phone —
tell the manager if you pressed the wrong one.

### Freeing a table

**Free table** → *Free table 7?* → **Free table**. This ends the guests'
session: to order again they must scan the QR code. It refuses while money is
owed (*Table 7 still owes … KM*) — record the payment first.

### The floor screen (`/waiter/monitor`)

A shared tablet showing the whole floor. Tap your name, enter your PIN, and you
see your tables: **Free**, **Seated**, **Ready**, **Calling**, **Bill**. Tap a
table for **I'll go** (so the others know you are on it), **Done**, **Bill
given**, **Cash** / **Terminal**, and **Guests have gone — free the table**.
After 5 minutes untouched it goes back to the names.

---

## Kitchen and bar — the board

Three columns: **New**, **Preparing**, **Ready**. A card looks roughly like
this:

```
 INSIDE  Table 7  NEW  #047  (Amina)  + bar  [Owes · cash]        ! 9m
   2× La Soul Burger                                         [Start]
      ⚠ no onions
      Allergens: gluten, dairy
   1× French Fries                                           [Start]
   Note: birthday — bring a candle
```

| Part | Means |
|---|---|
| **Table 7** | Where it goes |
| **#047** | The order number — the guest sees the same number on their phone |
| **(Amina)** | Who ordered |
| **+ bar** | A drink from the bar is coming for the same order |
| **⚠ …** and **Allergens: …** | Read every one. Allergies are here |
| **!** / **!!** / **!!!** | Waiting 8 / 15 / 25 minutes or more, with an amber or red band across the top |

**New order** — a banner *New order* with the table and number, and a chime
that repeats every 30 seconds until someone taps **Got it**.

**Making it** — each line: **Start** → **Ready** → **✓ Up**. Or for the whole
card: **Start all**, **All ready**, then **Mark served** when it has gone out.

**Made a mistake?** **Undo** works for 90 seconds — on the line, on the card,
or at the top of the screen.

**Bar screen** — shows drinks only. A drink that belongs to a combo shows as
*· part of …* with how far the kitchen is; the kitchen moves that order on.

**Void** — for an order that will not be made: a reason is required → **Void
order**. Before the kitchen starts and while unpaid, anyone may; after that the
manager has to.

**Views** — **Board** (the live queue), **All day** (how many of each dish are
waiting in total) and **History**.

**Keyboard or bump bar** — **1–9** picks a ticket, arrows move, **Enter** moves
it on, **U** or **Backspace** undoes, **P** reprints, **F** is full screen.

**Calls and bills** also show along the top: *Waiter Calls* (✕ clears it) and
*Bill Requests* (✓ asks whether to **Free table** or **Just clear the
request**). Waiters normally handle these from their phones.

---

## Orders that need confirming

Some orders wait for a waiter before the kitchen sees them. They appear at the
top of the waiter phones, the kitchen board and the floor screen as **Needs
confirming**: *Not printed yet. Check someone is at the table, then confirm.*
The guest's phone says *Order received — Your waiter will confirm it in a
moment.*

| Reason shown | Why |
|---|---|
| **Large first order** | Over 60 KM or 10 portions as the table's first order |
| **Over 150 KM unpaid** | The table owes a lot already |
| **Outside opening hours** | Sent before opening or after closing |
| **Joined without approval** | A phone joined the table without anyone at it saying yes |
| **Second session on table N** | Two separate groups ordering on one table number |
| **Many new tables at once** | Lots of tables opened at once — could be a photo of a QR code passed around |
| **Table was blocked recently** | Staff blocked this table in the last hour |

Go to the table, check the order is real, then:

- **Confirm** → *Table 7 confirmed — sent to the kitchen*, and it prints.
- **Reject** → give a reason → **Reject order**.
- **Block table** (only for the suspicious reasons) → **Block table**. Every
  unprinted order from that session is cancelled, the session ends, and those
  phones cannot order again. **Only if nobody real is sitting there.**

Once any of the staff has done anything for a table — taken it, accepted or
started an order, cleared a call, recorded a payment — its later orders go
straight to the kitchen.

---

## Payment labels

The label says whether money has arrived. **"Card" does not mean paid.**

| Label | Money arrived? | Do |
|---|---|---|
| **Paid · cash** | Yes | Nothing |
| **Paid · terminal** | Yes | Nothing |
| **Paid online** | Yes | Nothing — do **not** take money again |
| **Owes · cash** | No | Bring the bill; record **Cash** or **Terminal** when they pay |
| **Owes · bring terminal** | No | Bring the card machine |
| **Owes · card online** | No | The guest is paying on their phone |
| **Online payment pending** | **No** | Not paid yet. Usually sorts itself out in seconds |
| **Payment problem** | No | The card was not charged, and the order is **not** in the kitchen |
| **Refunded** / **Part refunded** | Returned | Ask the manager |

### Once online card payment is switched on (not yet)

An order paid by card on the guest's phone **does not reach the kitchen until
the money has arrived.**

- A guest says "I paid by card" and you cannot see the order: the payment did
  not complete. Ask to see their phone.
- Their phone says **Still confirming**: do not take a second payment. Note the
  order number and tell the manager.
- Their phone says **Payment was not completed**: the card was not charged.
  They can choose **Pay at the table instead**.

---

## Printing problems

| What you see | Do |
|---|---|
| A card says *Did not print* | Tap **Reprint** on the card |
| **PRINTER STUCK — n waiting · Retry** | Check paper and power, then tap **Retry** |
| *n tickets failed to print* | Reprint each one from its card |
| The printer shows *Offline — last seen … min ago* | Check its power and network cable. The board keeps working: read orders off the screen |
| A ticket printed twice | Should not happen. Tell the manager |

A reprint from the tablet is marked `*** REPRINT ***` so nobody makes it twice.

---

## When the internet fails

**Guests** are told plainly: *Your order was not sent. Nothing was charged.*
The app never says an order went through when it did not.

**Kitchen:** the board says *No connection — this board was last updated at …*
and keeps trying. Nothing already sent is lost; it all reappears when the
connection is back.

**Everyone:** take orders on paper until the pill is **Live** again.

---

## Closing — the manager

1. **Daily Report**: read *Needs attention before close* — money still owed,
   card payments that were started and never finished, payment problems,
   refunds.
2. Every app order is rung into the **fiscal POS** as always — the app is not
   a fiscal device. Then in **Orders**: **Mark fiscalized** → *Fiscal receipt
   number* → **Record receipt**.
3. Count the drawer against **Cash**, the terminal batch against **POS
   terminal** — each on its own.
4. **Close the day**: enter the counted cash and the terminal batch. A
   difference is written down, never "adjusted".

---

## Quick answers

**"Can I cancel an order?"** Waiters cannot from the phone. In the kitchen,
**Void** with a reason, while it has not been started and is unpaid. After
that, the manager.

**"Can I delete an order?"** No. Orders are cancelled, never deleted, so the
day still adds up.

**"The guest wants to add something."** They order again from their phone; it
goes on the same table bill.

**"Someone else at the table wants to order."** They scan the same QR code;
someone already at the table gets *… wants to join your table* and taps
**Accept**. If nobody answers, they get in after a couple of minutes and their
first order waits for you to confirm.

**"Where do I call the waiter / ask for the bill?"** **Call Waiter** is at the
top of the menu's first page. **Request Bill** is on **Your Tab**.

**"It says the QR code is invalid or expired."** It was an old code, or the
guest's session ended. Help them scan the code on the table again; they can
**Just browse the menu** meanwhile.

**"It says ordering is paused."** The manager has stopped phone orders. Take
the order yourself.

**"A guest can't find something."** The search box at the top of the menu finds
dishes by name in all three languages. The globe button at the top right
changes the language.

**"A guest says they were charged twice."** Take the order number. Do not refund
on the terminal. Get the manager — refunds are recorded in the app so the day
still balances.
