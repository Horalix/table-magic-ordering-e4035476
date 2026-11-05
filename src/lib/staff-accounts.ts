/**
 * Making a staff sign-in, and telling the person how to use it.
 *
 * The owner appoints restaurant admins (Admin → Team, manage-admins); an
 * admin or the owner adds waiters and kitchen tablets (Admin → Waiters,
 * create-waiter). Each signs in on their restaurant's own site
 * (src/lib/seo/site-url.ts): La Soul's staff at lasoul.net, Vera
 * Italia's at veraitalia.net. Either site lets anyone in — the account
 * decides what they see — but their own carries their restaurant's name and
 * look, and it is the one that goes on their home screen.
 *
 * Passwords: Supabase Auth refuses anything under 10 characters on the live
 * project (since 31 October 2026), so both forms, both functions and the
 * admin's Change password say 10, and src/lib/staff-accounts.test.ts holds
 * them to it. A password is shown once, on the login card, and kept nowhere:
 * not in storage, not in the database, not in an address.
 */
import { OWN_SITE_LIVE, VENUE_URLS } from './seo/site-url';
import { DEFAULT_VENUE } from './venues';

export const MIN_PASSWORD = 10;

/** Who a sign-in is for: they differ in where they sign in and what they type. */
export type StaffKind = 'admin' | 'waiter' | 'kitchen';

// No 0/O, 1/l/I: read off a screen or aloud, no character can be mistaken.
const LOWER = 'abcdefghjkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const ALL = LOWER + UPPER + DIGITS;

type Random = (bytes: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>;
const cryptoRandom: Random = (bytes) => crypto.getRandomValues(bytes);

/** A uniform index below n (rejection sampling: no modulo bias). */
function pick(n: number, random: Random): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const word = new Uint32Array(1);
  for (;;) {
    random(word);
    if (word[0] < limit) return word[0] % n;
  }
}

/**
 * A password to hand over: three groups of four, like "kp7R-m2xd-Wq9f".
 * Fourteen characters, about 60 bits, and every kind Supabase Auth can be
 * set to demand — lower case, upper case, a digit and a symbol (the dashes)
 * — so it is never the generated password that gets refused.
 */
export function generatePassword(random: Random = cryptoRandom): string {
  const chars = Array.from({ length: 12 }, () => ALL[pick(ALL.length, random)]);
  // One of each kind, at three different places.
  const places = [...chars.keys()];
  for (const set of [LOWER, UPPER, DIGITS]) {
    const at = places.splice(pick(places.length, random), 1)[0];
    chars[at] = set[pick(set.length, random)];
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join('')).join('-');
}

/** What create-waiter and waiter-login make of a typed username. */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, '');
}

/**
 * A username from the name typed: "Amra Hodžić" → "amra". Usernames are
 * shared by both restaurants, so a common first name may be taken; the
 * admin then types another.
 */
export function suggestUsername(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  const plain = first.toLowerCase().replace(/đ/g, 'dj').normalize('NFD').replace(/[̀-ͯ]/g, '');
  return normalizeUsername(plain);
}

/** A kitchen tablet's username: one per restaurant, never the other's. */
export const kitchenUsername = (slug: string) => `${slug}-kitchen`;

/** An account Admin → Waiters made for a kitchen tablet (or one named like it). */
export const isKitchenUsername = (username: string | null | undefined) => !!username && username.endsWith('-kitchen');

/** The site a restaurant's staff sign in on: its own once that is up, else La Soul's, which serves both. */
export function staffSiteUrl(slug: string): string {
  return OWN_SITE_LIVE[slug] && VENUE_URLS[slug] ? VENUE_URLS[slug] : VENUE_URLS[DEFAULT_VENUE];
}

/**
 * Where to open to sign in. Admins at /admin/login with their email; waiters
 * and kitchen tablets at /waiter/login with their username already filled
 * in, the kitchen's going on to the kitchen screen.
 */
export function signInUrl(kind: StaffKind, slug: string, username?: string): string {
  const site = staffSiteUrl(slug);
  if (kind === 'admin') return `${site}/admin/login`;
  const query = new URLSearchParams();
  if (username) query.set('u', username);
  if (kind === 'kitchen') query.set('to', 'kitchen');
  const qs = query.toString();
  return `${site}/waiter/login${qs ? `?${qs}` : ''}`;
}

/** Where /waiter/login?to=… goes after signing in. Only these; anything else is the waiter's phone. */
export function afterWaiterSignIn(to: string | null): '/waiter' | '/kitchen' | '/waiter/monitor' {
  if (to === 'kitchen') return '/kitchen';
  if (to === 'monitor') return '/waiter/monitor';
  return '/waiter';
}

/** Everything the login card shows, and the text it copies and shares. */
export interface LoginDetails {
  kind: StaffKind;
  venueSlug: string;
  venueName: string;
  /** Who it is for: "Marko", "Kitchen", or an admin's email. */
  name: string;
  /** What they type first: a waiter's username, an admin's email. */
  username: string;
  /** Shown once; null for an account that keeps the password it has. */
  password: string | null;
  /** The waiter's Floor PIN, when the function made or set one. */
  pin?: string | null;
  /** A new account, a new password for one, or a role for an account that already exists. */
  event: 'created' | 'reset' | 'appointed';
}

const ROLE_WORDS: Record<StaffKind, string> = { admin: 'admin', waiter: 'waiter', kitchen: 'kitchen tablet' };

/** The card as plain text, for a message: the address on its own line so a phone makes it a link. */
export function loginCardText(d: LoginDetails): string {
  const lines = [
    `${d.venueName} · ${ROLE_WORDS[d.kind]} sign-in${d.kind === 'admin' ? '' : ` for ${d.name}`}`,
    signInUrl(d.kind, d.venueSlug, d.kind === 'admin' ? undefined : d.username),
    `${d.kind === 'admin' ? 'Email' : 'Username'}: ${d.username}`,
    d.password ? `Password: ${d.password}` : 'Password: the one they already use',
  ];
  if (d.kind === 'waiter' && d.pin) lines.push(`Floor PIN (the shared floor screen): ${d.pin}`);
  if (d.kind === 'admin' && d.password) lines.push('Change the password after signing in: admin menu → Change password.');
  return lines.join('\n');
}

/** Why an Edge Function said no. */
export interface Refusal {
  message: string;
  code?: string;
  /** The HTTP status, when there was an answer at all. */
  status?: number;
}

/**
 * The function's own reason, in its own words.
 *
 * supabase-js turns every non-2xx answer into "Edge Function returned a
 * non-2xx status code" and keeps the body — where the function says why —
 * on the error's `context`, the Response. Read it there. Null when nothing
 * went wrong.
 */
export async function readRefusal(error: unknown, data: unknown, fn: string): Promise<Refusal | null> {
  const body = data as { error?: unknown; code?: unknown } | null | undefined;
  if (!error) {
    return typeof body?.error === 'string' ? { message: body.error, code: typeof body.code === 'string' ? body.code : undefined } : null;
  }
  const context = (error as { context?: unknown }).context;
  if (typeof Response !== 'undefined' && context instanceof Response) {
    const reason = await context.clone().json().catch(() => null) as { error?: unknown; code?: unknown } | null;
    if (typeof reason?.error === 'string') {
      return { message: reason.error, code: typeof reason.code === 'string' ? reason.code : undefined, status: context.status };
    }
    if (context.status === 404) {
      return { message: `The ${fn} function is not deployed. Ask Lovable to deploy it.`, status: 404 };
    }
    return { message: `The ${fn} function failed (HTTP ${context.status}). Try again in a minute.`, status: context.status };
  }
  if ((error as { name?: string }).name === 'FunctionsFetchError') {
    return { message: 'Could not reach the server. Check the internet connection and try again.' };
  }
  return { message: error instanceof Error ? error.message : `The ${fn} function failed` };
}

/** Which field a refusal is about, so it can be said next to it. */
export function refusalField(r: Refusal): 'password' | 'username' | null {
  if (r.code === 'weak_password' || r.code === 'needs_password') return 'password';
  if (r.code === 'username_taken') return 'username';
  // A function from before these codes: Auth's own words, or its own.
  if (/already (been )?registered|already taken|email_exists/i.test(r.message)) return 'username';
  if (/password/i.test(r.message) && !/username \(3\+/i.test(r.message)) return 'password';
  return null;
}

/**
 * The refusal in words for the person at the form. Auth's raw "Password
 * should be…" from a function too old to say who refused gets a subject.
 */
export function plainRefusal(r: Refusal): string {
  if (/^Password should/i.test(r.message)) return `Supabase Auth refused the password: ${r.message}`;
  if (/already (been )?registered|email_exists/i.test(r.message)) {
    return 'An older sign-in already uses that username. Pick another one.';
  }
  return r.message;
}
