import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inWaiterApp, WAITER_APP_PACKAGES } from './waiter-app';

/**
 * The Android waiter apps (android/README.md) and the websites must name each
 * other, or the app opens with a browser's address bar and its alerts are the
 * browser's, not its own:
 *
 *   - each app names its site (app/build.gradle: hostName, launchUrl);
 *   - each site names both apps and the key they are signed with
 *     (public/.well-known/assetlinks.json, served by both sites).
 *
 * One wrong letter in either is silent until a tablet shows an address bar.
 */

const root = (...p: string[]) => resolve(__dirname, '..', '..', ...p);
const gradle = readFileSync(root('android', 'app', 'build.gradle'), 'utf8');
const manifest = readFileSync(root('android', 'app', 'src', 'main', 'AndroidManifest.xml'), 'utf8');
const links = JSON.parse(readFileSync(root('public', '.well-known', 'assetlinks.json'), 'utf8')) as {
  relation: string[];
  target: { namespace: string; package_name: string; sha256_cert_fingerprints: string[] };
}[];

const APPS = [
  { flavor: 'lasoul', id: 'net.lasoul.waiter', host: 'lasoul.net', name: 'La Soul Waiter' },
  { flavor: 'veraitalia', id: 'net.veraitalia.waiter', host: 'veraitalia.net', name: 'Vera Italia Waiter' },
];

describe('the Android waiter apps', () => {
  it.each(APPS)("$name opens its own restaurant's waiter screen", ({ id, host, name }) => {
    expect(gradle).toContain(`applicationId '${id}'`);
    expect(gradle).toContain(`resValue 'string', 'launcherName', '${name}'`);
    if (host === 'lasoul.net') {
      // La Soul's host can be swapped for a preview site when testing; left alone it is lasoul.net.
      expect(gradle).toContain("def laSoulHost = previewHost ?: 'lasoul.net'");
      expect(gradle).toContain("resValue 'string', 'launchUrl', 'https://' + laSoulHost + '/waiter'");
    } else {
      expect(gradle).toContain(`resValue 'string', 'hostName', '${host}'`);
      expect(gradle).toContain(`resValue 'string', 'launchUrl', 'https://${host}/waiter'`);
      expect(gradle).toContain(`assetStatements('${host}')`);
    }
    expect(WAITER_APP_PACKAGES).toContain(id);
  });

  it('the sites vouch for exactly these two apps, signed with one key', () => {
    expect(links.map((l) => l.target.package_name).sort()).toEqual(APPS.map((a) => a.id).sort());
    for (const link of links) {
      expect(link.relation).toEqual(['delegate_permission/common.handle_all_urls']);
      expect(link.target.namespace).toBe('android_app');
      expect(link.target.sha256_cert_fingerprints).toHaveLength(1);
      // SHA-256 of the signing certificate: 32 bytes, upper-case hex, colon-separated.
      expect(link.target.sha256_cert_fingerprints[0]).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    }
    expect(new Set(links.map((l) => l.target.sha256_cert_fingerprints[0])).size).toBe(1);
  });

  it('is the waiter screen only: no shortcuts to the floor or the kitchen', () => {
    expect(manifest).not.toContain('android.app.shortcuts');
    for (const { flavor } of APPS) {
      expect(existsSync(root('android', 'app', 'src', flavor, 'res', 'xml', 'shortcuts.xml'))).toBe(false);
    }
  });

  it('is on each site to download, with the page that says how', () => {
    for (const file of ['la-soul-waiter.apk', 'vera-italia-waiter.apk']) {
      const apk = readFileSync(root('public', 'waiter-app', file));
      // A zip (what an APK is), and a whole one.
      expect(apk.subarray(0, 2).toString()).toBe('PK');
      expect(apk.length).toBeGreaterThan(1_000_000);
    }
    const page = readFileSync(root('public', 'waiter-app', 'index.html'), 'utf8');
    expect(page).toContain('/waiter-app/la-soul-waiter.apk');
    expect(page).toContain('/waiter-app/vera-italia-waiter.apk');
    expect(page).toContain('noindex');
  });

  it('shows alerts as its own, and asks Android for leave to', () => {
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android:name=".TableAlertService"');
    expect(manifest).toContain('android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE');
    expect(manifest).toContain('com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity');
    expect(existsSync(root('android', 'app', 'src', 'main', 'res', 'raw', 'table_alert.wav'))).toBe(true);
  });

  it('answers for the whole site, so Chrome can find its alert service', () => {
    // Chrome looks the service up by the scope of the site's service worker, "/". An app that
    // opens only /waiter is not found, and every alert is then Chrome's own, on Chrome's channel.
    expect(manifest).toContain('android:host="@string/hostName"');
    expect(manifest).not.toContain('android:pathPrefix');
    expect(manifest).toContain('android:autoVerify="true"');
  });

  it('declares every screen the launcher switches on by name, or it stops as it opens', () => {
    expect(manifest).toContain('com.google.androidbrowserhelper.trusted.ManageDataLauncherActivity');
    expect(manifest).toContain('com.google.androidbrowserhelper.trusted.FocusActivity');
  });

  it.each(APPS)('$name has its icon in every density, and its colours', ({ flavor }) => {
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      for (const file of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
        expect(existsSync(root('android', 'app', 'src', flavor, 'res', `mipmap-${density}`, file)), `${flavor} ${density} ${file}`).toBe(true);
      }
    }
    expect(existsSync(root('android', 'app', 'src', flavor, 'res', 'drawable-nodpi', 'splash.png'))).toBe(true);
    expect(readFileSync(root('android', 'app', 'src', flavor, 'res', 'values', 'colors.xml'), 'utf8')).toContain('ic_launcher_background');
  });

  it('keeps the signing key out of the repository', () => {
    const ignore = readFileSync(root('android', '.gitignore'), 'utf8');
    for (const line of ['keystore.properties', '*.jks', '*.keystore']) expect(ignore).toContain(line);
    expect(gradle).not.toMatch(/storePassword\s+['"][^'"]+['"]/);
  });
});

describe('inside the waiter app', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  };

  it('is known from the page the app opened, and for the rest of the visit', () => {
    const visit = memory();
    expect(inWaiterApp('android-app://net.lasoul.waiter/', visit)).toBe(true);
    // The next page of the same visit has an ordinary referrer.
    expect(inWaiterApp('https://lasoul.net/waiter/login', visit)).toBe(true);
    expect(inWaiterApp('android-app://net.veraitalia.waiter', memory())).toBe(true);
  });

  it('is not a browser tab, another app, or a lookalike package', () => {
    expect(inWaiterApp('', memory())).toBe(false);
    expect(inWaiterApp('https://lasoul.net/', memory())).toBe(false);
    expect(inWaiterApp('android-app://com.android.chrome/', memory())).toBe(false);
    expect(inWaiterApp('android-app://net.lasoul.waiter.evil/', memory())).toBe(false);
  });

  it('still knows on its first page with storage switched off', () => {
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    expect(inWaiterApp('android-app://net.lasoul.waiter/', blocked)).toBe(true);
    expect(inWaiterApp('https://lasoul.net/waiter', blocked)).toBe(false);
  });
});
