/**
 * Stands in for `virtual:pwa-register` under vitest, which runs without the
 * PWA plugin that provides it. Tests that care mock it with vi.mock.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
