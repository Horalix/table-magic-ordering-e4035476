import { test, expect } from './staff-fixtures';
import type { Page, Route } from '@playwright/test';

/**
 * Table reservations: a guest asks on the restaurant's website (/reserve/),
 * the admin answers on Admin → Reservations, and the guest's own page
 * (/reservation/<id>) shows the answer by itself (src/lib/reservations.ts,
 * supabase/migrations/20261113090000_reservations.sql). And what search
 * engines find at each of those addresses (src/lib/seo/reservations.ts).
 *
 * The database is stubbed: what it would refuse or allow is covered by
 * supabase/tests/reservations.test.ts. Here: what each person sees and what
 * the pages ask the database for.
 */

const json = (route: Route, body: unknown, status = 200, headers: Record<string, string> = {}) => route.fulfill({
  status, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range', ...headers },
  body: JSON.stringify(body),
});

const OPTIONS = {
  enabled: true, venue: 'lasoul', open: '11:00', close: '21:00', max_party: 10, days_ahead: 30, lead_minutes: 60,
  phone: '+387 33 877 779', note: 'We hold a table for 15 minutes.', today: '2026-11-13', now: '10:00',
};
const KEY = { id: '7b1f6a52-0d5e-4d0f-9a43-1c7f3a2e9b10', token: 'a'.repeat(64) };

const mine = (over: Record<string, unknown> = {}) => ({
  id: KEY.id, code: 'R48213', venue: 'lasoul', status: 'pending', name: 'Amina Hadžić', party_size: 4,
  day: '2026-11-14', time: '19:30', note: 'By the window', reply: null, cancelled_by: null,
  asked_at: new Date().toISOString(), waited_seconds: 20, phone: '+387 33 877 779', ...over,
});

interface Guest {
  options: Record<string, unknown>;
  /** What guest_request_reservation was sent, each time. */
  asked: Record<string, unknown>[];
  /** What it answers: a key, or a refusal word. */
  refuse: string | null;
  reservation: Record<string, unknown> | null;
}

async function guestStubs(page: Page, over: Partial<Guest> = {}): Promise<Guest> {
  const guest: Guest = { options: OPTIONS, asked: [], refuse: null, reservation: mine(), ...over };
  await page.route('**/rest/v1/rpc/guest_reservation_options', (route) => json(route, guest.options));
  await page.route('**/rest/v1/rpc/guest_request_reservation', (route) => {
    guest.asked.push(route.request().postDataJSON());
    return guest.refuse
      ? json(route, { code: '22023', message: `RESERVATION:${guest.refuse}` }, 400)
      : json(route, { ...KEY, code: 'R48213', status: 'pending' });
  });
  await page.route('**/rest/v1/rpc/guest_reservation', (route) => json(route, guest.reservation));
  await page.route('**/rest/v1/rpc/guest_cancel_reservation', (route) => {
    guest.reservation = { ...guest.reservation, status: 'cancelled', cancelled_by: 'guest' };
    return json(route, guest.reservation);
  });
  return guest;
}

/** A day, a time and how many are each one tap among a few: the group, the one chosen, and choosing another. */
const group = (page: Page, name: string) => page.getByRole('radiogroup', { name });
const chosen = (page: Page, name: string) => group(page, name).locator('[aria-checked="true"]');
const pick = (page: Page, name: string, value: string) => group(page, name).locator(`[data-value="${value}"]`).click();

const fill = async (page: Page, name = 'Amina Hadžić', phone = '+387 61 123-456') => {
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Phone number').fill(phone);
};

test.describe('a guest asks for a table', () => {
  test('picks a day, a time and how many, and is taken to their own page', async ({ page }) => {
    const guest = await guestStubs(page);
    await page.goto('/reserve');
    await expect(page.getByRole('heading', { level: 1, name: 'Reserve a table' })).toBeVisible();
    await expect(page.getByText('We hold a table for 15 minutes.')).toBeVisible();

    // The restaurant's own day first, and dinner time where the day still has it.
    await expect(chosen(page, 'Day')).toHaveAttribute('data-value', '2026-11-13');
    await expect(chosen(page, 'Time')).toHaveAttribute('data-value', '19:00');
    await expect(chosen(page, 'Guests')).toHaveAttribute('data-value', '2');
    await pick(page, 'Day', '2026-11-14');
    await pick(page, 'Time', '19:30');
    await pick(page, 'Guests', '4');
    // What is being asked for, in one line, before it is sent.
    await expect(page.getByTestId('reserve-summary')).toContainText('Saturday 14 November · 19:30 · Guests: 4');
    await fill(page);
    await page.getByLabel(/Anything we should know/).fill('By the window');
    await page.getByRole('button', { name: 'Ask for this table' }).click();

    await expect(page).toHaveURL(new RegExp(`/reservation/${KEY.id}\\?t=${KEY.token}$`));
    await expect(page.getByTestId('reservation-status')).toHaveText('We have your request');
    expect(guest.asked).toEqual([{
      _venue: 'lasoul', _name: 'Amina Hadžić', _phone: '+387 61 123-456', _party: 4, _day: '2026-11-14', _time: '19:30',
      _note: 'By the window', _locale: 'en', _trap: null,
    }]);
  });

  test('today offers only what is far enough ahead, and a day with nothing left says so', async ({ page }) => {
    await guestStubs(page, { options: { ...OPTIONS, now: '20:30' } });
    await page.goto('/reserve');
    // Nothing left today: the first day with a time is tomorrow.
    await expect(chosen(page, 'Day')).toHaveAttribute('data-value', '2026-11-14');
    await pick(page, 'Day', '2026-11-13');
    await expect(page.getByText('No more times on this day. Pick another day.')).toBeVisible();
    await expect(page.getByTestId('reserve-summary')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Ask for this table' })).toBeDisabled();
  });

  test('the day is offered in three parts, each a dozen times at most, and the restaurant\'s rules are said up front', async ({ page }) => {
    await guestStubs(page);
    await page.goto('/reserve');
    await expect(page.getByText('Tables 11:00 to 21:00')).toBeVisible();
    await expect(page.getByText('Up to 10 guests')).toBeVisible();
    // Evening first, where dinner is; the other parts one tap away, each opening on its usual time.
    await expect(page.getByRole('button', { name: 'Evening' })).toHaveAttribute('aria-pressed', 'true');
    await expect(group(page, 'Time').getByRole('radio')).toHaveCount(13);
    await page.getByRole('button', { name: 'Midday' }).click();
    await expect(chosen(page, 'Time')).toHaveAttribute('data-value', '13:00');
    await expect(group(page, 'Time').getByRole('radio').first()).toHaveAttribute('data-value', '11:00');
    await page.getByRole('button', { name: 'Afternoon' }).click();
    await expect(chosen(page, 'Time')).toHaveAttribute('data-value', '16:00');
    await expect(page.getByTestId('reserve-summary')).toContainText('16:00');
    // As many guests as the restaurant takes online, and no more.
    await expect(group(page, 'Guests').getByRole('radio')).toHaveCount(10);
  });

  test('a name or number that cannot be right is caught before anything is sent', async ({ page }) => {
    const guest = await guestStubs(page);
    await page.goto('/reserve');
    await fill(page, 'Amina', '12345');
    await page.getByRole('button', { name: 'Ask for this table' }).click();
    await expect(page.getByRole('alert')).toContainText('does not look like a phone number');
    await fill(page, 'A', '+387 61 123-456');
    await page.getByRole('button', { name: 'Ask for this table' }).click();
    await expect(page.getByRole('alert')).toContainText('Please tell us your name.');
    expect(guest.asked).toEqual([]);
  });

  test('a refusal is said in plain words, with the phone to call', async ({ page }) => {
    await guestStubs(page, { refuse: 'soon' });
    await page.goto('/reserve');
    await fill(page);
    await page.getByRole('button', { name: 'Ask for this table' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('That is too soon to reserve online. Please call us.');
    await expect(alert.getByRole('link', { name: 'Call +387 33 877 779' })).toHaveAttribute('href', 'tel:+38733877779');
    await expect(page).toHaveURL(/\/reserve\/?$/);
  });

  test('while the restaurant takes none online, the page says so and gives the phone', async ({ page }) => {
    await guestStubs(page, { options: { enabled: false } });
    await page.goto('/reserve');
    await expect(page.getByRole('heading', { level: 2, name: 'Online reservations are not open yet' })).toBeVisible();
    // La Soul's own number, from its website, when the admin has set none.
    await expect(page.getByRole('link', { name: /Call \+387 33 877 779/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask for this table' })).toHaveCount(0);
  });

  test('in Arabic the page reads right to left, in Arabic', async ({ page }) => {
    await guestStubs(page);
    await page.addInitScript(() => { try { localStorage.setItem('lasoul-lang', 'ar'); } catch { /* fresh anyway */ } });
    await page.goto('/reserve');
    await expect(page.getByRole('heading', { level: 1, name: 'احجز طاولة' })).toBeVisible();
    await expect(page.locator('main').locator('..')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByRole('button', { name: 'اطلب هذه الطاولة' })).toBeVisible();
    // A phone number and a time stay left to right.
    await expect(page.getByLabel('رقم الهاتف')).toHaveAttribute('dir', 'ltr');
    // Nothing to scroll sideways: in a right-to-left page, "far off to the left" is reachable.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('a guest is told before asking that the restaurant will message them on WhatsApp, where it does', async ({ page }) => {
    await guestStubs(page);
    await page.goto('/reserve');
    await expect(page.getByRole('button', { name: 'Ask for this table' })).toBeVisible();
    await expect(page.getByTestId('whatsapp-notice')).toHaveCount(0);

    await guestStubs(page, { options: { ...OPTIONS, whatsapp: true } });
    await page.goto('/reserve');
    await expect(page.getByTestId('whatsapp-notice')).toHaveText('We will message you on WhatsApp when we have your request and when we answer.');
  });

  test('fits a phone: nothing to scroll sideways', async ({ page }) => {
    await guestStubs(page);
    await page.goto('/reserve');
    await expect(page.getByRole('button', { name: 'Ask for this table' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});

test.describe('the guest\'s own page', () => {
  const own = `/reservation/${KEY.id}?t=${KEY.token}`;

  test('shows the answer by itself, the moment the restaurant gives it', async ({ page }) => {
    const guest = await guestStubs(page);
    await page.goto(own);
    const status = page.getByTestId('reservation-status');
    await expect(status).toHaveText('We have your request');
    await expect(page.getByText('Saturday 14 November')).toBeVisible();
    await expect(page.getByText('19:30')).toBeVisible();
    await expect(page.getByText('Guests: 4')).toBeVisible();
    await expect(page.getByText('Reservation R48213')).toBeVisible();
    // Where it stands: sent, and the restaurant's answer still to come.
    await expect(page.getByTestId('reservation-steps')).toContainText('Request sent');
    await expect(page.getByTestId('reservation-steps')).toContainText('The restaurant answers');
    await expect(page.getByRole('link', { name: 'Add to calendar' })).toHaveCount(0);

    // The admin confirms. Nobody reloads the guest's page.
    guest.reservation = mine({ status: 'confirmed', reply: 'By the window, as you asked' });
    await expect(status).toHaveText('Your table is confirmed', { timeout: 12_000 });
    await expect(status).toHaveAttribute('data-status', 'confirmed');
    await expect(page.getByText('By the window, as you asked')).toBeVisible();
    await expect(page.getByTestId('reservation-steps')).toContainText('Confirmed');
  });

  test('a confirmed table goes into the guest\'s calendar, with the way there', async ({ page }) => {
    await guestStubs(page, { reservation: mine({ status: 'confirmed' }) });
    await page.goto(own);
    const calendar = page.getByRole('link', { name: 'Add to calendar' });
    await expect(calendar).toHaveAttribute('download', 'reservation.ics');
    const entry = decodeURIComponent((await calendar.getAttribute('href') ?? '').replace('data:text/calendar;charset=utf-8,', ''));
    expect(entry).toContain('DTSTART;TZID=Europe/Sarajevo:20261114T193000');
    expect(entry).toContain('SUMMARY:Table at La Soul');
    expect(entry).toContain('DESCRIPTION:Guests: 4. Reservation R48213');
    await expect(page.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', /maps|goo\.gl|google/);
  });

  test('a declined request says so, with the restaurant\'s line and a way to ask again', async ({ page }) => {
    await guestStubs(page, { reservation: mine({ status: 'declined', reply: 'Full at 19:30, 21:00 is free' }) });
    await page.goto(own);
    await expect(page.getByTestId('reservation-status')).toHaveText('We cannot take this reservation');
    await expect(page.getByText('Full at 19:30, 21:00 is free')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ask for another table' })).toHaveAttribute('href', '/reserve');
    await expect(page.getByRole('button', { name: 'Cancel my reservation' })).toHaveCount(0);
  });

  test('the guest can take it back, after being asked once', async ({ page }) => {
    await guestStubs(page, { reservation: mine({ status: 'confirmed' }) });
    await page.goto(own);
    await page.getByRole('button', { name: 'Cancel my reservation' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByTestId('reservation-status')).toHaveText('You cancelled this reservation');
  });

  test('a long wait shows the code to mention on the phone', async ({ page }) => {
    await guestStubs(page, { reservation: mine({ waited_seconds: 600 }) });
    await page.goto(own);
    await expect(page.getByText('Still waiting? Call us and mention R48213.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Call +387 33 877 779' })).toBeVisible();
  });

  test('an address without its key finds nothing', async ({ page }) => {
    await guestStubs(page, { reservation: null });
    await page.goto(`/reservation/${KEY.id}?t=wrong`);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find this reservation' })).toBeVisible();
    await page.goto(`/reservation/${KEY.id}`);
    await expect(page.getByRole('heading', { level: 1, name: 'We could not find this reservation' })).toBeVisible();
  });

  test('is nobody\'s search result: no index, no canonical', async ({ page }) => {
    await guestStubs(page);
    await page.goto(own);
    await expect(page.getByTestId('reservation-status')).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
  });
});

test.describe('the website', () => {
  test('offers "Reserve a table" only while the restaurant takes requests online', async ({ page }) => {
    await guestStubs(page, { options: { enabled: false } });
    await page.goto('/');
    await expect(page.getByRole('link', { name: /Call/ }).first()).toBeAttached();
    await expect(page.getByTestId('reserve-link')).toHaveCount(0);

    await guestStubs(page);
    await page.goto('/');
    await expect(page.getByTestId('reserve-link')).toHaveAttribute('href', '/reserve/');
    await expect(page.getByTestId('reserve-link')).toContainText('Reserve a table');
  });
});

/*
 * This build is made without the database (e2e), so the page it wrote says
 * what a build believes until told otherwise: not open online, not listed.
 * The app then says what the database says now.
 */
test.describe('what search engines find', () => {
  const ld = (page: Page) => page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent ?? '').join('\n'));

  test('the booking page is a page of its own before the app runs, and is not the home page', async ({ page }) => {
    const html = await (await page.request.get('/reserve/')).text();
    expect(html).toContain('<link rel="canonical" href="https://lasoul.net/reserve/" />');
    expect(html).toContain('<title>Reserve a table · La Soul</title>');
    expect(html).toContain('<meta name="robots" content="noindex, follow" />');
    expect(html).toContain('Online reservations are not open yet');
  });

  test('open online: listed, named for what people search, with how it works and its questions on the page', async ({ page }) => {
    await guestStubs(page);
    await page.goto('/reserve/');
    await expect(page.getByRole('button', { name: 'Ask for this table' })).toBeVisible();
    await expect(page).toHaveTitle('Reserve a table at La Soul, Sarajevo');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://lasoul.net/reserve/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow, max-image-preview:large');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /^Ask for a table at La Soul online/);
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(0);

    await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'The restaurant answers, usually within minutes.' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'Questions' })).toBeVisible();
    // Every answer is in the page, opened or not.
    await expect(page.getByText('No. Reserving a table is free.')).toBeAttached();
    await page.getByText('Does a reservation cost anything?').click();
    await expect(page.getByText('No. Reserving a table is free.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });

  test('not open online: the page asks to be left out, and names no canonical', async ({ page }) => {
    await guestStubs(page, { options: { enabled: false } });
    await page.goto('/reserve/');
    await expect(page.getByRole('heading', { level: 2, name: 'Online reservations are not open yet' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
    await expect(page).toHaveTitle('Reserve a table · La Soul');
    await expect(page.getByRole('heading', { level: 2, name: 'How it works' })).toHaveCount(0);
  });

  test('the home page says a table can be reserved only while it can: its questions and its structured data', async ({ page }) => {
    await guestStubs(page, { options: { enabled: false } });
    await page.goto('/');
    await expect(page.locator('#faq')).toBeAttached();
    await expect(page.locator('#faq').getByText('Can I reserve a table?')).toHaveCount(0);
    expect(await ld(page)).not.toMatch(/ReserveAction|acceptsReservations/);

    await guestStubs(page);
    await page.goto('/');
    await expect(page.locator('#faq').getByText('Can I reserve a table?')).toBeAttached();
    await expect(page.locator('#faq').getByText(/Ask for a table online at lasoul\.net\/reserve/)).toBeAttached();
    await expect.poll(() => ld(page)).toContain('"acceptsReservations":"https://lasoul.net/reserve/"');
    expect(await ld(page)).toContain('"@type":"ReserveAction"');
    expect(await ld(page)).toContain('"name":"Can I reserve a table?"');
  });

  test('each build says what it believed, so a switch flipped later can be told apart (scripts/republish-check.mjs)', async ({ page }) => {
    const state = await (await page.request.get('/site-state.json')).json();
    // This build had no database to ask: it says so, and nothing is concluded from it.
    expect(state).toMatchObject({ venue: 'lasoul', asked: false });
    expect(state).not.toHaveProperty('publishableKey');
    expect(Date.parse(state.builtAt)).toBeGreaterThan(0);
  });

  test('in Bosnian and Arabic the booking page is named in that language', async ({ page }) => {
    await guestStubs(page);
    await page.addInitScript(() => { try { localStorage.setItem('lasoul-lang', 'bs'); } catch { /* fresh anyway */ } });
    await page.goto('/reserve/');
    await expect(page).toHaveTitle('Rezervišite sto u La Soul, Sarajevo');
    await expect(page.getByRole('heading', { level: 2, name: 'Kako funkcioniše' })).toBeVisible();
  });
});

// ---------------------------------------------------------------------
// The restaurant's side
// ---------------------------------------------------------------------

const hoursAhead = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const aRequest = (over: Record<string, unknown> = {}) => ({
  id: 'r-1', code: 'R48213', status: 'pending', guest_name: 'Amina Hadžić', guest_phone: '+38761123456', party_size: 4,
  reserved_for: hoursAhead(26), note: 'By the window', reply: null, cancelled_by: null, created_at: minutesAgo(3), decided_at: null, ...over,
});

interface Admin {
  rows: Record<string, unknown>[];
  decisions: Record<string, unknown>[];
  settingsWrites: Record<string, unknown>[];
}

async function adminStubs(page: Page, staff: { settings: Record<string, unknown> }, rows = [aRequest()]): Promise<Admin> {
  const admin: Admin = { rows, decisions: [], settingsWrites: [] };
  Object.assign(staff.settings, {
    reservations_enabled: true, reservations_open: '11:00:00', reservations_close: '21:00:00', reservations_max_party: 10,
    reservations_days_ahead: 30, reservations_lead_minutes: 60, reservations_phone: null, reservations_note: null,
  });
  await page.route('**/rest/v1/restaurant_settings**', (route) => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON();
      admin.settingsWrites.push(patch);
      Object.assign(staff.settings, patch);
      return json(route, []);
    }
    return json(route, staff.settings);
  });
  await page.route('**/rest/v1/reservations**', (route) => {
    const waiting = admin.rows.filter((r) => r.status === 'pending').length;
    // The menu's count asks with HEAD; the answer is in the header.
    if (route.request().method() === 'HEAD') return json(route, null, 200, { 'content-range': `*/${waiting}` });
    return json(route, admin.rows);
  });
  await page.route('**/rest/v1/rpc/staff_decide_reservation', (route) => {
    const body = route.request().postDataJSON() as { _id: string; _decision: string; _reply: string | null };
    admin.decisions.push(body);
    const next = body._decision === 'confirm' ? 'confirmed' : body._decision === 'decline' ? 'declined' : 'cancelled';
    admin.rows = admin.rows.map((r) => (r.id === body._id
      ? { ...r, status: next, reply: body._reply, decided_at: new Date().toISOString(), cancelled_by: next === 'cancelled' ? 'restaurant' : null } : r));
    return json(route, { id: body._id, status: next });
  });
  return admin;
}

test.describe('Admin → Reservations', () => {
  test('a waiting request is first, with who, when, how many and a number to call', async ({ page, staff }) => {
    await adminStubs(page, staff);
    await page.goto('/admin/reservations');
    await expect(page.getByRole('heading', { level: 1, name: 'Reservations' })).toBeVisible();
    await expect(page.getByTestId('pending-count')).toHaveText('1 waiting for your answer');
    const card = page.getByTestId('pending-reservation');
    await expect(card).toContainText('Amina Hadžić');
    await expect(card).toContainText('“By the window”');
    await expect(card).toContainText('R48213');
    await expect(card.getByRole('link', { name: '+38761123456' })).toHaveAttribute('href', 'tel:+38761123456');
  });

  test('Confirm, with a line for the guest, moves it to the confirmed tables', async ({ page, staff }) => {
    const admin = await adminStubs(page, staff);
    await page.goto('/admin/reservations');
    const card = page.getByTestId('pending-reservation');
    await card.getByLabel('A line for the guest (optional)').fill('By the window, as you asked');
    await card.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByTestId('pending-reservation')).toHaveCount(0);
    await expect(page.getByTestId('confirmed-reservation')).toContainText('Amina Hadžić');
    await expect(page.getByText('Nobody is waiting. New requests appear here by themselves.')).toBeVisible();
    expect(admin.decisions).toEqual([{ _id: 'r-1', _decision: 'confirm', _reply: 'By the window, as you asked' }]);
  });

  test('after an answer, the message for the guest is written, one tap from WhatsApp, Viber or a text', async ({ page, staff }) => {
    await adminStubs(page, staff);
    await page.goto('/admin/reservations');
    const card = page.getByTestId('pending-reservation');
    await card.getByLabel('A line for the guest (optional)').fill('By the window');
    await card.getByRole('button', { name: 'Confirm' }).click();

    const tell = page.getByTestId('tell-guest');
    await expect(tell).toContainText('Tell Amina Hadžić');
    const text = (await tell.getByTestId('tell-guest-text').textContent()) ?? '';
    expect(text).toMatch(/^La Soul: your table is confirmed\. .+ at \d\d:\d\d, guests: 4\. Reservation R48213\. By the window\. Questions\? Call /);
    await expect(tell.getByRole('link', { name: 'WhatsApp' })).toHaveAttribute('href', `https://wa.me/38761123456?text=${encodeURIComponent(text)}`);
    await expect(tell.getByRole('link', { name: 'Viber' })).toHaveAttribute('href', 'viber://chat?number=%2B38761123456');
    await expect(tell.getByRole('link', { name: 'Text message' })).toHaveAttribute('href', `sms:+38761123456?&body=${encodeURIComponent(text)}`);
    await tell.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('tell-guest')).toHaveCount(0);

    // And again later, from the confirmed table itself.
    await page.getByTestId('confirmed-reservation').getByRole('button', { name: 'Message' }).click();
    await expect(page.getByTestId('tell-guest-text')).toContainText('your table is confirmed');
  });

  test('the message is in the language the guest asked in', async ({ page, staff }) => {
    await adminStubs(page, staff, [aRequest({ locale: 'bs' })]);
    await page.goto('/admin/reservations');
    await page.getByTestId('pending-reservation').getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByTestId('tell-guest')).toContainText('It is written in Bosnian');
    await expect(page.getByTestId('tell-guest-text')).toContainText('La Soul: žao nam je, ne možemo primiti vašu rezervaciju');
    // The day is named in words, whatever this browser knows of Bosnian (never "M11 14, Sat").
    expect(await page.getByTestId('tell-guest-text').textContent()).not.toMatch(/M[0-9][0-9]/);
  });

  test.describe('WhatsApp messages', () => {
    const TEMPLATES = Array.from({ length: 14 }, (_, i) => ({ name: `reservation_${i}`, language: 'en', status: 'APPROVED' }));
    /** The database knows the two choices, and the function answers as it would with the number connected. */
    async function whatsapp(page: Page, staff: { settings: Record<string, unknown> }, report: Record<string, unknown>) {
      const admin = await adminStubs(page, staff, [aRequest()]);
      Object.assign(staff.settings, { reservations_whatsapp_guest: false, reservations_whatsapp_admin: null });
      const calls: Record<string, unknown>[] = [];
      await page.route('**/functions/v1/reservation-messages', (route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        calls.push(body);
        return json(route, body.action === 'test' ? { sent: true } : report);
      });
      return { admin, calls };
    }

    test('before the database knows them, nothing about them is shown', async ({ page, staff }) => {
      await adminStubs(page, staff, []);
      await page.goto('/admin/reservations');
      await expect(page.getByRole('button', { name: 'Save the rules' })).toBeVisible();
      await expect(page.getByTestId('reservation-whatsapp')).toHaveCount(0);
    });

    test('not connected yet: it says so, and guests cannot be switched on', async ({ page, staff }) => {
      await whatsapp(page, staff, { configured: false, number: false, ready: false, templates: [] });
      await page.goto('/admin/reservations');
      const card = page.getByTestId('reservation-whatsapp');
      await expect(card.getByTestId('whatsapp-state')).toHaveText('Not connected yet');
      await expect(card.getByRole('switch', { name: /Send guests a WhatsApp confirmation/ })).toBeDisabled();
      await expect(card.getByRole('button', { name: 'Send a test' })).toBeDisabled();
    });

    test('connected, messages not sent for approval yet: one button does it', async ({ page, staff }) => {
      const { calls } = await whatsapp(page, staff, {
        configured: true, number: true, ready: false, templates: TEMPLATES.map((t) => ({ ...t, status: 'MISSING' })), refused: [],
      });
      await page.goto('/admin/reservations');
      const card = page.getByTestId('reservation-whatsapp');
      await expect(card.getByTestId('whatsapp-state')).toHaveText('0 of 14 messages approved');
      await card.getByRole('button', { name: 'Set up the messages' }).click();
      await expect.poll(() => calls.map((c) => c.action)).toEqual(['status', 'setup']);
      expect(calls[1]).toEqual({ action: 'setup', venue: 'lasoul' });
    });

    test('ready: the restaurant chooses to message guests, and a number to be told, and tries it', async ({ page, staff }) => {
      const { admin, calls } = await whatsapp(page, staff, { configured: true, number: true, ready: true, templates: TEMPLATES });
      await page.goto('/admin/reservations');
      const card = page.getByTestId('reservation-whatsapp');
      await expect(card.getByTestId('whatsapp-state')).toHaveText('Ready');
      // "Also when their request arrives" is a choice of its own, there once confirmations are on.
      await expect(card.getByRole('switch', { name: /Also when their request arrives/ })).toHaveCount(0);
      await card.getByRole('switch', { name: /Send guests a WhatsApp confirmation/ }).click();
      await expect.poll(() => admin.settingsWrites).toEqual([{ reservations_whatsapp_guest: true }]);
      await expect(card).toContainText('On: the guest is told on WhatsApp when you confirm, decline or cancel their table.');
      await expect(card).toContainText('Two messages for each reservation.');
      await card.getByRole('switch', { name: /Also when their request arrives/ }).click();
      await expect.poll(() => admin.settingsWrites.at(-1)).toEqual({ reservations_whatsapp_received: false });
      await expect(card).toContainText('Off: one message for each reservation, your answer.');
      admin.settingsWrites.length = 1;

      await card.getByLabel(/Also tell this WhatsApp number/).fill('+387 62 555 000');
      await card.getByRole('button', { name: 'Save' }).click();
      await expect.poll(() => admin.settingsWrites.length).toBe(2);
      expect(admin.settingsWrites[1]).toEqual({ reservations_whatsapp_admin: '+387 62 555 000' });
      await card.getByRole('button', { name: 'Send a test' }).click();
      await expect.poll(() => calls.at(-1)).toEqual({ action: 'test', venue: 'lasoul', to: '+387 62 555 000' });
    });

    test('the same choices are on Ordering & service, under the reservations switch', async ({ page, staff }) => {
      const { admin } = await whatsapp(page, staff, { configured: true, number: true, ready: true, templates: TEMPLATES });
      await page.goto('/admin/service');
      const card = page.getByTestId('service-reservations').getByTestId('reservation-whatsapp');
      await expect(card.getByTestId('whatsapp-state')).toHaveText('Ready');
      await card.getByRole('switch', { name: /Send guests a WhatsApp confirmation/ }).click();
      await expect.poll(() => admin.settingsWrites).toEqual([{ reservations_whatsapp_guest: true }]);
    });

    test('an answer that already went out by itself is said, so the admin does not send it twice', async ({ page, staff }) => {
      await whatsapp(page, staff, { configured: true, number: true, ready: true, templates: TEMPLATES });
      await page.route('**/rest/v1/reservation_messages**', (route) =>
        json(route, [{ reservation_id: 'r-1', kind: 'guest_confirmed', status: 'sent', detail: 'wamid.1' }]));
      await page.goto('/admin/reservations');
      await page.getByTestId('pending-reservation').getByRole('button', { name: 'Confirm' }).click();
      await expect(page.getByTestId('tell-guest-auto')).toHaveText('Already sent by itself on WhatsApp. Send it yourself as well only if you want to.');
    });
  });

  test('the same switch is on Ordering & service, among the other things a restaurant turns on and off', async ({ page, staff }) => {
    const admin = await adminStubs(page, staff, []);
    staff.settings.reservations_enabled = false;
    await page.goto('/admin/service');
    const card = page.getByTestId('service-reservations');
    await expect(card).toContainText('Off: the booking page tells guests to call instead.');
    await card.getByRole('switch', { name: 'Take reservation requests on the website' }).click();
    await expect.poll(() => admin.settingsWrites).toEqual([{ reservations_enabled: true }]);
    await expect(card).toContainText('On: guests ask for a table on your website');
    await card.getByRole('link', { name: 'Requests, times and alerts' }).click();
    await expect(page).toHaveURL(/\/admin\/reservations$/);
  });

  test('Decline leaves it among the answered ones, where it can still be confirmed', async ({ page, staff }) => {
    const admin = await adminStubs(page, staff);
    await page.goto('/admin/reservations');
    await page.getByTestId('pending-reservation').getByRole('button', { name: 'Decline' }).click();
    await expect(page.getByTestId('pending-reservation')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Declined, cancelled and past' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm after all' }).click();
    await expect(page.getByTestId('confirmed-reservation')).toContainText('Amina Hadžić');
    expect(admin.decisions.map((d) => d._decision)).toEqual(['decline', 'confirm']);
  });

  test('a confirmed table is cancelled only after being asked, and the guest is to be called', async ({ page, staff }) => {
    const admin = await adminStubs(page, staff, [aRequest({ status: 'confirmed', decided_at: minutesAgo(30) })]);
    await page.goto('/admin/reservations');
    await page.getByTestId('confirmed-reservation').getByRole('button', { name: 'Cancel' }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Call them too');
    await dialog.getByLabel('A line for the guest (optional)').fill('Private event that evening');
    await dialog.getByRole('button', { name: 'Cancel the reservation' }).click();
    await expect(page.getByTestId('confirmed-reservation')).toHaveCount(0);
    expect(admin.decisions).toEqual([{ _id: 'r-1', _decision: 'cancel', _reply: 'Private event that evening' }]);
  });

  test('a new request arrives by itself while the page is open', async ({ page, staff }) => {
    const admin = await adminStubs(page, staff, []);
    await page.goto('/admin/reservations');
    await expect(page.getByText('Nobody is waiting. New requests appear here by themselves.')).toBeVisible();
    admin.rows = [aRequest({ id: 'r-2', guest_name: 'Fahad', created_at: new Date().toISOString() })];
    await expect(page.getByTestId('pending-reservation')).toContainText('Fahad', { timeout: 15_000 });
  });

  test('the switch and the rules are the restaurant\'s to set', async ({ page, staff }) => {
    const admin = await adminStubs(page, staff, []);
    await page.goto('/admin/reservations');
    await expect(page.getByRole('link', { name: /\/reserve$/ })).toBeVisible();
    await page.getByLabel('Largest group').fill('12');
    await page.getByLabel('Phone guests can call').fill('+387 33 877 779');
    await page.getByRole('button', { name: 'Save the rules' }).click();
    await expect.poll(() => admin.settingsWrites.length).toBe(1);
    expect(admin.settingsWrites[0]).toMatchObject({
      reservations_open: '11:00', reservations_close: '21:00', reservations_max_party: 12, reservations_phone: '+387 33 877 779',
    });

    await page.getByRole('switch', { name: /Take reservation requests on the website/ }).click();
    await expect.poll(() => admin.settingsWrites.length).toBe(2);
    expect(admin.settingsWrites[1]).toEqual({ reservations_enabled: false });
    await expect(page.getByText('Off: the page tells guests to call instead.')).toBeVisible();
  });

  test('the menu shows how many are waiting, on every admin page', async ({ page, staff }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'the sidebar is open on a computer; on a phone it is behind the menu button');
    await adminStubs(page, staff);
    await page.goto('/admin/orders');
    await expect(page.getByTestId('reservations-waiting')).toHaveText('1');
    await page.getByRole('link', { name: /Reservations/ }).click();
    await expect(page).toHaveURL(/\/admin\/reservations$/);
  });

  test('guests waiting are said on every other admin page, one tap from the answer', async ({ page, staff }) => {
    await adminStubs(page, staff);
    await page.goto('/admin/orders');
    const notice = page.getByTestId('reservations-waiting-notice');
    await expect(notice).toContainText('A guest is waiting for an answer about a table');
    await notice.click();
    await expect(page).toHaveURL(/\/admin\/reservations$/);
    // The page that answers does not also announce.
    await expect(page.getByTestId('pending-reservation')).toBeVisible();
    await expect(page.getByTestId('reservations-waiting-notice')).toHaveCount(0);
  });

  test('added to a phone\'s Home Screen, the admin is the Manager app', async ({ page, staff }) => {
    await adminStubs(page, staff, []);
    await page.goto('/admin/reservations');
    await expect(page.getByRole('heading', { level: 1, name: 'Reservations' })).toBeVisible();
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest-manager.webmanifest');
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/icons/manager-apple-touch-icon.png');
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Manager');
    const manifest = await (await page.request.get('/manifest-manager.webmanifest')).json();
    expect(manifest).toMatchObject({ name: 'La Soul Manager', short_name: 'Manager', start_url: '/admin', display: 'standalone', id: '/admin' });
    for (const icon of manifest.icons as { src: string }[]) expect((await page.request.get(icon.src)).status()).toBe(200);
    expect((await page.request.get('/icons/manager-apple-touch-icon.png')).status()).toBe(200);
  });

  test('before the database knows reservations, the page says so instead of failing', async ({ page, staff }) => {
    await adminStubs(page, staff);
    await page.route('**/rest/v1/reservations**', (route) =>
      json(route, { code: 'PGRST205', message: "Could not find the table 'public.reservations' in the schema cache" }, 404));
    await page.goto('/admin/reservations');
    await expect(page.getByText(/Reservations are not switched on.*yet\./)).toBeVisible();
    await expect(page.getByTestId('pending-reservation')).toHaveCount(0);
  });

  test('fits a phone: nothing to scroll sideways', async ({ page, staff }) => {
    await adminStubs(page, staff, [aRequest(), aRequest({ id: 'r-3', status: 'confirmed', guest_name: 'Lamija', decided_at: minutesAgo(40) })]);
    await page.goto('/admin/reservations');
    await expect(page.getByTestId('pending-reservation')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  });
});
