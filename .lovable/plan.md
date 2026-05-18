# Plan

Three focused improvements to the restaurant app.

## 1. QR Codes — printable A4 sheet (cut-friendly)

File: `src/pages/admin/AdminQRCodes.tsx` (+ small additions to `src/index.css` for print styles).

- Replace the "one QR per page" behavior with a **multi-up A4 grid** designed for cutting.
- Layout: 3 columns × 4 rows per A4 page (12 QRs/page), each cell:
  - "La Soul" wordmark on top (serif, centered)
  - QR code (high error correction, ~50mm)
  - "Table N" below (large, serif)
  - Dashed cut border around each cell
- Print CSS:
  - `@page { size: A4; margin: 10mm; }`
  - `.qr-sheet { display:grid; grid-template-columns: repeat(3, 1fr); gap: 0; }`
  - `.qr-cell { break-inside: avoid; border: 1px dashed #999; padding: 8mm; }`
  - Page-break only between full pages, not per QR.
- Keep existing "Print Single" (still one-per-page) and add the new **"Print Sheet (A4)"** as the primary action.
- Add an on-screen preview that mirrors the print grid so admins see what they'll get.

## 2. Waiter Monitor — all-tables overview + filter by waiter

Goal: a screen shown on a restaurant monitor where staff see every table at a glance, and any waiter can tap their name to filter to just their tables.

- New route: `/waiter/monitor` (public, no login — it's an in-house display).
- New file: `src/pages/WaiterMonitor.tsx`.
- Layout:
  - Header strip: restaurant name + live clock + global stats (occupied / free / oldest wait / pending calls).
  - **Waiter pill bar**: "All" + one pill per active waiter (from `waiters` table). Tapping a pill filters the grid to tables whose `assigned_waiter_id` (via session/section) matches; selection persists in `localStorage` for that device.
  - **Tables grid**: large cards, color-coded by state:
    - Free (muted), Occupied (primary), Needs attention — waiter call (amber, pulsing), Bill requested (red), Order ready to serve (blue).
    - Each card shows: table #, section dot+name, guest name, elapsed time, # active orders, oldest order wait, assigned waiter initials.
  - Realtime subscriptions on `tables`, `table_sessions`, `orders`, `waiter_calls`, `bill_requests`.
- Add a link to `/waiter/monitor` from `WaiterDashboard` header and from `AdminLayout` sidebar ("Floor Monitor").
- Filtering rules:
  - "All" shows everything.
  - Waiter pill shows tables where the active session's `assigned_waiter_id` = that waiter OR table's `section_id` is assigned to that waiter for today (`section_assignments` for `CURRENT_DATE`).

## 3. Anti-spam / abuse hardening

Goal: stop guests ordering when not at the table or spamming.

Backend (migration):
- Add `last_heartbeat_at timestamptz` to `table_sessions` (default `now()`).
- Add DB trigger on `orders` INSERT that rejects when:
  - session is not active, OR
  - `now() - last_heartbeat_at > interval '2 minutes'` (guest device not present), OR
  - more than **5 orders in the last 60 seconds** for the same session.
- Add trigger on `waiter_calls` INSERT: max 1 pending call per session at a time; min 60s between resolved calls.
- Add trigger on `bill_requests` INSERT: only 1 pending per session.
- Tighten RLS INSERT policy on `orders` to also require `last_heartbeat_at > now() - interval '2 minutes'`.

Frontend:
- Guest pages (`GuestMenu`, `CartPage`, `RunningTabPage`): existing 60s heartbeat already pings session; extend it to also write `last_heartbeat_at = now()` via an RPC `touch_session(session_id, token)` (SECURITY DEFINER, validates token).
- On `visibilitychange` → tab hidden > 5 min, force re-validation before next order.
- Keep existing 30s order cooldown + 10-per-item cap; surface clearer toast messages tied to the new trigger errors.

## Technical notes

- Print: rely on CSS `@media print` only; no extra libs.
- Monitor page is read-only and public-safe (only reads already-public tables). No new RLS needed beyond what exists.
- All new colors use semantic tokens from `index.css` (no raw hex in components).
- Realtime: ensure `tables`, `table_sessions`, `orders`, `waiter_calls`, `bill_requests` are in `supabase_realtime` publication (add any missing in the migration).
- `touch_session` RPC signature:
  ```sql
  create or replace function public.touch_session(_id uuid, _token text)
  returns void language sql security definer set search_path=public as $$
    update public.table_sessions
       set last_heartbeat_at = now()
     where id = _id and token = _token and is_active = true;
  $$;
  ```

## Files touched

- `src/pages/admin/AdminQRCodes.tsx` (rewrite print layout)
- `src/index.css` (print styles)
- `src/pages/WaiterMonitor.tsx` (new)
- `src/App.tsx` (add `/waiter/monitor` route)
- `src/pages/WaiterDashboard.tsx` (link to monitor)
- `src/components/admin/AdminLayout.tsx` (sidebar link)
- One migration: `last_heartbeat_at`, triggers, `touch_session` RPC, realtime publication
- Guest pages: extend heartbeat to call `touch_session`
