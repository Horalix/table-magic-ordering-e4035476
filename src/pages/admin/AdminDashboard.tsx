import React, { useCallback, useEffect, useState } from 'react';
import { formatClock } from '@/lib/timing';
import { Link, useOutletContext } from 'react-router-dom';
import { motion } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import {
  DollarSign, ShoppingBag, Clock, TrendingUp, Timer, CreditCard, Hand, Users,
  CheckCircle2, Circle, ArrowRight, Sparkles, X,
} from 'lucide-react';
import { staggerContainer, fadeUp, useCountUp } from '@/lib/motion';
import { orderStatusLabel } from '@/components/staff/order-status';
import { getSuggestionImpact, type SuggestionImpact } from '@/lib/menu-intelligence';
import InsightCards from '@/components/admin/InsightCards';
import ServiceHealthCard from '@/components/admin/ServiceHealthCard';
import type { AdminOutletContext } from '@/components/admin/AdminLayout';
import { useCoalesced, useStaffTables } from '@/lib/realtime';

/*
 * The setup guide is dismissed for one restaurant at a time: the owner who
 * put it away for La Soul still needs it for Vera Italia, which starts with
 * no tables. The key from before there were two meant La Soul.
 */
const SETUP_DISMISS_KEY = 'admin:setupDismissed';
/** What the numbers on this page are made of. */
const DASHBOARD_TABLES = ['orders', 'bill_requests', 'waiter_calls'] as const;
const setupDismissKey = (venue: string) => `${SETUP_DISMISS_KEY}:${venue}`;

function setupDismissed(venue: string): boolean {
  try {
    return localStorage.getItem(setupDismissKey(venue)) === '1'
      || (venue === 'lasoul' && localStorage.getItem(SETUP_DISMISS_KEY) === '1');
  } catch {
    return false;
  }
}

function dismissSetup(venue: string): void {
  try {
    localStorage.setItem(setupDismissKey(venue), '1');
  } catch {
    // Storage off: it stays put away for this visit only.
  }
}

interface SetupCounts { tables: number; sections: number; assignments: number; menuItems: number; waiters: number }

/** First-run guidance: the order that makes staff screens actually work. */
const SetupChecklist = ({ counts, onDismiss }: { counts: SetupCounts; onDismiss: () => void }) => {
  const steps = [
    { done: counts.tables > 0, label: 'Add your tables', to: '/admin/tables', cta: 'Add tables' },
    { done: counts.sections > 0, label: 'Create sections & group tables', to: '/admin/sections', cta: 'Create sections' },
    { done: counts.waiters > 0 && counts.assignments > 0, label: 'Add waiters & assign sections', to: '/admin/tonight', cta: 'Assign waiters' },
    { done: counts.menuItems > 0, label: 'Build your menu', to: '/admin/menu', cta: 'Build menu' },
  ];
  const next = steps.find((s) => !s.done);
  const completed = steps.filter((s) => s.done).length;

  return (
    <Card className="mb-8 border-primary/20 bg-gradient-to-br from-primary/[0.04] to-transparent">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <div>
              <h2 className="font-serif text-lg font-bold text-foreground">Get your restaurant ready</h2>
              <p className="text-xs font-sans text-muted-foreground">{completed} of {steps.length} done · finish setup so staff screens light up</p>
            </div>
          </div>
          <button onClick={onDismiss} aria-label="Dismiss setup guide" className="text-muted-foreground hover:text-foreground p-1 -m-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="space-y-1.5">
          {steps.map((s) => (
            <Link key={s.to} to={s.to} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${s.done ? 'text-muted-foreground' : 'hover:bg-muted/60'}`}>
              {s.done ? <CheckCircle2 className="w-5 h-5 text-primary shrink-0" /> : <Circle className="w-5 h-5 text-muted-foreground/40 shrink-0" />}
              <span className={`flex-1 font-sans text-sm ${s.done ? 'line-through' : 'text-foreground font-medium'}`}>{s.label}</span>
              {next === s && <span className="inline-flex items-center gap-1 text-xs font-sans font-semibold text-primary">{s.cta}<ArrowRight className="w-3.5 h-3.5" /></span>}
            </Link>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border/60">
          <Button asChild variant="ghost" size="sm" className="text-xs gap-1.5 text-muted-foreground">
            <Link to="/admin/qr-codes">Print QR codes for your tables <ArrowRight className="w-3.5 h-3.5" /></Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
import type { Database } from '@/integrations/supabase/types';
import { businessDayISO, businessDayRange, onlySales, summarise, timeToAccept, timeToReady, timeToServe, openAgeMinutes } from '@/lib/reporting';

type OrderStatus = Database['public']['Enums']['order_status'];
type DashboardOrder = Pick<
  Database['public']['Tables']['orders']['Row'],
  'total' | 'created_at' | 'status' | 'updated_at' | 'guest_name'
  | 'released_to_kitchen_at' | 'confirmed_at' | 'ready_at' | 'served_at'
>;
type RecentOrder = Pick<Database['public']['Tables']['orders']['Row'], 'id' | 'created_at' | 'guest_name' | 'status' | 'total'> & {
  table_sessions: { tables: { table_number: number } | null } | null;
};

/**
 * Service timings measured from the stage stamps, not from "now".
 *
 * The previous version computed `now - created_at` and bucketed by *current*
 * status, so a lunch order served at 12:10 still read 480 minutes at 20:00 and
 * the "average" grew all evening. These stop moving once an order completes,
 * which is the only way an average means anything — and each reports how many
 * orders it is actually based on, because an average over three of fifty is not
 * a fact about the service.
 */
interface ServiceTimings {
  accept: ReturnType<typeof summarise>;
  ready: ReturnType<typeof summarise>;
  serve: ReturnType<typeof summarise>;
  oldestOpen: number | null;
}

/** Single stat tile — count-up animation + consistent elevation. */
const StatCard = ({
  label, value, format, icon: Icon, color,
}: {
  label: string;
  value: number;
  format: (n: number) => string;
  icon: React.ElementType;
  color: string;
}) => {
  const n = useCountUp(value);
  return (
    <motion.div variants={fadeUp}>
      <Card className="border-border card-lux-hover">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-sans text-muted-foreground">{label}</p>
              <p className="text-xl sm:text-2xl font-sans font-semibold text-foreground mt-1 tabular-nums">{format(n)}</p>
            </div>
            <div className={`hidden sm:flex w-10 h-10 rounded-lg bg-muted items-center justify-center shrink-0 ${color}`}>
              <Icon className="w-5 h-5" />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

/**
 * Are suggestions earning anything? One line for the owner, on the page they
 * open every day, with the detail one tap away. The figure is sales on lines
 * a guest added from a suggestion — an upper bound, which is why the link goes
 * to Menu Intelligence, where the holdout comparison says what was caused.
 */
const SuggestionsCard = () => {
  const [impact, setImpact] = useState<SuggestionImpact | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getSuggestionImpact(7)
      .then((data) => { if (!cancelled) setImpact(data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (failed) return null;
  const seen = impact?.seen ?? 0;
  return (
    <Card className="border-border mb-8">
      <CardContent className="p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-sans text-muted-foreground flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-primary" aria-hidden /> Suggestions · last 7 days
          </p>
          {!impact ? (
            <Skeleton className="h-7 w-48 mt-2 rounded" />
          ) : seen === 0 ? (
            <p className="text-sm font-sans text-foreground mt-1.5">
              None shown yet. They start with the first orders, using the house pairings.
            </p>
          ) : (
            <p className="mt-1 font-sans text-foreground">
              <span className="font-sans text-2xl font-semibold tabular-nums">{impact.attributed_revenue.toFixed(2)} KM</span>
              <span className="text-sm text-muted-foreground ml-2">
                from {impact.paid} added of {seen} shown
                {impact.paid_acceptance_pct != null ? ` (${impact.paid_acceptance_pct}%)` : ''}
              </span>
            </p>
          )}
        </div>
        <Button asChild variant="outline" className="rounded-xl min-h-[44px]">
          <Link to="/admin/menu-intelligence">See what works</Link>
        </Button>
      </CardContent>
    </Card>
  );
};

const AdminDashboard = () => {
  // The restaurant being looked at; null while the account's roles load.
  const venue = useOutletContext<AdminOutletContext | null>()?.venueSlug ?? null;
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    todayRevenue: 0,
    totalOrders: 0,
    activeTables: 0,
    avgOrderValue: 0,
    billRequests: 0,
    waiterCalls: 0,
    guestCount: 0,
  });
  const [recentOrders, setRecentOrders] = useState<RecentOrder[]>([]);
  const [setup, setSetup] = useState<SetupCounts | null>(null);
  const [dismissedNow, setDismissedNow] = useState<string[]>([]);
  // Until the restaurant is known, no guide: it might be the one put away.
  const dismissed = !venue || dismissedNow.includes(venue) || setupDismissed(venue);
  const empty = { median: null, p90: null, counted: 0, total: 0 };
  const [timings, setTimings] = useState<ServiceTimings>({
    accept: empty, ready: empty, serve: empty, oldestOpen: null,
  });

  const fetchStats = useCallback(async () => {
    // The restaurant's TRADING day, not UTC's and not the calendar's. For a
    // UTC+2 venue the old `toISOString()` boundary ran 02:00 to 02:00 local;
    // the calendar day then split a late service at midnight. This is the
    // same 05:00-to-05:00 day `day_reconciliation()` and the Daily Report use.
    const { start, end } = businessDayRange();

    const { data: orders } = await supabase
      .from('orders')
      .select('total, created_at, status, updated_at, guest_name, released_to_kitchen_at, confirmed_at, ready_at, served_at')
      .gte('created_at', start)
      .lt('created_at', end);

    // One shared definition of a sale. Excluding only `cancelled` counted
    // abandoned card checkouts that never reached the kitchen as takings,
    // which is why this page and the Daily Report disagreed.
    const todayOrders = onlySales((orders ?? []) as DashboardOrder[]);
    const revenue = todayOrders.reduce((sum, order) => sum + Number(order.total), 0);
    const count = todayOrders.length;

    const { count: activeSessions } = await supabase
      .from('table_sessions')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    const { count: billReqCount } = await supabase
      .from('bill_requests')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: waiterCallCount } = await supabase
      .from('waiter_calls')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: guestCount } = await supabase
      .from('table_sessions')
      .select('*', { count: 'exact', head: true })
      .gte('opened_at', start)
      .lt('opened_at', end);

    setStats({
      todayRevenue: revenue,
      totalOrders: count,
      activeTables: activeSessions || 0,
      avgOrderValue: count > 0 ? revenue / count : 0,
      billRequests: billReqCount || 0,
      waiterCalls: waiterCallCount || 0,
      guestCount: guestCount || 0,
    });

    const openAges = todayOrders
      .map((o) => openAgeMinutes(o as never))
      .filter((v): v is number => v !== null);

    setTimings({
      accept: summarise(todayOrders.map((o) => timeToAccept(o as never)), todayOrders.length),
      ready: summarise(todayOrders.map((o) => timeToReady(o as never)), todayOrders.length),
      serve: summarise(todayOrders.map((o) => timeToServe(o as never)), todayOrders.length),
      oldestOpen: openAges.length > 0 ? Math.max(...openAges) : null,
    });

    const { data: recent } = await supabase
      .from('orders')
      .select('id, created_at, guest_name, status, total, table_sessions!inner(tables!inner(table_number))')
      .gte('created_at', start)
      .order('created_at', { ascending: false })
      .limit(10);

    setRecentOrders((recent ?? []) as RecentOrder[]);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchStats(); }, [fetchStats]);

  // The tab's shared channel: only the restaurant shown, and polled where the
  // socket cannot see it (the owner looking at Vera Italia). A six-item order
  // is seven events; the numbers are fetched once, after the burst.
  useStaffTables(DASHBOARD_TABLES, useCoalesced(() => { void fetchStats(); }, 300));

  // First-run setup detection (counts only — cheap head requests).
  useEffect(() => {
    if (dismissed) return;
    (async () => {
      const [tbl, sec, menu, wtr, asg] = await Promise.all([
        supabase.from('tables').select('*', { count: 'exact', head: true }),
        supabase.from('sections').select('*', { count: 'exact', head: true }),
        supabase.from('menu_items').select('*', { count: 'exact', head: true }),
        supabase.from('waiters').select('id', { count: 'exact', head: true }).eq('is_active', true),
        // The rota is keyed by trading day (business_day()), so "assigned for
        // tonight" at 00:30 means the shift that started yesterday evening.
        supabase.from('section_assignments').select('*', { count: 'exact', head: true }).eq('shift_date', businessDayISO()),
      ]);
      setSetup({
        tables: tbl.count ?? 0,
        sections: sec.count ?? 0,
        menuItems: menu.count ?? 0,
        waiters: wtr.count ?? 0,
        assignments: asg.count ?? 0,
      });
    })();
  }, [dismissed]);

  const setupComplete = !!setup && setup.tables > 0 && setup.sections > 0 && setup.menuItems > 0 && setup.waiters > 0 && setup.assignments > 0;

  const money = (n: number) => `${n.toFixed(2)} KM`;
  const whole = (n: number) => Math.round(n).toString();

  const statCards = [
    { label: "Today's Revenue", value: stats.todayRevenue, format: money, icon: DollarSign, color: 'text-primary' },
    { label: 'Total Orders', value: stats.totalOrders, format: whole, icon: ShoppingBag, color: 'text-accent' },
    { label: 'Active Tables', value: stats.activeTables, format: whole, icon: Clock, color: 'text-primary' },
    { label: 'Avg Order', value: stats.avgOrderValue, format: money, icon: TrendingUp, color: 'text-accent' },
    { label: 'Bill Requests', value: stats.billRequests, format: whole, icon: CreditCard, color: 'text-primary' },
    { label: 'Waiter Calls', value: stats.waiterCalls, format: whole, icon: Hand, color: 'text-accent' },
    { label: 'Tables seated today', value: stats.guestCount, format: whole, icon: Users, color: 'text-primary' },
  ];

  const timingRows = [
    { key: 'accept' as const, label: 'Kitchen accepted', hint: 'from reaching the kitchen' },
    { key: 'ready' as const, label: 'Food ready', hint: 'from reaching the kitchen' },
    { key: 'serve' as const, label: 'Ready to table', hint: 'how long it waited under the lamp' },
  ];

  return (
    <div>
      <motion.h1
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        className="font-serif text-3xl font-bold text-foreground mb-6"
      >
        Dashboard
      </motion.h1>

      {setup && !dismissed && !setupComplete && (
        <SetupChecklist
          counts={setup}
          onDismiss={() => { if (!venue) return; dismissSetup(venue); setDismissedNow((list) => [...list, venue]); }}
        />
      )}

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
        </div>
      ) : (
        <motion.div
          variants={staggerContainer(0.05)}
          initial="hidden"
          animate="show"
          /* Two per row on a phone: one per row put seven tiles between the
             manager and anything below them. */
          className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8"
        >
          {statCards.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </motion.div>
      )}

      {/* The three things most worth doing this week, in KM. */}
      <div className="mb-8">
        <InsightCards limit={3} showAllLink title="Top three things to do" />
      </div>

      <ServiceHealthCard />

      <SuggestionsCard />

      <Card className="border-border mb-8">
        <CardHeader>
          <CardTitle className="font-serif text-lg flex items-center gap-2">
            <Timer className="w-5 h-5 text-primary" />
            Service times today
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {timingRows.map((row) => {
              const data = timings[row.key];
              return (
                <div key={row.key} className="rounded-xl border border-border p-4">
                  <p className="text-xs font-sans font-medium text-muted-foreground">{row.label}</p>
                  <p className="font-sans text-2xl font-semibold text-foreground mt-1 tabular-nums">
                    {data.median === null ? '—' : Math.round(data.median)}
                    <span className="text-sm font-sans text-muted-foreground ml-1">min</span>
                  </p>
                  <p className="text-xs font-sans text-muted-foreground mt-1">
                    {/* The slow tail is what guests complain about; a median
                        alone hides it, and a mean alone is dragged by it. */}
                    {data.p90 === null ? row.hint : `slowest 10%: ${Math.round(data.p90)} min`}
                  </p>
                  <p className="text-[11px] font-sans text-muted-foreground/80 mt-0.5">
                    {data.counted === 0
                      ? 'no completed orders yet'
                      : `median of ${data.counted} of ${data.total} orders`}
                  </p>
                </div>
              );
            })}
          </div>

          {timings.oldestOpen !== null && timings.oldestOpen > 20 && (
            <div className="mt-3 flex items-center gap-2 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2">
              <Timer className="w-4 h-4 text-destructive shrink-0" />
              <p className="text-sm font-sans text-destructive">
                An order has been open for {Math.round(timings.oldestOpen)} minutes.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Recent Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between py-2">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32 rounded" />
                    <Skeleton className="h-3 w-20 rounded" />
                  </div>
                  <Skeleton className="h-4 w-16 rounded" />
                </div>
              ))}
            </div>
          ) : recentOrders.length === 0 ? (
            <p className="text-muted-foreground font-sans text-sm py-4">No orders yet</p>
          ) : (
            <div className="space-y-3">
              {recentOrders.map((order) => (
                <div key={order.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                  <div>
                    <p className="text-sm font-sans font-medium text-foreground">
                      Table {order.table_sessions?.tables?.table_number}
                      {order.guest_name && <span className="text-muted-foreground ml-2">- {order.guest_name}</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{formatClock(order.created_at)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-sans font-semibold text-foreground tabular-nums">{Number(order.total).toFixed(2)} KM</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      order.status === 'pending' ? 'bg-destructive/10 text-destructive' :
                      order.status === 'served' ? 'bg-primary/10 text-primary' :
                      'bg-accent/10 text-accent'
                    }`}>
                      {orderStatusLabel(order.status)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default AdminDashboard;
