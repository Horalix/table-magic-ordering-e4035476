-- =====================================================================
-- One page that answers "what did this app earn us"
--
-- Everything needed to answer it already exists, scattered across a
-- diagnostics page an owner will not read: the causal comparison, its
-- interval, experiment health, per-placement attribution, the item funnel,
-- the cost of things being sold out.
--
-- This composes them into one answer, in one call, with the honesty attached
-- rather than in a caption underneath:
--
--   * the causal figure comes first, and is allowed to say it does not know;
--   * health gates the result — a broken split is not a small caveat, it
--     means the number is meaningless;
--   * attributed revenue appears clearly labelled as an upper bound;
--   * contribution margin only when real food costs exist, because
--     `margin_score` is an ordinal 0-100 and presenting it as money would be
--     inventing a currency.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Real cost, optional
-- ---------------------------------------------------------------------

/*
 * `margin_score` is a merchandising WEIGHT — a number a manager picks to say
 * "push this one". It is not money and no amount of arithmetic turns it into
 * money. If a restaurant wants contribution margin, it has to supply actual
 * costs; until it does, the impact page reports net sales and says so.
 */
ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS food_cost numeric(10,2)
    CHECK (food_cost IS NULL OR food_cost >= 0);

COMMENT ON COLUMN public.menu_items.food_cost IS
  'What the ingredients cost, per portion. Optional. When set for enough of '
  'the menu, the impact page can report contribution margin instead of net '
  'sales. NULL means unknown — never treated as zero.';

/** How much of the menu has a real cost recorded. Any margin figure states it. */
CREATE OR REPLACE FUNCTION public.food_cost_coverage()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'items', count(*),
    'with_cost', count(*) FILTER (WHERE food_cost IS NOT NULL),
    'coverage', CASE WHEN count(*) = 0 THEN 0
                     ELSE round(count(*) FILTER (WHERE food_cost IS NOT NULL)::numeric / count(*), 3) END)
    FROM public.menu_items WHERE is_available;
$$;

REVOKE ALL ON FUNCTION public.food_cost_coverage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.food_cost_coverage() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. The composed answer
-- ---------------------------------------------------------------------

/**
 * Everything the owner needs, in the order they need it.
 *
 * Deliberately one call: three round trips that can disagree with each other
 * is how a dashboard ends up showing a confident headline above a table that
 * contradicts it.
 */
CREATE OR REPLACE FUNCTION public.app_impact_summary(_days int DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_since timestamptz := now() - make_interval(days => GREATEST(COALESCE(_days, 30), 1));
  v_causal jsonb;
  v_attributed jsonb;
  v_funnel jsonb;
  v_sessions int;
  v_net numeric;
BEGIN
  IF NOT public.is_staff_member() THEN
    RAISE EXCEPTION 'Only staff can read the impact summary' USING ERRCODE = 'insufficient_privilege';
  END IF;

  v_causal := public.reco_holdout_comparison(_days);

  SELECT count(*), COALESCE(sum(so.net_sales), 0)
    INTO v_sessions, v_net
    FROM public.session_outcomes so
   WHERE so.opened_at > v_since AND so.orders > 0;

  -- The upper bound, kept and labelled rather than hidden. It is useful — it
  -- is just not causal, and the difference has to be on the page.
  SELECT jsonb_build_object(
           'revenue', COALESCE(round(sum(sc.line_total), 2), 0),
           'orders', count(DISTINCT sc.order_id))
    INTO v_attributed
    FROM public.suggestion_conversions sc
    JOIN public.completed_orders co ON co.id = sc.order_id
   WHERE sc.created_at > v_since;

  /*
   * Money left on the table: dishes people look at and do not order.
   *
   * The single most actionable thing on the page, because the fix is usually a
   * description or a price rather than anything technical.
   */
  SELECT COALESCE(jsonb_agg(x ORDER BY x.views DESC), '[]'::jsonb)
    INTO v_funnel
    FROM (
      SELECT mi.name,
             count(*) FILTER (WHERE e.event = 'item_viewed') AS views,
             count(*) FILTER (WHERE e.event = 'item_added') AS adds
        FROM public.analytics_events e
        JOIN public.menu_items mi ON mi.id = nullif(e.props->>'item_id', '')::uuid
       WHERE e.occurred_at > v_since
         AND e.event IN ('item_viewed', 'item_added')
       GROUP BY mi.id, mi.name
      HAVING count(*) FILTER (WHERE e.event = 'item_viewed') >= 20
         AND count(*) FILTER (WHERE e.event = 'item_added')
             < count(*) FILTER (WHERE e.event = 'item_viewed') * 0.03
       ORDER BY 2 DESC
       LIMIT 5
    ) x;

  RETURN jsonb_build_object(
    'days', _days,
    'sessions', v_sessions,
    'net_sales', round(v_net, 2),
    -- First, and allowed to say "I do not know yet".
    'causal', v_causal,
    'attributed', v_attributed || jsonb_build_object('is_causal', false),
    'looked_at_not_ordered', v_funnel,
    'food_cost', public.food_cost_coverage()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.app_impact_summary(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_impact_summary(int) TO authenticated;
