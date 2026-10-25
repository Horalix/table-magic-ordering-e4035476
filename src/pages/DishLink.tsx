import { useEffect, useState } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { sectionSlug } from '@/lib/menu-sections';
import { assignDishSlugs } from '@/lib/seo/menu-data';
import { menuCategoryPath } from '@/lib/venues';
import NotFound from './NotFound';

type Row = { id: string; name: string; subcategories: { name: string; categories: { name: string } | null } | null };

/**
 * /menu/<venue>/dish/<slug> — a dish's own address.
 *
 * Search engines and answer engines read the page prerendered at that address
 * (scripts/seo-prerender.ts). A person who follows the link is taken to the
 * dish on the real menu, open, in its category and section. Slugs come from
 * the same function the build uses, over the same rows: available dishes.
 */
const DishLink = () => {
  const { dishSlug } = useParams<{ dishSlug: string }>();
  const [target, setTarget] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let live = true;
    void (async () => {
      const { data, error } = await supabase
        .from('menu_items')
        .select('id, name, subcategories(name, categories(name))')
        .eq('is_available', true);
      if (!live) return;
      if (error || !Array.isArray(data)) { setTarget(null); return; }
      const rows = data as unknown as Row[];
      const slugs = assignDishSlugs(rows);
      const row = rows.find((r) => slugs.get(r.id) === dishSlug);
      const category = row?.subcategories?.categories?.name;
      if (!row || !category) { setTarget(null); return; }
      const params = new URLSearchParams({ section: sectionSlug(row.subcategories?.name ?? ''), dish: row.id });
      setTarget(`${menuCategoryPath(sectionSlug(category))}?${params.toString()}`);
    })();
    return () => { live = false; };
  }, [dishSlug]);

  if (target === undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }
  return target ? <Navigate to={target} replace /> : <NotFound />;
};

export default DishLink;
