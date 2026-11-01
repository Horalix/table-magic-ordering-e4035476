import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import LoginCard from '@/components/admin/LoginCard';
import type { LoginDetails } from '@/lib/staff-accounts';

/**
 * The card a new account's details are handed over on, once. Test values
 * only, made up for this file.
 */

const TEST_PW = 'Kp7R-m2xd-Wq9f';
const TEST_PIN = '4821';

const waiter: LoginDetails = {
  kind: 'waiter', venueSlug: 'veraitalia', venueName: 'Vera Italia', name: 'Giulia', username: 'giulia',
  password: TEST_PW, pin: TEST_PIN, event: 'created',
};

const details = () => within(screen.getByRole('dialog'));

afterEach(() => {
  vi.restoreAllMocks();
  // navigator.share is defined per test where wanted.
  delete (navigator as { share?: unknown }).share;
});

describe('LoginCard', () => {
  it('shows nothing without an account', () => {
    render(<LoginCard details={null} onDone={() => undefined} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('says where to sign in — the restaurant’s own site, the username filled in — and what to type', () => {
    render(<LoginCard details={waiter} onDone={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Giulia can sign in' })).toBeInTheDocument();
    const link = details().getByRole('link', { name: /veraitalia\.net\/waiter\/login\?u=giulia/ });
    expect(link).toHaveAttribute('href', 'https://veraitalia.net/waiter/login?u=giulia');
    expect(details().getByText('Vera Italia')).toBeInTheDocument();
    expect(details().getByText('giulia')).toBeInTheDocument();
    expect(details().getByTestId('login-card-password')).toHaveTextContent(TEST_PW);
    expect(details().getByText(TEST_PIN)).toBeInTheDocument();
    expect(details().getByText(/shown only this once and is not kept anywhere/)).toBeInTheDocument();
  });

  it('a kitchen tablet’s link goes on to the kitchen screen, and has no PIN', () => {
    render(<LoginCard details={{ ...waiter, kind: 'kitchen', name: 'Kitchen', username: 'veraitalia-kitchen' }} onDone={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'Vera Italia kitchen tablet ready' })).toBeInTheDocument();
    expect(details().getByRole('link')).toHaveAttribute('href', 'https://veraitalia.net/waiter/login?u=veraitalia-kitchen&to=kitchen');
    expect(details().queryByText('Floor PIN')).toBeNull();
  });

  it('an admin signs in with their email at the admin sign-in, and is asked to change the password', () => {
    render(<LoginCard details={{ kind: 'admin', venueSlug: 'lasoul', venueName: 'La Soul', name: 'ana@lasoul.test', username: 'ana@lasoul.test', password: TEST_PW, event: 'created' }} onDone={() => undefined} />);
    expect(screen.getByRole('dialog', { name: 'ana@lasoul.test now runs La Soul' })).toBeInTheDocument();
    expect(details().getByRole('link')).toHaveAttribute('href', 'https://lasoulapp.netlify.app/admin/login');
    expect(details().getByText('Email')).toBeInTheDocument();
    expect(details().getByText(/admin menu → Change password/)).toBeInTheDocument();
  });

  it('an account that already existed keeps its password: none is shown', () => {
    render(<LoginCard details={{ kind: 'admin', venueSlug: 'lasoul', venueName: 'La Soul', name: 'ana@lasoul.test', username: 'ana@lasoul.test', password: null, event: 'appointed' }} onDone={() => undefined} />);
    expect(details().getByText('Their own, unchanged')).toBeInTheDocument();
    expect(details().queryByTestId('login-card-password')).toBeNull();
  });

  it('Copy puts the whole card on the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<LoginCard details={waiter} onDone={() => undefined} />);
    await act(async () => { fireEvent.click(details().getByRole('button', { name: 'Copy' })); });
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toContain('https://veraitalia.net/waiter/login?u=giulia');
    expect(text).toContain(`Password: ${TEST_PW}`);
    expect(details().getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('Share is there only where the device has a share sheet', () => {
    render(<LoginCard details={waiter} onDone={() => undefined} />);
    expect(details().queryByRole('button', { name: 'Share' })).toBeNull();
  });

  it('Share hands the same text to the phone’s sheet, and closing the sheet is not an error', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('closed'), { name: 'AbortError' }));
    Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true });
    render(<LoginCard details={waiter} onDone={() => undefined} />);
    await act(async () => { fireEvent.click(details().getByRole('button', { name: 'Share' })); });
    expect(share).toHaveBeenCalledWith({ title: 'Vera Italia sign-in', text: expect.stringContaining(`Password: ${TEST_PW}`) });
  });

  it('Done closes it; a tap outside does not', () => {
    const onDone = vi.fn();
    render(<LoginCard details={waiter} onDone={onDone} />);
    fireEvent.pointerDown(document.body);
    expect(onDone).not.toHaveBeenCalled();
    fireEvent.click(details().getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the password out of storage', () => {
    render(<LoginCard details={waiter} onDone={() => undefined} />);
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain(TEST_PW);
  });
});
