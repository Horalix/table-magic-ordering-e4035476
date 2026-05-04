# Plan: Make Images Load Instantly + Snappier UX Throughout

## Root Cause of Slowness
The menu images come from `menu.lasoul.net` at full resolution (~150–500 KB JPEGs). Even with lazy-load, an 80×80 thumbnail still downloads the full image. The fix is to route every image through an **on-the-fly resize CDN** so an 80px thumb downloads as ~5–10 KB WebP.

## Part 1 — Instant Image Loading

### A. Route all images through wsrv.nl (free, no signup, no API key)
`wsrv.nl` is a free Cloudflare-backed image proxy. We rewrite every image URL to:
```
https://wsrv.nl/?url=menu.lasoul.net/img/x.jpg&w=80&h=80&fit=cover&output=webp&q=78
```
Returns optimized WebP at the exact pixel size. Edge-cached globally.
Updates `SmartImage.tsx` with:
- `srcSet` with 1x and 2x variants (sharp on retina, small on mobile)
- Subtle scale-in (1.02 → 1.0) + fade on load — feels alive instead of just popping in
- Smarter error fallback (tries original URL before showing letter)

### B. Replace shimmer with a real moving gradient (`src/index.css`)
Current `animate-pulse` is fine but the new shimmer sweeps left-to-right — perceptually faster.

### C. Pre-warm wsrv connection (`index.html`)
Add `<link rel="preconnect" href="https://wsrv.nl" crossorigin>` and `<link rel="dns-prefetch" href="//wsrv.nl">` so the very first image avoids TLS handshake delay (~150ms on mobile).

### D. Eager-load the first **8** items (was 4)
On a desktop viewport like the user's (1045px), 4 isn't enough above-the-fold. Bump priority count to 8.

### E. Prefetch the **current** subcategory's later images on idle
Right now we prefetch only adjacent subcategory. Also kick off a low-priority warmup for items 9–20 of the current view immediately after first paint, so scrolling never waits.

### F. Decode-before-paint
Use `img.decode()` Promise so fade-in only fires after the image is fully decoded — no half-rendered flash.

## Part 2 — Snappier UI / Satisfying Buttons & Transitions

### A. Tactile button press (global) — `src/index.css`
New utility `.tap` with `active:scale-95` + `transition-transform duration-100 ease-out` and a faint ring on tap. Apply to all primary tap targets (cart bar, place-order, +/-, category cards, subcategory tabs, add-to-cart pills).

### B. Page transitions
Wrap routes in a **shared layout** with `framer-motion` `AnimatePresence` + a 180ms cross-fade & subtle slide. Already-cached React Query data means the next page renders instantly under the fade.

### C. Subcategory tab switch — instant content, animated underline
- Animated active-pill (layoutId="activeSub") that **slides** between tabs instead of recoloring — feels Apple-grade.
- Items use `placeholderData: keepPreviousData` (already done), but also stagger the **new** items with 20 ms delay so they cascade in.

### D. Cart bar polish
- Spring entrance (already there) + tiny pulse on the count badge whenever count changes.
- Total amount uses `tabular-nums` and animates with a count-up (300ms) when changing.
- Button gets a soft inner-glow on hover.

### E. Card press feedback
Menu item cards: on tap, briefly translate-y-[1px] + shadow drop. On hover (desktop), thumbnail scales 1.04 inside its frame (mask via `overflow-hidden`).

### F. Snappier framer-motion config
- Drop entrance durations from 0.3s → 0.18s.
- Cap the staggered list entrance at the first 6 items only (currently every item delays — slow on long lists).
- Honor `prefers-reduced-motion`.

### G. Skeleton sizes mirror real layout (already done) — verify and extend to the GuestMenu cards too.

### H. Faster initial paint
- Move the heavy framer-motion logo intro on `GuestMenu.tsx` from 1.0s/0.8s/0.7s delays down to 0.4s max — shaves perceived load by ~600 ms.

### I. Sticky header subtle elevation on scroll
Add a 1px shadow + slight bg darken once scrolled — gives depth, feels native-app.

### J. Optimistic add-to-cart
The Plus button already triggers haptics; add a 250 ms scale bounce on the cart-bar count badge so the user *feels* the item land.

## Files Touched
| Action | File |
|---|---|
| Edit | `src/components/ui/SmartImage.tsx` (wsrv proxy + 2x srcset + decode) |
| Edit | `src/index.css` (shimmer keyframes, `.tap`, reduced-motion, sticky shadow) |
| Edit | `index.html` (preconnect to wsrv.nl) |
| Edit | `src/pages/CategoryPage.tsx` (priority=8, animated subcategory pill, snappier stagger, prefetch current tail) |
| Edit | `src/pages/GuestMenu.tsx` (faster intro, tap utility) |
| Edit | `src/pages/CartPage.tsx` (count-up total, button polish) |
| Edit | `src/components/guest/CartBar.tsx` (badge bounce on change, count-up total) |
| Edit | `src/components/guest/MenuItemDetail.tsx` (priority hero + spring) |
| Edit | `tailwind.config.ts` (add `shimmer` keyframe + `.tap` plugin) |
| New | `src/components/PageTransition.tsx` (shared route fade) |
| Edit | `src/App.tsx` (wrap routes with PageTransition) |

## Expected Impact
- Thumbnails: **~150 KB → ~6 KB** each. List paints in 1 RTT on 4G.
- Hero image in modal: ~400 KB → ~25 KB WebP.
- Subcategory switch feels instant due to keepPreviousData + animated pill.
- Every tap has visible/haptic feedback within 16 ms.

Approve and I'll implement.
