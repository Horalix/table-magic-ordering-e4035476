/**
 * Stands in for `virtual:pwa-register` in demo builds, which have no service
 * worker (vite.config.ts): nothing to register, never a new version waiting.
 */
export function registerSW(): (reloadPage?: boolean) => Promise<void> {
  return async () => {};
}
