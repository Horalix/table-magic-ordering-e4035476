# WhatsApp messages about reservations

A guest who asks for a table is messaged on WhatsApp, by itself, from the
restaurant's own business number: "we have your request", then "confirmed",
"declined" or "cancelled", in the language they asked in. The restaurant can
be told about each new request the same way, on any WhatsApp number it names.

Off until two things are done: the restaurant's number is connected at Meta
(once, below), and an admin switches it on (**WhatsApp messages**, on Admin →
Ordering & service under the reservations switch, and the same card on Admin
→ Reservations). Until then nothing is sent and nothing fails, and **Tell the
guest** (one tap from the admin's own WhatsApp, Viber or Messages) works as
it always did.

## Why WhatsApp, and what it costs

Priced on 12 November 2026:

| Way | Cost per message to a Bosnian number | Needs |
| --- | --- | --- |
| Text message through Twilio | $0.51 | A Twilio account |
| WhatsApp from the restaurant's own business number | A few cents at most. Meta's rate card puts Bosnia in its "Other" region; the current rate is on Meta's pricing page | A number, a Meta business account, a card |
| "Tell the guest" from the admin's own phone | Nothing | Nothing |

A SIM or eSIM by itself sends nothing automatically: it would need a phone
that stays on, charged and in credit at the restaurant. What a Bosnian number
is for is this: it becomes the restaurant's WhatsApp Business number, after
which Meta sends the messages and no phone has to be on.

Guests without WhatsApp get no message by themselves. Their page still shows
the answer within seconds, and **Tell the guest** offers Viber and a text.

## What you need (once)

1. **A phone number for each restaurant** that can take one call or one text
   and is **not used in the WhatsApp app** on any phone. The restaurant's
   landline works (Meta reads the code out in a call) and is the best choice:
   it is the number guests already know. Otherwise a new Bosnian SIM or eSIM,
   kept in credit so the number is not lost.
2. **A Meta business account** (business.facebook.com), ideally the one that
   already holds the restaurants' Instagram or Facebook pages, with a payment
   card.
3. About 45 minutes for the steps below.

## Connecting the numbers at Meta

Meta changes its screens; the names below are Meta's own as of November 2026.

1. **developers.facebook.com → My Apps → Create app.** Use case **Other**,
   type **Business**, any name ("Restaurant messages"), and choose your
   business account.
2. In the app, **Add product → WhatsApp → Set up.** This makes the WhatsApp
   Business Account.
3. **WhatsApp → API Setup → Add phone number.** Display name `La Soul`,
   category Restaurant, the number, then the code Meta sends by text or call.
   Do it again for `Vera Italia`. On the same page note three ids:
   **WhatsApp Business Account ID** (one) and each number's **Phone number
   ID** (two).
4. **WhatsApp Manager → Payment settings**: add the card.
5. A token that does not expire: **Business settings → Users → System users →
   Add** (role Admin) → **Assign assets**: the app and the WhatsApp account,
   full control → **Generate token**: choose the app, expiry **Never**,
   permissions `whatsapp_business_messaging` and
   `whatsapp_business_management`. Copy it once; Meta does not show it again.

## Giving them to the system

In Lovable, add four secrets to the Edge Functions (the same place as the
alert keys). Nobody else needs to see them, and they are never written in the
repository:

| Secret | What |
| --- | --- |
| `WHATSAPP_TOKEN` | The token from step 5 |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | The WhatsApp Business Account ID |
| `WHATSAPP_PHONE_ID_LASOUL` | La Soul's Phone number ID |
| `WHATSAPP_PHONE_ID_VERAITALIA` | Vera Italia's Phone number ID |

Then send Lovable the **Next** prompt in `docs/lovable-migration-prompt.md`
(one migration, one new function). The order does not matter: the function
reads the secrets whenever it runs.

## Switching it on

**Admin → Ordering & service → Table reservations → WhatsApp messages** (or
the same card on Admin → Reservations), at each restaurant:

1. The line at the top says where it stands: *Not connected yet*, *No number
   for this restaurant yet*, *n of 14 messages approved*, or *Ready*.
2. **Set up the messages** sends the wording of all fourteen messages to
   WhatsApp for approval (six messages; the four for guests in English,
   Bosnian and Arabic). Approval usually takes minutes. Do it once; it serves
   both restaurants.
3. When it says **Ready**, the restaurant's choices:
   - **Send guests a WhatsApp confirmation**: the guest is told when you
     confirm, decline or cancel their table.
   - **Also when their request arrives** (shown once the first is on, and on
     to begin with): "we have your request", before you have answered. Off,
     each reservation costs one message instead of two.
   - **Also tell this WhatsApp number about new requests**: type a number,
     **Save**, and **Send a test**. Leave it empty to be told by the app's
     own alert only.

A WhatsApp message rings an iPhone like any other message, with no app to add
to the Home Screen.

## What is sent

| When | To | Message |
| --- | --- | --- |
| A guest asks for a table | The guest | We have your request for (day, time, guests, code). Not confirmed yet |
| | The restaurant's number | New table request: day, time, guests, name, phone |
| The admin confirms | The guest | Your table is confirmed, with the admin's own line |
| The admin declines | The guest | We cannot take this reservation, with the admin's own line |
| The admin cancels a confirmed table | The guest | We had to cancel, with the admin's own line |
| A guest gives back a confirmed table | The restaurant's number | The table is free again |

Each goes once. On Admin → Reservations, **Tell the guest** says when the
same answer already went out by itself, or that WhatsApp could not deliver it
and why, so it is sent by hand instead. A request nobody answered in time
lapses without a message.

The booking page says, under the phone number, that the restaurant will
message on WhatsApp, before the guest sends anything.

## Limits worth knowing

- A new WhatsApp Business number may message 250 different people a day until
  Meta has verified the business. That is more than a restaurant's
  reservations; verifying lifts it.
- Meta reviews the display name ("La Soul"). Until it is approved, messages
  still go, under the number.
- Whether a message was *delivered* (the guest's phone was on, the number is
  on WhatsApp) is not read back yet: "sent" means Meta took it.
- The first real message is the test of all of this: none has been sent
  through Meta's servers from here, only through a stand-in in the tests.

## Where it lives

| Piece | File |
| --- | --- |
| The six messages, sending, creating them at Meta | `supabase/functions/_shared/whatsapp.ts` |
| Who is sent what, and the admin's set-up calls | `supabase/functions/_shared/reservation-messages.ts`, `supabase/functions/reservation-messages/index.ts` |
| The two choices, what was sent, the triggers | `supabase/migrations/20261114090000_reservation_messages.sql` |
| The admin's card | `src/components/admin/ReservationWhatsApp.tsx` |
| Tests | `src/lib/whatsapp.test.ts`, `supabase/tests/reservation-messages.test.ts`, `e2e/reservations.spec.ts` |
