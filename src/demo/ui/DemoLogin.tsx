/**
 * The sign-in pages in the demo (demo mode only): /admin/login and
 * /waiter/login. Nobody has a password to type, so instead of the forms they
 * offer each demo account as one tap. Normally these pages are never seen —
 * a staff screen signs its account in by itself (src/demo/session.ts) — only
 * after someone signs out.
 */
import { useEffect } from 'react';
import { ChefHat, LayoutDashboard, MonitorPlay, UserRound } from 'lucide-react';
import { ACCOUNTS, PRODUCT, RESTAURANT, type DemoArea } from '../brand';
import { clearSignedOut } from '../session';
import { DemoLockup } from './Brand';

const CHOICES: { area: DemoArea; href: string; title: string; note: string; icon: typeof UserRound }[] = [
  { area: 'admin', href: '/admin', title: 'Owner', note: 'The admin: sales, menu, team', icon: LayoutDashboard },
  { area: 'waiter', href: '/waiter', title: 'Waiter', note: 'Amra’s phone, on the terrace', icon: UserRound },
  { area: 'kitchen', href: '/kitchen', title: 'Kitchen', note: 'The kitchen display', icon: ChefHat },
  { area: 'monitor', href: '/waiter/monitor', title: 'Floor monitor', note: `Waiters tap their name and PIN ${RESTAURANT.floorPin}`, icon: MonitorPlay },
];

const DemoLogin = () => {
  useEffect(() => {
    document.title = `${RESTAURANT.name} — sign in · ${PRODUCT.name} demo`;
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', 'en');
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10" style={{ backgroundColor: 'hsl(150, 16%, 24%)' }}>
      <div className="w-full max-w-sm">
        <DemoLockup />
        <p className="mt-8 text-center font-sans text-sm text-white/80">This is a demo: choose who to sign in as. No password needed.</p>
        <div className="mt-5 space-y-2.5">
          {CHOICES.map((choice) => (
            <a
              key={choice.area}
              href={choice.href}
              onClick={() => clearSignedOut(choice.area)}
              className="flex items-center gap-4 rounded-2xl bg-white px-4 py-3.5 shadow-lg transition hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <choice.icon className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block font-serif text-lg font-semibold text-foreground leading-tight">{choice.title}</span>
                <span className="block font-sans text-xs text-muted-foreground">{choice.note} · {ACCOUNTS[choice.area].label}</span>
              </span>
            </a>
          ))}
        </div>
        <a href="/" className="mt-6 block text-center font-sans text-sm font-medium text-white/80 underline underline-offset-4 hover:text-white">
          All demo screens
        </a>
      </div>
    </div>
  );
};

export default DemoLogin;
