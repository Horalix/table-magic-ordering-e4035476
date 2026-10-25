import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useDialog } from '@/lib/use-dialog';

/**
 * Android Back closes a sheet instead of leaving the page, and closing a
 * sheet any other way takes its history entry back out — exactly once.
 */

const Sheet = ({ onClose }: { onClose: () => void }) => {
  const { dialogProps } = useDialog({ onClose, label: 'Sheet' });
  return (
    <div {...dialogProps}>
      <button onClick={onClose}>Close</button>
    </div>
  );
};

const Harness = ({ onCloseSpy }: { onCloseSpy: () => void }) => {
  const [open, setOpen] = useState(false);
  const close = () => { onCloseSpy(); setOpen(false); };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      {open && <Sheet onClose={close} />}
    </>
  );
};

const popped = () => new Promise<void>((resolve) => {
  window.addEventListener('popstate', () => resolve(), { once: true });
});

let startLength = 0;

beforeEach(() => {
  window.history.replaceState({ usr: null, key: 'k1', idx: 0 }, '');
  startLength = window.history.length;
});

afterEach(async () => {
  // A sheet still open at the end of a test pops its entry on unmount; let
  // that land before the next test starts.
  const pending = window.history.state?.sheet ? popped() : null;
  cleanup();
  if (pending) await pending;
});

describe('useDialog and the Back button', () => {
  it('pushes one entry on open, keeping the router state', () => {
    render(<Harness onCloseSpy={() => {}} />);
    fireEvent.click(screen.getByText('Open'));

    expect(window.history.length).toBe(startLength + 1);
    expect(window.history.state).toMatchObject({ key: 'k1', idx: 0 });
    expect(typeof window.history.state.sheet).toBe('string');
  });

  it('closes the sheet when Back pops its entry, and does not go back again', async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByText('Open'));
    expect(screen.getByRole('dialog')).toBeTruthy();

    const back = vi.spyOn(window.history, 'back');
    await act(async () => {
      const p = popped();
      window.history.go(-1);
      await p;
    });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.history.state?.sheet).toBeUndefined();
    // The guest's Back already removed the entry; the hook must not pop the page too.
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('takes its entry back out when closed another way, without closing twice', async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByText('Open'));
    const sheetId = window.history.state.sheet;
    expect(sheetId).toBeTruthy();

    const back = vi.spyOn(window.history, 'back');
    // Outside act: effects (and so the cleanup that pops) flush when it returns.
    const p = popped();
    fireEvent.click(screen.getByText('Close'));
    await act(async () => { await p; });

    expect(back).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.history.state?.sheet).toBeUndefined();
    expect(window.history.state).toMatchObject({ key: 'k1' });
    back.mockRestore();
  });

  it('closes on Escape and removes the entry', async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByText('Open'));

    const p = popped();
    fireEvent.keyDown(document, { key: 'Escape' });
    await act(async () => { await p; });

    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.history.state?.sheet).toBeUndefined();
  });

  it('does not pop history when the page navigated away underneath the sheet', async () => {
    const spy = vi.fn();
    const { unmount } = render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByText('Open'));

    // A link inside the sheet pushed a new route on top of the sheet's entry.
    window.history.pushState({ usr: null, key: 'k2', idx: 1 }, '');
    const back = vi.spyOn(window.history, 'back');
    unmount();

    expect(back).not.toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    back.mockRestore();
  });

  it('a sheet opened while the previous one is still leaving waits for that pop', async () => {
    const spy = vi.fn();
    render(<Harness onCloseSpy={spy} />);
    fireEvent.click(screen.getByText('Open'));

    const p = popped();
    // Close and immediately reopen, in the same tick.
    fireEvent.click(screen.getByText('Close'));
    fireEvent.click(screen.getByText('Open'));
    await act(async () => { await p; });

    await waitFor(() => expect(typeof window.history.state?.sheet).toBe('string'));
    // The programmatic pop of the first sheet did not close the second.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
