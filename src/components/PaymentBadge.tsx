import React from 'react';
import { CreditCard, Banknote } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Staff-facing payment indicator. Shows how a table is paying so the floor/admin
 * instantly knows who paid online vs still owes cash.
 *   card + paid    → "Paid" (primary)
 *   card + pending → "Card" (accent)
 *   cash           → "Cash" (muted)
 */
const PaymentBadge = ({ method, status, className }: { method?: string | null; status?: string | null; className?: string }) => {
  if (method !== 'card' && method !== 'cash') return null;
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-sans font-medium';

  if (method === 'card') {
    const paid = status === 'paid';
    return (
      <span className={cn(base, paid ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent', className)}>
        <CreditCard className="w-3 h-3" />
        {paid ? 'Paid' : status === 'pending' ? 'Card · pending' : 'Card'}
      </span>
    );
  }
  return (
    <span className={cn(base, 'bg-muted text-muted-foreground', className)}>
      <Banknote className="w-3 h-3" /> Cash
    </span>
  );
};

export default PaymentBadge;
