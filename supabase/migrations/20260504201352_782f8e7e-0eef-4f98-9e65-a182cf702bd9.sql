
INSERT INTO storage.buckets (id, name, public)
VALUES ('menu-images', 'menu-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public can read menu images"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

CREATE POLICY "Admins can upload menu images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'menu-images' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update menu images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'menu-images' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete menu images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'menu-images' AND public.has_role(auth.uid(), 'admin'));
