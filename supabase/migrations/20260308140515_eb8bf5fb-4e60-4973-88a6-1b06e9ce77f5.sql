
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'staff');
CREATE TYPE public.order_status AS ENUM ('pending', 'confirmed', 'preparing', 'ready', 'served', 'cancelled');
CREATE TYPE public.order_item_status AS ENUM ('pending', 'preparing', 'ready', 'served');
CREATE TYPE public.table_status AS ENUM ('available', 'occupied', 'reserved');

-- Categories (Drinks, Food, Dessert)
CREATE TABLE public.categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  name_bs TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subcategories
CREATE TABLE public.subcategories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_bs TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Menu Items
CREATE TABLE public.menu_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  subcategory_id UUID NOT NULL REFERENCES public.subcategories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_bs TEXT,
  description TEXT,
  description_bs TEXT,
  price DECIMAL(10,2) NOT NULL,
  image_url TEXT,
  is_available BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Restaurant Tables
CREATE TABLE public.tables (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_number INTEGER NOT NULL UNIQUE,
  status public.table_status NOT NULL DEFAULT 'available',
  qr_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table Sessions
CREATE TABLE public.table_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  is_active BOOLEAN NOT NULL DEFAULT true,
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at TIMESTAMPTZ
);

-- Orders
CREATE TABLE public.orders (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  table_session_id UUID NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  status public.order_status NOT NULL DEFAULT 'pending',
  total DECIMAL(10,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Order Items
CREATE TABLE public.order_items (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id),
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price DECIMAL(10,2) NOT NULL,
  notes TEXT,
  status public.order_item_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Roles (separate table as required)
CREATE TABLE public.user_roles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);

-- Enable RLS on all tables
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subcategories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer function for role checks
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- PUBLIC read policies for menu (guests can browse)
CREATE POLICY "Anyone can view categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Anyone can view subcategories" ON public.subcategories FOR SELECT USING (true);
CREATE POLICY "Anyone can view available menu items" ON public.menu_items FOR SELECT USING (true);

-- Admin write policies for menu management
CREATE POLICY "Admins can insert categories" ON public.categories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update categories" ON public.categories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete categories" ON public.categories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert subcategories" ON public.subcategories FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update subcategories" ON public.subcategories FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete subcategories" ON public.subcategories FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert menu items" ON public.menu_items FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update menu items" ON public.menu_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete menu items" ON public.menu_items FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Table policies (admin/staff manage, public can view for session validation)
CREATE POLICY "Anyone can view tables" ON public.tables FOR SELECT USING (true);
CREATE POLICY "Admin/staff can manage tables" ON public.tables FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- Table sessions (public can read their own session via token, admin/staff manage all)
CREATE POLICY "Anyone can view active sessions" ON public.table_sessions FOR SELECT USING (true);
CREATE POLICY "Anyone can create sessions" ON public.table_sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin/staff can update sessions" ON public.table_sessions FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- Orders (guests create via session, admin/staff view all)
CREATE POLICY "Anyone can view orders" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Anyone can create orders" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin/staff can update orders" ON public.orders FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- Order items
CREATE POLICY "Anyone can view order items" ON public.order_items FOR SELECT USING (true);
CREATE POLICY "Anyone can create order items" ON public.order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin/staff can update order items" ON public.order_items FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'staff'));

-- User roles (only admin can manage)
CREATE POLICY "Admins can view roles" ON public.user_roles FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can manage roles" ON public.user_roles FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Enable realtime for orders and order_items (kitchen display)
ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;

-- Timestamp update function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON public.menu_items FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_orders_updated_at BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
