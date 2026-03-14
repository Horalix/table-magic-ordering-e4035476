

# Comprehensive Polish: Contact Info, Halal Menu, RTL Fix, Review System, Performance, Table Management, Anti-Spam

## Changes Overview

### 1. Fix Contact Info in i18n
Update `phone` and `address` translation keys:
- Phone: `033 877-779` (all locales)
- Address: `Butmirska cesta, Sarajevo 71000` (EN/BS), Arabic version with Arabic script

### 2. Fix Category Descriptions (Halal Restaurant)
Update `drinks_desc` and `food_desc` — remove "wine" and "pizza" mentions:
- `drinks_desc`: "Cocktails, coffee, juices & more" / "Kokteli, kafa, sokovi i više" / Arabic equivalent
- `food_desc`: "Starters, mains, burgers & more" / "Predjela, glavna jela, burgeri i više" / Arabic equivalent

### 3. Fix "LA SOUL" Flipping in Arabic RTL
The letter-by-letter animation at line 83-94 of `GuestMenu.tsx` renders each letter as a separate `<span>`. In RTL mode the browser reverses the order. Fix by wrapping the entire "LA SOUL" text in a `dir="ltr"` container so it always reads left-to-right regardless of document direction.

### 4. Rating & Google Review Popup After Bill Request
Create a `ReviewPrompt` component that appears as a dialog after the user clicks "Request Bill" on `RunningTabPage.tsx`:
- Star rating (1-5) with visual feedback
- "Leave us a Google Review" button linking to `https://share.google/al1h37etpg3lpIXGn`
- Show after bill request succeeds, before the "Bill requested" confirmation
- Store rating in a new `ratings` table (optional, or just show the prompt without storing)

**Database migration**: Create `ratings` table:
```sql
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id UUID NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;
-- Anyone can insert for active sessions
CREATE POLICY "Anyone can create ratings" ON public.ratings FOR INSERT TO public
WITH CHECK (EXISTS (SELECT 1 FROM table_sessions WHERE id = ratings.table_session_id));
-- Admin can view
CREATE POLICY "Admin can view ratings" ON public.ratings FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'));
```

### 5. Performance — Image Preloading
In `TableEntry.tsx`, after session creation and before showing the name modal, fire off a prefetch of all menu item images in the background:
```typescript
// Prefetch menu images
supabase.from('menu_items').select('image_url').not('image_url', 'is', null)
  .then(({ data }) => {
    data?.forEach(item => {
      if (item.image_url) {
        const link = document.createElement('link');
        link.rel = 'prefetch';
        link.as = 'image';
        link.href = item.image_url;
        document.head.appendChild(link);
      }
    });
  });
```

### 6. Table Management — Auto-Free on Session Close + Better UX
**AdminTables.tsx** improvements:
- When admin closes a session (clicks PowerOff), the table automatically becomes "Available" — this already works since it checks `is_active`
- Add guest name + order count display on occupied tables
- Add a "Close & Free Table" button label instead of just an icon
- Add realtime subscription so table status updates live without refresh

### 7. Anti-Spam / Fake Order Prevention
Current protections: session heartbeat (60s), `is_active` check before ordering, RLS policies. Additional measures:
- **Rate limiting in CartPage**: Add a cooldown after placing an order (e.g., 30 seconds before another order can be placed from same session). Store `lastOrderTime` in cart store.
- **Order size limit**: Cap at 20 items per order and max quantity of 10 per item
- **Session-level order limit**: Check total orders per session before allowing new ones (max 10 active orders per session)

### 8. Bill Request Flow — Close Session Automatically
When admin resolves a bill request in KitchenDisplay, also close the associated table session automatically (set `is_active = false`, `closed_at = now()`). This frees the table.

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/i18n.ts` | Fix phone, address, category descriptions |
| `src/pages/GuestMenu.tsx` | Add `dir="ltr"` wrapper on "LA SOUL" text |
| `src/pages/RunningTabPage.tsx` | Add review/rating prompt after bill request |
| `src/pages/TableEntry.tsx` | Prefetch menu images on entry |
| `src/pages/CartPage.tsx` | Rate limiting, order size caps |
| `src/lib/cart-store.ts` | Add `lastOrderTime` for rate limiting |
| `src/pages/admin/AdminTables.tsx` | Better UX, realtime updates |
| `src/pages/KitchenDisplay.tsx` | Auto-close session on bill resolve |

## Files to Create

| File | Purpose |
|------|---------|
| `src/components/guest/ReviewPrompt.tsx` | Star rating + Google Review link dialog |

## Migration
- Create `ratings` table with RLS

