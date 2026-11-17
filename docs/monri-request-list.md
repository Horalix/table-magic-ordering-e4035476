# Paying on the phone with Monri: what to ask for

Written 17 November 2026. Online card payment is **off** and stays off until
Monri has answered and every sandbox case in `docs/monri-go-live.md` passes.
The app side is built (Monri Components, `monri-create-payment`,
`monri-webhook`) but has never run against Monri, because it needs things only
Monri and the bank can give. This is that list, with a message to send.

## What "pay on the phone" means

1. **Card, on the guest's own phone.** The guest orders from the table QR code
   and pays in the same page: the card field is Monri's (Components), 3-D Secure
   included. Built, waiting for Monri's credentials and approval.
2. **Phone wallet: Apple Pay and Google Pay.** One tap on the phone, no card
   typing. **Not built.** Whether it is possible with Components on our
   contract is Monri's answer to give (see "Wallets" below).

## What to ask Monri for

Ask for each restaurant, or for one contract covering both domains if Monri
prefers (La Soul, lasoul.net; Vera Italia, veraitalia.net). Whether the two
restaurants are one company or two decides this: tell Monri either way.

| # | Ask | Why we need it |
|---|---|---|
| 1 | An **online (card-not-present) merchant account** with its own MID, not the POS terminal's | A physical terminal does not authorise e-commerce |
| 2 | **Test (sandbox) credentials**: `merchant key` and `authenticity token`, then the **production** pair | They go in the Edge Function secrets (`MONRI_MERCHANT_KEY`, `MONRI_AUTHENTICITY_TOKEN`); never in the repo or a chat |
| 3 | Confirmation that **Monri Components** (card field inside our page) and the **Payments API** (`/v2/payment/new`) are on our contract, and which **PCI form** we fill in (SAQ A is expected, because card data never touches our servers) | Components is how we take the card; the form is a compliance step |
| 4 | **Registering our callback URL**: `https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/monri-webhook`, and the addresses Monri calls from, if it publishes them | Only the callback releases an order to the kitchen and marks it paid |
| 5 | **Currency BAM**, amounts in fening (×100), and **3-D Secure 2** switched on | The webhook refuses a wrong amount or currency |
| 6 | **Test cards** for success, decline, a failed 3-D Secure, and a way to test a **refund** | `docs/monri-go-live.md` section 5 has 16 cases to run |
| 7 | The **fees** (per card brand, per transaction, monthly, minimums, refunds), **when money is paid out**, and the **refund and chargeback** procedure | The owner's decision, and the reconciliation |
| 8 | A **settlement report** (file or API) per day | The Daily report's `paid_online` must equal Monri's report |
| 9 | What Monri **checks on the website** before production (terms, return policy, privacy, company details, contact, prices in KM, card and 3-D Secure logos), and which **card brands** it covers, including domestic cards | So we show it before they look, not after they refuse |
| 10 | Whether Monri **limits Components to certain domains**, and whether the production approval is per domain | We have two domains and two deploy previews |
| 11 | **Wallets**: see the next section | Apple Pay and Google Pay |

## Wallets: Apple Pay and Google Pay

What Monri's own documents say (read on 17 November 2026):

- The **Components page** lists three components: `card`, `saved_card` (with a
  `cvv` for pan tokens) and `pay-cek` (crypto). It does not mention Apple Pay or
  Google Pay. [Components](https://ipg.monri.com/en/documentation/components)
- **Google Pay** (Monri's guide, v1.00, 26 May 2025): to switch it on, **send a
  request to support@monri.com**, accept the Google Pay API terms of use, and
  publish the integration with Google. Two ways: (a) **Monri's payment form**
  (redirect): after the request, Monri adds a Google Pay tab, no development on
  our side; (b) **Monri's API**: we integrate the Google Pay API ourselves and
  send the token to `/v2/transaction`; this puts us **in PCI DSS scope**, so it
  needs a PCI DSS certificate. Cards: Visa and Mastercard only. The gateway
  merchant id is `webPayMerchant{merchant_id}`, so Monri must tell us the
  merchant id. [Google Pay guide (PDF)](https://ipg.monri.com/documentation/google-pay.pdf)
- **Apple Pay**: Monri's documentation site lists an Apple Pay page; I could not
  open it. A search summary says it is offered as a Monri.js component, loaded
  from Monri's own servers with separate test and production addresses. That is
  **not confirmed**, so ask. Apple Pay on the web also needs, in general, a
  verification file hosted on each domain under `/.well-known/`
  (`apple-developer-merchantid-domain-association`); we can host it on both
  sites the day Monri gives it.

So the question for Monri is: **can Apple Pay and Google Pay be used with
Components (so that no card data or PCI certificate comes to us), and what do
you need from us to switch them on?** If the answer is "only on the payment
form or the API", the choice is between Monri's redirect form with a Google Pay
tab (different from what is built) and not offering wallets yet.

## What Monri will probably ask us for

These are the usual papers for an online merchant account. **Monri's own list
wins**: ask for it. Typically: the company's registration extract and tax
numbers; the owner's identity; the bank account for payouts; the web shop
address(es) and what is sold; expected monthly volume and average bill; the
website's terms, return and privacy pages and contact details; a signed
contract; and a test of the integration in the sandbox.

## After Monri answers

1. Put the four values in the Edge Function secrets (Lovable's secret form; the
   key never goes in a chat): `MONRI_MERCHANT_KEY`, `MONRI_AUTHENTICITY_TOKEN`,
   `MONRI_ENVIRONMENT=test`, `MONRI_CALLBACK_URL`.
2. Register the callback in Monri's dashboard.
3. Run the 16 sandbox cases (`docs/monri-go-live.md`, section 5).
4. Only then production, one real low-value payment and a refund, and the
   Admin → Ordering & service switch (section 6).

## Message to send

**English**

> Subject: Online card payments for La Soul and Vera Italia (Sarajevo): Monri Components, test access and Apple Pay / Google Pay
>
> Hello,
>
> We run two restaurants in Sarajevo, La Soul (lasoul.net) and Vera Italia (veraitalia.net). Guests scan a QR code at the table, order on their phone, and we would like them to pay by card on the same phone. We already have a Monri POS terminal; this request is for **online (card-not-present)** payments.
>
> The integration is already built on Monri Components (the card field in our page), the Payments API (`/v2/payment/new`) and your callback. For each restaurant (or one account for both domains, if that is easier for you) we need:
>
> 1. An online merchant account (MID) and the test credentials, merchant key and authenticity token, then the production ones.
> 2. Confirmation that Monri Components is available on our contract, and which PCI form we should complete.
> 3. Our callback URL registered: https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/monri-webhook (and the addresses you call from, if you publish them).
> 4. Currency BAM, amounts in fening, and 3-D Secure 2 switched on.
> 5. Test cards for success, decline and failed 3-D Secure, and a way to test a refund.
> 6. Your fees, payout schedule, refund and chargeback procedure, and a daily settlement report (file or API).
> 7. What you check on the website before going live (terms, return policy, privacy, company details, logos), and which card brands are covered.
> 8. **Apple Pay and Google Pay:** can they be used with Monri Components, without us entering PCI DSS scope? If so, what do you need from us (the Apple Pay domain verification for lasoul.net and veraitalia.net, the Google Pay request), and how do we test them?
>
> Thank you,

**Bosanski**

> Predmet: Online plaćanje karticom za La Soul i Vera Italia (Sarajevo): Monri Components, test pristup i Apple Pay / Google Pay
>
> Poštovani,
>
> Imamo dva restorana u Sarajevu: La Soul (lasoul.net) i Vera Italia (veraitalia.net). Gosti skeniraju QR kod na stolu, naruče na svom telefonu i željeli bismo da mogu platiti karticom na istom telefonu. Već imamo Monri POS terminal; ovaj zahtjev je za **online plaćanje (card-not-present)**.
>
> Integracija je već izrađena na Monri Components (polje za karticu u našoj stranici), Payments API-ju (`/v2/payment/new`) i vašem callbacku. Za svaki restoran (ili jedan račun za obje domene, ako vam je lakše) trebamo:
>
> 1. Online trgovački račun (MID) i test podatke, merchant key i authenticity token, a zatim produkcijske.
> 2. Potvrdu da je Monri Components dostupan na našem ugovoru i koji obrazac PCI usklađenosti trebamo popuniti.
> 3. Registrovan naš callback URL: https://jgxnvrrphxnmzongtmzs.supabase.co/functions/v1/monri-webhook (i adrese s kojih šaljete callback, ako ih objavljujete).
> 4. Valutu BAM, iznose u feninzima i uključen 3-D Secure 2.
> 5. Test kartice za uspjeh, odbijanje i neuspjelu 3-D Secure autentifikaciju, te način da testiramo povrat novca.
> 6. Vaše naknade, rokove isplate, postupak povrata i chargebacka te dnevni izvještaj o isplatama (datoteka ili API).
> 7. Šta provjeravate na web stranici prije puštanja u produkciju (uslovi, politika povrata, privatnost, podaci o firmi, logotipi) i koje kartice su pokrivene.
> 8. **Apple Pay i Google Pay:** mogu li se koristiti sa Monri Components, bez ulaska u PCI DSS opseg? Ako mogu, šta vam treba od nas (verifikacija domena lasoul.net i veraitalia.net za Apple Pay, zahtjev za Google Pay) i kako ih testiramo?
>
> Hvala unaprijed,
