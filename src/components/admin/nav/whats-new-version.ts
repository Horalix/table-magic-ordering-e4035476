/**
 * Which "What's new" walkthrough is current, and where a device remembers
 * that an admin has seen it (WhatsNewTour.tsx).
 *
 * A file of its own with no imports, so the browser tests' fixtures can read
 * it too (e2e/staff-fixtures.ts marks it seen, or it would open over every
 * page under test).
 *
 * To show a walkthrough again after a later update: change the steps in
 * whats-new.ts and this version. Every admin then sees it once more.
 */
export const WHATS_NEW_VERSION = '2026-11-design';

/** One key per account: a laptop two managers share shows it to each of them. */
export const whatsNewKey = (userId: string) => `tf.whatsNew.${userId}`;
