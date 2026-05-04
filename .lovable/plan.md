## 1. Fix "Failed to send a request to the Edge Function"

Root cause confirmed in edge function logs:
```
TypeError: userClient.auth.getClaims is not a function
```
The `migrate-images` function calls `userClient.auth.getClaims(token)`, which doesn't exist in supabase-js 2.45.0. The function crashes before responding, so the browser sees a network failure.

**Fix `supabase/functions/migrate-images/index.ts`:**
- Replace `getClaims` with `userClient.auth.getUser(token)` (standard, supported API).
- Use the returned `user.id` for the admin role lookup against `user_roles`.
- Keep the rest of the migration flow (batched download → upload to `menu-images` → update row) unchanged.
- Redeploy the function.

After this, clicking **Self-host Images** in `/admin/menu` will return `{ migrated, skipped, failed, total }` and the toast will show real progress.

## 2. Clean up the Waiter app (`src/pages/WaiterDashboard.tsx`)

Currently it's a plain stack of cards with no header chrome, mixed density, and weak visual hierarchy. Bring it in line with the polished guest/admin look.

**Layout & header**
- Add a sticky top bar (matches AdminLayout style): waiter name + avatar circle on the left, live "On shift" status dot, sign-out button on the right. Subtle border-bottom + backdrop blur.
- Section the page into clearly titled blocks: **Attention needed**, **My tables**, **Live orders** — each with a count chip.

**Attention needed (waiter calls + bill requests)**
- Promote to a single horizontal-scroll row of compact "alert pills" with colored left accent (amber for call, primary for bill), big table number, elapsed time, and a single tap "Done" button with `.tap` feedback.
- Empty state: muted "All caught up ✨" line so the section doesn't disappear/reappear jarringly.

**My tables grid**
- Restyle cards: large table number top-left, elapsed-time pill top-right using `waitBg(ms)` color thresholds (consistent with kitchen), guest name as subtitle, and a soft divider before the action row.
- Replace the destructive-looking "Close & free table" with a ghost "Free table" button + small confirm (using existing AlertDialog pattern) so it's not misclicked.
- Show count of active orders for that table inline.

**Live orders**
- Group orders under their table number, sorted by oldest-first.
- Status badge becomes a colored dot + label; the "Mark as next" button becomes the primary CTA full-width with `.tap` press effect and an icon matching the next state (Check, Flame, Bell, Utensils).
- Add subtle entrance animation via existing framer-motion (stagger 40ms, fade+slide 8px).

**Loading / empty**
- Replace the bare "Loading…" with a 3-card skeleton grid (reusing shadcn `Skeleton`).
- Empty states get a small icon + 1-line copy instead of plain text.

**Responsiveness**
- Mobile: single column, sticky bottom-safe padding so last card isn't hidden behind iOS bars (`pb-[env(safe-area-inset-bottom)]`).
- Tablet/desktop: 2–3 column grid as today.

No schema changes, no new dependencies — only `supabase/functions/migrate-images/index.ts` and `src/pages/WaiterDashboard.tsx` are modified.