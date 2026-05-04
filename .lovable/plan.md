# Plan: Self-Host All Menu Images + Final Polish Pass

## Why
External images on `menu.lasoul.net` are slow, uncacheable on our edge, and a single point of failure. Even with the wsrv.nl proxy, we depend on a third party. Solution: **download every image once, store in Lovable Cloud Storage, rewrite `image_url` in the database to the new public URL.** Then images come from Supabase's global CDN — fast, reliable, free.

---

## Part 1 — Migrate All Images to Cloud Storage

### A. Create the storage bucket
Migration creates a public `menu-images` bucket with read-everyone / write-admin RLS.

### B. One-time migration Edge Function: `migrate-images`
Server-side Deno function that:
1. Selects every row in `menu_items` where `image_url` starts with `http` and is NOT already on our Supabase domain.
2. For each: `fetch(url)` → upload to `menu-images/<menu_item_id>.<ext>` with `cacheControl: '31536000, immutable'`.
3. Updates the row's `image_url` to the new public URL.
4. Returns a JSON summary `{ migrated, skipped, failed }`.

Runs in batches of 20 in parallel; safe to re-run (idempotent — skips items already on our domain).

Also handles category images if any exist.

### C. Trigger it from a new admin page button: `/admin/menu` → "Migrate Images"
- Shows progress, last-run summary.
- Disabled while running.
- Only visible to admins (existing `has_role('admin')` check).

### D. Auto-upload future images
Update the existing admin "edit menu item" flow so when an admin uploads a new image, it goes straight to the `menu-images` bucket instead of being a URL field. (Quick add: a small `<input type="file">` next to the URL field that uploads & fills the URL.)

### E. Simplify `SmartImage`
Once images are on Supabase, `?width=` query params actually work (Supabase Storage supports image transforms). Update `SmartImage`:
- If URL is a Supabase Storage URL → append `?width=Wx&quality=78&format=webp`.
- Otherwise → fall back to wsrv.nl proxy (still useful for any stragglers).
- Remove the proxy dependency for the common case.

---

## Part 2 — Cleaner / Smoother / Faster Polish

### A. Smarter list virtualization (only if needed)
For categories with 20+ items, mount only what's near the viewport (`react-window` or simple IntersectionObserver-based). On Drinks/Coffee (12 items) it's not needed; only kick in past N=15.

### B. Route-level code splitting
Convert admin/kitchen/waiter routes to `React.lazy()` so guests don't ship admin JS. Should drop initial bundle ~30%.

### C. Progressive image hint via `<link rel="preload">` for top 4
After session creation, inject `<link rel="preload" as="image" href=...>` for the 4 hero items of Drinks. Browser starts fetching before React even mounts the page.

### D. Page-transition wrapper
A tiny `<PageTransition>` using framer-motion `AnimatePresence` for a 160 ms fade between guest routes. Feels native.

### E. Sticky header elevation on scroll
Shadow appears once `scrollY > 4` — adds depth, signals scroll position.

### F. Better empty / error states
- Network error fallback on Category page: "Couldn't load menu — Tap to retry".
- Empty cart already nice.

### G. Cleanup dead code
- Old `image-cache.ts` `prefetched` Set is fine, keep.
- Remove unused `ShoppingBag` import in CartBar (verify).
- Drop `framer-motion` from low-value places (e.g. plain divs that don't need animating).

### H. Service worker (lightweight) for image cache
Register a tiny SW that caches `menu-images/*` URLs with a stale-while-revalidate strategy. Second visit = 0 network for images. Optional, only if user wants offline-first.

### I. Web manifest + PWA "Add to home screen"
Add `manifest.webmanifest` + theme color so guests can add La Soul to home screen — repeat visits feel like an app.

---

## Files Touched / Created
| Action | File |
|---|---|
| New | `supabase/functions/migrate-images/index.ts` (one-shot uploader) |
| New | `supabase/migrations/<ts>_menu_images_bucket.sql` |
| Edit | `src/components/ui/SmartImage.tsx` (Supabase transform support) |
| Edit | `src/pages/admin/AdminMenu.tsx` (Migrate button + progress + per-item file upload) |
| Edit | `src/App.tsx` (lazy-load admin/kitchen/waiter routes, wrap guest routes in PageTransition) |
| New | `src/components/PageTransition.tsx` |
| Edit | `src/pages/TableEntry.tsx` (preload top 4 hero images) |
| Edit | `src/index.css` (sticky-header shadow on scroll utility) |
| New | `public/manifest.webmanifest` + `<link>` in `index.html` |
| New (optional) | `public/sw.js` + register in `main.tsx` |

## Out of Scope (Ask if Wanted)
- True service worker / offline mode (Section H, I) — adds complexity. **Want me to include PWA + SW now or keep it simple?**

Approve and I'll implement Parts 1 + 2A–G, and skip H/I unless you say otherwise.
