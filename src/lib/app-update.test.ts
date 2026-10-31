import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * A phone kept showing the previous release — old menu photos included —
 * until its first tap after a new version arrived. A version that arrives
 * while the app is still opening, before anyone has touched it, is now taken
 * at once.
 */

type Options = { onNeedRefresh?: () => void; onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration) => void };

const sw = vi.hoisted(() => ({
  options: null as null | Options,
  update: vi.fn(async (_reload?: boolean) => {}),
}));

vi.mock('virtual:pwa-register', () => ({
  registerSW: (options: Options) => {
    sw.options = options;
    return sw.update;
  },
}));

beforeEach(() => {
  vi.resetModules();
  sw.options = null;
  sw.update.mockClear();
  // A phone the app is already installed on.
  Object.defineProperty(navigator, 'serviceWorker', { value: { controller: {}, addEventListener: vi.fn() }, configurable: true });
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

  it('is taken at once on "not found", touched or not: the page may be in it', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const mod = await start();
    window.dispatchEvent(new Event('pointerdown'));
    const leave = mod.lookForMissingPage();
    sw.options!.onNeedRefresh!();
    expect(sw.update).toHaveBeenCalledWith(true);
    leave();
  });

  it('already waiting, is taken the moment "not found" shows', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const mod = await start();
    sw.options!.onNeedRefresh!();
    expect(sw.update).not.toHaveBeenCalled();
    mod.lookForMissingPage();
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('waits again once the guest has left the "not found" page', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const mod = await start();
    mod.lookForMissingPage()();
    sw.options!.onNeedRefresh!();
    expect(sw.update).not.toHaveBeenCalled();
  });

  it('is heard of when the browser was downloading it before the page registered', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(60_000);
    const mod = await start();
    mod.lookForMissingPage();
    const next = Object.assign(new EventTarget(), { state: 'installing' });
    sw.options!.onRegisteredSW!('/sw.js', { installing: next, waiting: null, update: async () => {} } as unknown as ServiceWorkerRegistration);
    expect(sw.update).not.toHaveBeenCalled();
    next.state = 'installed';
    next.dispatchEvent(new Event('statechange'));
    expect(sw.update).toHaveBeenCalledWith(true);
  });

  it('never reloads the cart, where a card payment may be in flight', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(3_000);
    window.history.replaceState(null, '', '/cart');
    await start();
    sw.options!.onNeedRefresh!();
    expect(sw.update).not.toHaveBeenCalled();
  });
});
