

# Premium Landing Page + Anti-Fraud Order Protection

## 1. Premium Landing Page (GuestMenu.tsx)

**Use the actual La Soul arch logo** from `https://menu.lasoul.net/img/test1.svg` (their SVG with arch + olive branch).

Redesign the hero section:
- Full-screen sage green hero background matching their current site
- The actual La Soul SVG logo centered with a cinematic fade-in + scale animation sequence
- "LA SOUL" text revealed with a staggered letter animation
- Decorative gold divider line with "Menu" label
- Restaurant info (phone + address) at the bottom, matching their current site
- Smooth scroll transition into category cards
- Category cards get subtle parallax hover effect and gold accent borders
- If table is set, show an elegant gold "Table X" badge

## 2. Anti-Fraud Order Protection

Current state: Users can visit `/menu` directly, add items to cart, but get blocked at checkout (no sessionId). This still lets people build fake carts.

**Changes:**
- **CategoryPage.tsx**: Hide the "+" add-to-cart buttons when there's no valid table session (no `table`/`token` params). Show a subtle banner: "Scan the QR code at your table to order"
- **MenuItemDetail.tsx**: Disable "Add to Order" button when no session; show message instead
- **CartBar.tsx**: Don't show the cart bar when no session
- **CartPage.tsx**: Add a server-side session validation check before placing orders — query `table_sessions` to confirm the session is still active (not just trust the Zustand store)
- **GuestMenu.tsx**: Allow browsing (good for discovery) but show "Scan QR to order" messaging when no table params

This way the menu is still browsable for people discovering the restaurant, but ordering is locked behind a valid QR scan.

## Files to modify

| File | Change |
|------|--------|
| `src/pages/GuestMenu.tsx` | Full redesign with La Soul SVG logo, premium animations, restaurant info |
| `src/pages/CategoryPage.tsx` | Conditionally hide add-to-cart when no session |
| `src/components/guest/MenuItemDetail.tsx` | Disable ordering when no session |
| `src/components/guest/CartBar.tsx` | Hide when no session |
| `src/pages/CartPage.tsx` | Validate session is active server-side before order |

