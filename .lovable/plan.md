# Plan: Faster Image Loading + UX Polish

## Problem
Menu images come from `menu.lasoul.net` at full resolution (~hundreds of KB each). They load slowly on mobile, cause layout shift, and there's no progressive feedback. Combined with several small UX rough edges across the guest flow.

## Part 1 — Image Loading Speed

### A. Smart `<Image>` component (`src/components/ui/SmartImage.tsx` — new)
Single reusable component handling:
- **Responsive `srcset`** with `width` query param (most CDNs/Supabase Storage honor it). For external URLs that don't, falls back to original.
- **`loading="lazy"`** for off-screen items, **`loading="eager"` + `fetchpriority="high"`** for above-the-fold (first 4 cards).
- **`decoding="async"`**.
- **Blur-up placeholder**: tiny solid color (from a hash of name) shown until `onLoad` fires, then fades in.
- **Explicit `width`/`height`** props → reserves space, kills CLS.
- **IntersectionObserver pre-decode** for the next viewport's images.

### B. Replace `<img>` usages
Swap raw `<img>` in:
- `src/pages/CategoryPage.tsx` (list thumbnails — 80×80, eager for first 4)
- `src/pages/GuestMenu.tsx` (category cards)
- `src/components/guest/MenuItemDetail.tsx` (modal hero — eager, high priority)
- `src/pages/CartPage.tsx` (cart thumbnails)

### C. Smarter prefetch in `TableEntry.tsx`
Currently prefetches **every** menu image on session start (wasteful, can saturate mobile). Change to:
- Only prefetch images for the **first category** (Drinks) at small thumbnail size.
- Use `<link rel="preload" as="image" imagesrcset=...>` for top 8 items.
- Move full prefetch to idle time via `requestIdleCallback`.

### D. React Query caching
- Set `staleTime: 5 * 60 * 1000` and `gcTime: 30 * 60 * 1000` on menu/category/subcategory queries so back-navigation is instant.
- Add `placeholderData: keepPreviousData` on subcategory item switches so the list doesn't blank out.

### E. Service worker–style cache via `Cache Storage` (lightweight)
Small util `src/lib/image-cache.ts` that warms the browser HTTP cache for next likely subcategory's images when user hovers/taps a tab.

## Part 2 — UX Polish

1. **Skeletons match real layout** — current skeletons are generic rectangles. Make item skeletons mirror the 80×80 thumb + 2 text lines layout so transition is seamless (no jump).
2. **Tab bar sticky shadow** — add subtle shadow only when scrolled (IntersectionObserver sentinel).
3. **Empty-state illustration** — replace the bare "no items" text with a small icon + helpful copy.
4. **Cart bar bounce** — when an item is added, briefly pulse the count badge (already mounted, just animate).
5. **Add-to-cart toast** — small bottom toast "Added Americano · 5.00 KM" with undo (3s). Reduces accidental adds.
6. **Quantity stepper haptic** — `navigator.vibrate(10)` on +/- on mobile.
7. **Image fallback** — when image 404s, show the existing letter-circle fallback instead of broken icon.
8. **Sticky header blur tweak** — increase `backdrop-blur` and add `bg-background/70` for readability over images.
9. **RTL fixes** — verify Arabic locale: cart bar item count badge position, back-arrow rotation already handled, ensure category card text alignment.
10. **Reduce motion respect** — wrap framer-motion entrance animations in `prefers-reduced-motion` check.
11. **Faster route transitions** — preload `/cart` and `/tab` route components on idle (React.lazy + dynamic import warm-up).
12. **Menu item modal** — close on swipe-down gesture (currently only close button / backdrop tap).
13. **Price emphasis** — slightly larger price font, tabular-nums so prices align vertically in lists.
14. **Network status banner** — already exists; ensure it doesn't overlap CartBar (add padding when offline).

## Files Touched
| Action | File |
|---|---|
| New | `src/components/ui/SmartImage.tsx` |
| New | `src/lib/image-cache.ts` |
| New | `src/components/guest/AddedToast.tsx` |
| Edit | `src/pages/CategoryPage.tsx` |
| Edit | `src/pages/GuestMenu.tsx` |
| Edit | `src/pages/CartPage.tsx` |
| Edit | `src/pages/TableEntry.tsx` |
| Edit | `src/components/guest/MenuItemDetail.tsx` |
| Edit | `src/components/guest/CartBar.tsx` |
| Edit | `src/main.tsx` (QueryClient defaults) |
| Edit | `src/index.css` (skeleton shimmer, reduced motion) |

## Out of Scope
- Migrating images to Supabase Storage (would give true on-the-fly resizing). Can be a follow-up if speedups here aren't enough — let me know and I'll plan that migration separately.

Approve and I'll implement.
