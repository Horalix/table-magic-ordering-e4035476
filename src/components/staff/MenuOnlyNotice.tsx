import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useMenuOnly } from '@/hooks/useMenuOnly';

/**
 * Says, on every staff screen, that the restaurant shows its menu only
 * (Admin → Ordering & service). Without it a quiet screen looked broken: the
 * waiter's phone said a manager had not assigned a section, the floor told
 * guests to scan the code, the kitchen waited for orders that the database
 * refuses while Menu only is on (20261103120000_menu_only.sql).
 *
 * Shown only once the answer is known to be "on"; the live feed refreshes it
 * when the switch changes (src/lib/realtime.ts).
 */
export type MenuOnlyAudience = 'admin' | 'waiter' | 'kitchen';

const MENU_ONLY_WORDS: Record<MenuOnlyAudience, string> = {
  admin: 'Guests can read the menu but cannot order, call a waiter or ask for the bill from their phones. Orders, tables and sales stay empty until ordering is on.',
  waiter: 'Guests can read the menu on their phones but cannot order, call you or ask for the bill. Take orders the usual way.',
  kitchen: 'No orders come from guests’ phones while it is on. Take and send orders the usual way.',
};

interface Props {
  audience: MenuOnlyAudience;
  /** On the notice itself. */
  className?: string;
  /** A wrapper to lay it out in, rendered only with the notice. */
  outerClassName?: string;
}

const MenuOnlyNotice = ({ audience, className = '', outerClassName }: Props) => {
  const menuOnly = useMenuOnly();
  if (menuOnly !== true) return null;
  const notice = (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl border border-primary/25 bg-primary/10 px-3.5 py-2.5 text-sm font-sans text-foreground ${className}`}
    >
      <BookOpen className="w-4 h-4 shrink-0 mt-0.5 text-primary" aria-hidden />
      <p className="leading-snug">
        <span className="font-semibold">Menu only is on.</span> {MENU_ONLY_WORDS[audience]}
        {audience === 'admin' && (
          <>
            {' '}
            <Link to="/admin/service" className="underline underline-offset-2 font-medium whitespace-nowrap">Change it</Link>
          </>
        )}
      </p>
    </div>
  );
  return outerClassName ? <div className={outerClassName}>{notice}</div> : notice;
};

export default MenuOnlyNotice;
