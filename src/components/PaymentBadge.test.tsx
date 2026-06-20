import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PaymentBadge from '@/components/PaymentBadge';

describe('PaymentBadge', () => {
  it('shows "Paid" for a paid card order', () => {
    render(<PaymentBadge method="card" status="paid" />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('shows a card label for a pending card order', () => {
    render(<PaymentBadge method="card" status="pending" />);
    expect(screen.getByText(/Card/)).toBeInTheDocument();
  });

  it('shows "Cash" for a cash order', () => {
    render(<PaymentBadge method="cash" status="unpaid" />);
    expect(screen.getByText('Cash')).toBeInTheDocument();
  });

  it('renders nothing without a method', () => {
    const { container } = render(<PaymentBadge method={null} status={null} />);
    expect(container.firstChild).toBeNull();
  });
});
