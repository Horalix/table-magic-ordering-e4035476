import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CheckoutSheet from '@/components/guest/CheckoutSheet';
import { useLanguageStore } from '@/lib/i18n';

/** No tip before service: the tip row belongs to online card payment only. */

afterEach(() => cleanup());

const renderSheet = (props: Partial<React.ComponentProps<typeof CheckoutSheet>> = {}) => {
  useLanguageStore.getState().setLocale('en');
  const onChoose = vi.fn();
  render(
    <MemoryRouter>
      <CheckoutSheet
        open
        total={23.4}
        submitting={null}
        onlineCardEnabled
        payAtTableEnabled
        onChoose={onChoose}
        onClose={() => {}}
        {...props}
      />
    </MemoryRouter>,
  );
  return onChoose;
};

describe('CheckoutSheet tipping', () => {
  it('offers No tip, Round up, 5% and 10% with online card, and preselects only No tip', () => {
    renderSheet();
    const group = screen.getByRole('group');
    const labels = Array.from(group.querySelectorAll('button')).map((b) => b.textContent);
    expect(labels).toEqual(['No tip', 'Round up', '5%', '10%']);
    expect(screen.getByRole('button', { name: 'No tip' }).getAttribute('aria-pressed')).toBe('true');
    for (const name of ['Round up', '5%', '10%']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    }
  });

  it('sends the chosen tip with the online card payment', () => {
    const onChoose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Round up' }));
    fireEvent.click(screen.getByRole('button', { name: /Pay now/i }));
    expect(onChoose).toHaveBeenCalledWith('card_online', 0.6);
  });

  it('never sends a tip with cash or the card terminal, even after choosing one', () => {
    const onChoose = renderSheet();
    fireEvent.click(screen.getByRole('button', { name: '10%' }));
    fireEvent.click(screen.getByRole('button', { name: /^Cash/ }));
    fireEvent.click(screen.getByRole('button', { name: /Card at the table/ }));
    expect(onChoose).toHaveBeenNthCalledWith(1, 'cash', 0);
    expect(onChoose).toHaveBeenNthCalledWith(2, 'pos_terminal', 0);
  });

  it('shows no tip row at all when only paying at the table is possible', () => {
    renderSheet({ onlineCardEnabled: false });
    expect(screen.queryByRole('button', { name: 'No tip' })).toBeNull();
    expect(screen.queryByRole('group')).toBeNull();
    expect(screen.getByRole('button', { name: /^Cash/ })).toBeTruthy();
  });
});
