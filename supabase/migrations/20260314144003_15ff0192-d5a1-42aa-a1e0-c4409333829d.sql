
CREATE TABLE public.ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_session_id UUID NOT NULL REFERENCES public.table_sessions(id) ON DELETE CASCADE,
  rating INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Use a trigger for validation instead of CHECK constraint
CREATE OR REPLACE FUNCTION public.validate_rating()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.rating < 1 OR NEW.rating > 5 THEN
    RAISE EXCEPTION 'Rating must be between 1 and 5';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER check_rating_value
  BEFORE INSERT OR UPDATE ON public.ratings
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_rating();

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can create ratings" ON public.ratings
  FOR INSERT TO public
  WITH CHECK (EXISTS (SELECT 1 FROM table_sessions WHERE id = ratings.table_session_id));

CREATE POLICY "Admin can view ratings" ON public.ratings
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));
