# Fiscalization in Bosnia & Herzegovina — what La Soul needs

> Not legal advice. Confirm specifics with your accountant and the **Porezna
> uprava FBiH** before go-live. Checked against the law text on 25 October 2026.

## The law (short version) — checked against the gazette text, 25 Oct 2026
BiH has **three** fiscalization frameworks: **FBiH** (Sarajevo / La Soul is here), **Republika Srpska**, and **Brčko District**.

**Today** La Soul is under the old FBiH regime (Zakon o fiskalnim sistemima, Sl. novine FBiH 81/09): every sale goes through a **certified fiscal device** (fiscal printer/register from an authorised distributor, e.g. Tring, HCP), whatever the payment method — cash, card terminal *and* online card.

**Coming**: the new **Zakon o fiskalizaciji transakcija u FBiH** (Sl. novine FBiH 9/2026, 4 Feb 2026, in force 12 Feb 2026) replaces devices with certified **software** — an *ESET* (elektronski sistem za evidentiranje transakcija) that signs every bill with a security module and reports it in real time to the Tax Administration's central platform (CPF), with a QR code on the bill.
- **Not applied yet.** Application starts when the bylaws and the Tax Administration's systems are ready, at the latest 18 months after entry into force (about **August 2027**). The technical rulebooks were not published as of autumn 2026.
- **Transition.** B2C businesses (restaurants) must comply within **two years** of the start of application (Art. 86); old fiscal systems may be used for a **three-year** transitional period (Art. 87).
- **Restaurants** may issue an **order form (narudžbenica)** before the bill, and the bill then cites it (Art. 5); an ESET for hospitality may sign and report order forms (Art. 28). An app order is exactly that document.
- **Who may make an ESET** (Art. 33): a registered software producer with at least two degree-qualified engineers, ISO 9001, ISO 27001 and ISO 37001, a service network across the Federation (contracts with at least ten service companies) and a **1,000,000 KM bank guarantee** held for as long as the approval lasts; each ESET is approved by the Federal Ministry of Finance. Using an invoicing system without approval can get the business **closed** (Art. 79).

So this app will not itself become a fiscal system: it connects to one (below).

What it means for a restaurant:
- **Every** sale must be fiscalized — **regardless of payment method** (cash, card, *and* online).
- The legal receipt always comes from the certified device today, and from an approved ESET under the new law.

## Where our app fits
Our ordering app is **not** a certified EFS, and becoming one (certificates, accredited device, real-time PU integration) is a separate, regulated project. So the app must **not** be treated as the fiscal receipt issuer.

**The restaurant already owns a certified fiscal POS** (currently used for physical card payments). That device is the legal receipt issuer.

## Recommended approach (immediate, compliant)
**Fiscalize every online order through the existing certified POS.**

1. A guest orders (cash or card) in the app → the order lands on the floor/kitchen.
2. The **cashier rings that order into the existing fiscal POS**, which issues the legal fiscal receipt (with QR + real-time report), exactly as for a walk-in.
3. The app makes this frictionless — it already shows, per order: **table, items, total, tip, and payment method** (see the kitchen ticket + Daily Report), so the cashier can mirror it into the POS in seconds.

To make reconciliation tight, a small optional add-on (not built yet, easy to add): a **"fiscalized" toggle** on each order in the admin/waiter view so staff can mark which orders have been rung into the fiscal device, and the **Daily Report** can flag any un-fiscalized orders at close.

> Important for **card-online (Monri)**: paying online does **not** remove the fiscal obligation — the sale still needs a fiscal receipt from the certified device. Plan the cashier step for online-paid orders too.

## Automatic fiscalization — two steps
**Now (old regime): drive the existing fiscal printer.** Certified fiscal printers in FBiH are driven by their maker's software; Tring's *Tring.Fiscal.Server* exposes an HTTP API that ERP/POS systems already use for receipts, refunds and X/Z reports (an Odoo integration exists). A small **fiscal bridge** on the PC next to the printer (the same pattern as the kitchen print bridge) picks up each order the waiter marks paid, sends its lines and payment type to the printer, and writes the returned receipt number back through `set_order_fiscalization(...)` — the reconciliation fields below already exist. Needs: the printer's make and model, its driver/server documentation from the authorised service, VAT group and article (PLU) mapping per menu item, and a test with the service technician. The legal issuer is still the certified device; the app only stops staff retyping orders.

**From 2027 (new law): connect to an approved ESET.** Once ESET producers are approved, connect to one that offers an API: each app order is signed as a **narudžbenica**, the bill is issued against it as a fiscal invoice with QR code, and the guest can get it on their phone. Build the app side behind a small provider interface now, so the switch from printer to ESET is a configuration change, not a rewrite.

## Action checklist
- [ ] Confirm with the accountant / PU FBiH exactly how online + card orders must be fiscalized for **your** registration.
- [ ] Adopt the "ring online orders into the existing POS" workflow; train staff.
- [ ] (Optional) add the **fiscalized toggle + Daily Report flag** for clean reconciliation.
- [ ] Decide later whether to integrate a certified EFS provider API.

## Sources
- [EDICOM — Bosnia mandatory e-invoicing & e-reporting](https://edicomgroup.com/blog/bosnia-herzegovina-electronic-invoice-ereporting)
- [Fiscal Solutions — BiH digital transformation / e-invoicing](https://www.fiscal-requirements.com/news/4615)
- [VATupdate — BiH advances digital fiscalization law (Dec 2025)](https://www.vatupdate.com/2025/12/04/bosnia-and-herzegovina-advances-digital-fiscalization-law-to-combat-tax-evasion-and-modernize-transactions/)
- [DDD Invoices — Fiscalization & real-time reporting in BiH](https://dddinvoices.com/learn/fiscalization-and-real-time-reporting-in-bosnia-and-herzegovina)
