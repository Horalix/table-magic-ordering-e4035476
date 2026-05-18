
# Floor Monitor — Quick PIN Access for Waiters

Goal: turn the Floor Monitor into the one screen servers actually use. Show every waiter as a big tap target on the shared monitor; tapping their tile asks for a 4‑digit PIN and then drops them into a focused view of only their tables. Keep the full‑floor view available for the host/manager.

## UX flow

1. Floor Monitor (idle / shared view)
   - Top strip: clock + live stats (occupied, active orders, alerts, oldest wait).
   - Big "Waiter rail": one large card per active waiter with name, color dot, # assigned tables, and any urgent badges (calls / bills / ready).
   - One extra tile: "All tables" (manager/host view).
   - Tap a waiter tile → PIN pad modal.

2. PIN pad modal
   - Large numeric keypad (0–9, ⌫, Cancel), 4 dots above.
   - Server enters 4‑digit PIN. On success: enter "My view".
   - Wrong PIN: shake + clear, 3 wrong attempts = 30s cooldown on that tile.

3. "My view" (per‑waiter)
   - Big header: waiter name + "Exit" button (and 5‑min idle auto‑exit back to rail).
   - Only that waiter's tables (same card design we already have, but larger and ordered by urgency: bill → call → ready → oldest wait → seated → free).
   - Sticky bottom bar with quick counts: Calls · Bills · Ready.
   - No admin/management actions here — read‑only floor view tuned for glance + walk.

4. Manager "All tables" tile
   - No PIN. Opens the existing full grid (current behaviour).

## Visual / UX cleanup

- Bigger touch targets (min 96px tall tiles, 56px keypad buttons).
- Reduce chrome: drop the small filter pills row in favor of the waiter rail.
- Color is meaningful only: green = ok, amber = waiting, red = urgent (bill/long wait). Everything else neutral.
- One consistent urgency sort everywhere.
- Persist last‑used waiter on this device so re‑entering PIN is the only step after a refresh.

## Technical details

Database
- Add `pin_hash text` and `pin_set_at timestamptz` to `public.waiters`.
- Add SECURITY DEFINER RPC `verify_waiter_pin(_waiter_id uuid, _pin text) returns boolean` that compares with `crypt()` (pgcrypto) — never expose hashes to the client.
- Add SECURITY DEFINER RPC `admin_set_waiter_pin(_waiter_id uuid, _pin text)` guarded by `has_role(auth.uid(),'admin')` that stores `crypt(_pin, gen_salt('bf'))`.
- PIN must be exactly 4 digits; reject otherwise.

Admin
- `AdminWaiters.tsx`: add "Set PIN" action per waiter (4‑digit input, confirm). Show "PIN set ✓" / "No PIN" badge. New waiters created via `create-waiter` get an auto‑generated PIN shown once.

Frontend (Floor Monitor)
- Refactor `src/pages/WaiterMonitor.tsx`:
  - New top‑level state: `mode: 'rail' | 'mine'`, `activeWaiterId`, `pinTarget`.
  - New components: `WaiterRail`, `WaiterTile`, `PinPadModal`, `MyFloorView`.
  - Reuse existing `TableCard` for both views.
  - Urgency sort helper shared by both views.
  - Idle timeout (5 min no interaction in `mine`) → back to rail.
  - localStorage: `monitor:lastWaiterId` (for convenience only; PIN still required).
  - Lockout: in‑memory map of `{waiterId: {fails, until}}`.

Routes
- Keep `/waiter/monitor` as the single entry. No new routes.
- `/waiter/login` (full waiter dashboard) is untouched.

Out of scope
- No changes to the existing Waiter Dashboard, ordering, or anti‑spam logic.
- PIN is for floor‑view scoping only, not for performing admin/staff DB mutations.

## Files

- migration: add `pin_hash`, `pin_set_at` + two RPCs (uses `pgcrypto`).
- `supabase/functions/create-waiter/index.ts`: optionally accept/generate initial PIN.
- `src/pages/admin/AdminWaiters.tsx`: Set‑PIN dialog + status badge.
- `src/pages/WaiterMonitor.tsx`: rewrite into rail + PIN pad + my‑view.
- `src/components/monitor/PinPad.tsx` (new): reusable numeric keypad.
