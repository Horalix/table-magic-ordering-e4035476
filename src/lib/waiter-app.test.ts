import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { inKitchenApp, inWaiterApp, KITCHEN_APP_PACKAGES, WAITER_APP_PACKAGES } from './waiter-app';

/**
 * The Android staff apps (android/README.md: a waiter app and a kitchen app
 * for each restaurant) and the websites must name each other, or the app
 * opens with a browser's address bar and its alerts are the browser's, not
 * its own:
 *
 *   - each app names its site (app/build.gradle: hostName, launchUrl);
 *   - each site names all four apps and the key they are signed with
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
  { flavor: 'lasoul', id: 'net.lasoul.waiter', host: 'lasoul.net', name: 'La Soul Waiter', screen: 'waiter', file: 'waiter-app/la-soul-waiter.apk' },
  { flavor: 'veraitalia', id: 'net.veraitalia.waiter', host: 'veraitalia.net', name: 'Vera Italia Waiter', screen: 'waiter', file: 'waiter-app/vera-italia-waiter.apk' },
  { flavor: 'lasoulKitchen', id: 'net.lasoul.kitchen', host: 'lasoul.net', name: 'La Soul Kitchen', screen: 'kitchen', file: 'kitchen-app/la-soul-kitchen.apk' },
  { flavor: 'veraitaliaKitchen', id: 'net.veraitalia.kitchen', host: 'veraitalia.net', name: 'Vera Italia Kitchen', screen: 'kitchen', file: 'kitchen-app/vera-italia-kitchen.apk' },
];

describe('the Android staff apps', () => {
  it.each(APPS)("$name opens its own restaurant's $screen screen", ({ flavor, id, host, name, screen }) => {
    // This app's own block of the build file.
    const block = gradle.slice(gradle.indexOf(`        ${flavor} {`));
    const own = block.slice(0, block.indexOf('\n        }'));
    expect(own).toContain(`applicationId '${id}'`);
    expect(own).toContain(`resValue 'string', 'launcherName', '${name}'`);
    expect(own).toContain(`resValue 'string', 'providerAuthority', '${id}.fileprovider'`);
    if (host === 'lasoul.net') {
      // La Soul's host can be swapped for a preview site when testing; left alone it is lasoul.net.
      expect(gradle).toContain("def laSoulHost = previewHost ?: 'lasoul.net'");
      expect(own).toContain("resValue 'string', 'hostName', laSoulHost");
      expect(own).toContain(`resValue 'string', 'launchUrl', 'https://' + laSoulHost + '/${screen}'`);
      expect(own).toContain('assetStatements(laSoulHost)');
    } else {
      expect(own).toContain(`resValue 'string', 'hostName', '${host}'`);
      expect(own).toContain(`resValue 'string', 'launchUrl', 'https://${host}/${screen}'`);
      expect(own).toContain(`assetStatements('${host}')`);
    }
    expect(screen === 'kitchen' ? KITCHEN_APP_PACKAGES : WAITER_APP_PACKAGES).toContain(id);
    expect(screen === 'kitchen' ? WAITER_APP_PACKAGES : KITCHEN_APP_PACKAGES).not.toContain(id);
  });

  it('the sites vouch for exactly these four apps, signed with one key', () => {
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

  it.each(APPS)('$name is on its site to download, with the page that says how', ({ file }) => {
    const apk = readFileSync(root('public', ...file.split('/')));
    // A zip (what an APK is), and a whole one.
    expect(apk.subarray(0, 2).toString()).toBe('PK');
    expect(apk.length).toBeGreaterThan(1_000_000);
    const page = readFileSync(root('public', file.split('/')[0], 'index.html'), 'utf8');
    expect(page).toContain(`/${file}`);
    expect(page).toContain('noindex');
  });

  it('the kitchen page shows the kitchen icons, and the sites keep both pages fresh', () => {
    const page = readFileSync(root('public', 'kitchen-app', 'index.html'), 'utf8');
    for (const icon of ['la-soul-kitchen.png', 'vera-italia-kitchen.png']) {
      expect(page).toContain(`/kitchen-app/${icon}`);
      expect(readFileSync(root('public', 'kitchen-app', icon)).subarray(1, 4).toString()).toBe('PNG');
    }
    const headers = readFileSync(root('public', '_headers'), 'utf8').replace(/\r\n/g, '\n');
    for (const path of ['/waiter-app/*', '/kitchen-app/*']) {
      expect(headers).toContain(`${path}\n  Cache-Control: no-cache`);
    }
  });

  it('shows alerts as its own, and asks Android for leave to', () => {
    expect(manifest).toContain('android.permission.POST_NOTIFICATIONS');
    expect(manifest).toContain('android:name=".TableAlertService"');
    expect(manifest).toContain('android.support.customtabs.trusted.TRUSTED_WEB_ACTIVITY_SERVICE');
    expect(manifest).toContain('com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity');
    expect(existsSync(root('android', 'app', 'src', 'main', 'res', 'raw', 'table_alert.wav'))).toBe(true);
  });

  it("has its bell as images: a vector reaches Chrome empty and the alert wears Chrome's icon", () => {
    expect(manifest).toContain('android:resource="@drawable/ic_notification"');
    for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
      const png = readFileSync(root('android', 'app', 'src', 'main', 'res', `drawable-${density}`, 'ic_notification.png'));
      expect(png.subarray(1, 4).toString(), density).toBe('PNG');
    }
    expect(existsSync(root('android', 'app', 'src', 'main', 'res', 'drawable', 'ic_notification.xml'))).toBe(false);
    const service = readFileSync(root('android', 'app', 'src', 'main', 'java', 'net', 'lasoul', 'waiterapp', 'TableAlertService.java'), 'utf8');
    // With the app's own package: by bare id the icon is looked up in Chrome's resources.
    expect(service).toContain('builder.setSmallIcon(Icon.createWithResource(this, R.drawable.ic_notification))');
  });

  it("the kitchen apps have no alert service, so a waiter's alerts are always the waiter app's", () => {
    // On a tablet with both of a restaurant's apps, Chrome hands the site's alerts to an app
    // that answers for the site and has the service. Only the waiter app may be that app.
    const kitchen = readFileSync(root('android', 'app', 'src', 'kitchen', 'AndroidManifest.xml'), 'utf8');
    for (const name of [
      'android.permission.POST_NOTIFICATIONS',
      'net.lasoul.waiterapp.TableAlertService',
      'com.google.androidbrowserhelper.trusted.NotificationPermissionRequestActivity',
    ]) {
      expect(kitchen).toMatch(new RegExp(`android:name="${name.replace(/\./g, '\\.')}"\\s+tools:node="remove"`));
    }
    for (const flavor of ['lasoulKitchen', 'veraitaliaKitchen']) {
      expect(gradle).toContain(`${flavor} { manifest.srcFile 'src/kitchen/AndroidManifest.xml' }`);
    }
    // The waiter apps have no such file: theirs is the main manifest, whole.
    for (const flavor of ['lasoul', 'veraitalia']) {
      expect(gradle).not.toContain(`${flavor} { manifest.srcFile`);
    }
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

describe('inside the kitchen app', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { getItem: (k: string) => kept.get(k) ?? null, setItem: (k: string, v: string) => { kept.set(k, v); } };
  };

  it('is known from the page the app opened, and for the rest of the visit', () => {
    const visit = memory();
    expect(inKitchenApp('android-app://net.lasoul.kitchen/', visit)).toBe(true);
    expect(inKitchenApp('https://lasoul.net/waiter/login?to=kitchen', visit)).toBe(true);
    expect(inKitchenApp('android-app://net.veraitalia.kitchen', memory())).toBe(true);
  });

  it('is not the waiter app, and the waiter app is not it', () => {
    const visit = memory();
    expect(inKitchenApp('android-app://net.lasoul.waiter/', visit)).toBe(false);
    expect(inWaiterApp('android-app://net.lasoul.kitchen/', memory())).toBe(false);
    // One visit is one app: what the kitchen app's visit remembers says nothing of the waiter app.
    const kitchen = memory();
    expect(inKitchenApp('android-app://net.lasoul.kitchen/', kitchen)).toBe(true);
    expect(inWaiterApp('https://lasoul.net/kitchen', kitchen)).toBe(false);
    expect(inKitchenApp('', memory())).toBe(false);
    expect(inKitchenApp('android-app://net.lasoul.kitchen.evil/', memory())).toBe(false);
  });
});
