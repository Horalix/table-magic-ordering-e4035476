

# Comprehensive Fix & Polish: Analytics, QR Codes, Translations, Anti-Fraud

## Issues Identified

1. **Analytics includes cancelled orders** — Top items and category breakdown queries don't filter out cancelled orders
2. **QR token regeneration on session close breaks printed QR codes** — The closeSession function regenerates the qr_token, invalidating all printed QR codes. This is wrong — printed codes must always work. Anti-fraud should work differently.
3. **Translations broken** — The translate-menu edge function only translates items with `name_ar IS NULL`. If it was called once and failed partially, or items have empty strings instead of null, they won't be re-translated. Also "LA SOUL" brand name gets translated in the UI when it shouldn't.
4. **Menu items don't show translated names** — The `getLocalizedName` and `getLocalizedDescription` functions work, but the data isn't in the DB yet. The edge function needs to also handle Bosnian translations, and the "Auto-Translate" button should translate both AR and BS.
5. **Anti-fraud approach is wrong** — Regenerating QR tokens destroys printed codes. Better approach: session-based validation only (which already exists via heartbeat + `is_active` check before ordering).

## Plan

### 1. Fix Analytics — Exclude Cancelled Orders

**`AdminAnalytics.tsx`**: Add `.neq('status', 'cancelled')` to the order_items queries for top items and category breakdown. The daily revenue and peak hours already filter cancelled — good. But top items query joins `order_items` without filtering the parent order status.

- Fetch order_items via orders join, filtering `orders.status != 'cancelled'`
- Or fetch orders first (non-cancelled), then get their items

### 2. Fix QR Code Anti-Fraud (Remove Token Regeneration)

**`AdminTables.tsx`**: 
- Remove the QR token regeneration from `closeSession()` — printed QR codes must remain valid
- Remove the `regenerateToken` button from the QR display
- Anti-fraud is already handled: session heartbeat checks `is_active`, and `placeOrder` validates session before inserting
- When admin closes a session, the next QR scan creates a new session (existing logic in `TableEntry.tsx`)

### 3. Fix Translation Edge Function

**`translate-menu/index.ts`**:
- Add support for Bosnian (`name_bs`, `description_bs`) translations too
- Also translate items where `name_ar` is empty string (not just null)
- Add a `force` parameter to re-translate everything
- Increase robustness of AI prompt (explicitly say "Do NOT translate brand names like 'La Soul'")

### 4. Fix "LA SOUL" Not Being Translated in UI

**`GuestMenu.tsx`**: The "LA SOUL" text in the hero is hardcoded — good, it should stay English. But check if the `getLocalizedName` for categories could return "لا سول" for category names. The issue is the edge function prompt — it should preserve brand names.

### 5. Translation Button Improvements

**`AdminMenu.tsx`**:
- Add a "Re-translate All" option (sends `force: true`)
- Add "Translate Bosnian" button too, or make one button translate both AR and BS

### 6. Translate-menu Edge Function — Also Handle Bosnian

Update the edge function to translate to both Arabic AND Bosnian in one call, or accept a `target_locale` parameter.

### 7. Overall Polish Items

- **`AdminAnalytics.tsx`**: The peak hours filter logic is buggy/complex. Simplify to just show hours 8-23.
- **`KitchenDisplay.tsx`**: The `soundEnabled` state is captured in a stale closure in the realtime callback. Use a ref for sound state.
- **`AdminDashboard.tsx`**: Dashboard revenue also correctly excludes cancelled — good.
- **`RunningTabPage.tsx`**: Order items show English names (`oi.menu_items?.name`) even when locale is Arabic. Should show localized name.

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/admin/AdminAnalytics.tsx` | Filter cancelled from top items + category breakdown, simplify peak hours |
| `src/pages/admin/AdminTables.tsx` | Remove QR token regeneration from closeSession, remove regenerate button |
| `supabase/functions/translate-menu/index.ts` | Support Bosnian, force re-translate, preserve brand names |
| `src/pages/GuestMenu.tsx` | Ensure "LA SOUL" is never translated |
| `src/pages/admin/AdminMenu.tsx` | Better translate button (both languages, force option) |
| `src/pages/KitchenDisplay.tsx` | Fix stale closure for soundEnabled |
| `src/pages/RunningTabPage.tsx` | Show localized item names |
| `src/pages/CategoryPage.tsx` | Minor — already uses localized names, verify |
| `supabase/config.toml` | Update if edge function config changes |

