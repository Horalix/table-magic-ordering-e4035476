import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { KeyRound, LogOut } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { springPill } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { AREAS, LAUNCHERS, pagesIn } from './admin-nav';
import { areaLanding } from './nav-memory';
import { LauncherLink, OpensElsewhere, RestaurantSwitch, SearchField, WaitingBadge } from './NavParts';
import { waitingLabel, type AdminShell } from './shell';

/**
 * The sidebar, on a laptop and wider: the restaurant, the search, the five
 * areas, the two other screens, the account. Short enough never to scroll at
 * 1366×768; the pages of an area are the tabs at the top of the content
 * (AreaTabs.tsx), not a list here.
 */

const quiet = 'flex w-full items-center gap-3 rounded-lg px-3 font-sans text-sm text-sidebar-foreground/70 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

const AdminSidebar = ({ shell }: { shell: AdminShell }) => (
  <aside className="sticky top-0 hidden h-[100dvh] w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex print:hidden">
    <div className="px-5 pb-4 pt-6">
      {shell.venueName
        ? <p data-testid="admin-venue" className="truncate font-serif text-xl font-semibold leading-tight text-sidebar-foreground">{shell.venueName}</p>
        : <Skeleton aria-label="Loading the restaurant" className="h-6 w-32 rounded bg-sidebar-accent/60" />}
      <p className="mt-1 font-sans text-xs text-sidebar-foreground/55">{shell.owner ? 'Owner · admin' : 'Admin'}</p>
      {shell.choices.length > 1 && <div className="mt-3"><RestaurantSwitch shell={shell} tone="sidebar" /></div>}
    </div>

    <div className="px-3">
      <SearchField onOpen={shell.openSearch} tone="sidebar" />
    </div>

    <nav aria-label="Admin menu" className="mt-4 px-3">
      <ul className="space-y-0.5">
        {AREAS.map((area) => {
          const pages = pagesIn(area.id, shell.audience);
          if (!pages.length) return null;
          const active = shell.area === area.id;
          // The area you are in goes to its first page; any other, to where you last were in it.
          const to = (active ? pages[0] : areaLanding(area.id, shell.audience) ?? pages[0]).path;
          const waiting = area.id === 'service' ? shell.pending : 0;
          return (
            <li key={area.id}>
              <Link
                to={to}
                aria-current={active ? 'location' : undefined}
                className={cn(
                  'relative flex h-11 items-center gap-3 rounded-lg px-3 font-sans text-[15px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  active ? 'font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/40 hover:text-sidebar-foreground',
                )}
              >
                {active && <motion.span layoutId="admin-area-active" transition={springPill} className="absolute inset-0 rounded-lg bg-sidebar-accent" />}
                <area.icon className="relative h-[18px] w-[18px] shrink-0" aria-hidden />
                <span className="relative min-w-0 flex-1 truncate">{area.label}</span>
                {waiting > 0 && <WaitingBadge count={waiting} label={waitingLabel(waiting)} className="relative" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>

    <div className="mx-5 my-4 h-px shrink-0 bg-sidebar-border" />

    <div className="px-3">
      <p id="admin-other-screens" className="mb-1 px-3 font-sans text-[10px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/40">Other screens</p>
      <ul aria-labelledby="admin-other-screens" className="space-y-0.5">
        {LAUNCHERS.map((launcher) => (
          <li key={launcher.path}>
            <LauncherLink launcher={launcher} shell={shell} className={cn(quiet, 'h-11')}>
              <launcher.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-left">{launcher.label}</span>
              <OpensElsewhere />
            </LauncherLink>
          </li>
        ))}
      </ul>
    </div>

    <div className="mt-auto border-t border-sidebar-border px-3 pb-3 pt-3">
      {shell.email && (
        <p className="truncate px-3 pb-1.5 font-sans text-xs text-sidebar-foreground/55" title={shell.email}>{shell.email}</p>
      )}
      <button type="button" onClick={shell.changePassword} className={cn(quiet, 'h-11')}>
        <KeyRound className="h-4 w-4 shrink-0" aria-hidden />
        Change password
      </button>
      <button type="button" onClick={shell.signOut} className={cn(quiet, 'h-11')}>
        <LogOut className="h-4 w-4 shrink-0" aria-hidden />
        Sign out
      </button>
    </div>
  </aside>
);

export default AdminSidebar;
