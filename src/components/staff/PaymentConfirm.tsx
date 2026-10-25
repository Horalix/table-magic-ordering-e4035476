import React from 'react';
import { Banknote, CreditCard } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { km, type TablePaymentMethod } from '@/lib/staff-api';

/**
 * The second step of every in-room payment.
 *
 * There is no undo on a recorded payment — reversing one is a refund and a
 * manager's decision — so the protection has to come before the fact. It names
 * the TABLE and the AMOUNT, because the failure it exists to stop is not "I
 * didn't mean to tap", it is "I meant to, on a different table": a sheet that
 * stayed open while the floor moved, or two cards side by side on a phone.
 */
const PaymentConfirm = ({
  tableNumber,
  amount,
  method,
  busy = false,
  detail,
  onCancel,
  onConfirm,
  onConfirmAndFree,
}: {
  tableNumber: number | string;
  amount: number;
  method: TablePaymentMethod;
  busy?: boolean;
  /** e.g. "2 orders" when several are being settled together. */
  detail?: string;
  onCancel: () => void;
  onConfirm: () => void;
  /**
   * "Received + free table" — offered where the guests asked for the bill, so
   * paying and closing the table is one confirmation instead of a trip to the
   * table list. The server still refuses to free a table that owes anything.
   */
  onConfirmAndFree?: () => void;
}) => (
  <div
    role="alertdialog"
    aria-label={`Confirm payment for table ${tableNumber}`}
    className="rounded-xl border-2 border-destructive/50 bg-destructive/5 p-3"
  >
    <p className="text-base font-sans font-semibold text-foreground flex items-center gap-2">
      {method === 'cash' ? <Banknote className="w-5 h-5 shrink-0" /> : <CreditCard className="w-5 h-5 shrink-0" />}
      <span>
        Table {tableNumber}: take <span className="tabular-nums">{km(amount)}</span>{' '}
        {method === 'cash' ? 'in cash' : 'on the terminal'}?
      </span>
    </p>
    <p className="text-sm text-muted-foreground font-sans mt-1">
      {detail ? `${detail}. ` : ''}This goes into the end-of-day count and cannot be undone here.
    </p>
    <div className="flex flex-wrap gap-2 mt-3">
      <Button variant="outline" className="min-h-[48px] flex-1 text-sm" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      <Button
        variant={onConfirmAndFree ? 'outline' : 'default'}
        className="min-h-[48px] flex-1 text-sm"
        onClick={onConfirm}
        disabled={busy}
      >
        {busy ? 'Recording…' : `Yes, ${km(amount)} received`}
      </Button>
      {onConfirmAndFree && (
        <Button className="min-h-[48px] basis-full text-sm font-semibold" onClick={onConfirmAndFree} disabled={busy}>
          {busy ? 'Recording…' : `${km(amount)} received + free table ${tableNumber}`}
        </Button>
      )}
    </div>
  </div>
);

export default PaymentConfirm;
