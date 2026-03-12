
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS name_ar TEXT;
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS description_ar TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name_ar TEXT;
ALTER TABLE public.subcategories ADD COLUMN IF NOT EXISTS name_ar TEXT;
ALTER TABLE public.table_sessions ADD COLUMN IF NOT EXISTS guest_name TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS guest_name TEXT;
