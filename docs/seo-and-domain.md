# SEO, AEO and GEO — what is built, and the day lasoul.net moves here

La Soul's website (`/`, `/bs/`, `/ar/`) and menu (`/menu/lasoul/`) are built to
be found by search engines (SEO), quoted by answer engines such as Google's AI
answers, ChatGPT, Perplexity and Claude (AEO/GEO), and to replace the old
lasoul.net without losing what it had.

The app is hosted on **Netlify** at `https://lasoulapp.netlify.app`. Netlify
builds and deploys every push to `main` by itself (including the prerendered
pages below, made with the live menu at build time); nothing has to be
published by hand.

## What is built

| | Where | Why it matters |
|---|---|---|
| **Real HTML for every public page** | `scripts/seo-prerender.ts` (runs in `vite build`) | Most AI crawlers do not run JavaScript; to them a React app was an empty page. Every public page is now written as HTML with its real words: the website in 3 languages, the menu, 3 category pages and **a page for every dish** (166) |
| **A page per dish** | `/menu/lasoul/dish/<name>/` | Ranks for "San Sebastian cheesecake Sarajevo"-style searches; each has photo, price in KM, description in 3 languages, allergens, halal, and links to its neighbours. People who open it land on the dish, open, on the real menu |
| **Structured data (schema.org)** | `src/lib/seo/structured-data.ts` | Restaurant + CafeOrCoffeeShop with address, map pin, hours, phone, Instagram, Google Maps listing, price range, payment; the full **Menu** with every dish marked **HalalDiet** and priced in BAM; **FAQPage**; breadcrumbs; WebSite |
| **FAQ on the page** | `src/components/site/SiteFaq.tsx` | Halal, alcohol, where, hours, ordering at the table, languages, what is on the menu, contact — the questions answer engines get asked, answered in one sentence each, identical in the structured data |
| **Language addresses** | `/`, `/bs/`, `/ar/` with `hreflang` | Bosnian searches find the Bosnian page, Arabic-speaking visitors the Arabic one; a shared link opens in its language |
| **One address per page** | `src/lib/venues.ts` (`menuPath`, `menuCategoryPath`) | Every page address ends in `/`, the form Netlify serves a prerendered page at (it redirects `/bs` to `/bs/`). Canonical links, hreflang, the sitemap, structured data, llms.txt and every link in the app use that form, so search engines never meet a redirect or two addresses for one page |
| **Head tags** | every page | Title, description, canonical, Open Graph + Twitter cards (a dish's own photo on its page), `geo.*` tags with the map pin |
| **robots.txt** | generated | Welcomes Google, Bing and the AI crawlers (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Applebot…); keeps admin, kitchen, waiter, cart and table pages out |
| **sitemap.xml** | generated | Every public page, language alternates, and **dish photos** for Google Images |
| **llms.txt, llms-full.txt** | generated | The emerging standard summary for AI engines: the facts, the FAQ and the whole menu with prices, as text |
| **Old addresses** | `public/_redirects` (Netlify reads it) | The old lasoul.net pages (`/en/home`, `/bs/home`, `/ar/home`) and the old menu.lasoul.net pages redirect permanently to their new homes in one hop |

The facts all come from one place: `src/lib/venues.ts` (address, phone, hours
11:00–21:00 every day, Instagram @lasoul.bih, map pin, the Google Maps listing
name). Change a fact there and the website, structured data, sitemap and
llms.txt all follow on the next deploy.

## The day lasoul.net points here

1. **Domain.** In Netlify: Site configuration → Domain management → Add a
   domain → `lasoul.net`, and set it as the **primary domain** (Netlify then
   redirects `www.lasoul.net` and `lasoulapp.netlify.app` to it). Add
   `menu.lasoul.net` as a domain alias too, so the old menu's printed QR codes
   keep working. At the domain registrar, add the DNS records Netlify shows
   (or move the nameservers to Netlify DNS). Netlify issues the HTTPS
   certificate by itself. The old site (another developer's) is replaced;
   nothing from it needs to be kept.
2. **One line.** `src/lib/seo/site-url.ts`: change `SITE_URL` to
   `'https://lasoul.net'` and push to `main`; Netlify redeploys. Canonical
   links, the sitemap, structured data and llms.txt then all name lasoul.net.
3. **Check the redirects**: open `https://lasoul.net/en/home` — it must land
   on `https://lasoul.net/`; `https://menu.lasoul.net/food/burgers.html` must
   land on the burgers on the new menu.
4. **Google Search Console** (search.google.com/search-console): add
   `lasoul.net` as a Domain property (a DNS TXT record), submit
   `https://lasoul.net/sitemap.xml`, and use URL Inspection on `/`, `/bs/`,
   `/menu/lasoul/` to request indexing. If the Netlify address was added
   earlier, its pages move over by themselves through the redirect.
5. **Bing Webmaster Tools** (bing.com/webmasters): import from Search Console,
   submit the sitemap. Bing also feeds ChatGPT's and Copilot's search.
6. **Google Business Profile** for "La Soul Cafe & Burger Boutique": set the
   website to `https://lasoul.net/`, the menu link to
   `https://lasoul.net/menu/lasoul/`, check the hours (11:00–21:00), category
   (Café / Burger restaurant), attributes (halal, no alcohol), and add recent
   photos. This is the single strongest signal for "near me" and map
   searches, and answer engines read it.
7. **Instagram bio**: link to `https://lasoul.net/`.
8. **Ask happy guests for Google reviews** — rating and recency are what local
   search and AI answers weigh most, and they cannot be faked or invented here.

Until then the Netlify address works as the real site: everything above names
`https://lasoulapp.netlify.app`, so it can already be submitted to Search
Console (as a URL-prefix property) if the owners want a head start.

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
