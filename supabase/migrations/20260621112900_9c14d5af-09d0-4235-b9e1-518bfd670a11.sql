ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS dietary_tags text[] NOT NULL DEFAULT '{}';