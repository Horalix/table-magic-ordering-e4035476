import { Link } from 'react-router-dom';
import { Ellipsis } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AREAS, pagesIn } from '@/components/admin/nav/admin-nav';
import { areaLanding } from '@/components/admin/nav/nav-memory';
import { WaitingBadge, WaitingWords } from '@/components/admin/nav/NavParts';
import type { AdminShell } from '@/components/admin/nav/shell';

/**
 * The phone's bottom bar: the same areas as the laptop's sidebar.
 *
 * Home, Service, Menu and Reports are one tap away with a thumb; Service
 * carries the number of guests waiting for an answer about a table, the one
 * thing that rings the manager's phone. Setup, the other screens and the
 * account are behind More (nav/MoreSheet.tsx), which is lit while a Setup
 * page is open. The pages inside an area are the chips under the top bar.
 */

const item = 'relative flex min-h-[56px] w-full flex-col items-center justify-center gap-1 font-sans text-[11px] leading-none transition-colors focus-visible:outline-none focus-visible:bg-muted';

const AdminMobileTabs = ({ shell, moreOpen, onMore }: { shell: AdminShell; moreOpen: boolean; onMore: () => void }) => {
  const areas = AREAS.filter((a) => a.id !== 'setup');
  const inMore = shell.area === 'setup';
  return (
    <nav
      aria-label="Admin quick navigation"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/80 bg-background/[0.97] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur-md lg:hidden print:hidden"
    >
      <ul className="mx-auto grid max-w-xl grid-cols-5">
        {areas.map((area) => {
          const pages = pagesIn(area.id, shell.audience);
          if (!pages.length) return <li key={area.id} />;
          const active = shell.area === area.id;
          // The area you are in goes to its first page; any other, to where you last were in it.
          const to = (active ? pages[0] : areaLanding(area.id, shell.audience) ?? pages[0]).path;
          const waiting = area.id === 'service' ? shell.pending : 0;
          return (
            <li key={area.id}>
              <Link
                to={to}
                aria-current={active ? 'location' : undefined}
                className={cn(item, active ? 'font-semibold text-primary' : 'text-muted-foreground')}
              >
                <span className="relative">
                  <area.icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.8} aria-hidden />
                  {waiting > 0 && (
                    <WaitingBadge count={waiting} className="absolute -right-3 -top-1.5 h-[18px] min-w-[18px] px-1 ring-2 ring-background" />
                  )}
                </span>
                <span>{area.label}{waiting > 0 && <WaitingWords count={waiting} />}</span>
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={cn(item, inMore ? 'font-semibold text-primary' : 'text-muted-foreground')}
          >
            <Ellipsis className="h-[22px] w-[22px]" strokeWidth={inMore ? 2.2 : 1.8} aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default AdminMobileTabs;
