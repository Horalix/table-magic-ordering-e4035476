import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A phone kept showing the previous release — old menu photos included —
 * until its first tap after a new version arrived. A version that arrives
 * while the app is still opening, before anyone has touched it, is now taken
 * at once.
 */

const sw = vi.hoisted(() => ({
  options: null as null | { onNeedRefresh?: () => void },
  update: vi.fn(async (_reload?: boolean) => {}),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: { onNeedRefresh?: () => void }) => {
    sw.options = options;
    return sw.update;
  },
}));

beforeEach(() => {
  vi.resetModules();
  sw.options = null;
  sw.update.mockClear();
  Object.defineProperty(navigator, 'serviceWorker', { value: {}, configurable: true });
  window.history.replaceState(null, '', '/menu/lasoul/');
});

afterEach(() => { vi.restoreAllMocks(); });

const start = async () => {
  const mod = await import('./app-update');
  mod.startAppUpdates();
  return mod;
};

describe('a new version of the app', () => {
  it('is taken at once while the app is still opening and untouched', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(3_000);
    await start();
    sw.options!.onNeedRefresh!();
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('waits once the guest has touched the screen', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(3_000);
    await start();
    window.dispatchEvent(new Event('pointerdown'));
    sw.options!.onNeedRefresh!();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it('waits when it arrives long after the app opened', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    await start();
    sw.options!.onNeedRefresh!();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it('never reloads the cart, where a card payment may be in flight', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(3_000);
    window.history.replaceState(null, '', '/cart');
    await start();
    sw.options!.onNeedRefresh!();
    expect(sw.update).not.toHaveBeenCalled();
  });
});
