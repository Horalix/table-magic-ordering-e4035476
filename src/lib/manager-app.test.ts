import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { VENUES } from './venues';

/**
 * The Manager app: the admin, added to a phone's Home Screen
 * (public/manifest-manager*.webmanifest, src/hooks/useVenue.ts). On iPhone it
 * is the only way a manager's phone rings for a reservation, so its
 * manifest, its icons and what each restaurant points at must all be there.
 */
const root = (...p: string[]) => resolve(__dirname, '..', '..', ...p);
const png = (file: string) => readFileSync(root('public', ...file.replace(/^\//, '').split('/'))).subarray(1, 4).toString();

describe('the Manager app', () => {
  it.each(Object.values(VENUES))('$name has its own: named, opening the admin, with icons that exist', (venue) => {
    const manifest = JSON.parse(readFileSync(root('public', venue.brand.managerManifest.replace(/^\//, '')), 'utf8')) as {
      id: string; name: string; short_name: string; start_url: string; scope: string; display: string;
      icons: { src: string; sizes: string; purpose?: string }[];
    };
    expect(manifest.name).toBe(`${venue.name} Manager`);
    expect(manifest.short_name).toBe('Manager');
    expect(manifest).toMatchObject({ id: '/admin', start_url: '/admin', scope: '/', display: 'standalone' });
    expect(manifest.icons.map((i) => i.sizes).sort()).toEqual(['192x192', '512x512', '512x512']);
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) expect(png(icon.src), icon.src).toBe('PNG');
    // iPhone takes the Home Screen icon from the page, not the manifest.
    expect(png(venue.brand.managerTouchIcon)).toBe('PNG');
  });

  it('is told apart from the guests\' app and the waiters\' app of the same restaurant', () => {
    for (const venue of Object.values(VENUES)) {
      const { manifest, waiterManifest, managerManifest, appleTouchIcon, managerTouchIcon } = venue.brand;
      expect(new Set([manifest, waiterManifest, managerManifest]).size).toBe(3);
      expect(managerTouchIcon).not.toBe(appleTouchIcon);
      expect(existsSync(root('public', managerTouchIcon.replace(/^\//, '')))).toBe(true);
    }
    expect(VENUES.lasoul.brand.managerManifest).not.toBe(VENUES.veraitalia.brand.managerManifest);
  });
});
