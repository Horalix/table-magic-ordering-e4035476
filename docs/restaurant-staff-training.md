# Staff guide — La Soul ordering system

Written for the floor, not for engineers. Print it and keep a copy by the pass.

---

## Opening the shift

1. **Kitchen device** — open `/kitchen`. Check the pill next to the order count:

   | Pill | Meaning | Do |
   |---|---|---|
   | 🟢 **Live** | Orders arrive instantly | Nothing |
   | ⚪ **Connecting…** | Starting up | Wait a few seconds |
   | 🔴 **Reconnecting** | The screen is refreshing every 15 s instead of instantly | Check the Wi-Fi. Orders still arrive, just slightly later. |

   If it says **Reconnecting** for more than a minute, reload the page. If that
   does not help, tell the manager — someone must watch the tables directly
   until it is back.

2. **Printer** — tap the printer icon so it is highlighted on **one** device
   only. Only the device with the icon lit prints. If two devices have it lit,
   the system still prints each ticket once, but keep it to one anyway.

3. **Sound** — tap the speaker icon so alerts are on. New orders, waiter calls
   and bill requests each have their own sound.

4. **Sections** — the manager assigns waiters to sections for tonight under
   Admin → Tonight.

---

## Reading a kitchen ticket

```
Table 7   #047   (Amina)     [New]   [Owes · cash]     !! 12m ago
────────────────────────────────────────────────────────
  2× La Soul Burger
      ⚠ no onions
  1× French Fries
```

| Part | Meaning |
|---|---|
| **Table 7** | Where it goes |
| **#047** | The order number. This is what the guest sees on their phone. Use it when talking to a guest. |
| **(Amina)** | Who ordered, if they gave a name |
| **⚠ text** | A guest request. **Read every one.** These include allergies. |
| **!** next to the time | Waiting 5+ minutes |
| **!!** next to the time | Waiting 10+ minutes — this one is late |

---

## Payment labels — read these carefully

The label tells you whether money has arrived. **"Card" does not mean paid.**

| Label | Money arrived? | What to do |
|---|---|---|
| **Paid online** | ✅ Yes | Nothing. Already paid. |
| **Paid · cash** | ✅ Yes | Nothing |
| **Paid · terminal** | ✅ Yes | Nothing |
| **Online payment pending** | ❌ **No** | Money has **not** arrived. Do not treat as paid. It usually resolves in seconds. |
| **Payment problem** | ❌ No | The card failed. This order is **not** in the kitchen. |
| **Owes · cash** | ❌ No | Bring the bill, collect cash |
| **Owes · bring terminal** | ❌ No | **Bring the card machine to the table** |
| **Refunded / Part refunded** | Money returned | Ask the manager |

### The one rule about card orders

An order paid by card online **does not appear in the kitchen until the money
has actually arrived**. So:

- If a guest says "I ordered and paid by card" and you cannot see the order,
  their payment did not complete. Ask them to show you their phone.
- If their phone says **"Still confirming — do not pay again"**, do not take a
  second payment. Note the order number and check with the manager.
- If their phone says **"Payment was not completed"**, the card was not
  charged. Take payment at the table; the order goes to the kitchen as soon as
  you record it.

---

## New orders

Orders arrive automatically with a sound and, on the printer device, a ticket.

Move each one along as you go:

**New → Confirm → Start preparing → Mark ready → Mark served**

You can skip steps if you are busy — the system only refuses moves that make no
sense, like going backwards.

---

## Ready orders

An order marked **Ready** should leave the pass. Tap **Mark served** when it
reaches the table. That timestamp is what tells the manager whether food is
sitting under the lamp.

---

## Waiter calls and bill requests

They appear as coloured bars at the top of the kitchen screen and on
`/waiter/monitor`.

- **Waiter call (orange)** — a table needs something. Go, then tap the ✕.
- **Bill request (green)** — a table wants to pay. Take the bill; tapping ✓
  resolves the request **and closes the table session**, so only do it once
  they are actually settled.

---

## Taking payment at the table

On `/waiter` or in Admin → Orders, each unpaid order has two buttons:

- **Paid cash** — for notes and coins
- **Paid terminal** — for the physical card machine

**Use the right one.** They are counted separately at the end of the night: cash
is matched against the drawer, terminal against the machine's batch report. If
they are mixed up the day will not balance.

---

## Fiscalization

Ring the sale into the fiscal POS exactly as you always have — **the app does
not do this for you.** Then mark the order as fiscalized in Admin → Orders so
the manager can see it is done.

The app is not a fiscal device. It only keeps track of which orders have been
rung in.

---

## Printing problems

| Problem | Do |
|---|---|
| A ticket did not print | The screen shows "This ticket did not print". Tap **Reprint**. |
| Printer is offline | The kitchen screen keeps working. Read orders off the screen and reconnect the printer when you can. |
| A ticket printed twice | Should be impossible. Tell the manager — it means something is wrong. |

---

## When the internet fails

**Guests:** their app tells them the order was **not** sent and that nothing was
charged. It never claims an order went through when it did not.

**You:** take orders on paper as usual. Nothing is lost — orders already in the
system are safe in the database and will reappear when the connection returns.

**Do not** ask a guest to try paying again by card during an outage.

---

## Closing the shift

1. Every table settled — Admin → Daily Report shows anything still owed.
2. Check **"Needs attention before close"**:
   - *Still owed* — collect it or tell the manager.
   - *Payments started and never resolved* — these guests were **not** charged
     and never got food. The manager must check them.
   - *Callback problems* — a payment did not add up. Manager only.
3. Every order marked fiscalized.
4. Compare: cash drawer against **Cash**, terminal batch against **POS
   terminal**, Monri report against **Card online**.
5. Any difference: write it down, tell the manager. Never "adjust" it to match.

---

## Quick answers

**"Can I cancel an order?"**
Before the kitchen starts, yes — with a reason. Once it is being prepared or
paid for, a manager must do it.

**"Can I delete an order?"**
No. Orders are cancelled, never deleted, so the day still adds up.

**"A guest says the app charged them twice."**
Take their order number. Do not refund from the terminal. Get the manager —
there is a proper refund route that keeps the records straight.

**"The guest wants to add to their order."**
They just order again from their phone; it joins the same table tab.

**"Someone else at the table wants to order."**
Their phone asks to join. Anyone already at the table can accept, and it
auto-accepts after 30 seconds.

**"A guest is looking for something on the menu."**
Tell them to use the search box at the top of the menu — it searches everything
in all three languages.
