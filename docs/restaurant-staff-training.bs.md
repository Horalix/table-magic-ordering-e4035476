# Vodič za osoblje — La Soul naručivanje

Za konobare i kuhinju. Pročitajte ga prije probe, odštampajte ga i držite
primjerak kod pulta za izdavanje hrane.

Ekrani za osoblje su na engleskom, pa su riječi s ekrana ovdje ostavljene na
engleskom i **podebljane** — tačno onako kako ih vidite. Gosti vide meni na
bosanskom, engleskom ili arapskom; gdje se spominje ekran gosta, navedeno je
oboje.

Engleska verzija: [restaurant-staff-training.md](restaurant-staff-training.md).

---

## Vaši ekrani

Sve je na **lasoulapp.netlify.app** (kasnije lasoul.net).

| Ko | Otvara | Prijava |
|---|---|---|
| Konobar | `/waiter/login`, zatim ostaje na `/waiter` | Korisničko ime i lozinka koje dobije od menadžera |
| Tablet u kuhinji i na šanku | `/waiter/login` s kuhinjskim nalogom, zatim `/kitchen` | Kuhinjski nalog (npr. `kitchen`) |
| Ekran za salu (nije obavezan) | `/waiter/monitor` | Bilo koji nalog osoblja; svaki konobar dodirne svoje ime i četverocifreni **Floor PIN** |
| Menadžer | `/admin/login` | E-mail i lozinka |

Dodajte svoj ekran na početni ekran telefona, pa će se otvarati kao aplikacija.

---

## Prije svake smjene

**Menadžer**
- **Tonight**: dodirnite svaku sekciju i konobare koji je pokrivaju → **Done**.
  Svaki dan. Ako se to ne uradi, svaki sto se pojavljuje pod *No waiter yet*.

**Konobari**
- Prijavite se, otvorite `/waiter` i **ostavite ga otvorenog**. Telefon zvoni
  i vibrira samo dok je ovaj ekran otvoren — kad je zatvoren ili je telefon
  zaključan, obavještenja ne stižu.
- Podesite da ekran ostane upaljen što duže.
- Ako piše **Alerts are silent — tap to enable sound**, dodirnite to.

**Kuhinja i šank**
- Tablet na punjaču, podešen da se ekran nikad ne gasi (ako piše **Screen may
  sleep — set the tablet to never sleep**, promijenite to u postavkama
  tableta), zvuk pojačan.
- Izaberite stanicu: **All**, **Kitchen** ili **Bar**.
- Dodirnite **Test sound**. Ako piše **Sound blocked — tap to enable**,
  dodirnite to. Zvuk se sam ponovo uključi svaki put kad se stranica ponovo
  učita.
- **Printer:** ako restoran ima mrežni printer, ne radite ništa — štampa sam.
  Bez njega uključite ikonu printera na **samo jednom** tabletu po stanici.

**Svi:** oznaka pored vašeg imena ili broja narudžbi treba biti zelena.

| Oznaka | Znači | Uradite |
|---|---|---|
| **Live** | Sve stiže odmah | Ništa |
| **Connecting…** | Pokreće se | Sačekajte nekoliko sekundi |
| **Offline · retrying** | Nema veze. Ekran pokušava ponovo svakih 15 sekundi i nijedna narudžba se ne gubi | Provjerite Wi-Fi. Duže od minute: ponovo učitajte stranicu, pa javite menadžeru |

---

## Put jedne narudžbe

1. Gost pošalje narudžbu sa svog telefona.
2. Obično ide **pravo u kuhinju**: pojavi se *New order* uz zvuk, i odštampa
   se listić. Neke narudžbe prvo čekaju da ih konobar potvrdi — vidi
   *Narudžbe koje treba potvrditi* niže.
3. Kuhinja dodirne **Start**, pa **Ready**.
4. Konobaru zavibrira telefon: *Ready to run*. Odnesite hranu, dodirnite
   **Mark served**.
5. Gost zatraži račun s telefona ili vas pozove.
6. Naplatite i zabilježite: **Cash** ili **Terminal**.
7. Kad je sto platio i otišao: **Free table**.

Gosti ne plaćaju u aplikaciji (online plaćanje karticom još nije uključeno).
Svaka narudžba stiže kao **Owes · cash**; vi zabilježite kako je gost stvarno
platio.

---

## Konobari — vaš telefon

Na vrhu: vaše ime, koliko stolova imate, oznaka veze, **Floor** (ekran za
salu), dugme za zvuk i **Sign out**. Ispod toga: **Owed** (koliko vaši stolovi
još duguju), **In kitchen**, **Oldest wait**.

Zatim, odozgo prema dolje:

| Dio | Šta je u njemu |
|---|---|
| **Needs confirming** | Narudžbe koje čekaju vas prije nego što ih kuhinja vidi |
| **Attention needed** | Prvo hrana koja je gotova, pa pozivi konobara, pa zahtjevi za račun. Kad je prazno: *All caught up* |
| **In the kitchen** | Narudžbe vaših stolova koje se spremaju |
| **No waiter yet** | Stolovi s gostima koji nisu ni u čijoj sekciji — **Take**, i sto je vaš |
| **My tables** | Vaši stolovi, koliko koji duguje, **Cash** / **Terminal** i **Free table** |

**Nova narudžba** — jedna kratka vibracija i tihi zvuk, i pojavi se pod *In the
kitchen*. Dodirnite **Accept** da gost vidi da ju je konobar primijetio (nije
obavezno — kuhinja ne čeka na to).

**Hrana je gotova** — duga vibracija i zvuk, a narudžba stoji na vrhu kao
*Ready to run*. Odnesite je, pa **Mark served**.

**Poziv konobara** — zvuk i vibracija, kartica *Needs you*. Idite do stola,
pa dodirnite **Done**. Telefon vas podsjeća svakih 75 sekundi dok poziv neko
ne riješi.

**Zahtjev za račun** — kartica *Wants the bill*. Donesite račun i naplatite
(niže). **Bill given** samo briše zahtjev; sto ostaje otvoren.

**Sto koji niko nema** — ako poziv ili narudžba dođe sa stola bez konobara,
vidite *No waiter on table N* i **Take table**. Dodirnite: *Table N is yours*.
Ako je neko bio brži, piše ko ga ima.

### Naplata

1. U redu stola (*Owes … KM*) dodirnite **Cash** ili **Terminal**.
2. Provjerite pitanje: *Table 7: take 24.00 KM in cash?*
3. Dodirnite **Yes, 24.00 KM received** — ili, kod zahtjeva za račun,
   **24.00 KM received + free table 7** ako gosti odlaze.

**Koristite pravo dugme.** Na kraju večeri gotovina se poredi s kasom, a
terminal s presjekom (batch) kartičnog terminala; ako se pomiješaju, dan se
neće slagati. Naplata zabilježena ovdje ne može se poništiti s telefona —
javite menadžeru ako ste pritisnuli pogrešno dugme.

### Oslobađanje stola

**Free table** → *Free table 7?* → **Free table**. Ovim se završava sesija
gostiju: da bi ponovo naručili, moraju opet skenirati QR kod. Ne može dok sto
duguje (*Table 7 still owes … KM*) — prvo zabilježite naplatu.

### Ekran za salu (`/waiter/monitor`)

Zajednički tablet koji prikazuje cijelu salu. Dodirnite svoje ime, unesite PIN
i vidite svoje stolove: **Free**, **Seated**, **Ready**, **Calling**,
**Bill**. Dodirnite sto za **I'll go** (da ostali znaju da idete vi),
**Done**, **Bill given**, **Cash** / **Terminal** i **Guests have gone — free
the table**. Nakon 5 minuta bez dodira vraća se na spisak imena.

---

## Kuhinja i šank — tabla

Tri kolone: **New**, **Preparing**, **Ready**. Kartica izgleda otprilike
ovako:

```
 INSIDE  Table 7  NEW  #047  (Amina)  + bar  [Owes · cash]        ! 9m
   2× La Soul Burger                                         [Start]
      ⚠ bez luka
      Allergens: gluten, dairy
   1× French Fries                                           [Start]
   Note: rođendan — donesite svijeću
```

| Dio | Znači |
|---|---|
| **Table 7** | Gdje ide |
| **#047** | Broj narudžbe — gost vidi isti broj na svom telefonu |
| **(Amina)** | Ko je naručio |
| **+ bar** | Za istu narudžbu dolazi i piće sa šanka |
| **⚠ …** i **Allergens: …** | Pročitajte svaku. Ovdje su alergije |
| **!** / **!!** / **!!!** | Čeka 8 / 15 / 25 minuta ili duže; na vrhu kartice je narandžasta ili crvena traka |

**Nova narudžba** — obavještenje *New order* sa stolom i brojem, i zvuk koji
se ponavlja svakih 30 sekundi dok neko ne dodirne **Got it**.

**Priprema** — svaka stavka: **Start** → **Ready** → **✓ Up**. Ili za cijelu
karticu: **Start all**, **All ready**, pa **Mark served** kad je hrana
izašla.

**Pogriješili ste?** **Undo** radi 90 sekundi — na stavci, na kartici ili na
vrhu ekrana.

**Ekran za šank** — prikazuje samo pića. Piće koje je dio kombinacije (combo)
prikazuje se kao *· part of …*, uz to dokle je stigla kuhinja; tu narudžbu
dalje pomjera kuhinja.

**Void** — za narudžbu koja se neće praviti: razlog je obavezan → **Void
order**. Prije nego što kuhinja počne i dok nije plaćena, može bilo ko;
poslije toga mora menadžer.

**Prikazi** — **Board** (narudžbe uživo), **All day** (koliko kojeg jela
ukupno čeka) i **History**.

**Tastatura ili bump bar** — **1–9** bira listić, strelice se pomjeraju između
listića, **Enter** ga pomjera korak dalje, **U** ili **Backspace** poništava,
**P** ponovo štampa, **F** prebacuje na cijeli ekran.

**Pozivi i računi** se prikazuju i na vrhu table: *Waiter Calls* (✕ ga briše)
i *Bill Requests* (✓ pita da li **Free table** ili **Just clear the
request**). Konobari ovo obično rješavaju sa svojih telefona.

---

## Narudžbe koje treba potvrditi

Neke narudžbe čekaju konobara prije nego što ih kuhinja vidi. Pojavljuju se na
vrhu telefona konobara, kuhinjske table i ekrana za salu kao **Needs
confirming**: *Not printed yet. Check someone is at the table, then confirm.*
Na telefonu gosta piše *Narudžba je primljena — Vaš konobar će je potvrditi
za trenutak* (na engleskom: *Order received — Your waiter will confirm it in a
moment*).

| Razlog na ekranu | Zašto |
|---|---|
| **Large first order** | Prva narudžba stola je preko 60 KM ili preko 10 porcija |
| **Over 150 KM unpaid** | Sto već duguje mnogo |
| **Outside opening hours** | Poslano prije otvaranja ili poslije zatvaranja |
| **Joined without approval** | Telefon se pridružio stolu, a niko za stolom nije potvrdio |
| **Second session on table N** | Dvije odvojene grupe naručuju na istom broju stola |
| **Many new tables at once** | Mnogo stolova otvoreno odjednom — možda kruži slika QR koda |
| **Table was blocked recently** | Osoblje je blokiralo ovaj sto u posljednjih sat vremena |

Idite do stola, provjerite da je narudžba stvarna, pa:

- **Confirm** → *Table 7 confirmed — sent to the kitchen*, i listić se
  odštampa.
- **Reject** → upišite razlog → **Reject order**.
- **Block table** (samo kod sumnjivih razloga) → **Block table**. Sve
  neodštampane narudžbe te sesije se otkazuju, sesija se završava, a ti
  telefoni više ne mogu naručivati. **Samo ako za stolom zaista niko ne
  sjedi.**

Čim je neko od osoblja bilo šta uradio za sto — preuzeo ga, prihvatio ili
počeo narudžbu, riješio poziv, zabilježio naplatu — sljedeće narudžbe s tog
stola idu pravo u kuhinju.

---

## Oznake plaćanja

Oznaka govori da li je novac stigao. **„Card" ne znači plaćeno.**

| Oznaka | Novac stigao? | Uradite |
|---|---|---|
| **Paid · cash** | Da | Ništa |
| **Paid · terminal** | Da | Ništa |
| **Paid online** | Da | Ništa — **ne** naplaćujte ponovo |
| **Owes · cash** | Ne | Donesite račun; kad plate, zabilježite **Cash** ili **Terminal** |
| **Owes · bring terminal** | Ne | Donesite kartični terminal |
| **Owes · card online** | Ne | Gost plaća na svom telefonu |
| **Online payment pending** | **Ne** | Još nije plaćeno. Obično se riješi za nekoliko sekundi |
| **Payment problem** | Ne | Kartica nije terećena, a narudžba **nije** u kuhinji |
| **Refunded** / **Part refunded** | Vraćeno | Pitajte menadžera |

### Kad se uključi online plaćanje karticom (još nije)

Narudžba plaćena karticom na telefonu gosta **ne stiže u kuhinju dok novac ne
stigne.**

- Gost kaže „platio sam karticom", a vi ne vidite narudžbu: plaćanje nije
  završeno. Zamolite gosta da vam pokaže telefon.
- Na telefonu piše *Još potvrđujemo* (*Still confirming*): nemojte naplatiti
  drugi put. Zapišite broj narudžbe i javite menadžeru.
- Na telefonu piše *Plaćanje nije završeno* (*Payment was not completed*):
  kartica nije terećena. Gost može izabrati *Radije plati za stolom* (*Pay at
  the table instead*).

---

## Problemi sa štampanjem

| Šta vidite | Uradite |
|---|---|
| Na kartici piše *Did not print* | Dodirnite **Reprint** na kartici |
| **PRINTER STUCK — n waiting · Retry** | Provjerite papir i napajanje, pa dodirnite **Retry** |
| *n tickets failed to print* | Ponovo odštampajte svaki listić s njegove kartice |
| Printer pokazuje *Offline — last seen … min ago* | Provjerite napajanje i mrežni kabl. Tabla radi i dalje: čitajte narudžbe s ekrana |
| Listić se odštampao dvaput | Ne bi smjelo da se desi. Javite menadžeru |

Ponovo odštampan listić s tableta označen je s `*** REPRINT ***`, da ga niko
ne napravi dvaput.

---

## Kad nestane interneta

**Gosti** dobiju jasnu poruku: *Vaša narudžba nije poslana i ništa nije
naplaćeno* (*Your order was not sent. Nothing was charged*). Aplikacija nikad
ne kaže da je narudžba prošla ako nije.

**Kuhinja:** na tabli piše *No connection — this board was last updated at …*
i pokušava ponovo. Ništa što je već poslano se ne gubi; sve se pojavi čim se
veza vrati.

**Svi:** primajte narudžbe na papir dok oznaka ponovo ne pokaže **Live**.

---

## Zatvaranje — menadžer

1. **Daily Report**: pročitajte *Needs attention before close* — novac koji se
   još duguje, plaćanja karticom koja su počela i nisu završena, problemi s
   plaćanjem, povrati novca.
2. Svaka narudžba iz aplikacije otkuca se na **fiskalnoj kasi** kao i uvijek —
   aplikacija nije fiskalni uređaj. Zatim u **Orders**: **Mark fiscalized** →
   *Fiscal receipt number* → **Record receipt**.
3. Kasu (gotovinu) uporedite s **Cash**, presjek terminala s **POS terminal** —
   svako posebno.
4. **Close the day**: upišite izbrojanu gotovinu i iznos s terminala. Razlika
   se zapiše, nikad se „ne namješta".

---

## Brzi odgovori

**„Mogu li otkazati narudžbu?"** Konobari ne mogu s telefona. U kuhinji:
**Void** s razlogom, dok nije počela i dok nije plaćena. Poslije toga —
menadžer.

**„Mogu li obrisati narudžbu?"** Ne. Narudžbe se otkazuju, nikad ne brišu, da
bi se dan i dalje slagao.

**„Gost želi još nešto dodati."** Naruči ponovo sa svog telefona; ide na isti
račun stola.

**„Još neko za stolom želi naručiti."** Skenira isti QR kod; neko ko je već
za stolom dobije *… želi se pridružiti vašem stolu* (*… wants to join your
table*) i dodirne *Prihvati* (*Accept*). Ako niko ne odgovori, pušta ga se za
par minuta, a njegova prva narudžba čeka vašu potvrdu.

**„Gdje se zove konobar / traži račun?"** *Pozovi konobara* (*Call Waiter*) je
na vrhu prve stranice menija. *Zatraži račun* (*Request Bill*) je na stranici
*Vaš račun* (*Your Tab*).

**„Piše da je QR kod nevažeći ili je istekao."** Kod je star, ili je sesija
gosta završena. Pomozite im da ponovo skeniraju kod na stolu; u međuvremenu
mogu *Pogledaj meni bez naručivanja* (*Just browse the menu*).

**„Piše da je naručivanje pauzirano."** (*Naručivanje je pauzirano* /
*Ordering is paused*) Menadžer je zaustavio naručivanje s telefona. Primite
narudžbu vi.

**„Gost ne može nešto pronaći."** Pretraga na vrhu menija nalazi jela po
nazivu na sva tri jezika. Dugme s globusom gore desno mijenja jezik.

**„Gost kaže da mu je naplaćeno dvaput."** Zapišite broj narudžbe. Ne vraćajte
novac preko terminala. Pozovite menadžera — povrat se bilježi u aplikaciji da
bi se dan slagao.
