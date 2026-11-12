# The waiter apps for Android

Two apps from one project: **La Soul Waiter** (`net.lasoul.waiter`) and
**Vera Italia Waiter** (`net.veraitalia.waiter`). Each is its restaurant's
waiter screen and nothing else: a waiter signs in, works the shift and signs
out.

Tablets get them from the restaurant's own site:

- https://lasoul.net/waiter-app/
- https://veraitalia.net/waiter-app/

## What the app is

A Trusted Web Activity: the app opens `https://<site>/waiter` full screen in
Chrome, with no address bar. It is the same web app the browser shows, so a
new version of the waiter screen reaches every tablet by itself; the APK only
changes when something in this folder does.

What the APK adds to a browser tab:

- **Alerts with the screen off.** New orders, guest calls and bill requests
  are web push notifications (`supabase/functions/notify-staff`,
  `public/sw-push.js`). Chrome hands each one to the app
  (`TableAlertService.java`), which shows it on its own channel, **Orders,
  calls and bills**: high importance, on the lock screen, with the app's own
  chime (three rising notes, twice) and a long vibration.
- **No double ringing.** While the waiter screen is open and in front, the
  page rings itself and marks its notification silent; the app shows that one
  on a second, soundless channel.
- **Only the waiter screen.** Inside the app the floor monitor button and the
  manager's sign-in link are hidden, and a kitchen account is sent back
  (`src/lib/waiter-app.ts`).

The site and the app name each other, or the app shows an address bar and its
alerts are Chrome's:

- the app names its site (`app/build.gradle`: `hostName`, `launchUrl`);
- the site names both apps and the key they are signed with
  (`public/.well-known/assetlinks.json`, served by both sites).

`src/lib/waiter-app.test.ts` holds the two to each other.

## Setting up a tablet

1. Update **Chrome** (Play Store) and make it the default browser.
2. Open the site's `/waiter-app/` page in Chrome, tap **Download the app**,
   then **Open**. The first time, allow Chrome to install apps (**Settings →
   Allow from this source**), go back and tap **Install**.
3. Open the app, sign in as the waiter.
4. Turn on **Alerts on lock screen**, tap **Allow**, then **Send a test** and
   lock the screen: it rings within 10 seconds.
5. Settings → Apps → the app → **Battery → Unrestricted**. The same for
   Chrome. On Samsung also add both to **Never sleeping apps**.
6. Notification volume up; Do Not Disturb off during service. A tablet that
   stays in one place stays on its charger.

If the app shows an address bar at the top, Chrome could not check the site's
`assetlinks.json`: the tablet was offline the first time, or the file on the
site does not name this key. Open the app again with the tablet online.

## Building

Needs Android Studio (its JDK and the Android SDK) and the signing key.

```bash
cd android
JAVA_HOME="C:/Program Files/Android/Android Studio/jbr" \
WAITER_KEYSTORE_PROPERTIES="C:/Users/<you>/Documents/waiter-app-signing/keystore.properties" \
./gradlew assembleRelease
```

The two APKs land in `app/build/outputs/apk/<flavour>/release/`. To put them
on the sites, copy them over `public/waiter-app/la-soul-waiter.apk` and
`public/waiter-app/vera-italia-waiter.apk` and deploy.

For every APK handed out, raise `versionCode` and `versionName` in
`app/build.gradle` first (and the version on `public/waiter-app/index.html`):
Android refuses to install a lower `versionCode` over a higher one.

The icons, the splash image, the colours and the chime are made from the
websites' brand files by `node android/tools/make-assets.mjs` and committed;
run it again only when the brand changes.

## The signing key

The key is **not** in this repository. It was made on 12 November 2026 and
lives in `Documents/waiter-app-signing/` on the computer that built the apps
(`waiter-apps.jks` and `keystore.properties`, which holds its password).

Keep a copy of that folder somewhere safe. Every update of either app must be
signed with it: Android refuses an update signed with another key, and the
sites vouch for this key's fingerprint only. If it is lost, both apps must be
uninstalled from every tablet and installed again under a new key, and
`public/.well-known/assetlinks.json` changed to the new fingerprint.

`local.properties` (where the Android SDK is) and `keystore.properties` are
ignored by git.

## Testing before a release

A pull request's preview site serves the same `assetlinks.json`, so the whole
hand-off can be tried before a merge:

```bash
./gradlew assembleLasoulRelease -PpreviewHost=deploy-preview-NN--lasoulapp.netlify.app
adb install -r app/build/outputs/apk/lasoul/release/app-lasoul-release.apk
```

Never hand such a build to a waiter: it opens the preview site.

What to check on a tablet or an emulator with Chrome:

- the app opens the waiter sign-in with **no address bar**;
- turning alerts on shows **Android's** permission prompt, not Chrome's;
- an alert appears under the app's name on **Orders, calls and bills**
  (`adb shell dumpsys notification --noredact`, look for the package and
  `channel=table_alerts`);
- `adb shell dumpsys deviceidle force-idle`, then a waiter call: it still
  rings.
