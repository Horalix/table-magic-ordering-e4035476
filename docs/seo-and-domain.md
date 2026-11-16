# SEO, AEO and GEO — what is built, and the day lasoul.net moves here

La Soul's website (`/`, `/bs/`, `/ar/`) and menu (`/menu/lasoul/`) are built to
be found by search engines (SEO), quoted by answer engines such as Google's AI
answers, ChatGPT, Perplexity and Claude (AEO/GEO), and to replace the old
lasoul.net without losing what it had.

The app is hosted on **Netlify** (the `lasoulapp` project) and answers at
`https://lasoul.net` since 2026-11-05, as well as at
`https://lasoulapp.netlify.app`. Netlify
builds and deploys every push to `main` by itself (including the prerendered
pages below, made with the live menu at build time); nothing has to be
published by hand.

## What is built

| | Where | Why it matters |
|---|---|---|
| **Real HTML for every public page** | `scripts/seo-prerender.ts` (runs in `vite build`) | Most AI crawlers do not run JavaScript; to them a React app was an empty page. Every public page is written as HTML with its real words, **in each of the three languages at its own address** (below): the website, the menu, each category, **a page for every dish**, the booking page and the privacy notice — 502 pages for La Soul from the menu of 16 November 2026 (158 dishes × 3) |
| **A page per dish** | `/menu/lasoul/dish/<name>/`, `/bs/menu/lasoul/dish/<name>/`, `/ar/menu/lasoul/dish/<name>/` | Ranks for "San Sebastian cheesecake Sarajevo"-style searches, and for the Bosnian and Arabic names; each has photo, price in KM, its description, allergens, halal, its names in the other two languages as one "also called" line, and links to its neighbours. People who open it land on the dish, open, on the real menu |
| **Photographs in the HTML** | `src/lib/seo/static-pages.ts` | The home page's first photograph and each signature dish, a 240 px square of every dish on the menu and category pages, the dish's own photo on its page: real `<img>` with size and alt text in the page's language, for image search and readers that run no script. All `loading="lazy"`: the app hides this HTML when it runs, and a lazy image in a hidden element is never fetched, so visitors download none of them |
| **Structured data (schema.org)** | `src/lib/seo/structured-data.ts` | Restaurant + CafeOrCoffeeShop with address, map pin, hours, phone, Instagram, Google Maps listing, price range, payment; the full **Menu** with every dish marked **HalalDiet** and priced in BAM; **FAQPage**; breadcrumbs; WebSite |
| **FAQ on the page** | `src/components/site/SiteFaq.tsx` | Halal, alcohol, where, hours, ordering at the table, languages, what is on the menu, contact — the questions answer engines get asked, answered in one sentence each, identical in the structured data |
| **Reserving a table** | `/reserve/`, `src/lib/seo/reservations.ts` | Only while the restaurant takes requests online (Admin → Reservations): the booking page is listed under its own title, the restaurant's structured data says `acceptsReservations` with a `ReserveAction`, the home page and `llms.txt` say how, and the sitemap has the page. Off, none of it is there and the page says `noindex`. Written at build time from the live database; the sites publish themselves again within the hour of the switch changing (docs/reservations.md, "Where guests find it") |
| **Language addresses** | `src/lib/seo/locale-path.ts` | Every public page in English at its usual address, in Bosnian under `/bs/` and in Arabic under `/ar/`, the same path after the prefix. Each names all three and `x-default` with `hreflang` and is its own canonical. Bosnian searches find the Bosnian page, Arabic-speaking visitors the Arabic one; a shared link opens in its language. See "Pages in three languages" below |
| **Questions from the live menu** | `src/lib/seo/menu-faq.ts` | The home page also answers what the menu can: signatures with prices, breakfast, a kids' menu, pizza, what a burger, a coffee or a cake costs, vegetarian dishes (only those the menu marks so). Built from the live menu at publish time, written into the pages and into `/site-facts.json`, which the live home page reads, so the page, its FAQPage data and the prerendered HTML say the same words |
| **A dish that is gone answers 404** | `public/_redirects` | An address under `/menu/<venue>/dish/` (and its `/bs/`, `/ar/` forms) with no page is served the app with "404 Not Found": a dish added since the last publish still opens for a person, a dish that was removed drops out of search instead of lingering as a "soft 404" |
| **One address per page and language** | `src/lib/venues.ts` (`menuPath`, `menuCategoryPath`) | Every page address ends in `/`, the form Netlify serves a prerendered page at (it redirects `/bs` to `/bs/`). Canonical links, hreflang, the sitemap, structured data, llms.txt and every link in the app use that form, so search engines never meet a redirect or two addresses for one page |
| **Head tags** | every page | Title, description, canonical, Open Graph + Twitter cards (a dish's own photo on its page), `geo.*` tags with the map pin |
| **robots.txt** | generated | Welcomes Google, Bing and the AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot…); keeps admin, kitchen, waiter, cart and table pages and a guest's own reservation (`/reservation/…`) out |
| **sitemap.xml** | generated | Every public page, language alternates, and **dish photos** for Google Images |
| **llms.txt, llms-full.txt** | generated | The emerging standard summary for AI engines: the facts, the FAQ and the whole menu with prices, as text |
| **IndexNow** | `npm run indexnow -- https://veraitalia.net` (or the La Soul address), key in `public/<key>.txt` | Tells Bing — whose index ChatGPT search and Copilot read — and Yandex, Seznam and Naver that pages changed, the same day, instead of waiting for a crawl. Run it after a deploy that changes what the pages say. Google takes no part: it reads the sitemap |
| **Old addresses** | `public/_redirects` (Netlify reads it) | The old lasoul.net pages (`/en/home`, `/bs/home`, `/ar/home`) and the old menu.lasoul.net pages redirect permanently to their new homes in one hop |

The facts all come from one place: `src/lib/venues.ts` (address, phone, hours
11:00–21:00 every day, Instagram @lasoul.bih, map pin, the Google Maps listing
name). Change a fact there and the website, structured data, sitemap and
llms.txt all follow on the next deploy.

## Pages in three languages

**The addresses.** English keeps the addresses the site always had. Bosnian
is the same address under `/bs/`, Arabic under `/ar/`:

| | English | Bosnian | Arabic |
|---|---|---|---|
| Website | `/` | `/bs/` | `/ar/` |
| Menu | `/menu/lasoul/` | `/bs/menu/lasoul/` | `/ar/menu/lasoul/` |
| A category | `/menu/lasoul/food/` | `/bs/menu/lasoul/food/` | `/ar/menu/lasoul/food/` |
| A dish | `/menu/lasoul/dish/spanish-latte/` | `/bs/menu/lasoul/dish/spanish-latte/` | `/ar/menu/lasoul/dish/spanish-latte/` |
| Booking | `/reserve/` | `/bs/reserve/` | `/ar/reserve/` |
| Privacy | `/privacy/` | `/bs/privacy/` | `/ar/privacy/` |

Slugs are the same in every language (made from the English name), so a
page's other versions are found by swapping the prefix. Vera Italia's own
site (veraitalia.net) has the same shape for its pages.

**What each page carries.** `<html lang>` (and `dir="rtl"` in Arabic),
`og:locale`, its own canonical, `hreflang` for all three and `x-default` (the
English address) — the same set on every member of a family, as Google asks
(developers.google.com/search/docs/specialty/international/localized-versions).
Its words are its language's: titles and descriptions follow the English
patterns in `src/lib/site-copy.ts` and `src/lib/reservation-copy.ts`; dish and
category names and descriptions come from the database's `name_bs`/`name_ar`
columns, and where a translation is missing the English is used for that
field rather than leaving it empty. The fixed words around them ("Allergens",
"Also called", "Open … on the menu") are in `src/lib/seo/page-copy.ts`. The
sitemap lists every address with its alternates and the dish photos.

**In the app.** A prefixed address opens the same screen in its language
before the first paint, whatever the phone had saved
(`src/lib/seo/AddressLanguage.tsx`), and when the visitor changes language
there the address follows (`/bs/…` → `/ar/…`, or to the unprefixed address
for English; query and hash kept). Inside the app, links keep going to the
unprefixed addresses and the language stays with the visitor; table ordering
is untouched. The head is kept by one rule in `usePageMeta`
(`src/lib/seo/page-meta.ts`, `headFor`): a page shown in a language names
that language's address as canonical and its whole family. So each of the
three addresses, opened fresh by a crawler that runs JavaScript, ends with
the same title, description, canonical and hreflang its HTML had.

One case differs, as it always has: a phone set to Bosnian (or with Bosnian
saved) that opens an **English** address sees the page in Bosnian, and its
head then names the Bosnian address as canonical, the page it is showing.
Crawlers send no saved language and read English there.

**Adding a language** (say German, `de`): add it to `Locale` in
`src/lib/i18n.ts` and to every trilingual table (`site-copy.ts`,
`reservation-copy.ts`, `page-copy.ts`, `menu-faq.ts`, the Vera copy), add
`'de'` to `PREFIXED_LOCALES` in `src/lib/seo/locale-path.ts` and to `LOCALES`
in `structured-data.ts`, its `og:locale` in `static-pages.ts` and
`page-meta.ts`, the `/de/…` routes in `src/App.tsx` (the test in
`languages.test.ts` lists them) and the `/de/…` rules in `public/_redirects`
(`appRedirects` writes Vera Italia's). The build then writes every page in it.

**Adding a restaurant with its own site**: its facts in `src/lib/venues.ts`
(a fact not known stays null and is left out everywhere), its address in
`src/lib/seo/site-url.ts`, and a module like `vera-seo.ts` that builds its
pages for each language with `localePath` and `languageAlternates`.

**After this reaches the live site** (first publish with the new pages):
submit `https://lasoul.net/sitemap.xml` and `https://veraitalia.net/sitemap.xml`
again in Google Search Console and Bing Webmaster Tools, use URL Inspection
on `/bs/menu/lasoul/` and `/ar/menu/lasoul/` to ask for indexing, and run
`npm run indexnow -- https://lasoul.net` (and Vera Italia's). Search Console's
"International targeting" report shows hreflang errors, if any, within a few
weeks.

## Moving lasoul.net here — website, menu and QR codes, email untouched

Where everything is today (public DNS, November 2026):

- **Registrar:** Namecheap. Its DNS is served by the old hosting account
  (`dns1/dns2.namecheaphosting.com`), so the records are edited in that
  account's cPanel → **Zone Editor**, not at the registrar.
- **Old website and old menu:** `lasoul.net`, `www` and `menu` all point at
  the old hosting, 68.65.121.200. The restaurant's printed QR codes open
  `menu.lasoul.net`.
- **Email:** MX `mx1/mx2/mx3-hosting.jellyfish.systems`, an SPF and a DKIM
  record, plus `mail`, `webmail`, `autodiscover` and `autoconfig`, also on the
  old hosting. None of these change, and the hosting must stay paid for as
  long as it holds the email.

Afterwards, `lasoul.net` is the website, `menu.lasoul.net/` opens the menu
at `lasoul.net/menu/lasoul/` (every menu.lasoul.net address forwards to
lasoul.net for good since 2026-11-05, so search engines move what it had
earned to lasoul.net; the first rules in `public/_redirects`), every old menu page (`/menu.html`,
`/food/burgers.html` …) lands on the same dishes, and every old website page
(`/`, `/home`, `/en`, `/en/home`, `/bs/home`, `/ar/home`) lands on the new
website in its language. `lasoulapp.netlify.app` keeps answering (Netlify
does not redirect it), so the TV, the staff screens and any QR code printed
with it keep working.

1. **Menu only first**, while the owner has not decided to take orders through
   the app: Admin → Service → Menu only. The website then promises no
   ordering from the table either (`src/lib/seo/ordering.ts`).
2. **Netlify** (the `lasoulapp` project): Domain management → Add a domain →
   `lasoul.net` (Netlify adds `www.lasoul.net` with it) and make it the
   **primary domain**; then add `menu.lasoul.net` as a domain alias. Nothing
   changes for anyone until the DNS below does.
3. **DNS, after closing time (21:00)**, in cPanel → Zone Editor → lasoul.net.
   Change exactly these three, and nothing else:

   | Name | Now | Change to |
   |---|---|---|
   | `lasoul.net` | A `68.65.121.200` | A `75.2.60.5` (Netlify's load balancer) |
   | `www` | CNAME `lasoul.net` | CNAME `lasoulapp.netlify.app` |
   | `menu` | A `68.65.121.200` | delete it; add CNAME `lasoulapp.netlify.app` |

   If cPanel refuses the CNAME with "CNAME and other data", the subdomain
   still has an SPF TXT row named `menu.lasoul.net.` (cPanel made it with the
   subdomain). Delete that row only (the `lasoul.net.` SPF row stays), then
   add the CNAME. That is what happened on 2026-11-05.

   Every MX, `mail`, `webmail`, `cpanel`, `autodiscover`, `autoconfig` and TXT
   record stays as it is. `ftp` follows `lasoul.net`, so it stops reaching the
   old hosting; nothing needs it.
4. **HTTPS.** Netlify issues the certificate once the names point at it,
   usually within the hour (Domain management → HTTPS). Phones that remember
   the old address see the old site for a few hours, never an error page.
5. **One line.** `src/lib/seo/site-url.ts`: La Soul's address becomes
   `'https://lasoul.net'` (prepared on a branch, merged once lasoul.net
   answers from Netlify), so canonical links, the sitemap, structured data,
   llms.txt and the staff sign-in links name it. Then
   `npm run indexnow -- https://lasoul.net`.
6. **Check:** `https://lasoul.net/` is the website, `https://www.lasoul.net/`
   lands on it, `https://lasoul.net/en/home` lands on `/`,
   `https://menu.lasoul.net/` opens the menu,
   `https://menu.lasoul.net/food/burgers.html` lands on the burgers,
   `https://lasoul.net/tv/` is the entrance TV's board, and an email to the
   restaurant still arrives.
7. **Google Search Console** (search.google.com/search-console): add
   `lasoul.net` as a Domain property (a DNS TXT record, added in the same Zone
   Editor), submit `https://lasoul.net/sitemap.xml`, and use URL Inspection on
   `/`, `/bs/`, `/menu/lasoul/` to request indexing.
8. **Bing Webmaster Tools** (bing.com/webmasters): import from Search Console,
   submit the sitemap. Bing also feeds ChatGPT's and Copilot's search.
9. **Google Business Profile** for "La Soul Cafe & Burger Boutique": set the
   website to `https://lasoul.net/`, the menu link to
   `https://lasoul.net/menu/lasoul/`, check the hours (11:00–21:00), category
   (Café / Burger restaurant), attributes (halal, no alcohol), and add recent
   photos. This is the single strongest signal for "near me" and map
   searches, and answer engines read it.
10. **Instagram bio**: link to `https://lasoul.net/`.
11. **Ask happy guests for Google reviews** — rating and recency are what
    local search and AI answers weigh most, and they cannot be faked or
    invented here.

**Moving the domain to another registrar** (Spaceship, say) is not needed for
any of this, and is best left for after. A transfer can switch the nameservers
to the new registrar's with only the records set up there in advance, which
would stop the email. Either keep the nameservers
`dns1.namecheaphosting.com` / `dns2.namecheaphosting.com`, or copy every
record from the Zone Editor across first.

## Keep in mind

- Hours: confirm 11:00–21:00 is still right (it is what the old site said). If
  days differ, `hours` in `venues.ts` takes several runs, e.g. weekdays and
  weekends.
- Name: Google Maps lists "La Soul Cafe & Burger Boutique"; the old site said
  "Coffee & Burger Boutique"; the new site says "Cake & Burger Boutique". All
  three are listed as alternate names in the structured data, but one name
  everywhere (site, Maps, Instagram) is better — the owners should choose.
- Real interior photos and a short "who we are" from the owners would add the
  one thing structured data cannot: first-hand details.
