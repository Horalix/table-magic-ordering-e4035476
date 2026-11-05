/**
 * Tells Bing — and through it ChatGPT search and Copilot — Yandex, Seznam and
 * Naver that a site's pages are new or changed, through IndexNow, instead of
 * waiting for their crawlers to come round. Google takes no part; it reads
 * the sitemap.
 *
 *   npm run indexnow -- https://veraitalia.net
 *   npm run indexnow -- https://lasoul.net
 *
 * Run it after a deploy that changed what the pages say (a new dish, new
 * prices, the address or hours filled in). It submits every address in the
 * live sitemap.xml. The key is public by design: the site serves it at
 * /<key>.txt (public/), which is how the engines know the submission is the
 * site's own. Both sites serve the same file.
 */
const KEY = '5b1559719b577447885e9701dc41fd4f';

const arg = process.argv[2];
if (!arg) {
  console.error('Which site? e.g. npm run indexnow -- https://veraitalia.net');
  process.exit(1);
}
const site = new URL(arg);
const keyLocation = new URL(`/${KEY}.txt`, site).href;

// The engines fetch the key from the site; a deploy without it would be refused.
const served = await fetch(keyLocation).then((r) => (r.ok ? r.text() : ''));
if (served.trim() !== KEY) {
  console.error(`${keyLocation} does not serve the key yet: deploy first.`);
  process.exit(1);
}

const sitemap = await fetch(new URL('/sitemap.xml', site)).then((r) => r.text());
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  .filter((u) => new URL(u).host === site.host);
if (!urlList.length) {
  console.error(`No addresses in ${new URL('/sitemap.xml', site).href}.`);
  process.exit(1);
}

const res = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: site.host, key: KEY, keyLocation, urlList }),
});
// 200: received. 202: received, the key is still being checked (the first time).
const meaning = { 200: 'received', 202: 'received; the key is being checked', 400: 'malformed', 403: 'key not valid for this site', 422: 'addresses not on this site', 429: 'too many submissions — try later' };
console.log(`${site.host}: ${urlList.length} addresses — ${res.status} ${meaning[res.status] ?? res.statusText}`);
process.exit(res.ok ? 0 : 1);
