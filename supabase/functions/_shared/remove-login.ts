/**
 * Deleting a sign-in for good: the owner's Remove on Team (manage-admins
 * `remove`) and the last role of a waiter let go under Waiters (delete-waiter).
 *
 * Supabase Auth deletes the account's row in auth.users. Its roles go with it
 * (user_roles: ON DELETE CASCADE), and most columns that say who did something
 * let go of it by themselves (paid_by, cancelled_by, …: ON DELETE SET NULL).
 * These five were made without that, so Auth refused to delete anyone who had
 * ever acknowledged or resolved a guest's call or bill, or closed a shift —
 * "Database error deleting user" — that is, every waiter who had worked a
 * shift. They let go here first, as the others do; the call, the bill and the
 * shift close stay, without the name.
 *
 * supabase/tests/remove-login.test.ts reads every foreign key to auth.users
 * after all the migrations and checks it is one of these, or lets go itself.
 */
export const SIGNED_BY = [
  { table: 'waiter_calls', column: 'acknowledged_by' },
  { table: 'waiter_calls', column: 'resolved_by' },
  { table: 'bill_requests', column: 'acknowledged_by' },
  { table: 'bill_requests', column: 'resolved_by' },
  { table: 'shift_closes', column: 'closed_by' },
] as const;

/** `UPDATE table SET column = null WHERE column = userId`, with the service role. */
export type ClearColumn = (
  table: string,
  column: string,
  userId: string,
) => PromiseLike<{ error: { message: string } | null }>;

/**
 * Lets go of the account in every SIGNED_BY column. The first refusal is
 * returned, as "table.column: message", and nothing after it is tried; null
 * when all went through.
 */
export async function releaseSignatures(clear: ClearColumn, userId: string): Promise<string | null> {
  for (const { table, column } of SIGNED_BY) {
    const { error } = await clear(table, column, userId);
    if (error) return `${table}.${column}: ${error.message}`;
  }
  return null;
}
