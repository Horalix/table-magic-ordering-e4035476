/**
 * The demo's front page (demo mode only): every screen of the product, one
 * tap away, each opening as the person who would use it. No passwords — an
 * area's demo account is signed in when its page opens (src/demo/session.ts).
 */
import { useEffect, useState } from 'react';
import {
  ArrowUpRight, CalendarCheck, ChefHat, LayoutDashboard, MonitorPlay, Presentation, RotateCcw, Smartphone, Tv, UserRound, Users,
} from 'lucide-react';
import { ACCOUNTS, PRODUCT, RESTAURANT, guestTablePath } from '../brand';
import { demoRuntime } from '../runtime';
import { clearSignedOut } from '../session';
import { DemoMonogram } from './Brand';

interface Screen {
  title: string;
  who: string;
  what: string;
  href: string;
  icon: typeof Smartphone;
  device: 'Phone' | 'Tablet' | 'Desktop' | 'TV';
  area?: keyof typeof ACCOUNTS;
}

const SCREENS: Screen[] = [
  {
    title: 'Guest', who: `Table ${RESTAURANT.guestTable}, scanning the QR code`, device: 'Phone', icon: Smartphone,
    what: 'Browse the menu in three languages, add to the order, pay at the table or by card, follow the order, call the waiter.',
    href: guestTablePath(),
  },
  {
    title: 'Kitchen display', who: 'The kitchen tablet', device: 'Tablet', icon: ChefHat, area: 'kitchen',
    what: 'New tickets arrive with a chime. Start, bump dish by dish, mark ready. Kitchen and bar see their own lines.',
    href: '/kitchen',
  },
  {
    title: 'Waiter', who: 'Amra, on the terrace', device: 'Phone', icon: UserRound, area: 'waiter',
    what: 'Her tables, what is ready to carry, calls and bill requests, taking payment and closing the table.',
    href: '/waiter',
  },
  {
    title: 'Admin', who: 'The owner', device: 'Desktop', icon: LayoutDashboard, area: 'admin',
    what: 'Today’s sales, analytics, menu engineering, prep forecast, promotions, reservations, team, printers and QR codes.',
    href: '/admin',
  },
  {
    title: 'TV menu board', who: 'The screen at the entrance', device: 'TV', icon: Tv,
    what: 'The menu as a rotating board: featured dishes, offers and prices, always current.',
    href: '/tv',
  },
  {
    title: 'Floor monitor', who: 'The shared screen at the pass', device: 'Tablet', icon: MonitorPlay, area: 'monitor',
    what: `Every table at a glance. A waiter taps their name and PIN (${RESTAURANT.floorPin} for everyone here) to act on one.`,
    href: '/waiter/monitor',
  },
  {
    title: 'Reservations', who: 'A guest booking a table', device: 'Phone', icon: CalendarCheck,
    what: 'Ask for a table online; the restaurant confirms or proposes another time in Admin → Reservations.',
    href: '/reserve',
  },
  {
    title: 'Side by side', who: 'For presenting', device: 'Desktop', icon: Presentation,
    what: 'The guest’s phone next to the kitchen display, live: order on the left, watch it land on the right.',
    href: '/demo/stage',
  },
];

const STEPS = [
  ['Guest', `Open Guest. Add a Casa Burger and a drink, send the order, choose “Pay at the table”.`],
  ['Kitchen', 'Open Kitchen display in a second tab. The ticket is already there. Start it, then mark it ready.'],
  ['Waiter', 'Open Waiter. The table shows “ready”. Serve it, take the payment, close the table.'],
  ['Admin', 'Open Admin. The sale is in today’s numbers; Analytics and Menu intelligence show ten weeks of trading.'],
];

const DemoHub = () => {
  const [facts, setFacts] = useState<{ orders: number; days: number; open: number } | null>(null);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    document.title = `${PRODUCT.name} — ${PRODUCT.byline}`;
    document.documentElement.setAttribute('dir', 'ltr');
    document.documentElement.setAttribute('lang', 'en');
    let cancelled = false;
    void demoRuntime().then(async ({ db }) => {
      const { rows } = await db.query<{ orders: number; days: number; open: number }>(
        `SELECT (SELECT count(*) FROM public.orders)::int AS orders,
                (SELECT count(DISTINCT public.business_day(created_at)) FROM public.orders)::int AS days,
                (SELECT count(*) FROM public.table_sessions WHERE is_active)::int AS open`);
      if (!cancelled && rows[0]) setFacts(rows[0]);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const reset = () => {
    if (!window.confirm('Reset the demo? Every order, change and sign-in made here goes back to the starting point, in all open tabs.')) return;
    setResetting(true);
    void demoRuntime().then((runtime) => runtime.reset());
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="relative overflow-hidden" style={{ backgroundColor: 'hsl(150, 16%, 24%)' }}>
        <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-10 pb-12 sm:pt-14 sm:pb-16">
          <p className="font-sans text-[11px] font-semibold uppercase tracking-[0.32em] text-white/70">{PRODUCT.byline}</p>
          <h1 className="mt-3 font-serif text-4xl sm:text-6xl font-semibold text-white leading-[1.05]">{PRODUCT.name}</h1>
          <p className="mt-4 max-w-2xl font-sans text-base sm:text-lg text-white/85">{PRODUCT.tagline}.</p>
          <div className="mt-8 inline-flex items-center gap-4 rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
            <DemoMonogram tone="dark" className="h-12 w-12 shrink-0" />
            <div className="min-w-0">
              <p className="font-serif text-xl font-semibold text-white leading-tight">{RESTAURANT.name}</p>
              <p className="font-sans text-sm text-white/75">
                {RESTAURANT.tagline} · {RESTAURANT.city}
                {facts && ` · ${facts.orders.toLocaleString('en')} orders over ${facts.days} days · ${facts.open} tables seated now`}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 sm:px-8 py-8 sm:py-12 space-y-12">
        <section aria-labelledby="demo-screens">
          <h2 id="demo-screens" className="font-serif text-2xl font-semibold">Open a screen</h2>
          <p className="mt-1 font-sans text-sm text-muted-foreground">
            Each opens in a new tab, already signed in. Keep them in this browser: the tabs share one live restaurant.
          </p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SCREENS.map((screen) => (
              <a
                key={screen.title}
                href={screen.href}
                target="_blank"
                rel="noopener"
                onClick={() => { if (screen.area) clearSignedOut(screen.area); }}
                className="group flex flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <screen.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="rounded-full bg-muted px-2.5 py-1 font-sans text-[11px] font-semibold text-muted-foreground">{screen.device}</span>
                </div>
                <h3 className="mt-4 flex items-center gap-1.5 font-serif text-xl font-semibold">
                  {screen.title}
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-primary" aria-hidden />
                </h3>
                <p className="mt-0.5 font-sans text-xs font-medium text-primary">{screen.who}</p>
                <p className="mt-2 font-sans text-sm text-muted-foreground leading-relaxed">{screen.what}</p>
              </a>
            ))}
          </div>
        </section>

        <section aria-labelledby="demo-walkthrough" className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <h2 id="demo-walkthrough" className="font-serif text-2xl font-semibold">A five-minute walkthrough</h2>
            <ol className="mt-5 space-y-3">
              {STEPS.map(([title, text], i) => (
                <li key={title} className="flex gap-4 rounded-2xl border border-border bg-card p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary font-sans text-sm font-semibold text-primary-foreground">{i + 1}</span>
                  <p className="font-sans text-sm leading-relaxed">
                    <span className="font-semibold">{title}.</span> {text}
                  </p>
                </li>
              ))}
            </ol>
          </div>
          <div className="space-y-4">
            <div className="rounded-2xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 font-serif text-lg font-semibold"><Users className="h-4 w-4 text-primary" aria-hidden /> Good to know</h2>
              <ul className="mt-3 space-y-2 font-sans text-sm text-muted-foreground leading-relaxed">
                <li>Everything runs in this browser. There is no server and no internet is needed.</li>
                <li>The small <span className="font-semibold text-foreground">Demo</span> tab at the edge of every screen sends in new guests, makes a table call the waiter, or resets the data.</li>
                <li>Card payment is simulated: the card is filled in, and nothing is charged.</li>
                <li>Close the demo and come back tomorrow: the restaurant will have carried on trading.</li>
              </ul>
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={resetting}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 py-3 font-sans text-sm font-semibold text-foreground transition hover:border-destructive/40 hover:text-destructive disabled:opacity-60"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> {resetting ? 'Resetting…' : 'Reset the demo data'}
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

export default DemoHub;
