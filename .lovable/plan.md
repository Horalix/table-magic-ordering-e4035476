

# Implementation Plan: Admin Setup, Data Seeding, and DB-Driven Menu

## What needs to happen

The database is completely empty — no tables, no categories, no menu items, no admin user. The guest menu currently reads from hardcoded `menu-data.ts` instead of the database. We need to:

1. **Create the admin user** and assign the admin role
2. **Seed 30 restaurant tables** into the `tables` table
3. **Seed all menu categories, subcategories, and items** from the hardcoded data into the database
4. **Update the guest menu to read from the database** instead of hardcoded data

## Technical Steps

### Step 1: Create an edge function for admin setup + data seeding

Build a `seed-data` edge function that:
- Creates the admin user (kerim.sabic@gmail.com / kerimko123) using the service role key
- Inserts the admin role into `user_roles`
- Inserts 30 tables (table_number 1-30) into the `tables` table
- Inserts all 3 categories (Drinks, Food, Desserts), their subcategories, and all menu items from the hardcoded `menu-data.ts` data

This uses the service role key (already available as `SUPABASE_SERVICE_ROLE_KEY` secret) to bypass RLS for seeding.

### Step 2: Update CategoryPage to fetch from database

Replace the hardcoded `menuData` import with database queries:
- Fetch categories from `categories` table
- Fetch subcategories from `subcategories` table (filtered by category)
- Fetch menu_items from `menu_items` table (filtered by subcategory, where `is_available = true`)
- Keep the same UI structure and animations

### Step 3: Update GuestMenu to show categories from DB

Replace hardcoded category list with a query to the `categories` table, mapping category names to icons and routes.

### Step 4: Update CartPage item IDs

Currently cart items use string IDs like `drinks-Cocktails-Mojito`. After switching to DB, items will use actual UUID `menu_item.id` — this is critical for order placement since `order_items.menu_item_id` references `menu_items.id`.

### Step 5: Call the seed function and test

Invoke the edge function to populate everything, then verify the admin can log in and the guest menu displays DB data.

## Files to create/modify

| File | Action |
|------|--------|
| `supabase/functions/seed-data/index.ts` | Create — seeding edge function |
| `src/pages/CategoryPage.tsx` | Modify — fetch from DB instead of hardcoded data |
| `src/pages/GuestMenu.tsx` | Modify — fetch categories from DB |
| `src/components/guest/MenuItemDetail.tsx` | Modify — use DB item IDs for cart |

