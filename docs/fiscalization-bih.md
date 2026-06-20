# Fiscalization in Bosnia & Herzegovina — what La Soul needs

> Not legal advice. Confirm specifics with your accountant and the **Porezna
> uprava FBiH** before go-live. This summarizes the situation as of mid-2026.

## The law (short version)
BiH has **three** fiscalization frameworks: **FBiH** (Sarajevo / La Soul is here), **Republika Srpska**, and **Brčko District**. FBiH adopted a new **Law on Fiscalization of Transactions**, published/live in **February 2026**, introducing mandatory **real-time reporting** and e-invoicing.

What it means for a restaurant:
- **Every** sale must be fiscalized — **regardless of payment method** (cash, card, *and* online).
- Receipts must be produced by an **approved Electronic Fiscal System (EFS)** / certified fiscal device, with **real-time data transmission** to the Tax Authority, a **QR code** on each fiscal receipt, and **e-signatures / security certificates**.

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

## Future option (when you want deeper integration)
Integrate a **certified EFS / fiscal middleware** (a BiH-accredited provider exposes an API + certificate) so the app can request a fiscal receipt automatically per order and store the returned fiscal number/QR on the order. This is a larger, vendor-specific effort and depends on FBiH's finalized technical spec — revisit once a provider/spec is confirmed with your accountant.

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
