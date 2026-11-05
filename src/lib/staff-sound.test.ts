import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MUTE_KEYS, MUTE_MS, muteSound, mutedUntil, soundBackAt, unmuteSound, useStaffSound } from './staff-sound';

afterEach(() => {
  localStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a waiter screen’s sound', () => {
  it('is on when nothing was ever muted', () => {
    expect(mutedUntil('waiter')).toBeNull();
  });

  it('forgets the old forever-mute, so phones muted before start with sound on', () => {
    localStorage.setItem('waiter-sound-on', 'false');
    localStorage.setItem('monitor:sound', 'false');
    expect(mutedUntil('waiter')).toBeNull();
    expect(localStorage.getItem('waiter-sound-on')).toBeNull();
    expect(localStorage.getItem('monitor:sound')).toBeNull();
  });

  it('stays muted for four hours, then comes back on by itself', () => {
    const now = 1_000_000;
    expect(MUTE_MS).toBe(4 * 60 * 60_000);
    expect(muteSound('waiter', now)).toBe(now + MUTE_MS);
    expect(mutedUntil('waiter', now + MUTE_MS - 1)).toBe(now + MUTE_MS);
    expect(mutedUntil('waiter', now + MUTE_MS)).toBeNull();
    expect(localStorage.getItem(MUTE_KEYS.waiter)).toBeNull();
  });

  it('keeps each screen’s mute apart', () => {
    muteSound('floor');
    expect(mutedUntil('floor')).not.toBeNull();
    expect(mutedUntil('waiter')).toBeNull();
    unmuteSound('floor');
    expect(mutedUntil('floor')).toBeNull();
  });

  it('treats a garbled value as on', () => {
    localStorage.setItem(MUTE_KEYS.waiter, 'yes');
    expect(mutedUntil('waiter')).toBeNull();
  });

  it('is on when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(mutedUntil('waiter')).toBeNull();
  });

  it('says when it comes back on as a 24-hour clock time', () => {
    expect(soundBackAt(new Date(2026, 10, 5, 21, 40).getTime())).toBe('21:40');
    expect(soundBackAt(new Date(2026, 10, 5, 9, 5).getTime())).toBe('09:05');
  });
});

describe('useStaffSound', () => {
  it('turns the sound back on when the mute ends, with the screen still open', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useStaffSound('waiter'));
    expect(result.current.soundOn).toBe(true);

    act(() => result.current.setSoundOn(false));
    expect(result.current.soundOn).toBe(false);
    expect(result.current.mutedUntil).toBe(Date.now() + MUTE_MS);

    act(() => { vi.advanceTimersByTime(MUTE_MS - 1_000); });
    expect(result.current.soundOn).toBe(false);
    act(() => { vi.advanceTimersByTime(2_000); });
    expect(result.current.soundOn).toBe(true);
    expect(result.current.mutedUntil).toBeNull();
  });

  it('remembers a mute across a reload of the screen', () => {
    const first = renderHook(() => useStaffSound('waiter'));
    act(() => first.result.current.setSoundOn(false));
    first.unmount();
    const again = renderHook(() => useStaffSound('waiter'));
    expect(again.result.current.soundOn).toBe(false);
    act(() => again.result.current.setSoundOn(true));
    expect(again.result.current.soundOn).toBe(true);
    expect(localStorage.getItem(MUTE_KEYS.waiter)).toBeNull();
  });
});
