# Plan: Sections, Waiter Assignments, Timing & Server Ratings

## 1. Database (migration)

**New tables:**
- `sections` — `id, name, color, sort_order, created_at`
- `waiters` (extends staff) — `id, user_id (auth.users), display_name, is_active, created_at`
- `section_assignments` — `id, section_id, waiter_id, shift_date (date), created_at` (which waiter covers which section today)
- `server_ratings` — `id, table_session_id, waiter_id, rating (1-5), comment, created_at` (validation trigger 1–5)

**Modify existing:**
- `tables` → add `section_id uuid` (nullable)
- `table_sessions` → add `assigned_waiter_id uuid` (set when session opens, from current shift assignment), add `first_order_at timestamptz`, add `served_at timestamptz`
- `orders` → add `confirmed_at`, `preparing_at`, `ready_at`, `served_at` timestamptz columns (populated by triggers when status changes), and `assigned_waiter_id` (denormalized from session for fast filter)

**Trigger:** on `orders` UPDATE, when `status` changes set the matching timestamp column.

**RLS:**
- `sections`, `waiters`, `section_assignments` — public SELECT, admin manage
- `server_ratings` — public INSERT for active sessions, admin SELECT
- Add helper SQL function `get_waiter_id(_user_id uuid)` so a logged-in waiter can filter their own data without recursion

## 2. Admin: Sections & Staff Management
**New page `/admin/sections`** (added to sidebar):
- Create/edit/delete sections (name + color swatch)
- Assign tables to sections (drag-drop or dropdown per table; reuse `AdminTables` with section column)
- Manage waiters list (create auth users with `staff` role, link to `waiters` row, set display name)
- Daily shift assignment UI: pick date → assign waiter to each section

## 3. Waiter Login & Filtered Kitchen/Orders
- Reuse `/admin/login` (staff role already exists)
- New page `/waiter` (or filter inside `/kitchen`): when logged-in user is a waiter, query joins `tables.section_id` and shows **only orders for tables in sections assigned to that waiter today**
- Add a "My Tables" view: list of active sessions in their section with live timers
- Admin sees everything (toggle: "All sections" / per-section filter)

## 4. Live Timers (occupancy + order wait)
Computed client-side from timestamps, refreshed each second:
- **Table occupancy** = `now - table_sessions.opened_at` (shown on `AdminTables`, waiter view, kitchen)
- **Order wait** = `now - orders.created_at` while not served; color escalates (green <10m, amber 10–20m, red >20m)
- Per-status durations from new timestamp columns shown in order cards

## 5. Customer Rates Their Server
Extend existing `ReviewPrompt` (after bill request):
- Step 1: overall experience stars (existing → goes to `ratings`)
- Step 2: **"How was your server, {waiter_name}?"** — stars + optional one-line comment → inserts `server_ratings` linked to `assigned_waiter_id`
- Step 3: Google review CTA (existing)
- Skippable per step

## 6. Admin Performance Analytics
**New page `/admin/performance`** (added to sidebar):
- Per-waiter cards with: avg server rating (★), total ratings, tables served, avg table-turn time, avg order-confirm time, avg order-served time, total revenue handled, bill-request response time, waiter-call response time
- Date range filter (today / week / month / custom)
- Section leaderboard
- Recent low ratings (<3★) with timestamps for follow-up
- Lightweight charts using `recharts` (already installed)

## 7. Extra polish (high-value, low-effort)
- **Waiter-call & bill-request routing**: notification on the assigned waiter's screen first, with a "claim" action; falls back to all staff after 60s
- **Idle session warning**: highlight tables with no orders >20m and no recent activity
- **Section color tags** on QR sticker print so staff can sort printed stickers per section
- **Response-time SLA badge** on dashboard (e.g., "Avg waiter-call response: 2m 14s")
- **Anti-spam reinforcement**: tie order rate-limit window to `assigned_waiter_id` so one waiter can override the cap from their device for legit large orders

## Files Summary
**Create:**
- `supabase/migrations/<ts>_sections_waiters.sql`
- `src/pages/admin/AdminSections.tsx`
- `src/pages/admin/AdminWaiters.tsx`
- `src/pages/admin/AdminPerformance.tsx`
- `src/pages/WaiterDashboard.tsx` (`/waiter` route)
- `src/components/admin/SectionPicker.tsx`
- `src/components/guest/ServerRatingStep.tsx`
- `src/lib/timing.ts` (formatDuration, useLiveTimer hook)

**Modify:**
- `src/App.tsx` — new routes
- `src/components/admin/AdminLayout.tsx` — add Sections, Waiters, Performance nav
- `src/pages/admin/AdminTables.tsx` — section column + filter, occupancy timer
- `src/pages/KitchenDisplay.tsx` — section filter, waiter-scoped view, per-status timestamps
- `src/pages/admin/AdminDashboard.tsx` — SLA badges
- `src/pages/admin/AdminQRCodes.tsx` — section tag on stickers
- `src/components/guest/ReviewPrompt.tsx` — multi-step with server rating
- `src/pages/TableEntry.tsx` — set `assigned_waiter_id` on session creation from today's section assignment
- `src/lib/i18n.ts` — new keys (rate_your_server, comment, section, waiter, etc. in en/bs/ar)
- `src/integrations/supabase/types.ts` — auto-regenerated

## Notes
- Waiter accounts use existing `staff` role; admin creates them via `/admin/waiters` (calls a small edge function with service role to create the auth user + role + waiters row, since client SDK can't create users)
- One new edge function: `create-waiter` (service-role, admin-guarded)
- All timing UI is client-side derived; no extra DB load
