

# Design Overhaul: Match La Soul's Original Sage Green Identity

## The Problem
The current app uses a light cream/off-white background while the original La Soul website (`menu.lasoul.net`) uses a rich sage green (`~#7D9181`) as the full-page background with white text and their arch logo. The guest menu needs to match this identity.

## Design Changes

### 1. Guest Menu Landing Page (`GuestMenu.tsx`)
- **Full-screen sage green hero** covering the entire viewport, matching the original site's `#7D9181` background
- White logo, white "LA SOUL" text, white "Menu" divider — exactly like the original
- Restaurant info (phone + address) in white/semi-transparent white at the bottom
- Category cards below the hero get a subtle redesign: white cards on a slightly lighter sage background
- Table badge and Call Waiter button styled in white/translucent white to match the sage hero

### 2. Color System Update (`index.css`)
- Add a `--hero-sage` custom property: `140 12% 53%` (the exact La Soul green)
- Keep existing cream background for inner pages (CategoryPage, CartPage, etc.) — only the landing is sage green
- This preserves readability on menu item pages while giving the landing its signature look

### 3. Category Page (`CategoryPage.tsx`)
- Refine the header with a subtle sage green accent line
- Improve card hover states with smoother transitions
- Better empty/loading states with skeleton placeholders instead of just a spinner
- Increase touch targets on subcategory tabs to 44px minimum

### 4. Cart Page (`CartPage.tsx`)
- Add a frosted glass background behind the fixed "Place Order" button
- Improve the empty cart state with the La Soul logo and warmer messaging
- Better visual separation between items

### 5. Menu Item Detail (`MenuItemDetail.tsx`)
- Sage green accent on the "Add to order" button instead of generic primary
- Better image placeholder when no image exists
- Smoother spring animation on the bottom sheet

### 6. Running Tab Page (`RunningTabPage.tsx`)
- Grand total card gets a sage green gradient background
- Better visual hierarchy between order groups

### 7. Kitchen Display (`KitchenDisplay.tsx`)
- Urgency-based card borders (red pulse for pending > 5min)
- Better visual density for desktop grid view

### 8. Admin Pages (AdminLogin, AdminLayout)
- AdminLogin: Add La Soul logo above the login form
- AdminLayout sidebar: Subtle sage green accent on active nav item

### 9. Global Polish
- Ensure all `hover:bg-sage-dark` references work (currently referencing a Tailwind color that may not exist as a utility)
- Add smooth page transitions between routes
- Fix the Index page (currently shows "Welcome to Your Blank App" — redirect to `/menu`)

## Files to Modify

| File | Key Change |
|------|-----------|
| `src/index.css` | Add `--hero-sage` color token, refine type scale |
| `src/pages/GuestMenu.tsx` | Full sage green hero matching original site |
| `src/pages/CategoryPage.tsx` | Refined cards, better loading states, touch targets |
| `src/pages/CartPage.tsx` | Frosted glass CTA, better empty state |
| `src/pages/RunningTabPage.tsx` | Sage gradient total card |
| `src/pages/KitchenDisplay.tsx` | Urgency indicators, density |
| `src/pages/AdminLogin.tsx` | Add logo, refine form |
| `src/pages/Index.tsx` | Redirect to `/menu` |
| `src/components/guest/MenuItemDetail.tsx` | Polish animations, sage CTA |
| `src/components/guest/CartBar.tsx` | Better visual weight |
| `src/components/guest/CallWaiterButton.tsx` | White styling when on sage hero |

