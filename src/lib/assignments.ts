import { supabase } from '@/integrations/supabase/client';
import { localDayISO } from '@/lib/reporting';

export interface SectionAssignment {
  id: string;
  section_id: string;
  waiter_id: string;
  shift_date: string;
}

/**
 * Today, in the restaurant's timezone.
 *
 * This used to be `toISOString().slice(0,10)` — the UTC date. In Bosnia
 * (UTC+1/+2) that means between local midnight and 01:00 or 02:00 it returned
 * *yesterday*, so a manager opening the floor plan at 00:30 during a late
 * service saw the previous night's assignments, and the "Back to today" button
 * navigated them further from reality. The database trigger uses CURRENT_DATE
 * in server time, so the client and server also disagreed about which shift a
 * new session belonged to.
 */
export const todayISO = () => localDayISO();

/**
 * Assign (or clear) the single waiter covering a section for a shift date.
 *
 * NOTE: superseded. Migration `20260622203436_*` replaced the
 * `UNIQUE(section_id, shift_date)` constraint with
 * `UNIQUE(section_id, waiter_id, shift_date)` and rewrote the auto-assign
 * trigger to load-balance across *multiple* waiters per section. Use
 * `addSectionWaiter` / `removeSectionAssignment`. Kept only so an older caller
 * does not break; it has no callers in this repository.
 */
export async function setSectionWaiter(
  sectionId: string,
  waiterId: string | null,
  date: string,
  existing?: Pick<SectionAssignment, 'id'> | null,
): Promise<{ error: string | null }> {
  let error = null;
  if (!waiterId) {
    if (existing) {
      const res = await supabase.from('section_assignments').delete().eq('id', existing.id);
      error = res.error?.message ?? null;
    }
  } else if (existing) {
    const res = await supabase.from('section_assignments').update({ waiter_id: waiterId }).eq('id', existing.id);
    error = res.error?.message ?? null;
  } else {
    const res = await supabase.from('section_assignments').insert({ section_id: sectionId, waiter_id: waiterId, shift_date: date });
    error = res.error?.message ?? null;
  }
  return { error };
}

/** Add one waiter to a section for a shift (multiple waiters per section allowed). */
export async function addSectionWaiter(sectionId: string, waiterId: string, date: string): Promise<{ error: string | null }> {
  const res = await supabase.from('section_assignments').insert({ section_id: sectionId, waiter_id: waiterId, shift_date: date });
  return { error: res.error?.message ?? null };
}

/** Remove one specific waiter assignment by row id. */
export async function removeSectionAssignment(id: string): Promise<{ error: string | null }> {
  // Optimistic UI hands us a temporary id before the insert has landed; deleting
  // it would match nothing and look like success. Say so instead.
  if (id.startsWith('tmp-')) return { error: 'still-saving' };
  const res = await supabase.from('section_assignments').delete().eq('id', id);
  return { error: res.error?.message ?? null };
}
