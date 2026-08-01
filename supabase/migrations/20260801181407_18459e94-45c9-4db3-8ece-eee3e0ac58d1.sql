-- =====================================================================
-- 1. Menu engineering fields
-- =====================================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS merchandising_tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS margin_score smallint NOT NULL DEFAULT 0 CHECK (margin_score BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS prep_minutes smallint CHECK (prep_minutes IS NULL OR prep_minutes BETWEEN 0 AND 240),
  ADD COLUMN IF NOT EXISTS allergens text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS portion_note text,
  ADD COLUMN IF NOT EXISTS description_ar text,
  ADD COLUMN IF NOT EXISTS available_from time,
  ADD COLUMN IF NOT EXISTS available_to time;

COMMENT ON COLUMN public.menu_items.margin_score IS
  'Internal merchandising weight (0-100). Never exposed to guests — see guest_get_recommendations.';

CREATE INDEX IF NOT EXISTS idx_menu_items_available ON public.menu_items(is_available, subcategory_id);

CREATE OR REPLACE FUNCTION public.menu_item_orderable(_item public.menu_items, _at time DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _item.is_available
     AND (_item.available_from IS NULL OR COALESCE(_at, LOCALTIME) >= _item.available_from)
     AND (_item.available_to   IS NULL OR COALESCE(_at, LOCALTIME) <= _item.available_to);
$$;

-- =====================================================================
-- 2. Recommendation relationships
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.menu_item_recommendations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_item_id uuid REFERENCES public.menu_items(id) ON DELETE CASCADE,
  source_subcategory_id uuid REFERENCES public.subcategories(id) ON DELETE CASCADE,
  recommended_item_id uuid NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  recommendation_type text NOT NULL DEFAULT 'pair_with'
    CHECK (recommendation_type IN ('pair_with', 'upgrade_to', 'frequently_bought_together', 'after_meal', 'alternative', 'add_on')),
  priority smallint NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  start_time time,
  end_time time,
  language text CHECK (language IS NULL OR language IN ('en', 'bs', 'ar')),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (source_item_id IS NOT NULL OR source_subcategory_id IS NOT NULL OR recommendation_type = 'after_meal'),
  CHECK (source_item_id IS DISTINCT FROM recommended_item_id)
);

CREATE INDEX IF NOT EXISTS idx_reco_source_item ON public.menu_item_recommendations(source_item_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_reco_source_sub ON public.menu_item_recommendations(source_subcategory_id) WHERE enabled;
CREATE INDEX IF NOT EXISTS idx_reco_type ON public.menu_item_recommendations(recommendation_type) WHERE enabled;

ALTER TABLE public.menu_item_recommendations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read recommendations" ON public.menu_item_recommendations;
CREATE POLICY "Staff read recommendations"
  ON public.menu_item_recommendations FOR SELECT TO authenticated
  USING (public.is_staff_member());

DROP POLICY IF EXISTS "Admins manage recommendations" ON public.menu_item_recommendations;
CREATE POLICY "Admins manage recommendations"
  ON public.menu_item_recommendations FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

REVOKE ALL ON public.menu_item_recommendations FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_item_recommendations TO authenticated;
GRANT ALL ON public.menu_item_recommendations TO service_role;

CREATE OR REPLACE FUNCTION public.guest_get_recommendations(
  _cart_item_ids uuid[] DEFAULT '{}',
  _placement text DEFAULT 'cart',
  _language text DEFAULT 'en',
  _limit int DEFAULT 4
)
RETURNS TABLE(
  id uuid,
  name text,
  name_bs text,
  name_ar text,
  price numeric,
  image_url text,
  dietary_tags text[],
  recommendation_type text,
  reason text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH settings AS (
    SELECT COALESCE((SELECT recommendations_enabled FROM public.restaurant_settings WHERE id = 1), true) AS enabled
  ),
  params AS (
    SELECT
      LEAST(GREATEST(COALESCE(_limit, 4), 1), 8) AS lim,
      COALESCE(_cart_item_ids, '{}'::uuid[]) AS cart,
      CASE WHEN _placement IN ('cart', 'after_meal', 'item') THEN _placement ELSE 'cart' END AS placement,
      CASE WHEN _language IN ('en', 'bs', 'ar') THEN _language ELSE 'en' END AS lang,
      LOCALTIME AS now_time
  ),
  cart_subcategories AS (
    SELECT DISTINCT mi.subcategory_id
      FROM public.menu_items mi, params p
     WHERE mi.id = ANY(p.cart)
  ),
  explicit AS (
    SELECT r.recommended_item_id AS item_id,
           r.recommendation_type AS rtype,
           r.priority + 40 AS score
      FROM public.menu_item_recommendations r, params p
     WHERE r.enabled
       AND (r.language IS NULL OR r.language = p.lang)
       AND (r.start_time IS NULL OR p.now_time >= r.start_time)
       AND (r.end_time IS NULL OR p.now_time <= r.end_time)
       AND (
         (p.placement = 'after_meal' AND r.recommendation_type = 'after_meal')
         OR (p.placement <> 'after_meal' AND r.recommendation_type <> 'after_meal'
             AND (r.source_item_id = ANY(p.cart)
                  OR r.source_subcategory_id IN (SELECT cs.subcategory_id FROM cart_subcategories cs)))
       )
  ),
  popular AS (
    SELECT pop.menu_item_id AS item_id,
           'frequently_bought_together'::text AS rtype,
           10 AS score
      FROM public.get_popular_items(12, 45) pop, params p
     WHERE p.placement <> 'after_meal'
       AND NOT EXISTS (SELECT 1 FROM explicit e WHERE e.item_id = pop.menu_item_id)
  ),
  candidates AS (
    SELECT * FROM explicit
    UNION ALL
    SELECT * FROM popular
  )
  SELECT mi.id,
         mi.name,
         mi.name_bs,
         mi.name_ar,
         mi.price,
         mi.image_url,
         mi.dietary_tags,
         c.rtype,
         c.rtype
    FROM candidates c
    JOIN public.menu_items mi ON mi.id = c.item_id
    CROSS JOIN params p
   WHERE (SELECT s.enabled FROM settings s)
     AND public.menu_item_orderable(mi, p.now_time)
     AND NOT (mi.id = ANY(p.cart))
     AND (c.rtype IN ('upgrade_to', 'add_on', 'after_meal')
          OR mi.subcategory_id NOT IN (SELECT cs.subcategory_id FROM cart_subcategories cs))
   GROUP BY mi.id, mi.name, mi.name_bs, mi.name_ar, mi.price, mi.image_url,
            mi.dietary_tags, mi.margin_score, c.rtype, p.lim
   ORDER BY max(c.score) DESC, mi.margin_score DESC, mi.price ASC
   LIMIT (SELECT p.lim FROM params p);
$$;

REVOKE ALL ON FUNCTION public.guest_get_recommendations(uuid[], text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_get_recommendations(uuid[], text, text, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.guest_search_menu(_query text, _limit int DEFAULT 20)
RETURNS TABLE(
  id uuid,
  name text,
  name_bs text,
  name_ar text,
  description text,
  description_bs text,
  description_ar text,
  price numeric,
  image_url text,
  dietary_tags text[],
  merchandising_tags text[],
  is_available boolean,
  subcategory_id uuid,
  category_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT mi.id, mi.name, mi.name_bs, mi.name_ar,
         mi.description, mi.description_bs, mi.description_ar,
         mi.price, mi.image_url, mi.dietary_tags, mi.merchandising_tags,
         mi.is_available, mi.subcategory_id, c.name
    FROM public.menu_items mi
    JOIN public.subcategories s ON s.id = mi.subcategory_id
    JOIN public.categories c ON c.id = s.category_id
   WHERE length(btrim(COALESCE(_query, ''))) >= 2
     AND (
       mi.name ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.name_bs, '') ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.name_ar, '') ILIKE '%' || btrim(_query) || '%'
       OR COALESCE(mi.description, '') ILIKE '%' || btrim(_query) || '%'
       OR s.name ILIKE '%' || btrim(_query) || '%'
     )
   ORDER BY mi.is_available DESC,
            (mi.name ILIKE btrim(_query) || '%') DESC,
            mi.sort_order ASC
   LIMIT LEAST(GREATEST(COALESCE(_limit, 20), 1), 50);
$$;

REVOKE ALL ON FUNCTION public.guest_search_menu(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guest_search_menu(text, int) TO anon, authenticated;

-- =====================================================================
-- 3. First-party analytics
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id bigserial PRIMARY KEY,
  visit_id text NOT NULL,
  event text NOT NULL,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_time ON public.analytics_events(event, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_visit ON public.analytics_events(visit_id, occurred_at);

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff read analytics" ON public.analytics_events;
CREATE POLICY "Staff read analytics"
  ON public.analytics_events FOR SELECT TO authenticated
  USING (public.is_staff_member());

REVOKE ALL ON public.analytics_events FROM anon;
GRANT SELECT ON public.analytics_events TO authenticated;
GRANT ALL ON public.analytics_events TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_event_allowed(_event text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _event IN (
    'menu_viewed', 'category_viewed', 'search_performed', 'search_no_results', 'item_viewed',
    'item_added', 'cart_item_removed', 'cart_viewed',
    'suggestion_shown', 'suggestion_accepted', 'suggestion_dismissed',
    'checkout_opened', 'checkout_submitted', 'order_placed', 'order_failed',
    'payment_started', 'payment_confirmed', 'payment_failed', 'payment_delayed', 'payment_switched_to_table',
    'tab_viewed', 'reorder_tapped', 'waiter_called', 'bill_requested', 'feedback_submitted'
  );
$$;

CREATE OR REPLACE FUNCTION public.record_analytics_events(_visit_id text, _events jsonb)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_visit text := left(COALESCE(nullif(trim(_visit_id), ''), 'anonymous'), 64);
  v_recent int;
  v_inserted int := 0;
BEGIN
  IF jsonb_typeof(_events) <> 'array' OR jsonb_array_length(_events) = 0 THEN
    RETURN 0;
  END IF;
  IF jsonb_array_length(_events) > 25 THEN
    RETURN 0;
  END IF;

  SELECT count(*) INTO v_recent
    FROM public.analytics_events
   WHERE visit_id = v_visit AND created_at > now() - interval '1 hour';
  IF v_recent > 500 THEN
    RETURN 0;
  END IF;

  WITH incoming AS (
    SELECT e->>'event' AS event,
           COALESCE(
             (SELECT jsonb_object_agg(k, v)
                FROM jsonb_each(COALESCE(e->'props', '{}'::jsonb)) AS kv(k, v)
               WHERE jsonb_typeof(v) IN ('string', 'number', 'boolean', 'null')
                 AND length(k) <= 40),
             '{}'::jsonb
           ) AS props,
           COALESCE((e->>'at')::timestamptz, now()) AS occurred_at
      FROM jsonb_array_elements(_events) AS e
  )
  INSERT INTO public.analytics_events(visit_id, event, props, occurred_at)
  SELECT v_visit, i.event, i.props, LEAST(i.occurred_at, now() + interval '1 minute')
    FROM incoming i
   WHERE public.analytics_event_allowed(i.event);

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.record_analytics_events(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_analytics_events(text, jsonb) TO anon, authenticated;

-- =====================================================================
-- 4. Reporting
-- =====================================================================

CREATE OR REPLACE VIEW public.completed_orders
WITH (security_invoker = true)
AS
  SELECT o.*
    FROM public.orders o
   WHERE o.status NOT IN ('awaiting_payment', 'payment_failed', 'cancelled')
     AND o.released_to_kitchen_at IS NOT NULL;

GRANT SELECT ON public.completed_orders TO authenticated;

CREATE OR REPLACE FUNCTION public.day_reconciliation(_day date DEFAULT CURRENT_DATE)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read reconciliation' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'day', _day,
    'orders', count(*),
    'gross', COALESCE(sum(total), 0),
    'tips', COALESCE(sum(tip_amount), 0),
    'refunded', COALESCE(sum(refunded_amount), 0),
    'net', COALESCE(sum(total) - sum(refunded_amount), 0),
    'paid_online', COALESCE(sum(total) FILTER (WHERE payment_method = 'card_online' AND payment_status = 'paid'), 0),
    'paid_cash', COALESCE(sum(total) FILTER (WHERE payment_method = 'cash' AND payment_status = 'paid'), 0),
    'paid_pos_terminal', COALESCE(sum(total) FILTER (WHERE payment_method = 'pos_terminal' AND payment_status = 'paid'), 0),
    'outstanding', COALESCE(sum(total) FILTER (WHERE payment_status IN ('unpaid', 'pending')), 0),
    'outstanding_orders', count(*) FILTER (WHERE payment_status IN ('unpaid', 'pending')),
    'unfiscalized', COALESCE(sum(total) FILTER (WHERE fiscalization_status <> 'fiscalized'), 0),
    'unfiscalized_orders', count(*) FILTER (WHERE fiscalization_status <> 'fiscalized'),
    'average_order', COALESCE(round(avg(total), 2), 0)
  )
  INTO v_result
  FROM public.completed_orders
  WHERE created_at >= _day::timestamptz
    AND created_at < (_day + 1)::timestamptz;

  SELECT v_result || jsonb_build_object(
    'stuck_payments', COALESCE(count(*), 0),
    'stuck_amount', COALESCE(round(sum(o.total), 2), 0),
    'cancelled_orders', (SELECT count(*) FROM public.orders c
                          WHERE c.status = 'cancelled'
                            AND c.created_at >= _day::timestamptz
                            AND c.created_at < (_day + 1)::timestamptz),
    'callback_problems', (SELECT count(*) FROM public.payment_callback_events e
                           WHERE e.outcome IN ('amount_mismatch', 'currency_mismatch', 'unknown_transaction')
                             AND e.created_at >= _day::timestamptz
                             AND e.created_at < (_day + 1)::timestamptz)
  )
  INTO v_result
  FROM public.orders o
  WHERE o.status IN ('awaiting_payment', 'payment_failed')
    AND o.created_at >= _day::timestamptz
    AND o.created_at < (_day + 1)::timestamptz;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.day_reconciliation(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.day_reconciliation(date) TO authenticated;