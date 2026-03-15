

# Comprehensive Polish: Large Orders, Printable QR Codes, UX Perfection, Anti-Fraud

## Changes

### 1. Large Orders — Show "Call Server" Instead of Blocking
Currently `MAX_ITEMS_PER_ORDER = 20` blocks the order entirely. Change to: allow any quantity, but for orders >20 items show a friendly message suggesting they call a server to assist, without preventing the order. Remove the hard block, add a soft suggestion.

**Files:** `src/pages/CartPage.tsx`, `src/lib/i18n.ts`

### 2. Printable QR Codes — Individual Print-Ready Cards
Redesign `AdminQRCodes.tsx` with:
- Each QR code as a standalone printable card with "La Soul" branding, table number, and "Scan to order" text
- "Print Individual" button per QR code (opens print dialog for just that card)
- "Print All" button prints a clean grid layout
- Add proper `@media print` CSS to hide admin chrome and show only QR cards
- Each card sized for standard label/card printing

**Files:** `src/pages/admin/AdminQRCodes.tsx`, `src/index.css`

### 3. Anti-Fraud — Session Token Validation on Every Order
Current protection is good (session heartbeat + `is_active` check). Enhance:
- In `TableEntry.tsx`, validate the QR token matches the table's current `qr_token` — already done
- Add session token to cart store and validate it matches on order placement
- The `table_sessions` INSERT RLS already requires a valid table — good
- The `orders` INSERT RLS already requires an active session — good
- Key addition: when the cart store's heartbeat detects an expired session, redirect user to a "session expired" page instead of just clearing cart silently

**Files:** `src/lib/cart-store.ts`

### 4. UX Polish — Navigation & Smooth Experience
- **CartPage**: Show item images in cart for visual confirmation
- **GuestMenu hero**: Reduce animation delays so menu loads faster visually (currently 1.8s+ before categories appear)
- **CartBar**: Ensure bottom padding on all pages so CartBar doesn't overlap content
- **MenuItemDetail**: Cap quantity at 10 in the detail modal (already capped in cart store)
- **Back navigation**: Ensure all back buttons preserve table/token params

**Files:** `src/pages/GuestMenu.tsx`, `src/pages/CartPage.tsx`, `src/components/guest/MenuItemDetail.tsx`

### 5. Print CSS for QR Codes
Add `@media print` rules to:
- Hide sidebar, headers, navigation
- Show only QR code cards in a clean grid
- Each card with border for cutting guides

**Files:** `src/index.css`

### 6. i18n — Add Missing Translation Keys
Add keys for: `large_order_suggestion`, `print_qr`, `download_qr`

**Files:** `src/lib/i18n.ts`

## Summary of All File Changes

| File | Changes |
|------|---------|
| `src/pages/CartPage.tsx` | Soft suggestion for large orders instead of blocking; show item images |
| `src/pages/admin/AdminQRCodes.tsx` | Full redesign with individual print, better layout, branding |
| `src/index.css` | Print CSS for QR codes |
| `src/lib/i18n.ts` | Add large_order_suggestion key |
| `src/pages/GuestMenu.tsx` | Reduce animation delays for faster perceived load |
| `src/lib/cart-store.ts` | Better session expiry handling with redirect |
| `src/components/guest/MenuItemDetail.tsx` | Cap quantity selector at 10 |

