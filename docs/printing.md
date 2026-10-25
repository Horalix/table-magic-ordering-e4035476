# Kitchen and bar printing

How La Soul gets kitchen and bar tickets onto paper, what to buy, how to connect
it, and what to do when nothing comes out.

This is about **kitchen/bar tickets** only. The **fiscal receipt** printer
(Tring and the like) is a certified device set up through fiscalization. It is
separate and is not covered here.

---

## The short answer

**Buy one network thermal printer per station and plug it into the router.**
The printer asks our server every few seconds whether it has a ticket to print.
Nothing has to stay open, paired or awake: no tablet, no PC, no app.

| | Recommended | Also works | Budget fallback |
|---|---|---|---|
| **Printer** | **Epson TM-m30III** (Ethernet) | **Star TSP143IV LAN** | Epson TM-T20IV, Xprinter XP-80 / XP-N160II (USB or LAN) |
| How it gets tickets | Fetches them itself (Epson Server Direct Print) | Fetches them itself (Star CloudPRNT) | A kitchen tablet has to stay on with the Kitchen screen open |
| Price each, new (Oct 2026) | **about 500–700 KM** in BiH (≈ 696 KM on OLX shops; ≈ 500–520 KM from Croatian shops) | **about 590 KM** (≈ €300 in the EU; not stocked in BiH, so import it or ask a distributor) | 120–220 KM for Xprinter, 290–450 KM for a TM-T20IV |
| Kitchen + bar | ≈ 1,000–1,400 KM | ≈ 1,200 KM | ≈ 250–900 KM, plus a tablet you already have |
| Why | Epson is by far the most-listed receipt-printer brand in BiH shops, so it is easy to buy, replace and get serviced locally | The fastest setup: paste one address and it prints | Cheapest; good as a spare |

**For La Soul: two Epson TM-m30III (kitchen and bar), Ethernet, 80 mm paper.**
If a dealer has a Star TSP143IV LAN at a similar price, it is equally good.

Watch out:

- The **Epson TM-T20III and TM-T20IV cannot fetch tickets themselves**. They
  are only on the budget path (a tablet stays on). The TM-m30III, TM-m30II-NT,
  TM-m50 and TM-T88VI/VII can.
- Buy the **Ethernet (LAN)** model and use a cable to the router. Wi-Fi works,
  but a kitchen is a bad place for Wi-Fi: steel, steam and microwaves.
- **80 mm** paper. 58 mm works, but the table number and notes are much easier
  to read on 80 mm.

Prices are from OLX.ba shop listings, ekupi.ba, links.hr, instar-informatika.hr
and LDLC, checked 25 Oct 2026. Ask two shops for a quote before buying.

---

## Connect a printer in 5 minutes

### 1. In the app (1 minute)

1. Open **Admin → Printing**.
2. Under **Network printers**, type a name (for example *Kitchen printer*),
   choose **Kitchen**, **Bar** or **Kitchen + bar**, and press **Add printer**.
3. Press **Address & setup steps** and **Copy** the address. It looks like
   `https://….supabase.co/functions/v1/cloudprnt/7f3a…` and it is this
   printer's password: do not share it.

### 2. On the printer (3 minutes)

First find the printer's **IP address**. Switch the printer off, hold the
**FEED** button, and switch it back on. It prints a settings page that shows
the IP address.

On a phone or laptop connected to the **same Wi-Fi**, open `http://<that IP>`.

**Epson (TM-m30III, TM-T88VII, TM-m50)**

1. Log in to **Web Config**. The default password is on the label underneath
   the printer, or on the settings page.
2. Open **Server Direct Print**.
3. Turn it **on** and paste the address as the **URL**. **ID** can be anything,
   for example `kitchen`. Set **Interval** to **5** seconds.
4. **Save**.

**Star (TSP143IV, mC-Print3)**

1. Log in. The default is `root` / `public`, unless someone changed it.
2. Open **CloudPRNT**.
3. Turn it **on**, paste the address as the **Server URL**, and set **Polling
   interval** to **5** seconds.
4. **Save**, then **Restart** the printer.

### 3. Check it (1 minute)

Back in **Admin → Printing**, the printer changes to **Online** within a few
seconds. Press **Test print**. A *TEST TICKET* comes out with a burger, its
notes and allergens, and a drink.

That's it. From now on, every confirmed order prints at the right station on
its own.

---

## What the ticket looks like

```
                    La Soul
 ███████████████ KITCHEN ORDER ███████████████
                    TABLE 7                      ← double size
                 #047   20:14                    ← order code + time it reached the kitchen (Sarajevo)
       Terasa | Waiter: Marko | Guest: Amina
================================================
2 x La Soul Burger                               ← double height
    + Side: Pomfrit                              ← combo parts
    + Drink: Coca-Cola [BAR]                     ← made at another station
████ ! no onions, well done █████████████████████ ← white on black
████ ALLERGENS: GLUTEN, SESAME ██████████████████ ← white on black

1 x Cevapi (10 kom)
================================================
█ ORDER NOTE: Bring the mains together ██████████
PAYMENT: CASH - NOT PAID
```

- **Kitchen and bar get separate tickets.** Each has only the lines its station
  makes. A drink that comes with a kitchen dish goes to the bar ticket, marked
  *(part of …)*.
- **Station tickets never show prices.** They do show the payment method and
  whether the order is paid.
- A **reprint** carries a black *REPRINT* band and the time the original
  printed, so nobody cooks it twice.
- Thermal printers have no č, ć, ž, š or đ, so they print c, z, s and dj
  (*Cevapi*). Screens and the browser print page keep the real letters.
- You can see the exact ticket, for the kitchen or the bar, under **Admin →
  Printing → What prints**.

---

## How it works

1. A confirmed order puts one ticket per station in the **print queue**: an
   order placed and accepted, a card order whose payment cleared, or a held
   order a waiter confirmed.
2. **Held orders print only once a waiter confirms them.** Until then they are
   not in the queue at all.
3. Whatever prints a ticket first **claims** it: a network printer, a tablet
   over Bluetooth or USB, or a browser print dialog. Only one can win, so a
   ticket never prints twice by accident.
4. A network printer confirms each ticket. It is then **Printed ✓ by the
   printer**. A tablet print is **Printed (unconfirmed)**, because Bluetooth
   and USB printers cannot report back.
5. A ticket that fails (paper out, cover open, printer off) turns **red on the
   kitchen board** with *Did not print* and a **Reprint** button. It also shows
   in **Admin → Printing → Print queue** with **Retry**.
6. If a network printer is **online** for a station, kitchen tablets leave that
   station alone. If the printer stops answering for a minute, a tablet that is
   set up to print takes over on its own.
7. A newly connected printer only prints tickets from the **last hour**, for
   food that is still being made. It does not print the restaurant's history.

---

## Without a network printer: print from a tablet

The tablet has to stay on, with the **Kitchen** screen open. The Kitchen screen
keeps the display awake on its own.

| You have | Do this (Admin → Printing → Or print from a tablet) |
|---|---|
| A Bluetooth printer that appears in Chrome's list (BLE) | **Bluetooth** → Connect → Send a test ticket |
| A Bluetooth printer that does **not** appear there (most cheap ones) | Pair it in the tablet's own Bluetooth settings (PIN 0000 or 1234), then **USB or classic Bluetooth** → *Classic Bluetooth / serial*. Needs Chrome 137+ on Android, or 117+ on a computer |
| An **Android** tablet and a USB printer | Plug it in with a USB-OTG cable → **USB or classic Bluetooth** → *Connect USB printer* |
| A Windows or Mac PC and a USB printer | Install the printer driver and make it the default printer → **This device** → follow *Print without the popup* (Chrome kiosk printing) |

iPads cannot print silently from a web page. Use a network printer, or an
Android tablet.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| Printer says **Never connected** | The address was not saved on the printer, or the printer has no internet. Open its settings page again, check the URL is pasted in full, and save. Check the router gives it internet: its settings page should show a gateway and DNS. |
| **Offline — last seen 4 min ago** | It is switched off, unplugged, or off the network. Switch it off and on. The kitchen board shows the same warning in red. |
| **Online — The printer reported 511 …** | The printer could not read the ticket format. In Admin → Printing, open the printer's **⋯** menu and turn on **Plain text**. |
| Tickets come out but some letters are **?** | Expected for č, ć, ž, š and đ on cheap printers. They print as c, z, s and dj. Anything else that prints as **?** means it is not a letter the printer has. |
| **Did not print — The printer is out of paper / cover is open** | Fix the paper, then press **Reprint** on the ticket, or **Retry** in the print queue. |
| A ticket printed **twice** | Only one device can claim a ticket, so a double is a deliberate reprint. It is marked *REPRINT* with the original time. |
| Nothing prints and the board says nothing | Check **Admin → Printing → Printing on** is on. Then check the station: a printer set to *Bar* never prints kitchen tickets. |
| A **held** order did not print | Correct. It prints the moment someone presses **Confirm** on *Needs confirming*. |
| The tablet still prints even though the network printer is online | The tablet's Kitchen screen is set to **All** stations and the printer only covers one. Set the tablet's station, or set the printer to **Kitchen + bar**. |
| Want to stop someone else's printer printing our tickets | Open the printer's **⋯** menu and choose **New address**. The old address stops working at once. Paste the new one into our printer. |

---

## For developers

- **Endpoint:** `supabase/functions/cloudprnt/index.ts`. It is deployed with
  `verify_jwt = false`, because a printer cannot send a JWT. The last path
  segment is the printer's `printers.poll_token`. Both protocols are handled
  in `supabase/functions/_shared/cloud-print.ts`, which is pure and unit-tested
  in `src/lib/cloud-print.test.ts`. The protocol is detected per request:
  - **Star CloudPRNT**
    - `POST` with a JSON body returns `{jobReady, mediaTypes, jobToken, deleteMethod: "DELETE"}`.
    - `GET ?type=&token=` returns the job, as `application/vnd.star.starprnt` or `text/plain`.
    - `DELETE ?code=200%20OK&token=` reports the result. Any code that does not start with "2" is a failure.
  - **Epson Server Direct Print**
    - A form `POST` with `ConnectionType=GetRequest` returns `<PrintRequestInfo>` with ePOS-Print XML, or an empty body when there is nothing to print.
    - `SetResponse` reports the result.
    - `SetStatus` reports status only.
- **Ticket layout:** `supabase/functions/_shared/ticket-layout.ts`. It renders
  four ways: text, ESC/POS, StarPRNT and ePOS-XML. The web app imports it too,
  so a tablet and a printer always print the same ticket.
- **Database:** `supabase/migrations/20261026120000_cloud_printers.sql` adds:
  - the `printers` table
  - `cloud_printer_checkin`, `cloud_print_claim`, `cloud_print_report`, `cloud_printer_test_done` (service role only)
  - `printer_health()` for staff, which never returns the token
  - `order_ticket_events.original_printed_at`

  It is tested in `supabase/tests/cloud-printers.test.ts`, on PGlite.
- **Tablet transports:**
  - Web Bluetooth: `src/lib/printer-connect.ts`
  - WebUSB and Web Serial: `src/lib/printer-direct.ts`
  - Browser print dialog: `src/lib/ticket-export.ts`
- **Simulating a Star printer:**
  ```sh
  URL="https://<project>.supabase.co/functions/v1/cloudprnt/<poll_token>"
  curl -s -X POST -H 'Content-Type: application/json' -d '{"statusCode":"200%20OK","printerMAC":"00:11:62:00:00:01"}' "$URL"
  curl -s "$URL?type=text/plain&token=<jobToken from above>"
  curl -s -X DELETE "$URL?code=200%20OK&token=<jobToken>"
  ```
- **Not verified on hardware yet:** the StarPRNT byte commands (reverse, emphasis, expansion) and the ePOS-XML attributes follow the vendors' published command references. Test the first real printer with **Test print**, and turn on **Plain text** if the styled ticket comes out garbled.

### Why not print straight from the browser to a LAN printer?

- **HTTPS pages calling the printer's own address:** Epson's ePOS SDK and Star's WebPRNT run into mixed-content blocking and the printer's self-signed certificate, which every device would have to trust by hand. They also hit Chrome's Local Network Access prompts. iPad Safari blocks it outright.
- **Raw port 9100:** web pages cannot open the raw socket that cheap LAN printers listen on.
- **Bridges:** a local print bridge (QZ Tray, about $749/year for support, or PrintNode at $9+/month) works. But it is one more thing to install, update and keep running.

The printer fetching its own tickets avoids all of this. It only needs internet.
