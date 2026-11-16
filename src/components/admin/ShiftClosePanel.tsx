import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Loader2, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { moneyKM } from '@/components/admin/admin-format';
import { Button } from '@/components/ui/button';
import { AdminCard, AdminCardContent, AdminCardHeader } from '@/components/admin/AdminCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { closeShift, shiftCloseFor, type DayReconciliation, type ShiftClose } from '@/lib/staff-api';
import { formatClock } from '@/lib/timing';

/**
 * Close the day.
 *
 * The report had a section headed "Needs attention before close" and no way to
 * close anything, so the day never formally ended: the drawer was counted on
 * paper and never compared to what the system thought happened.
 *
 * The one rule this panel enforces on itself: it never adjusts. Counting the
 * drawer cannot change what was sold. If the two numbers disagree, the
 * difference is displayed, recorded, and left standing — because that
 * disagreement is the entire reason to count.
 */

interface Props {
  day: string;
  recon: DayReconciliation | null;
}

/*
 * No role check here: AdminLayout already gates every /admin route on the
 * admin role, and close_shift() re-checks it server-side. A third check in the
 * component would be dead code pretending to be a control.
 */

const km = (n: number) => moneyKM(Number(n ?? 0));

const Difference = ({ expected, counted, label }: { expected: number; counted: string; label: string }) => {
  const value = counted.trim() === '' ? null : Number(counted);
  if (value === null || !Number.isFinite(value)) {
    return <p className="mt-2 text-xs font-sans text-muted-foreground">Not counted yet.</p>;
  }
  const diff = value - expected;
  if (Math.abs(diff) < 0.005) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs font-sans font-medium text-primary">
        <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> {label} balances.
      </p>
    );
  }
  return (
    <p className="mt-2 flex items-center gap-1.5 text-xs font-sans font-medium text-destructive">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
      {diff > 0 ? 'Over' : 'Short'} by <span className="tabular-nums font-semibold">{km(Math.abs(diff))}</span>
    </p>
  );
};

const ShiftClosePanel = ({ day, recon }: Props) => {
  const [existing, setExisting] = useState<ShiftClose | null>(null);
  const [cash, setCash] = useState('');
  const [terminal, setTerminal] = useState('');
  const [batch, setBatch] = useState('');
  const [notes, setNotes] = useState('');
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    const row = await shiftCloseFor(day).catch(() => null);
    setExisting(row);
    setCash(row?.counted_cash != null ? String(row.counted_cash) : '');
    setTerminal(row?.counted_terminal != null ? String(row.counted_terminal) : '');
    setBatch(row?.terminal_batch_reference ?? '');
    setNotes(row?.notes ?? '');
    setAck(row?.acknowledged_issues ?? false);
  }, [day]);

  useEffect(() => { void load(); }, [load]);

  const expectedCash = Number(recon?.paid_cash ?? 0);
  const expectedTerminal = Number(recon?.paid_pos_terminal ?? 0);

  /** Things a manager should have seen before signing off. Never a blocker. */
  const issues: string[] = [];
  if (recon) {
    if (recon.outstanding > 0) issues.push(`${km(recon.outstanding)} still owed across ${recon.outstanding_orders} order${recon.outstanding_orders === 1 ? '' : 's'}`);
    if (recon.stuck_payments > 0) issues.push(`${recon.stuck_payments} unresolved card payment${recon.stuck_payments === 1 ? '' : 's'}`);
    if (recon.unfiscalized_orders > 0) issues.push(`${recon.unfiscalized_orders} order${recon.unfiscalized_orders === 1 ? '' : 's'} not yet on the fiscal device`);
    if (recon.callback_problems > 0) issues.push(`${recon.callback_problems} rejected provider callback${recon.callback_problems === 1 ? '' : 's'}`);
  }
  const needsAck = issues.length > 0;

  const submit = async () => {
    if (needsAck && !ack) {
      toast.error('Tick the acknowledgement — those items are being closed as they are');
      return;
    }
    setSaving(true);
    try {
      const result = await closeShift(
        day,
        cash.trim() === '' ? null : Number(cash),
        terminal.trim() === '' ? null : Number(terminal),
        batch.trim() || undefined,
        notes.trim() || undefined,
        ack,
      );
      const diff = result.cash_difference;
      if (diff != null && Math.abs(Number(diff)) >= 0.005) {
        // Reported, not fixed. The close still succeeds — the discrepancy is
        // the record, and hiding it behind an error would just get it retyped.
        toast.warning(`Day closed. Cash is ${Number(diff) > 0 ? 'over' : 'short'} by ${km(Math.abs(Number(diff)))} — recorded.`);
      } else {
        toast.success('Day closed');
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not close the day');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminCard className={cn('print:break-inside-avoid print:shadow-none', existing && 'border-primary/40')} aria-labelledby="close-day-title">
      <AdminCardHeader
        icon={existing ? CheckCircle2 : Lock}
        titleId="close-day-title"
        title="Close the day"
        description={existing
          ? 'You can still correct the count; the close keeps its first time.'
          : 'Count the drawer and read the terminal. What the system expects is shown with each box.'}
        action={existing ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-sans font-semibold text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Closed at {formatClock(existing.closed_at)}
          </span>
        ) : undefined}
      />
      <AdminCardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CountField
            id="close-cash" label="Cash in the drawer" expected={expectedCash}
            value={cash} onChange={setCash} placeholder="Count the drawer" differenceLabel="Cash"
          />
          <CountField
            id="close-terminal" label="Terminal batch" expected={expectedTerminal}
            value={terminal} onChange={setTerminal} placeholder="Read off the terminal" differenceLabel="Terminal"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="close-batch" className="text-sm font-medium text-foreground">Terminal batch reference</Label>
            <Input id="close-batch" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="From the settlement slip" className="mt-1.5 h-11" />
          </div>
          <div>
            <Label htmlFor="close-notes" className="text-sm font-medium text-foreground">Notes</Label>
            <Textarea
              id="close-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="mt-1.5 min-h-[44px] text-base md:text-sm"
              placeholder="Anything that explains a difference: a comp, a float, a till error"
            />
          </div>
        </div>

        {needsAck && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-4">
            <p className="text-sm font-sans font-semibold text-foreground">Closing with these outstanding</p>
            <ul className="mt-1.5 space-y-1 text-sm font-sans text-muted-foreground">
              {issues.map((issue) => (
                <li key={issue} className="flex gap-2">
                  <span className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-amber-600" aria-hidden />
                  <span>{issue}</span>
                </li>
              ))}
            </ul>
            {/* Acknowledged, not blocked. A night can legitimately end with an
                unpaid tab, and a close button that refuses to work is a close
                button that gets worked around. */}
            <label className="no-print -mx-2 mt-2 flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg px-2 hover:bg-amber-500/[0.06]">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="h-5 w-5 shrink-0 accent-primary" />
              <span className="text-sm font-sans text-foreground">I have seen these and am closing the day anyway.</span>
            </label>
          </div>
        )}

        <div className="no-print flex flex-col-reverse gap-3 border-t border-border/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs font-sans leading-relaxed text-muted-foreground">
            Nothing here changes an order or a payment. A difference is recorded, never corrected.
          </p>
          <Button onClick={submit} disabled={saving} className="h-11 w-full shrink-0 gap-2 px-6 sm:w-auto">
            {saving && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />}
            {saving ? 'Closing…' : existing ? 'Update the close' : 'Close the day'}
          </Button>
        </div>
      </AdminCardContent>
    </AdminCard>
  );
};

/** A counted figure beside what the system expects, and the difference as it is typed. */
const CountField = ({ id, label, expected, value, onChange, placeholder, differenceLabel }: {
  id: string; label: string; expected: number; value: string; onChange: (v: string) => void; placeholder: string; differenceLabel: string;
}) => (
  <div className="rounded-xl bg-muted/40 p-4">
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">{label}</Label>
      <span className="whitespace-nowrap text-xs font-sans text-muted-foreground">
        System says <span className="font-semibold text-foreground tabular-nums">{km(expected)}</span>
      </span>
    </div>
    <div className="relative mt-2">
      <Input
        id={id} type="number" inputMode="decimal" step="0.01" min="0" placeholder={placeholder}
        value={value} onChange={(e) => onChange(e.target.value)}
        className="h-12 bg-background pe-12 text-base tabular-nums"
      />
      <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm font-sans text-muted-foreground" aria-hidden>KM</span>
    </div>
    <Difference expected={expected} counted={value} label={differenceLabel} />
  </div>
);

export default ShiftClosePanel;
