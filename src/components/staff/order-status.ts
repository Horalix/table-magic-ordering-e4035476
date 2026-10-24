/**
 * Order statuses in words a person uses.
 *
 * Staff screens printed the raw enum — "awaiting_payment" next to a table
 * number — which reads as a bug and, worse, says nothing about what to do.
 * Every staff and admin screen labels statuses from here.
 */
export const ORDER_STATUS_LABEL: Record<string, string> = {
  awaiting_payment: 'Waiting for online payment',
  payment_failed: 'Online payment failed',
  pending: 'New',
  confirmed: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  served: 'Served',
  cancelled: 'Cancelled',
};

export const orderStatusLabel = (status: string | null | undefined) =>
  (status && ORDER_STATUS_LABEL[status]) || (status ?? '').replace(/_/g, ' ');

/**
 * Card orders the kitchen has not been sent, because the money has not arrived.
 *
 * They look like brand-new orders on a floor screen unless they are called out,
 * and a waiter then chases the kitchen for food that was never ordered as far
 * as the kitchen knows.
 */
export const NOT_IN_KITCHEN = ['awaiting_payment', 'payment_failed'];

export const isInKitchen = (status: string) => !NOT_IN_KITCHEN.includes(status) && status !== 'cancelled';

/**
 * A pay-at-table order the database held back for staff to confirm (see
 * 20261024190000_order_abuse_guards.sql).
 *
 * Its status is plain `pending`, so by status alone it looks like a new order
 * the kitchen is making. It is not: nothing printed. Floor screens must say so
 * and must not count it as cooking, for the same reason as an unpaid card order.
 */
export const isHeld = (order: { status?: string | null; held_reason?: string | null; released_to_kitchen_at?: string | null }) =>
  !!order.held_reason && !order.released_to_kitchen_at && order.status !== 'cancelled';

/**
 * When an order reached the kitchen — the start of everything staff time.
 *
 * For a cash order that is when it was placed; for a card order it is when the
 * payment cleared, which can be minutes later. Ticket age, "is this new",
 * auto-print and "oldest wait" all start here, or a card order arrives looking
 * late and never prints.
 */
export const kitchenStart = (order: { released_to_kitchen_at?: string | null; created_at: string }) =>
  order.released_to_kitchen_at ?? order.created_at;

/** Payment states in words. `null` means "say nothing". */
export const paymentStatusLabel = (status: string | null | undefined, method?: string | null): string | null => {
  switch (status) {
    case 'paid':
      return method === 'card_online' ? 'Paid online'
        : method === 'pos_terminal' ? 'Paid on terminal'
          : method === 'cash' ? 'Paid cash' : 'Paid';
    case 'refunded': return 'Refunded';
    case 'partially_refunded': return 'Partly refunded';
    case 'pending': return 'Payment in progress';
    case 'failed': return 'Payment failed';
    case 'unpaid': return 'Not paid';
    default: return null;
  }
};
