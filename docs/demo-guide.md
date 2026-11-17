# Demo guide — La Soul and Vera Italia

How to show both restaurants to their owners: which accounts to make, in what
order, how each person signs in, and a short script for every role. About 30
minutes of setup the day before, 20 minutes of demo.

**No passwords in this file, ever.** Every password is made in the app, shown
once on a login card, and handed over in person or by message. If one is lost,
make a new one (below); nobody can look it up.

---

## The two sites

| Restaurant | Site | Its staff sign in at |
|---|---|---|
| La Soul | https://lasoul.net | https://lasoul.net/admin/login (admins) · https://lasoul.net/waiter/login (waiters, kitchen) |
| Vera Italia | https://veraitalia.net | https://veraitalia.net/admin/login (admins) · https://veraitalia.net/waiter/login (waiters, kitchen) |

One database behind both. Any account can sign in on either site and always
sees its own restaurant; each restaurant's staff use their own site because it
carries their name and is what goes on their home screen.

## Who signs in where

| Role | Opens | Types | Lands on |
|---|---|---|---|
| **Owner** (both restaurants) | `/admin/login` on either site | Email and password | **Both restaurants** (under Home): the two side by side |
| **Restaurant admin** | Their restaurant's `/admin/login` | Email, and the initial password from their login card | Their restaurant's **Dashboard** |
| **Waiter** | The link on their login card: `/waiter/login?u=<their username>` | The password only (the username is filled in) | The waiter phone, `/waiter` |
| **Kitchen tablet** | The link on its login card: `/waiter/login?u=<restaurant>-kitchen&to=kitchen` | The password only | The kitchen display, `/kitchen` |
| **Floor screen** (optional) | `/waiter/monitor`, signed in with any staff account of that restaurant (the kitchen tablet's link with `to=monitor` instead of `to=kitchen` lands there directly) | Each waiter taps their name and **Floor PIN** | The floor of that restaurant |
| **Guest** | Scans the QR code on the table | Nothing | That restaurant's menu, in Bosnian, English or Arabic |

The kitchen tablet signs in **with a username at `/waiter/login`**, not at
`/admin/login`. A waiter or kitchen tablet who tries the admin sign-in is told
where to go (**Staff sign-in**, under the form).

---

## Before the demo: the accounts, in order

Each account takes under a minute. After each one a **login card** opens with
the restaurant, the address to open, what to type and the password. Tap
**Share** (on a phone: WhatsApp, Viber, a message) or **Copy**, then **Done**.
The password is shown only on that card and is not stored anywhere; a tap
beside the card does not close it.

The admin has five areas: **Home**, **Service**, **Menu**, **Reports** and
**Setup**. On a laptop they are down the left side; on a phone they are the bar
at the bottom, with Setup under **More**. The pages of an area are the tabs
across the top. Below, **Setup → Team** means: open Setup, then the Team tab.
The magnifier (Ctrl K) finds any page by name. The account (**Change
password**, **Sign out**) and the restaurant switch are on the left side of a
laptop, and under **More** on a phone.

The first time an account opens the admin on a device, a one-minute tour,
**What’s new**, shows where everything is. Skip it or go through it; it is
there again as **What’s new** at the bottom of the left side (on a phone:
**More → What’s new**), or type "tour" in the search.

### 1. The owner signs in (once)

1. Open https://lasoul.net/admin/login and sign in with the owner's
   email. To pick the demo password, tap **Change password** at the bottom of
   the left side (on a phone: **More → Change password**), or **Setup → Team** →
   **Change password** on your own row. If nobody
   knows the owner's password, reset it in Lovable (Cloud → Users), never in
   a chat.
2. The first screen is **Both restaurants**. That is the
   owner's account working.

### 2. One admin per restaurant (owner, ~1 min each)

1. **Setup → Team**.
2. **Appoint a restaurant admin**: type **Their email**, pick **Restaurant they
   will run** (**La Soul** or **Vera Italia**), then **Generate** next to
   **Initial password**.
3. **Appoint Vera Italia admin** (the button names the restaurant you picked).
4. The login card says: sign in at `veraitalia.net/admin/login` with that
   email. **Share** it to them → **Done**.
5. Repeat for La Soul.

If the email already has an account, leave the password empty: they get the
role and keep their own password, and the card says so. If they forget their
password later, the owner gives them a new one: **Setup → Team** → their row →
**Password** → type one or **Generate** → **Set new password**. They change it
at once with **Change password** (bottom of the left side; on a phone, under
**More**).

### 3. Each restaurant's staff (owner or that restaurant's admin)

The owner works on one restaurant at a time: tap **La Soul** or **Vera Italia**
in the switch at the top of the left side (on a phone: under **More**). A
restaurant admin only ever sees
their own and skips this.

Then, for each restaurant:

1. **Setup → Waiters**. The form says **For Vera Italia** (or La Soul) and where
   they sign in. The owner can tap **Add to La Soul instead** to switch.
2. **The kitchen tablet:** tap **Kitchen tablet** → the name (*Kitchen*) and
   username (*<restaurant>-kitchen*) are filled in → **Generate** →
   **Create**. Share the card to the tablet (or open its link there).
3. **Each waiter:** **Waiter** → **Name** (the username fills itself in from
   the first name; change it if it is taken) → **Generate** → **Floor PIN**
   (optional: leave it blank and one is made) → **Create**. Share the card to
   their phone. For the demo, two waiters per restaurant are enough.

Usernames are shared by both restaurants: if "That username is taken" appears,
add a letter or the restaurant (for example a dot and the restaurant's name).

**A waiter forgot their password:** Setup → Waiters → their row → **Password** →
**Generate** → **Set new password**. A new card opens; the old password stops
working. The owner can do the same for anyone, at either restaurant, from
**Setup → Team**. (Needs the latest `create-waiter` and `manage-admins` deployed.)

**Every password at a glance:**

| Whose | Who changes it | Where |
|---|---|---|
| Owner | The owner | **Change password**, at the bottom of the left side or under **More** on a phone (asks for the current one) |
| Restaurant admin | Themselves, or the owner if forgotten | **Change password**, in the same place; the owner: **Setup → Team** → **Password** |
| Waiter, kitchen tablet | Their admin or the owner | **Setup → Waiters** → **Password**; the owner also **Setup → Team** → **Password** |

### 4. The floor (per restaurant, ~5 min)

1. **Setup → Tables** → *How many tables do you have?* → **Generate tables**.
2. **Setup → Floor sections** → add one or two (for example Terrace, Inside) and
   move tables into them.
3. **Service → Tonight’s waiters** → tap each section → tap the waiters who cover
   it → **Done**.
   Without this, every table shows under *No waiter yet* on the phones.
4. **Setup → QR codes** → **Per table**. Print a few, or show one on a laptop screen to
   scan. Vera Italia's codes open veraitalia.net; La Soul's open
   lasoul.net.
5. **Setup → Ordering & service** → **Accept orders from guests** on, and **Service
   hours** wide enough to cover the demo. An order sent outside them waits for
   a waiter to confirm it.

### 5. Devices, signed in the day before

| Device | Sign in with | Leave it on |
|---|---|---|
| Kitchen tablet (one per restaurant) | Its login card link | `/kitchen`, station **All**, **Test sound** tapped |
| Each waiter phone | Their login card link, then **Add to Home Screen** | `/waiter`, sound enabled |
| Floor screen (optional) | Any staff account of that restaurant | `/waiter/monitor` |
| Owner's laptop or phone | The owner's email | `/admin/overview` |
| Guest phone | Nobody (a private tab if it is a staff phone) | The camera |

---

## The demo

Run it once at La Soul, then once at Vera Italia (or side by side with two
guest phones). Keep the first order small: a first order over 60 KM or 10
portions waits for a waiter to confirm it.

### Guest: scan the table QR and order (3 min)

1. Scan the code on table 3. The menu opens on the restaurant's own site; the
   globe button (**EN** / **BS** / **عربي**) switches the language.
2. Open a dish, **Add to order**; add a drink. Point out the suggestion that
   appears with it.
3. **View Order** → **Send order**. The phone says *Your order has been sent to
   the kitchen.*
4. From the tab: **Call Waiter**, and later **Request Bill**.
5. The tab then asks the guest to rate the visit and the waiter.

Point out: nothing to install, no account, and a Vera Italia table can only
order from Vera Italia's menu.

### Waiter phone and the floor screen (4 min)

1. The order appears on the waiter's phone under **In the kitchen** with a
   short buzz; tap **Accept** (optional).
2. The guest's **Call Waiter** shows as *Needs you* with a chime → go → **Done**.
3. When the kitchen marks it ready: *Ready to run* → **Mark served**.
4. **Request Bill** shows as *Wants the bill* → on the table's row **Cash** or
   **Terminal** → **Yes, … KM received** → **Free table**.
5. Floor screen: tap a waiter's name, type their **Floor PIN**: only their
   tables, with **I'll go**, **Done**, **Cash** / **Terminal**. **All Tables**
   is the manager's view.

### Kitchen display (3 min)

1. The order arrives with a *New order* banner and a chime → **Got it**.
2. Read the card: table, order number (the guest sees the same), allergens,
   notes, how long it has waited.
3. **Start** → **Ready** on each line (or **Start all**, **All ready**). The
   waiter's phone buzzes.
4. **Undo** for 90 seconds; **All day** shows how many of each dish are waiting.
5. With a network printer, the ticket printed on its own.

### Restaurant admin (4 min)

Sign in as the restaurant's admin on its own site.

1. **Dashboard**: today's sales, open orders, what needs attention. Only this
   restaurant's name and numbers; no switch, no Both restaurants, no Team.
2. **Menu → Dishes**: tap a price to change it; switch a dish to **Sold out** and
   show the guest's phone that it can no longer be ordered.
3. **Setup → Waiters**: add a waiter live and share the card (under a minute).
4. **Service → Orders** and **Reports → Daily report**: the demo order, paid, by
   method.
5. **Service → Tonight’s waiters**: who covers which section.

### Owner's overview (3 min)

Sign in as the owner.

1. **Home → Both restaurants**: La Soul and Vera Italia side by side — sales so far against
   the same time last week, tables seated, the kitchen queue, guests waiting,
   printers. It refreshes every 30 seconds.
2. **Open Vera Italia admin** → the full admin of that restaurant; the switch
   at the top of the left side (on a phone: under **More**) goes back to La Soul.
3. **Setup → Team**: who runs each restaurant, their waiters and kitchen tablets,
   and when each last signed in. Appoint a restaurant admin, give anyone a new
   password, or **Remove** any account but your own: its sign-in is deleted
   for good, and orders and history stay. An admin's Remove also offers
   **Only stop running** that restaurant, which keeps the account. **Copy all
   sign-ins** copies the whole list, with the address each one opens and no
   passwords (nobody can read those; Password gives a new one).

---

## After the demo

- Free every table the demo used (waiter phone → **Free table**, after
  recording payment).
- Demo orders stay in today's reports. To start the next day clean, see
  `docs/operations-runbook.md`, *Free every table before a demo or rehearsal*.
- Switch off (Setup → Waiters → the switch on their row) or remove any account
  made only for the demo (the owner: **Setup → Team → Remove**).
