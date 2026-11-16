import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AdminCard, AdminCardContent, EmptyState } from '@/components/admin/AdminCard';
import { AdminPageHeader, AdminToolbar } from '@/components/admin/AdminPage';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronRight, ScrollText, Search } from 'lucide-react';
import { formatStamp } from '@/lib/timing';
import { localDayISO } from '@/lib/reporting';
import { DEFAULT_VENUE, VENUES, venueByDbId } from '@/lib/venues';
import type { Database } from '@/integrations/supabase/types';

/** venue_id: absent from the generated types, and on a database from before the second restaurant. */
type AuditRow = Database['public']['Tables']['audit_log']['Row'] & { venue_id?: string | null };

/**
 * The restaurant an entry belongs to. The database shows each admin, and the
 * owner, the log of the restaurant being looked at (20261031100000); saying
 * so on every entry means a screenshot or a copied line can never be taken
 * for the other restaurant's. Entries from before there were two restaurants
 * carry none and are La Soul's.
 */
const venueNameOf = (row: AuditRow) =>
  row.venue_id ? venueByDbId(row.venue_id)?.name ?? 'Unknown restaurant' : VENUES[DEFAULT_VENUE].name;

/**
 * The audit log, finally readable.
 *
 * Every financial and state-changing RPC has written here since the
 * payment-safety work — voids, refunds, reverted bumps, reprints, QR rotations,
 * fiscalization edits — and `audit_log` had **zero readers** anywhere in the
 * app. A write-only audit trail is not an audit trail: it cannot answer "who
 * voided table 7's order" without someone opening a SQL console, which in
 * practice means the question never gets asked.
 *
 * Read-only by construction. There is no edit or delete here and there must
 * never be one; the table is append-only and admin-read via RLS.
 */

/** Actions worth being able to isolate in one tap. */
const QUICK_FILTERS: { key: string; label: string; match: string[] }[] = [
  { key: 'all', label: 'Everything', match: [] },
  { key: 'money', label: 'Money', match: ['payment', 'refund', 'order.cancelled', 'shift'] },
  { key: 'kitchen', label: 'Kitchen', match: ['order.status', 'item.', 'ticket.'] },
  { key: 'settings', label: 'Settings', match: ['settings', 'qr', 'menu', 'waiter'] },
];

const PAGE_SIZE = 100;

const actionTone = (action: string) => {
  if (/refund|cancel|void|deleted/.test(action)) return 'bg-destructive/10 text-destructive';
  if (/payment|paid|shift/.test(action)) return 'bg-primary/10 text-primary';
  if (/revert|reprint/.test(action)) return 'bg-accent/10 text-accent';
  return 'bg-muted text-muted-foreground';
};

/** `order.status_changed` → "Order status changed". The raw name stays in the row's tooltip. */
const sayAction = (action: string) => {
  const words = action.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

const AdminAudit = () => {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quick, setQuick] = useState('all');
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return localDayISO(d);
  });
  const [to, setTo] = useState(() => localDayISO());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Bounded by date AND by row count, and it says when the cap was hit —
    // an audit view that silently shows a subset is worse than none, because
    // "no record of that" and "the record is on page two" look identical.
    const { data, error } = await supabase
      .from('audit_log')
      .select('*')
      .gte('created_at', `${from}T00:00:00`)
      .lte('created_at', `${to}T23:59:59.999`)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (error) {
      setLoadError(error.message);
      setRows([]);
    } else {
      setLoadError(null);
      setRows(data ?? []);
      setTruncated((data ?? []).length >= PAGE_SIZE);
    }
    setLoading(false);
  }, [from, to]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const filter = QUICK_FILTERS.find((f) => f.key === quick);
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter && filter.match.length > 0
        && !filter.match.some((m) => row.action.includes(m))) return false;
      if (!q) return true;
      const hay = `${row.action} ${row.actor_label ?? ''} ${row.entity_type} ${row.entity_id ?? ''} ${row.reason ?? ''} ${venueNameOf(row)}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, quick, search]);

  const filtered = quick !== 'all' || search.trim() !== '';
  const dateInput = 'h-11 w-[11.5rem] rounded-xl text-base sm:text-sm';

  return (
    <div>
      <AdminPageHeader
        title="Audit log"
        description="Every action that touched money or order state at this restaurant. Append-only — nothing here can be edited."
        loading={loading && rows.length > 0}
        actions={<Button variant="outline" className="h-11 rounded-xl px-4" onClick={() => void load()}>Refresh</Button>}
      />

      <AdminCard className="mb-4">
        <AdminCardContent className="space-y-3 pt-4 sm:pt-5">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Who, what, or an order id…"
              className="h-11 rounded-xl ps-10 text-base sm:text-sm"
              aria-label="Search the audit log"
            />
          </div>
          <AdminToolbar className="gap-1.5">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setQuick(f.key)}
                aria-pressed={quick === f.key}
                className={`min-h-[44px] rounded-full border px-4 text-sm font-sans transition-colors ${
                  quick === f.key ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </AdminToolbar>
          <AdminToolbar className="gap-x-2 gap-y-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={dateInput} aria-label="From date" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={dateInput} aria-label="To date" />
          </AdminToolbar>
        </AdminCardContent>
      </AdminCard>

      {loadError && (
        <AdminCard className="mb-4 border-destructive/40" role="alert">
          <AdminCardContent className="pt-5">
            <p className="text-sm font-sans text-destructive">Could not load the audit log: {loadError}</p>
            <p className="mt-1 text-xs font-sans text-muted-foreground">
              This is a read failure, not an empty log. Nothing has been removed.
            </p>
            <Button variant="outline" className="mt-3 h-11" onClick={() => void load()}>Try again</Button>
          </AdminCardContent>
        </AdminCard>
      )}

      {truncated && (
        <p className="mb-3 text-xs font-sans text-accent">
          Showing the newest {PAGE_SIZE} entries in this range — narrow the dates to see the rest.
        </p>
      )}

      {loading && rows.length === 0 ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading">
          {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[68px] w-full rounded-2xl" />)}
        </div>
      ) : visible.length === 0 ? (
        loadError ? null : (
          <AdminCard>
            <EmptyState
              icon={ScrollText}
              title="Nothing recorded in this range"
              hint={filtered ? 'Clear the search or pick Everything, or try a wider date range.' : 'Try a wider date range.'}
            />
          </AdminCard>
        )
      ) : (
        <div className={`space-y-2 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <p className="px-1 text-[13px] font-sans text-muted-foreground tabular-nums" aria-live="polite">
            {filtered ? `${visible.length} of ${rows.length} entries` : `${visible.length} entries`}
          </p>
          {visible.map((row) => {
            const open = expanded === row.id;
            return (
              <AdminCard key={row.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : row.id)}
                  aria-expanded={open}
                  title={row.action}
                  className="flex min-h-[56px] w-full items-start gap-2.5 px-4 py-3 text-start transition-colors hover:bg-muted/40"
                >
                  <ChevronRight className={`mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${open ? 'rotate-90' : ''}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-sans font-semibold ${actionTone(row.action)}`}>
                        {sayAction(row.action)}
                      </span>
                      <span className="text-xs font-sans text-muted-foreground">
                        {row.entity_type}
                        {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ''}
                      </span>
                    </div>
                    <p className="mt-1 text-[13px] font-sans leading-snug text-muted-foreground">
                      {/* Who, then when. An unattributed entry says so rather
                          than rendering a blank where a name should be. */}
                      <span className="font-medium text-foreground">
                        {row.actor_label || (row.actor_user_id ? row.actor_user_id.slice(0, 8) : 'system')}
                      </span>
                      {' · '}
                      <span className="tabular-nums">{formatStamp(row.created_at)}</span>
                      {' · '}
                      {venueNameOf(row)}
                    </p>
                    {row.reason && <p className="mt-0.5 break-words text-[13px] font-sans text-muted-foreground">{row.reason}</p>}
                  </div>
                </button>

                {open && (
                  <div className="grid grid-cols-1 gap-3 border-t border-border/60 px-4 pb-4 pt-3 sm:grid-cols-2">
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] font-sans font-semibold uppercase tracking-wide text-muted-foreground">Before</p>
                      <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-[11px]">
                        {row.before_state ? JSON.stringify(row.before_state, null, 2) : '—'}
                      </pre>
                    </div>
                    <div className="min-w-0">
                      <p className="mb-1 text-[11px] font-sans font-semibold uppercase tracking-wide text-muted-foreground">After</p>
                      <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted p-3 font-mono text-[11px]">
                        {row.after_state ? JSON.stringify(row.after_state, null, 2) : '—'}
                      </pre>
                    </div>
                  </div>
                )}
              </AdminCard>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAudit;
