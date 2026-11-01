/**
 * @vitest-environment node
 *
 * create-waiter's two jobs (Admin → Waiters): adding a waiter or kitchen
 * tablet, and giving a waiter who forgot theirs a new password. Both act
 * with the service role, so who may do what is decided in the function and
 * src/lib's tests cannot see it; these pin it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { mayResetLogin, type RoleRow } from '../functions/_shared/venue-access.ts';

const ROOT = path.join(__dirname, '..', '..');
const source = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');

const L = 'a5000000-0000-4000-8000-000000000001'; // La Soul
const V = 'a5000000-0000-4000-8000-000000000002'; // Vera Italia

describe('a new password for a waiter (reset_password)', () => {
  const owner: RoleRow[] = [{ role: 'admin', venue_id: null }];
  const adminL: RoleRow[] = [{ role: 'admin', venue_id: L }];
  const adminV: RoleRow[] = [{ role: 'admin', venue_id: V }];
  const ids = { userId: 'waiter-1', callerId: 'admin-1' };

  it('their restaurant’s admin, or the owner, may give one', () => {
    const waiterL: RoleRow[] = [{ role: 'staff', venue_id: L }];
    expect(mayResetLogin(adminL, waiterL, ids)).toBe(true);
    expect(mayResetLogin(owner, waiterL, ids)).toBe(true);
    expect(mayResetLogin(adminV, waiterL, ids)).toBe(false);
  });

  it('not to a sign-in that also works at a restaurant the caller does not run: the password opens both', () => {
    const atBoth: RoleRow[] = [{ role: 'staff', venue_id: L }, { role: 'staff', venue_id: V }];
    expect(mayResetLogin(adminL, atBoth, ids)).toBe(false);
    expect(mayResetLogin(owner, atBoth, ids)).toBe(true);
  });

  it('never to an account that manages a restaurant, the owner’s included: admins change their own', () => {
    expect(mayResetLogin(adminL, [{ role: 'staff', venue_id: L }, { role: 'admin', venue_id: V }], ids)).toBe(false);
    expect(mayResetLogin(owner, [{ role: 'staff', venue_id: L }, { role: 'admin', venue_id: L }], ids)).toBe(false);
    expect(mayResetLogin(owner, [{ role: 'staff', venue_id: L }, { role: 'admin', venue_id: null }], ids)).toBe(false);
  });

  it('never their own, and not when the roles could not be read', () => {
    expect(mayResetLogin(owner, [{ role: 'staff', venue_id: L }], { userId: 'me', callerId: 'me' })).toBe(false);
    expect(mayResetLogin(owner, null, ids)).toBe(false);
  });

  it('the function decides through it, for the waiter’s own restaurant, and checks the length', () => {
    const fn = source('supabase/functions/create-waiter/index.ts');
    expect(fn).toContain("body.action === 'reset_password'");
    expect(fn).toContain('managesVenue(callerRoles, waiter.venue_id)');
    expect(fn).toContain('mayResetLogin(callerRoles,');
    expect(fn).toContain('admin.auth.admin.updateUserById(waiter.user_id, { password })');
    // The length check comes before Auth is asked, in the reset as in the create.
    expect(fn.match(/password\.length < MIN_PASSWORD/g)).toHaveLength(2);
  });
});

describe('adding a waiter', () => {
  const fn = source('supabase/functions/create-waiter/index.ts');

  it('asks for 10 characters, the live Auth minimum, and says Auth’s refusal in Auth’s words', () => {
    expect(fn).toContain('const MIN_PASSWORD = 10;');
    expect(fn).not.toMatch(/password\.length < 6/);
    expect(fn).toMatch(/Supabase Auth refused the password: \$\{message\}/);
    expect(fn).toContain("code: 'weak_password'");
    expect(fn).toContain("code: 'username_taken'");
  });

  it('leaves no sign-in behind when the role or the waiter row cannot be made', () => {
    expect(fn).toContain('admin.auth.admin.deleteUser(userId)');
    // Both failure paths undo before answering.
    expect(fn.match(/await undo\(\);/g)).toHaveLength(2);
  });

  it('still decides the restaurant through resolveAdminVenue, as admin-separation pins', () => {
    expect(fn).toContain('resolveAdminVenue(callerRoles, namedVenue(body, req)');
  });

  it('never logs or returns a password', () => {
    expect(fn).not.toMatch(/console\.\w+\([^)]*password/);
    // No answer carries it as a field (the words "the password" in a message are fine).
    expect(fn).not.toMatch(/reply\([^)]*[{,]\s*password\s*[,}:]/);
  });
});
