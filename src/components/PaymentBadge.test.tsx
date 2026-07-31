import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentBadge from '@/components/PaymentBadge';

/**
 * The badge is what a waiter glances at before deciding whether to ask for
 * money. These tests exist to make sure it can never imply "paid" when the
 * money has not arrived.
 */
describe('PaymentBadge', () => {
  it('distinguishes a paid online card from cash and terminal', () => {
    const { unmount } = render(<PaymentBadge method="card_online" status="paid" />);
    expect(screen.getByText('Paid online')).toBeInTheDocument();
    unmount();

    const cash = render(<PaymentBadge method="cash" status="paid" />);
    expect(screen.getByText('Paid · cash')).toBeInTheDocument();
    cash.unmount();

    render(<PaymentBadge method="pos_terminal" status="paid" />);
    expect(screen.getByText('Paid · terminal')).toBeInTheDocument();
  });

  it('never says "paid" while an online payment is only pending', () => {
    render(<PaymentBadge method="card_online" status="pending" />);
    expect(screen.getByText('Online payment pending')).toBeInTheDocument();
    expect(screen.queryByText(/^Paid/)).not.toBeInTheDocument();
  });

  it('surfaces a failed payment as a problem, not as a card choice', () => {
    render(<PaymentBadge method="card_online" status="failed" />);
    expect(screen.getByText('Payment problem')).toBeInTheDocument();
  });

  it('tells the waiter what to bring for an unpaid table', () => {
    const { unmount } = render(<PaymentBadge method="pos_terminal" status="unpaid" />);
    expect(screen.getByText('Owes · bring terminal')).toBeInTheDocument();
    unmount();

    render(<PaymentBadge method="cash" status="unpaid" />);
    expect(screen.getByText('Owes · cash')).toBeInTheDocument();
  });

  it('shows refunds distinctly from unpaid', () => {
    const { unmount } = render(<PaymentBadge method="card_online" status="refunded" />);
    expect(screen.getByText('Refunded')).toBeInTheDocument();
    unmount();

    render(<PaymentBadge method="cash" status="partially_refunded" />);
    expect(screen.getByText('Part refunded')).toBeInTheDocument();
  });

  it('still understands the legacy "card" method value', () => {
    render(<PaymentBadge method="card" status="paid" />);
    expect(screen.getByText('Paid online')).toBeInTheDocument();
  });

  it('renders nothing without a method or status', () => {
    const { container } = render(<PaymentBadge method={null} status={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not rely on colour alone — every state carries words', () => {
    for (const [method, status] of [
      ['card_online', 'paid'], ['card_online', 'pending'], ['card_online', 'failed'],
      ['cash', 'unpaid'], ['pos_terminal', 'unpaid'],
    ] as const) {
      const view = render(<PaymentBadge method={method} status={status} />);
      expect(view.container.textContent?.trim().length ?? 0).toBeGreaterThan(3);
      view.unmount();
    }
  });
});
