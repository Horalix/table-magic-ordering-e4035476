import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  afterWaiterSignIn, generatePassword, isKitchenTablet, isKitchenUsername, kitchenUsername, lastSignInWords,
  loginCardText, MIN_PASSWORD, plainRefusal, readRefusal, refusalField, signInUrl, staffSiteUrl, suggestUsername,
  teamSignInsText, type LoginDetails, type TeamAccount,
} from './staff-accounts';

/**
 * Making staff sign-ins (Admin → Team, Admin → Waiters) and the card that
 * tells the person how to use theirs. Test values only: nothing here is, or
 * was ever, a real account's.
 */

const ROOT = path.join(__dirname, '..', '..');
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

describe('the password rule is the same everywhere: 10 characters', () => {
  // Supabase Auth's minimum on the live project since 31 October 2026. A
  // waiter made with 6–9 characters passed the form and failed at Auth with
  // "Edge Function returned a non-2xx status code".
  it('is 10 here, in both functions and in Change password', () => {
    expect(MIN_PASSWORD).toBe(10);
    for (const file of [
      'supabase/functions/create-waiter/index.ts',
      'supabase/functions/manage-admins/index.ts',
      'src/components/admin/AdminLayout.tsx',
    ]) {
      expect(source(file), file).toMatch(/const MIN_PASSWORD = 10;/);
    }
  });

  it('no form or function still asks for 6', () => {
    for (const file of [
      'supabase/functions/create-waiter/index.ts',
      'src/pages/admin/AdminWaiters.tsx',
      'src/pages/admin/AdminTeam.tsx',
    ]) {
      const text = source(file);
      expect(text, file).not.toMatch(/password\.length < 6|6\+ char|password \(6\+\)/i);
    }
    // The forms take the rule from here rather than keeping their own.
    for (const file of ['src/pages/admin/AdminWaiters.tsx', 'src/pages/admin/AdminTeam.tsx', 'src/components/admin/NewPasswordField.tsx']) {
      const text = source(file);
      expect(text, file).toContain("from '@/lib/staff-accounts'");
      expect(text, file).toMatch(/\bMIN_PASSWORD\b/);
      expect(text, file).not.toMatch(/const MIN_PASSWORD/);
    }
  });
});

describe('generatePassword', () => {
  it('makes three groups of four, at least 10 long, with every kind Auth can ask for', () => {
    for (let i = 0; i < 200; i += 1) {
      const made = generatePassword();
      expect(made).toMatch(/^[A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4}$/);
      expect(made.length).toBeGreaterThanOrEqual(MIN_PASSWORD);
      expect(made).toMatch(/[a-z]/);
      expect(made).toMatch(/[A-Z]/);
      expect(made).toMatch(/[2-9]/);
      // Nothing to misread: no 0/O, 1/l/I.
      expect(made).not.toMatch(/[0O1lI]/);
    }
  });

  it('is not the same twice', () => {
    const made = new Set(Array.from({ length: 500 }, () => generatePassword()));
    expect(made.size).toBe(500);
  });

  it('uses the random source it is given, and only it', () => {
    const counting = () => { let n = 0; return (bytes: Uint32Array<ArrayBuffer>) => { bytes[0] = n++; return bytes; }; };
    expect(generatePassword(counting())).toBe(generatePassword(counting()));
  });
});

describe('usernames', () => {
  it('suggests the first name, plain', () => {
    expect(suggestUsername('Amra Hodžić')).toBe('amra');
    expect(suggestUsername('  Marko  ')).toBe('marko');
    expect(suggestUsername('Đorđe')).toBe('djordje');
    expect(suggestUsername('Šejla')).toBe('sejla');
    expect(suggestUsername('')).toBe('');
  });

  it('gives each restaurant its own kitchen tablet', () => {
    expect(kitchenUsername('lasoul')).toBe('lasoul-kitchen');
    expect(kitchenUsername('veraitalia')).toBe('veraitalia-kitchen');
    expect(isKitchenUsername('veraitalia-kitchen')).toBe(true);
    expect(isKitchenUsername('marko')).toBe(false);
    expect(isKitchenUsername(null)).toBe(false);
  });
});

describe('where each restaurant’s staff sign in', () => {
  it('on the restaurant’s own site', () => {
    expect(staffSiteUrl('lasoul')).toBe('https://lasoul.net');
    expect(staffSiteUrl('veraitalia')).toBe('https://veraitalia.net');
    // Something unknown: La Soul's site, which serves both.
    expect(staffSiteUrl('nowhere')).toBe('https://lasoul.net');
  });

  it('admins with their email; waiters with the username filled in; the kitchen on to its screen', () => {
    expect(signInUrl('admin', 'veraitalia')).toBe('https://veraitalia.net/admin/login');
    expect(signInUrl('waiter', 'lasoul', 'marko')).toBe('https://lasoul.net/waiter/login?u=marko');
    expect(signInUrl('kitchen', 'veraitalia', 'veraitalia-kitchen')).toBe('https://veraitalia.net/waiter/login?u=veraitalia-kitchen&to=kitchen');
    expect(signInUrl('waiter', 'lasoul')).toBe('https://lasoul.net/waiter/login');
  });

  it('after signing in, only the kitchen or the floor screen, else the waiter phone', () => {
    expect(afterWaiterSignIn('kitchen')).toBe('/kitchen');
    expect(afterWaiterSignIn('monitor')).toBe('/waiter/monitor');
    expect(afterWaiterSignIn(null)).toBe('/waiter');
    for (const odd of ['//evil.test', 'https://evil.test', '/admin', 'constructor', '__proto__']) {
      expect(afterWaiterSignIn(odd)).toBe('/waiter');
    }
  });
});

describe('the login card as text', () => {
  // Test values, made up for this file.
  const WAITER_PW = 'Test-only-1x';
  const ADMIN_PW = 'Test-only-2y';
  const TEST_PIN = '4821';
  const waiter: LoginDetails = {
    kind: 'waiter', venueSlug: 'lasoul', venueName: 'La Soul', name: 'Marko', username: 'marko',
    password: WAITER_PW, pin: TEST_PIN, event: 'created',
  };

  it('has the address on a line of its own, what to type, and the PIN for a waiter', () => {
    const text = loginCardText(waiter);
    expect(text.split('\n')).toEqual([
      'La Soul · waiter sign-in for Marko',
      'https://lasoul.net/waiter/login?u=marko',
      'Username: marko',
      'Password: Test-only-1x',
      'Floor PIN (the shared floor screen): 4821',
    ]);
  });

  it('a kitchen tablet’s goes to the kitchen, without a PIN', () => {
    const text = loginCardText({ ...waiter, kind: 'kitchen', name: 'Kitchen', username: 'veraitalia-kitchen', venueSlug: 'veraitalia', venueName: 'Vera Italia' });
    expect(text).toContain('Vera Italia · kitchen tablet sign-in for Kitchen');
    expect(text).toContain('https://veraitalia.net/waiter/login?u=veraitalia-kitchen&to=kitchen');
    expect(text).not.toContain('PIN');
  });

  it('an admin’s: their restaurant’s admin sign-in, their email, and to change the password', () => {
    const admin: LoginDetails = { kind: 'admin', venueSlug: 'veraitalia', venueName: 'Vera Italia', name: 'a@vera.test', username: 'a@vera.test', password: ADMIN_PW, event: 'created' };
    expect(loginCardText(admin)).toBe([
      'Vera Italia · admin sign-in',
      'https://veraitalia.net/admin/login',
      'Email: a@vera.test',
      'Password: Test-only-2y',
      'Change the password after signing in: admin menu → Change password.',
    ].join('\n'));
    // An account that already existed keeps its own password; none is shown.
    const kept = loginCardText({ ...admin, password: null, event: 'appointed' });
    expect(kept).toContain('Password: the one they already use');
    expect(kept).not.toContain('Change the password');
  });
});

describe('a function’s refusal, in its own words', () => {
  // What supabase-js hands back for a non-2xx answer: a generic message, and the Response on `context`.
  const httpError = (status: number, body?: unknown) => Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: new Response(body === undefined ? '' : JSON.stringify(body), { status }),
  });

  it('reads the reason from the answer, not the client’s generic message', async () => {
    const r = await readRefusal(httpError(400, { error: 'Supabase Auth refused the password: Password should be at least 10 characters.', code: 'weak_password' }), null, 'create-waiter');
    expect(r).toEqual({ message: 'Supabase Auth refused the password: Password should be at least 10 characters.', code: 'weak_password', status: 400 });
    expect(refusalField(r!)).toBe('password');
  });

  it('says plainly when the function is missing or the network is', async () => {
    expect((await readRefusal(httpError(404), null, 'create-waiter'))?.message).toBe('The create-waiter function is not deployed. Ask Lovable to deploy it.');
    expect((await readRefusal(httpError(502), null, 'create-waiter'))?.message).toMatch(/HTTP 502/);
    const offline = Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError' });
    expect((await readRefusal(offline, null, 'create-waiter'))?.message).toMatch(/Could not reach the server/);
  });

  it('a 200 with an error in it is a refusal too; nothing wrong is null', async () => {
    expect(await readRefusal(null, { error: 'Admin only' }, 'create-waiter')).toEqual({ message: 'Admin only', code: undefined });
    expect(await readRefusal(null, { ok: true }, 'create-waiter')).toBeNull();
  });

  it('puts Auth’s words from a function too old to tag them next to the right field', () => {
    // Today's create-waiter before Lovable redeploys it: Auth's raw message, no code.
    const raw = { message: 'Password should be at least 10 characters.' };
    expect(refusalField(raw)).toBe('password');
    expect(plainRefusal(raw)).toBe('Supabase Auth refused the password: Password should be at least 10 characters.');
    const taken = { message: 'A user with this email address has already been registered' };
    expect(refusalField(taken)).toBe('username');
    expect(plainRefusal(taken)).toBe('An older sign-in already uses that username. Pick another one.');
    expect(refusalField({ message: 'Username already taken' })).toBe('username');
    // The old catch-all is about every field, so about none of them.
    expect(refusalField({ message: 'Username (3+ chars), password (6+ chars), and display name are required' })).toBeNull();
    expect(refusalField({ message: 'Admin only' })).toBeNull();
  });
});

describe('the owner’s Team list (manage-admins list)', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const account = (over: Partial<TeamAccount>): TeamAccount => ({
    user_id: 'u', email: null, username: null, display_name: null, kind: 'waiter', venue: 'lasoul', you: false, ...over,
  });
  const VENUES_SHOWN = [{ slug: 'lasoul', name: 'La Soul' }, { slug: 'veraitalia', name: 'Vera Italia' }];
  const TEAM: TeamAccount[] = [
    account({ user_id: 'u-me', email: 'owner@team.test', kind: 'owner', venue: null, you: true }),
    account({ user_id: 'u-co', email: 'partner@team.test', kind: 'owner', venue: null }),
    account({ user_id: 'u-ana', email: 'ana@team.test', kind: 'admin' }),
    account({ user_id: 'u-amar', username: 'amar', display_name: 'Amar' }),
    account({ user_id: 'u-kt', username: 'lasoul-kitchen', display_name: 'Kitchen' }),
    account({ user_id: 'u-hand', email: 'screen@team.test', kind: 'kitchen' }),
    account({ user_id: 'u-giulia', username: 'giulia', display_name: 'Giulia', venue: 'veraitalia' }),
    account({ user_id: 'u-old', email: 'old@team.test', kind: 'none', venue: null }),
    account({ user_id: 'u-oldw', username: 'gone', kind: 'none', venue: null }),
  ];

  it('a kitchen screen: one made by hand, or a tablet made under Waiters; never an admin', () => {
    expect(isKitchenTablet(account({ kind: 'kitchen', email: 'screen@team.test' }))).toBe(true);
    expect(isKitchenTablet(account({ username: 'lasoul-kitchen' }))).toBe(true);
    expect(isKitchenTablet(account({ username: 'amar' }))).toBe(false);
    expect(isKitchenTablet(account({ kind: 'admin', username: 'x-kitchen' }))).toBe(false);
  });

  it('says when each last signed in, and nothing when the function did not say', () => {
    expect(lastSignInWords(undefined, now)).toBeNull();
    expect(lastSignInWords(null, now)).toBe('never signed in');
    expect(lastSignInWords('not a date', now)).toBeNull();
    expect(lastSignInWords('2026-11-05T11:40:00Z', now)).toBe('signed in within the hour');
    expect(lastSignInWords('2026-11-05T07:00:00Z', now)).toBe('signed in 5 h ago');
    expect(lastSignInWords('2026-11-04T09:00:00Z', now)).toBe('signed in yesterday');
    expect(lastSignInWords('2026-10-26T12:00:00Z', now)).toBe('signed in 10 days ago');
    expect(lastSignInWords('2026-06-01T12:00:00Z', now)).toBe('last signed in 1 Jun 2026');
    // A clock a little ahead is not "in the future".
    expect(lastSignInWords('2026-11-05T12:05:00Z', now)).toBe('signed in within the hour');
  });

  it('copies every sign-in: each restaurant’s staff with the address they open, then the owners, then no role', () => {
    const text = teamSignInsText(VENUES_SHOWN, TEAM);
    expect(text.split('\n\n').map((block) => block.split('\n')[0])).toEqual([
      'La Soul — https://lasoul.net',
      'Vera Italia — https://veraitalia.net',
      'Owner — every restaurant',
      'No role — signs in, opens nothing',
      expect.stringMatching(/^No passwords here/),
    ]);
    expect(text).toContain('Admin: ana@team.test · https://lasoul.net/admin/login');
    expect(text).toContain('Waiter: Amar, username amar · https://lasoul.net/waiter/login?u=amar');
    expect(text).toContain('Kitchen tablet: Kitchen, username lasoul-kitchen · https://lasoul.net/waiter/login?u=lasoul-kitchen&to=kitchen');
    expect(text).toContain('Kitchen tablet: screen@team.test (signs in with that email)');
    expect(text).toContain('Waiter: Giulia, username giulia · https://veraitalia.net/waiter/login?u=giulia');
    expect(text).toContain('Owner: owner@team.test (you) · https://lasoul.net/admin/login');
    expect(text).toContain('Owner: partner@team.test · https://lasoul.net/admin/login');
    expect(text).toContain('old@team.test');
    expect(text).toContain('username gone');
    // Admins first, then waiters, then the kitchen, within a restaurant.
    const laSoul = text.split('\n\n')[0];
    expect(laSoul.indexOf('Admin:')).toBeLessThan(laSoul.indexOf('Waiter:'));
    expect(laSoul.indexOf('Waiter:')).toBeLessThan(laSoul.indexOf('Kitchen tablet:'));
    // Vera's block has nothing of La Soul's.
    expect(text.split('\n\n')[1]).not.toMatch(/amar|ana@|lasoul/);
  });

  it('never a password, and says why there is none', () => {
    const text = teamSignInsText(VENUES_SHOWN, TEAM);
    expect(text).not.toMatch(/Password:/);
    expect(text).toMatch(/stores them scrambled/);
    expect(text).toMatch(/Team → Password gives anyone a new one/);
  });

  it('a restaurant with no staff yet says so; no owner or no-role block when there are none', () => {
    const text = teamSignInsText(VENUES_SHOWN, [TEAM[2]]);
    expect(text).toContain('Vera Italia — https://veraitalia.net\nNo staff sign-ins yet');
    expect(text).not.toContain('Owner —');
    expect(text).not.toContain('No role —');
  });
});
