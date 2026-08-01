import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const km = (n: number) => `${Number(n ?? 0).toFixed(2)} KM`;

const Difference = ({ expected, counted, label }: { expected: number; counted: string; label: string }) => {
  const value = counted.trim() === '' ? null : Number(counted);
  if (value === null || !Number.isFinite(value)) {
    return <p className="text-xs text-muted-foreground font-sans mt-1">Not counted yet.</p>;
  }
  const diff = value - expected;
  if (Math.abs(diff) < 0.005) {
    return (
      <p className="text-xs font-sans mt-1 text-primary flex items-center gap-1">
        <CheckCircle2 className="w-3.5 h-3.5" /> {label} balances.
      </p>
    );
  }
  return (
    <p className="text-xs font-sans mt-1 text-destructive flex items-center gap-1">
      <AlertTriangle className="w-3.5 h-3.5" />
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
    <Card className={`mb-6 ${existing ? 'border-primary/40' : 'border-border'}`}>
      <CardHeader className="pb-3">
        <CardTitle className="font-serif text-lg flex items-center gap-2">
          <Lock className="w-4 h-4" /> Close the day
          {existing && (
            <span className="text-xs font-sans font-normal text-primary">
              closed at {formatClock(existing.closed_at)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">
              Cash counted — system says <span className="tabular-nums font-medium text-foreground">{km(expectedCash)}</span>
            </Label>
            <Input
              type="number" inputMode="decimal" step="0.01" min="0" placeholder="Count the drawer"
              value={cash} onChange={(e) => setCash(e.target.value)} className="mt-1"
            />
            <Difference expected={expectedCash} counted={cash} label="Cash" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              Terminal batch — system says <span className="tabular-nums font-medium text-foreground">{km(expectedTerminal)}</span>
            </Label>
            <Input
              type="number" inputMode="decimal" step="0.01" min="0" placeholder="Read off the terminal"
              value={terminal} onChange={(e) => setTerminal(e.target.value)} className="mt-1"
            />
            <Difference expected={expectedTerminal} counted={terminal} label="Terminal" />
          </div>
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Terminal batch reference</Label>
          <Input value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="From the settlement slip" className="mt-1" />
        </div>

        <div>
          <Label className="text-xs text-muted-foreground">Notes</Label>
          <Textarea
            value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1"
            placeholder="Anything that explains a difference — a comp, a float, a till error"
          />
        </div>

        {needsAck && (
          <div className="rounded-lg border border-accent/40 bg-accent/5 p-3">
            <p className="text-sm font-sans font-semibold text-accent mb-1">Closing with these outstanding</p>
            <ul className="text-xs font-sans text-foreground list-disc pl-4 space-y-0.5">
              {issues.map((issue) => <li key={issue}>{issue}</li>)}
            </ul>
            {/* Acknowledged, not blocked. A night can legitimately end with an
                unpaid tab, and a close button that refuses to work is a close
                button that gets worked around. */}
            <label className="flex items-start gap-2 mt-2 cursor-pointer">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 w-4 h-4" />
              <span className="text-xs font-sans">I have seen these and am closing the day anyway.</span>
            </label>
          </div>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button onClick={submit} disabled={saving}>
            {saving ? 'Closing…' : existing ? 'Update the close' : 'Close the day'}
          </Button>
          <p className="text-xs text-muted-foreground font-sans">
            Nothing here changes an order or a payment. A difference is recorded, never corrected.
          </p>
        </div>
      </CardContent>
    </Card>
  );
};

export default ShiftClosePanel;
