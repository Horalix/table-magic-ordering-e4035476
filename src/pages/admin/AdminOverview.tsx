import React from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CheckCircle2, ChefHat, CreditCard, Hand, Printer, RefreshCw,
  ShieldAlert, Star, Timer, TrendingDown, TrendingUp, Users, UtensilsCrossed, Wallet,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { chooseStaffVenue } from '@/lib/current-venue';
import { formatClock } from '@/lib/timing';
import { VENUES } from '@/lib/venues';
import { staggerContainer, fadeUp } from '@/lib/motion';

/**
 * The owner's first screen: La Soul and Vera Italia side by side, today.
 *
 * Each card is one restaurant's own numbers from owner_overview()
 * (20261031110000_owner_overview.sql), the same figures that restaurant's own
 * Dashboard and Daily Report show, and what needs someone right now on top:
 * a guest waiting for a waiter, an order waiting too long, a printer down.
 * It refreshes itself every 30 seconds. "Open … admin" picks the restaurant
 * in the switch and goes to its dashboard.
 */

const REFRESH_MS = 30_000;
/** An order open this long is flagged, as on the Dashboard. */
const LONG_WAIT_MINUTES = 20;

interface VenueOverview {
  venue_id: string;
  slug: string;
  name: string;
  is_live: boolean;
  day: string;
  sales: { gross: number; net: number; orders: number; average_order: number; paid: number; open: number; cancelled: number; stuck_payments: number };
  last_week: { day: string; gross: number; orders: number; gross_by_now: number; orders_by_now: number };
  seated: { tables_now: number; covers_now: number | null; sittings_today: number; covers_today: number };
  kitchen: { new: number; accepted: number; preparing: number; ready: number; held: number; oldest_wait_minutes: number | null };
  floor: { calls: number; oldest_call_minutes: number | null; bills: number; oldest_bill_minutes: number | null };
  rating: { average: number | null; count: number };
  top_dish: { name: string; units: number; revenue: number } | null;
  printers: { total: number; enabled: number; online: number; down: string[]; waiting: number };
  stale_orders: number;
}

async function fetchOverview(): Promise<VenueOverview[]> {
  const { data, error } = await supabase.rpc('owner_overview' as never, {} as never);
  if (error) {
    // Before the migration the function does not exist yet; say what is missing.
    if (/owner_overview|PGRST202|schema cache/i.test(`${error.code ?? ''} ${error.message}`)) {
      throw new Error('The overview needs the latest database update (owner_overview). Until it is applied, open each restaurant\'s admin below.');
    }
    throw new Error(error.message);
  }
  return (Array.isArray(data) ? data : []) as unknown as VenueOverview[];
}

/** The owner picks this restaurant and lands on its dashboard; the page starts again, as the switch does. */
function openAdmin(slug: string) {
  chooseStaffVenue(slug);
  window.location.assign('/admin');
}

const n = (v: unknown) => Number(v ?? 0) || 0;
const money = (v: unknown) => `${n(v).toFixed(2)} KM`;
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const weekday = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'long' });

interface Alert { key: string; icon: React.ElementType; text: string }

/** What needs someone now, most urgent first. */
function attention(v: VenueOverview): Alert[] {
  const alerts: Alert[] = [];
  const { floor, kitchen, printers } = v;
  if (n(floor.calls) > 0) {
    alerts.push({ key: 'calls', icon: Hand, text: `${plural(n(floor.calls), 'guest call')} waiting${floor.oldest_call_minutes != null ? ` · ${floor.oldest_call_minutes} min` : ''}` });
  }
  if (kitchen.oldest_wait_minutes != null && kitchen.oldest_wait_minutes >= LONG_WAIT_MINUTES) {
    alerts.push({ key: 'wait', icon: Timer, text: `An order has waited ${kitchen.oldest_wait_minutes} min` });
  }
  if (printers.down.length > 0) {
    alerts.push({ key: 'printers', icon: Printer, text: `Printer down: ${printers.down.join(', ')}` });
  }
  if (n(kitchen.held) > 0) {
    alerts.push({ key: 'held', icon: ShieldAlert, text: `${plural(n(kitchen.held), 'order')} held for staff to confirm` });
  }
  if (n(floor.bills) > 0) {
    alerts.push({ key: 'bills', icon: CreditCard, text: `${plural(n(floor.bills), 'bill')} asked for${floor.oldest_bill_minutes != null ? ` · ${floor.oldest_bill_minutes} min` : ''}` });
  }
  if (n(v.sales.stuck_payments) > 0) {
    alerts.push({ key: 'stuck', icon: Wallet, text: `${plural(n(v.sales.stuck_payments), 'card payment')} not completed` });
  }
  if (n(v.stale_orders) > 0) {
    alerts.push({ key: 'stale', icon: AlertTriangle, text: `${plural(n(v.stale_orders), 'order')} left open from earlier` });
  }
  return alerts;
}

/** Today beside the same weekday last week, as far into the day. */
const Comparison = ({ v }: { v: VenueOverview }) => {
  const now = n(v.sales.gross);
  const then = n(v.last_week.gross_by_now);
  const day = weekday(v.last_week.day);
  if (then === 0) {
    return <p className="text-xs font-sans text-muted-foreground mt-1">Nothing by this time last {day}</p>;
  }
  const pct = Math.round(((now - then) / then) * 100);
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p className="text-xs font-sans text-muted-foreground mt-1 flex items-start gap-1">
      <Icon className={`w-3.5 h-3.5 shrink-0 mt-px ${up ? 'text-primary' : 'text-destructive'}`} aria-hidden />
      <span>
        <span className={`font-semibold ${up ? 'text-primary' : 'text-destructive'}`}>{up ? '+' : ''}{pct}%</span>
        {' '}vs {money(then)} by this time last {day}
      </span>
    </p>
  );
};

const Figure = ({ icon: Icon, label, value, words = false, children }: {
  icon: React.ElementType;
  label: string;
  value: React.ReactNode;
  /** A name rather than a number: smaller, and two lines rather than cut short. */
  words?: boolean;
  children?: React.ReactNode;
}) => (
  <div className="rounded-xl border border-border p-3 sm:p-4 min-w-0">
    <p className="text-xs font-sans text-muted-foreground flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden /> {label}
    </p>
    <div className={`font-sans font-semibold text-foreground mt-1 ${words
      ? 'text-base leading-snug line-clamp-2 break-words'
      : 'text-lg sm:text-xl tabular-nums truncate'}`}>{value}</div>
    {children}
  </div>
);

const RestaurantCard = ({ v }: { v: VenueOverview }) => {
  const name = VENUES[v.slug]?.name ?? v.name;
  // Whether guests can order is the app's to say (src/lib/venues.ts); the
  // database's own flag was never switched on for Vera Italia and nothing reads it.
  const live = VENUES[v.slug]?.live ?? v.is_live;
  const alerts = attention(v);
  const { sales, seated, kitchen, rating, printers } = v;
  const cooking = n(kitchen.accepted) + n(kitchen.preparing);

  return (
    <motion.section variants={fadeUp} aria-label={name}>
      <Card className="border-border h-full flex flex-col">
        <CardHeader className="pb-3">
          <CardTitle className="font-serif text-2xl flex items-center justify-between gap-3">
            <span className="truncate">{name}</span>
            {!live && (
              <span className="text-[11px] font-sans font-medium text-muted-foreground border border-border rounded-full px-2 py-0.5 shrink-0">
                Not live
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col gap-4">
          {/* What needs someone now, before any number. */}
          <div role="group" aria-label={`${name}: needs attention`} className="space-y-1.5">
            {alerts.length === 0 ? (
              <p className="flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm font-sans text-muted-foreground">
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden /> Nothing needs you right now
              </p>
            ) : alerts.map((a) => (
              <p key={a.key} className="flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm font-sans font-medium text-foreground">
                <a.icon className="w-4 h-4 text-destructive shrink-0" aria-hidden /> {a.text}
              </p>
            ))}
          </div>

          <div className="grid grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-3">
            <Figure icon={TrendingUp} label="Sales today" value={money(sales.gross)}>
              <Comparison v={v} />
            </Figure>
            <Figure icon={Wallet} label="Orders" value={n(sales.orders)}>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                {n(sales.paid)} paid · {n(sales.open)} open · {n(sales.cancelled)} cancelled
              </p>
            </Figure>
            <Figure icon={Users} label="Seated now" value={plural(n(seated.tables_now), 'table')}>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                {seated.covers_now != null ? `${seated.covers_now} guests counted · ` : ''}{plural(n(seated.sittings_today), 'sitting')} today
              </p>
            </Figure>
            <Figure icon={ChefHat} label="Kitchen now" value={`${n(kitchen.new)} · ${cooking} · ${n(kitchen.ready)}`}>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                new · cooking · ready{kitchen.oldest_wait_minutes != null ? ` · oldest ${kitchen.oldest_wait_minutes} min` : ''}
              </p>
            </Figure>
            <Figure icon={Star} label="Guest rating" value={rating.average != null ? `${Number(rating.average).toFixed(1)} / 5` : '—'}>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                {n(rating.count) > 0 ? `from ${plural(n(rating.count), 'rating')} today` : 'no ratings yet today'}
              </p>
            </Figure>
            <Figure icon={UtensilsCrossed} label="Top dish" value={v.top_dish?.name ?? '—'} words={!!v.top_dish}>
              <p className="text-xs font-sans text-muted-foreground mt-1">
                {v.top_dish ? `${v.top_dish.units} sold · ${money(v.top_dish.revenue)}` : 'nothing sold yet'}
              </p>
            </Figure>
          </div>

          <p className={`text-sm font-sans flex items-center gap-2 ${printers.down.length ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
            <Printer className="w-4 h-4 shrink-0" aria-hidden />
            {n(printers.enabled) === 0
              ? 'No cloud printers switched on'
              : printers.down.length
                ? `${printers.down.length} of ${n(printers.enabled)} printers down`
                : `${n(printers.enabled) === 1 ? 'Printer' : `All ${n(printers.enabled)} printers`} online`}
            {n(printers.waiting) > 0 && ` · ${plural(n(printers.waiting), 'ticket')} waiting`}
          </p>

          <Button onClick={() => openAdmin(v.slug)} className="mt-auto w-full min-h-[44px] rounded-xl gap-2" disabled={!VENUES[v.slug]}>
            Open {name} admin <ArrowRight className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </motion.section>
  );
};

const AdminOverview = () => {
  const { data, error, isLoading, isFetching, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['owner-overview'],
    queryFn: fetchOverview,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
    staleTime: 0,
    retry: false,
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div>
          <motion.h1
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
            className="font-serif text-3xl font-bold text-foreground"
          >
            Overview
          </motion.h1>
          <p className="text-sm font-sans text-muted-foreground mt-1">
            Both restaurants, today
            {dataUpdatedAt > 0 && <> · updated {formatClock(new Date(dataUpdatedAt))}</>}
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()} disabled={isFetching} className="gap-2 min-h-[44px] rounded-xl">
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} aria-hidden /> Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-destructive/25 bg-destructive/5 mb-6">
          <CardContent className="p-4 sm:p-5 space-y-3">
            <p role="alert" className="text-sm font-sans text-foreground">{error.message}</p>
            {!data && (
              <div className="flex flex-wrap gap-2">
                {Object.values(VENUES).map((v) => (
                  <Button key={v.slug} variant="outline" onClick={() => openAdmin(v.slug)} className="gap-2 min-h-[44px] rounded-xl">
                    Open {v.name} admin <ArrowRight className="w-4 h-4" />
                  </Button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {Object.values(VENUES).map((v) => <Skeleton key={v.slug} className="h-[460px] rounded-xl" />)}
        </div>
      ) : data ? (
        <motion.div
          variants={staggerContainer(0.05)}
          initial="hidden"
          animate="show"
          /* Side by side on a laptop, one above the other on a phone. */
          className="grid gap-4 lg:grid-cols-2"
        >
          {data.map((v) => <RestaurantCard key={v.venue_id} v={v} />)}
        </motion.div>
      ) : null}
    </div>
  );
};

export default AdminOverview;
