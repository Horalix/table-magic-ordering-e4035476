import { supabase } from '@/integrations/supabase/client';

export interface SectionAssignment {
  id: string;
  section_id: string;
  waiter_id: string;
  shift_date: string;
}

export const todayISO = () => new Date().toISOString().slice(0, 10);

/**
 * Assign (or clear) the waiter covering a section for a given shift date.
 * One waiter per section per day — this matches the auto-assign DB trigger
 * that routes new table sessions to the section's waiter for today.
 * Pass the existing assignment row (if any) so we update instead of duplicate.
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
