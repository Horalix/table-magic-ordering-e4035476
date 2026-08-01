import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { recordRefund } from '@/lib/staff-api';

/**
 * Record a refund.
 *
 * `record_order_refund` and its client wrapper have both existed since the
 * payment-safety work and were imported by nothing. AdminOrders told a manager
 * "you will need to refund it separately" and offered no control, so refunds
 * happened in the bank or the till and never in the books — which is precisely
 * the gap that makes a day fail to reconcile.
 *
 * Two things this dialog refuses to do:
 *
 *   - **Move money.** It records that a refund happened (or is intended). The
 *     actual return to the guest happens on the card terminal or out of the
 *     drawer, by a human. Pretending otherwise would be a payment integration
 *     that does not exist.
 *   - **Guess the method.** A card order refunded in cash reconciles against a
 *     different total than one refunded to the card, so the method is a
 *     required choice, not a default.
 */

type RefundMethod = 'card_online' | 'cash' | 'pos_terminal';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: {
    id: string;
    order_code?: string | null;
    total: number;
    refunded_amount?: number | null;
    payment_method?: string | null;
    payment_status?: string | null;
  } | null;
  onDone: () => void;
}

const METHODS: { key: RefundMethod; label: string; hint: string }[] = [
  { key: 'card_online', label: 'Back to the card', hint: 'Reverses through the payment provider — do it there first' },
  { key: 'cash', label: 'Cash from the till', hint: 'Comes out of the drawer count' },
  { key: 'pos_terminal', label: 'Card terminal', hint: 'Appears in the terminal batch' },
];

const RefundDialog = ({ open, onOpenChange, order, onDone }: Props) => {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<RefundMethod>('cash');
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const [markCompleted, setMarkCompleted] = useState(false);
  const [saving, setSaving] = useState(false);

  const alreadyRefunded = Number(order?.refunded_amount ?? 0);
  const remaining = Math.max(0, Number(order?.total ?? 0) - alreadyRefunded);

  useEffect(() => {
    if (!open || !order) return;
    setAmount(remaining.toFixed(2));
    // Default to how they paid: that is the method that reconciles cleanly,
    // and any other choice should be a deliberate act.
    setMethod(
      order.payment_method === 'card_online' ? 'card_online'
        : order.payment_method === 'pos_terminal' ? 'pos_terminal' : 'cash',
    );
    setReason('');
    setReference('');
    setMarkCompleted(false);
  }, [open, order, remaining]);

  if (!order) return null;

  const value = Number.parseFloat(amount);
  const valid = Number.isFinite(value) && value > 0 && value <= remaining + 0.001 && reason.trim().length >= 3;

  const submit = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      await recordRefund(order.id, value, method, reason.trim(), markCompleted, reference.trim() || undefined);
      toast.success(`Recorded a ${value.toFixed(2)} KM refund`);
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not record the refund');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">
            Refund {order.order_code ? `#${order.order_code}` : ''}
          </DialogTitle>
          <DialogDescription>
            This records the refund in the books. It does not move any money — do that on the
            terminal or from the till, then record it here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg bg-muted px-3 py-2 text-sm font-sans">
            <div className="flex justify-between"><span>Order total</span><span className="tabular-nums">{Number(order.total).toFixed(2)} KM</span></div>
            {alreadyRefunded > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Already refunded</span><span className="tabular-nums">−{alreadyRefunded.toFixed(2)} KM</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t border-border mt-1 pt-1">
              <span>Refundable</span><span className="tabular-nums">{remaining.toFixed(2)} KM</span>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Amount (KM)</Label>
            <Input
              type="number" inputMode="decimal" min="0" step="0.01" max={remaining}
              value={amount} onChange={(e) => setAmount(e.target.value)} className="mt-1"
            />
            {Number.isFinite(value) && value > remaining && (
              <p className="text-xs text-destructive font-sans mt-1">
                More than is left to refund on this order.
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">How is the guest getting it back?</Label>
            <div className="mt-1.5 space-y-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setMethod(m.key)}
                  aria-pressed={method === m.key}
                  className={`w-full text-left rounded-lg border px-3 py-2 min-h-[52px] transition-colors ${
                    method === m.key ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'
                  }`}
                >
                  <p className="text-sm font-sans font-medium">{m.label}</p>
                  <p className="text-xs text-muted-foreground font-sans">{m.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Reason</Label>
            <Textarea
              value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1"
              placeholder="e.g. dish sent back, wrong order, guest complaint"
            />
            {/* Goes into the audit log. A refund without a reason is
                indistinguishable from a mistake or from theft. */}
            <p className="text-[11px] text-muted-foreground font-sans mt-1">
              Recorded against your account in the audit log.
            </p>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Provider reference (optional)</Label>
            <Input
              value={reference} onChange={(e) => setReference(e.target.value)} className="mt-1"
              placeholder="Terminal slip or provider refund id"
            />
          </div>

          <label className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={markCompleted}
              onChange={(e) => setMarkCompleted(e.target.checked)}
              className="mt-1 w-4 h-4"
            />
            <span className="text-sm font-sans">
              The money has already gone back
              <span className="block text-xs text-muted-foreground">
                Leave unticked to record the intent now and confirm once the terminal settles.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!valid || saving}>
            {saving ? 'Recording…' : 'Record refund'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RefundDialog;
