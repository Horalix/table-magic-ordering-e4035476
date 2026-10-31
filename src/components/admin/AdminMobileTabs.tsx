import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ClipboardList, LayoutDashboard, LayoutGrid, Menu as MenuIcon, Printer, UtensilsCrossed } from 'lucide-react';

/**
 * The four admin jobs that happen on a phone, mid-service, one tap away.
 *
 * Everything else stays in the drawer. These are the ones a manager does
 * standing at the pass: see how today is going, find an order, take a dish
 * off (or change its price), check the printers.
 */
const TABS = [
  { label: 'Today', path: '/admin', icon: LayoutDashboard },
  { label: 'Orders', path: '/admin/orders', icon: ClipboardList },
  { label: 'Menu', path: '/admin/menu', icon: UtensilsCrossed },
  { label: 'Printing', path: '/admin/printing', icon: Printer },
] as const;

/** The owner's first look, wherever they are: both restaurants at once. */
const OWNER_TAB = { label: 'Overview', path: '/admin/overview', icon: LayoutGrid } as const;

const AdminMobileTabs = ({ owner = false, onMore }: { owner?: boolean; onMore: () => void }) => {
  const { pathname } = useLocation();
  const tabs = owner ? [OWNER_TAB, ...TABS] : TABS;
  return (
    <nav
      aria-label="Admin quick navigation"
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-border bg-background/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      <ul className={`grid ${owner ? 'grid-cols-6' : 'grid-cols-5'}`}>
        {tabs.map(({ label, path, icon: Icon }) => {
          const active = path === '/admin' ? pathname === '/admin' : pathname.startsWith(path);
          return (
            <li key={path}>
              <Link
                to={path}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-sans ${active ? 'text-primary font-semibold' : 'text-muted-foreground'}`}
              >
                <Icon className="w-5 h-5" aria-hidden />
                {label}
              </Link>
            </li>
          );
        })}
        <li>
          <button
            type="button"
            onClick={onMore}
            className="w-full flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-sans text-muted-foreground"
          >
            <MenuIcon className="w-5 h-5" aria-hidden />
            More
          </button>
        </li>
      </ul>
    </nav>
  );
};

export default AdminMobileTabs;
