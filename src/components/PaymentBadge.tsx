import React from 'react';
import { CreditCard, Banknote, Smartphone, Clock, AlertTriangle, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PaymentBadgeProps {
  method?: string | null;
  status?: string | null;
  className?: string;
}

/**
 * Staff-facing payment indicator.
 *
 * The distinction this component exists to hold: **"chose card" is not
 * "paid"**. The previous version rendered the same card badge for both, which
 * staff read as money received. Every state below says either what actually
 * happened or what is still owed — never something that could be read as both.
 *
 * It also keeps cash and the physical POS terminal apart, because they settle
 * against different things at close of day.
 *
 * Status is never carried by colour alone: each state has its own icon and its
 * own words.
 */
const PaymentBadge = ({ method, status, className }: PaymentBadgeProps) => {
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans font-medium';

  const badge = (tone: string, icon: React.ReactNode, label: string, title?: string) => (
    <span className={cn(base, tone, className)} title={title ?? label}>
      {icon}
      {label}
    </span>
  );

  // Terminal money states first — true regardless of how it was taken.
  if (status === 'refunded') {
    return badge('bg-muted text-muted-foreground', <RotateCcw className="w-3 h-3" aria-hidden />, 'Refunded');
  }
  if (status === 'partially_refunded') {
    return badge('bg-muted text-muted-foreground', <RotateCcw className="w-3 h-3" aria-hidden />, 'Part refunded');
  }

  if (status === 'paid') {
    if (method === 'cash') {
      return badge('bg-primary/10 text-primary', <Banknote className="w-3 h-3" aria-hidden />, 'Paid · cash');
    }
    if (method === 'pos_terminal') {
      return badge('bg-primary/10 text-primary', <Smartphone className="w-3 h-3" aria-hidden />, 'Paid · terminal');
    }
    return badge('bg-primary/10 text-primary', <CreditCard className="w-3 h-3" aria-hidden />, 'Paid online');
  }

  if (status === 'failed') {
    return badge(
      'bg-destructive/10 text-destructive',
      <AlertTriangle className="w-3 h-3" aria-hidden />,
      'Payment problem',
      'The card was not charged — this order is not with the kitchen',
    );
  }

  if (status === 'pending') {
    return badge(
      'bg-accent/10 text-accent',
      <Clock className="w-3 h-3" aria-hidden />,
      'Online payment pending',
      'Money has not arrived yet — do not treat this as paid',
    );
  }

  // Unpaid: say how the guest intends to settle, so the waiter knows what to bring.
  if (method === 'cash') {
    return badge('bg-muted text-muted-foreground', <Banknote className="w-3 h-3" aria-hidden />, 'Owes · cash');
  }
  if (method === 'pos_terminal') {
    return badge('bg-muted text-muted-foreground', <Smartphone className="w-3 h-3" aria-hidden />, 'Owes · bring terminal');
  }
  if (method === 'card_online' || method === 'card') {
    return badge('bg-muted text-muted-foreground', <CreditCard className="w-3 h-3" aria-hidden />, 'Owes · card online');
  }

  return null;
};

export default PaymentBadge;
