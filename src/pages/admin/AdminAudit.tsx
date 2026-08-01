import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronDown, ChevronRight, ScrollText, Search } from 'lucide-react';
import { formatClock } from '@/lib/timing';
import { localDayISO } from '@/lib/reporting';
import type { Database } from '@/integrations/supabase/types';

type AuditRow = Database['public']['Tables']['audit_log']['Row'];

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
      const hay = `${row.action} ${row.actor_label ?? ''} ${row.entity_type} ${row.entity_id ?? ''} ${row.reason ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, quick, search]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <div>
          <h1 className="font-serif text-3xl font-bold text-foreground">Audit log</h1>
          <p className="text-sm text-muted-foreground font-sans">
            Every action that touched money or order state. Append-only — nothing here can be edited.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>Refresh</Button>
      </div>

      <Card className="mb-4">
        <CardContent className="p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" aria-label="From date" />
            <span className="text-sm text-muted-foreground">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" aria-label="To date" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                onClick={() => setQuick(f.key)}
                aria-pressed={quick === f.key}
                className={`px-3 min-h-[36px] rounded-full text-xs font-sans border transition-colors ${
                  quick === f.key ? 'bg-foreground text-background border-foreground' : 'bg-card text-muted-foreground border-border hover:text-foreground'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Who, what, or an order id…"
              className="pl-9"
              aria-label="Search the audit log"
            />
          </div>
        </CardContent>
      </Card>

      {loadError && (
        <Card className="mb-4 border-destructive/40">
          <CardContent className="p-4">
            <p className="text-sm font-sans text-destructive">Could not load the audit log: {loadError}</p>
            <p className="text-xs text-muted-foreground font-sans mt-1">
              This is a read failure, not an empty log. Nothing has been removed.
            </p>
          </CardContent>
        </Card>
      )}

      {truncated && (
        <p className="text-xs font-sans text-accent mb-3">
          Showing the newest {PAGE_SIZE} entries in this range — narrow the dates to see the rest.
        </p>
      )}

      {loading ? (
        <div className="space-y-2">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}</div>
      ) : visible.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <ScrollText className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-serif text-lg font-semibold text-foreground">Nothing recorded in this range</p>
            <p className="text-sm font-sans text-muted-foreground mt-1">Try a wider date range or a different filter.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-sans" aria-live="polite">{visible.length} entries</p>
          {visible.map((row) => {
            const open = expanded === row.id;
            return (
              <Card key={row.id} className="overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpanded(open ? null : row.id)}
                  aria-expanded={open}
                  className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-muted/40 transition-colors min-h-[52px]"
                >
                  {open ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0" /> : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[11px] font-sans font-semibold px-2 py-0.5 rounded-full ${actionTone(row.action)}`}>
                        {row.action}
                      </span>
                      <span className="text-xs text-muted-foreground font-sans">
                        {row.entity_type}
                        {row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ''}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground font-sans mt-0.5">
                      {/* Who, then when. An unattributed entry says so rather
                          than rendering a blank where a name should be. */}
                      {row.actor_label || (row.actor_user_id ? row.actor_user_id.slice(0, 8) : 'system')}
                      {' · '}
                      {new Date(row.created_at).toLocaleDateString()} {formatClock(row.created_at)}
                      {row.reason ? ` · ${row.reason}` : ''}
                    </p>
                  </div>
                </button>

                {open && (
                  <div className="px-3 pb-3 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-sans mb-1">Before</p>
                      <pre className="text-[11px] font-mono bg-muted rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words">
                        {row.before_state ? JSON.stringify(row.before_state, null, 2) : '—'}
                      </pre>
                    </div>
                    <div>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground font-sans mb-1">After</p>
                      <pre className="text-[11px] font-mono bg-muted rounded-lg p-2 overflow-x-auto whitespace-pre-wrap break-words">
                        {row.after_state ? JSON.stringify(row.after_state, null, 2) : '—'}
                      </pre>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default AdminAudit;
