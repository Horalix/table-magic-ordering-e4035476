# La Soul — Operations Runbook

Practical guide to keep the system healthy in production.

## 1. Backups (Supabase)
- **Enable backups**: Supabase Dashboard → Database → Backups. On the **Pro plan** you get daily backups; turn on **Point-in-Time Recovery (PITR)** for restaurant-grade safety (restore to any moment).
- **Test a restore** once before go-live so you trust the process.
- The local repo also holds all schema as `supabase/migrations/*` — that's your schema source of truth.

## 2. Error monitoring (Sentry)
- Create a free Sentry project (React) → copy its **DSN**.
- Set `VITE_SENTRY_DSN` (front-end env) and redeploy. Errors then appear in Sentry with stack traces + session replay on error.
- Without a DSN, monitoring is simply off — nothing breaks.

## 3. Uptime monitoring
- Add the deployed site URL and the Edge Function base URL to a free monitor (e.g. **UptimeRobot** / **Better Stack**), 1–5 min interval, alert by email/Telegram.
- Watch especially: the guest menu URL, `/kitchen`, and the `monri-webhook` function (payments).

## 4. Go-live checklists (cross-links)
- **Payments (Monri):** `docs/monri-payments-architecture.md` → "Go-live checklist".
- **Fiscalization (BiH):** `docs/fiscalization-bih.md`.
- **Security:** apply the `*_security_audit_fixes` migration, rotate the old admin password, enable Supabase **Leaked Password Protection** (Auth → Providers/Passwords), and delete the deployed `seed-data` function.
- **Printing:** Admin → Printing; on the kitchen device open `/kitchen` and tap the printer button; for silent printing launch Chrome with `--kiosk-printing`.

## 5. Staff quick-start
- **Admin**: Dashboard checklist walks first-time setup (tables → sections → assign waiters → menu → QR). Daily numbers live under **Daily Report**.
- **Kitchen**: `/kitchen` — orders flow New → Confirmed → Preparing → Ready; sound + auto-print on the designated device.
- **Floor/waiter**: `/waiter/monitor` (PIN) for the floor; `/waiter` for a waiter's own tables. Assign sections nightly via Admin → **Tonight**.

## 6. Routine checks
- **Daily**: glance at Daily Report (sales vs. expectation), confirm the kitchen printer device is on `/kitchen`.
- **Weekly**: skim Sentry for recurring errors; confirm a recent backup exists.
- **On menu changes**: edit in Admin → Menu; if you rely on the pre-optimized local images, re-run `npm run images` and redeploy.

## 7. Common fixes
- **Guest "can't place order"**: usually an expired session — they re-scan the table QR. Orders are also capped at 10 per table session and 5/min (anti-spam).
- **Kitchen not printing**: ensure the device is the designated printer (printer button highlighted), printing is enabled in Admin → Printing, and the browser allows printing (kiosk flag for silent).
- **Card payment "coming soon"**: Monri isn't enabled yet — see the Monri checklist.
