

# Comprehensive Upgrade: i18n, Guest Identity, Anti-Fraud, No-Refund Policy, Enhanced Admin Analytics

This is a large multi-feature plan. Here's the breakdown:

---

## 1. Database Changes

### New columns needed via migration:
- **`table_sessions`**: Add `guest_name TEXT` column — stores guest's name when they enter
- **`categories`**: Add `name_ar TEXT` column — Arabic translation
- **`subcategories`**: Add `name_ar TEXT` column — Arabic translation
- **`menu_items`**: Add `name_ar TEXT`, `description_ar TEXT` columns — Arabic translations
- **`orders`**: Add `guest_name TEXT` column — copied from session at order time for admin visibility

### No new tables needed — existing schema covers everything.

---

## 2. Multi-Language System (English, Bosnian, Arabic)

### Approach: Client-side i18n with a `src/lib/i18n.ts` translation store
- Create a **Zustand store** (`useLanguageStore`) with `locale` state (`en` | `bs` | `ar`)
- Persist language choice in `localStorage`
- Create a `translations` object with all static UI strings in EN/BS/AR
- Create a `t(key)` helper function

### Menu translations:
- DB already has `name_bs` and `description_bs` columns for Bosnian
- Add `name_ar` and `description_ar` columns for Arabic
- **Auto-translate existing menu items to Arabic** using an edge function that calls Lovable AI (Gemini Flash) to translate all menu items from English to Arabic in one batch, then stores results in DB
- When locale changes, the menu pages read the appropriate `name_[locale]` / `description_[locale]` fields

### RTL support for Arabic:
- Add `dir="rtl"` to the root `<html>` element when Arabic is selected
- Add Tailwind RTL utilities where needed (flip chevrons, text alignment)

### Language selector:
- A small globe icon button on the GuestMenu hero and in page headers
- Shows a dropdown/popover with 🇬🇧 English, 🇧🇦 Bosanski, 🇸🇦 العربية

---

## 3. Guest Name Collection

### Flow:
- When user scans QR and lands on `TableEntry.tsx`, after session is created, show a **name input modal** before redirecting to menu
- Store name in `table_sessions.guest_name`
- Also store in Zustand cart store (`guestName`)
- Display name in the order confirmation screen and on the admin side
- Copy `guest_name` into the `orders` table when placing an order so admin can see who ordered

---

## 4. No-Refund Confirmation Before Ordering

### Flow:
- In `CartPage.tsx`, when user taps "Place Order", show an **AlertDialog** (already have the component):
  - Title: "Confirm Your Order"
  - Body: "Once placed, this order cannot be cancelled or refunded. Please review your items carefully."
  - Two buttons: "Go Back" (cancel) and "Confirm Order" (proceed)
- Only after confirmation does `placeOrder()` execute

---

## 5. Anti-Fraud: Prevent Orders from Outside Establishment

### Strategy — Session heartbeat + admin close:
- **Admin can close table sessions** from the Tables page (already implemented via `closeSession`)
- When a session is closed, the `is_active` flag becomes `false`
- Already implemented: `CartPage.tsx` validates `is_active` before placing orders
- **Enhancement**: Add a periodic session validation check in the cart store — every 60 seconds, ping the session to verify it's still active. If not, clear the cart and show a "Session expired" message
- **Enhancement**: When admin closes a session from AdminTables, it invalidates the QR token by regenerating it, so old QR codes stop working immediately

---

## 6. Enhanced Admin Analytics

### Improvements to `AdminAnalytics.tsx`:
- Add **"Peak Hours" chart** — bar chart showing order volume by hour of day
- Add **"Average Order Preparation Time"** — from pending to served
- Add **"Revenue by Category"** breakdown with actual KM values
- Add **"Guest Count Today"** stat card
- Add **"Table Turnover Rate"** — sessions opened/closed per table

### Improvements to `AdminDashboard.tsx`:
- Show guest names in recent orders
- Add "Bill Requests" count as a stat card
- Add "Waiter Calls" count as a stat card

---

## 7. Auto-Translation Edge Function

### `supabase/functions/translate-menu/index.ts`
- Takes all menu items with no `name_ar` and uses Lovable AI (Gemini Flash) to translate them
- Also translates categories and subcategories
- Called once by admin from a "Translate Menu" button in AdminMenu
- Stores translations directly back in the DB

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/lib/i18n.ts` | Language store + translations + `t()` helper |
| `src/components/guest/LanguageSelector.tsx` | Globe icon dropdown for EN/BS/AR |
| `src/components/guest/GuestNameModal.tsx` | Name input shown after QR scan |
| `supabase/functions/translate-menu/index.ts` | AI-powered Arabic translation |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/TableEntry.tsx` | Add guest name collection step |
| `src/pages/GuestMenu.tsx` | Add language selector, use translated strings |
| `src/pages/CategoryPage.tsx` | Use translated menu item names/descriptions |
| `src/pages/CartPage.tsx` | Add no-refund confirmation dialog, use i18n |
| `src/pages/RunningTabPage.tsx` | Use i18n strings |
| `src/pages/CartPage.tsx` | Session heartbeat validation |
| `src/lib/cart-store.ts` | Add `guestName`, session heartbeat |
| `src/components/guest/MenuItemDetail.tsx` | Use translated strings |
| `src/components/guest/CallWaiterButton.tsx` | Use i18n |
| `src/components/guest/CartBar.tsx` | Use i18n |
| `src/pages/admin/AdminAnalytics.tsx` | Enhanced charts and stats |
| `src/pages/admin/AdminDashboard.tsx` | Guest names, bill/waiter counts |
| `src/pages/admin/AdminOrders.tsx` | Show guest names |
| `src/pages/admin/AdminMenu.tsx` | Add Arabic name fields, "Translate" button |
| `src/pages/admin/AdminTables.tsx` | Auto-regenerate token on session close |
| `src/index.css` | RTL support utilities |

## Migration SQL
- Add `name_ar TEXT`, `description_ar TEXT` to `menu_items`
- Add `name_ar TEXT` to `categories` and `subcategories`
- Add `guest_name TEXT` to `table_sessions`
- Add `guest_name TEXT` to `orders`

