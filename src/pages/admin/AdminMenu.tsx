import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import SmartImage from '@/components/ui/SmartImage';
import {
  ChevronDown, ChevronRight, ChevronUp, EyeOff, Image as ImageIcon, Languages,
  Loader2, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2, UtensilsCrossed, X,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import MenuItemDialog from '@/components/admin/MenuItemDialog';
import InlinePrice from '@/components/admin/InlinePrice';
import { DIET_BY_KEY, getItemTags } from '@/lib/dietary';
import { Link } from 'react-router-dom';
import { isNew, saleScheduled } from '@/lib/promotions';
import { shownVenueSlug } from '@/lib/current-venue';
import type { Database } from '@/integrations/supabase/types';

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];
type SubcategoryInsert = Database['public']['Tables']['subcategories']['Insert'];
type MenuItemRow = import('@/lib/promotions-api').MenuItemRow;
type AdminSubcategory = Database['public']['Tables']['subcategories']['Row'] & { menu_items?: MenuItemRow[] | null };
type AdminCategory = Database['public']['Tables']['categories']['Row'] & { subcategories?: AdminSubcategory[] | null };

interface TranslateMenuResponse { message?: string }
interface MigrateImagesResponse { migrated: number; skipped: number; failed: number }

type Names = { name: string; name_bs: string; name_ar: string };

/** Reusable EN/BS/AR name editor — used for adding and renaming. */
const NameEditor = ({ initial, label, onSave, onCancel }: {
  initial: Names; label: string; onSave: (v: Names) => void; onCancel: () => void;
}) => {
  const [v, setV] = useState(initial);
  return (
    <div className="p-3 bg-muted rounded-lg space-y-2">
      <Input placeholder={`${label} (EN)`} value={v.name} autoFocus onChange={(e) => setV({ ...v, name: e.target.value })} />
      <Input placeholder={`${label} (BS)`} value={v.name_bs} onChange={(e) => setV({ ...v, name_bs: e.target.value })} />
      <Input placeholder={`${label} (AR)`} value={v.name_ar} dir="rtl" onChange={(e) => setV({ ...v, name_ar: e.target.value })} />
      <div className="flex gap-2">
        <Button size="sm" className="font-sans" onClick={() => onSave(v)}>Save</Button>
        <Button size="sm" variant="outline" className="font-sans" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
};

const ConfirmDelete = ({ trigger, title, description, onConfirm }: {
  trigger: React.ReactNode; title: string; description: string; onConfirm: () => void;
}) => (
  <AlertDialog>
    <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const sortByOrder = <T extends { sort_order: number }>(arr?: T[] | null): T[] =>
  [...(arr ?? [])].sort((a, b) => a.sort_order - b.sort_order);

/**
 * Is this a "still referenced elsewhere" refusal?
 *
 * A dish that has ever been ordered is referenced by `order_items`, and the
 * database refuses to delete it so that past orders, receipts and the day's
 * reconciliation keep their lines. The page used to answer that with a bare
 * "Failed to delete", which reads as a glitch and invites retrying.
 */
const isStillReferenced = (error: { code?: string; message?: string } | null) =>
  !!error && (error.code === '23503' || /foreign key/i.test(error.message ?? ''));

/**
 * Available / Sold out, as one labelled control big enough for a thumb.
 *
 * It was a 28px "On"/"Off" ghost button — the most-used live control on the
 * page, small enough to miss and worded so that "Off" could mean either the
 * state or the action.
 */
const AvailabilitySwitch = ({ item, onToggle }: { item: MenuItemRow; onToggle: (item: MenuItemRow) => void }) => (
  <button
    type="button"
    role="switch"
    aria-checked={item.is_available}
    aria-label={`${item.name}: ${item.is_available ? 'available' : 'sold out'}`}
    onClick={() => onToggle(item)}
    className={`inline-flex items-center gap-2 min-h-[44px] px-2.5 rounded-lg text-xs font-sans font-semibold transition-colors ${
      item.is_available ? 'text-primary hover:bg-primary/10' : 'text-destructive hover:bg-destructive/10'
    }`}
  >
    <span
      aria-hidden
      className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${item.is_available ? 'bg-primary' : 'bg-muted-foreground/30'}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform ${item.is_available ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </span>
    {/* The word only where there is room for it and the dish's name; the
        switch's own label says it either way. */}
    <span className="hidden sm:inline w-[54px] text-left">{item.is_available ? 'Available' : 'Sold out'}</span>
  </button>
);

const AdminMenu = () => {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedSubcategory, setExpandedSubcategory] = useState<string | null>(null);

  const [addingCategory, setAddingCategory] = useState(false);
  const [search, setSearch] = useState('');
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'category' | 'subcategory'; id: string } | null>(null);

  const [itemDialog, setItemDialog] = useState<{ subcategoryId?: string; item?: MenuItemRow } | null>(null);

  const [isTranslating, setIsTranslating] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  /** "Re-translate All" overwrites hand-corrected names, so it asks first. */
  const [confirmRetranslate, setConfirmRetranslate] = useState(false);
  /** An item whose delete was asked for — one dialog, reachable from the inline button and the phone menu. */
  const [pendingDelete, setPendingDelete] = useState<MenuItemRow | null>(null);
  /** The same, for a category deleted from the phone menu. */
  const [pendingCategoryDelete, setPendingCategoryDelete] = useState<AdminCategory | null>(null);
  /** An item the database refused to delete because past orders point at it. */
  const [undeletable, setUndeletable] = useState<MenuItemRow | null>(null);

  const fetchMenu = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*, subcategories(*, menu_items(*))')
      .order('sort_order');
    if (error) { toast.error('Failed to load menu'); setLoading(false); return; }
    const sorted = (data ?? []).map((cat) => ({
      ...cat,
      subcategories: sortByOrder(cat.subcategories).map((sub) => ({ ...sub, menu_items: sortByOrder(sub.menu_items) })),
    }));
    setCategories(sorted);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchMenu(); }, [fetchMenu]);

  // ---- Create ----
  const addCategory = async ({ name, name_bs, name_ar }: Names) => {
    if (!name.trim()) return;
    const payload: CategoryInsert = { name: name.trim(), name_bs: name_bs.trim() || null, name_ar: name_ar.trim() || null, sort_order: categories.length };
    const { error } = await supabase.from('categories').insert(payload);
    if (error) { toast.error('Failed to add category'); return; }
    toast.success('Category added'); setAddingCategory(false); await fetchMenu();
  };

  const addSubcategory = async (categoryId: string, { name, name_bs, name_ar }: Names) => {
    if (!name.trim()) return;
    const cat = categories.find((c) => c.id === categoryId);
    const payload: SubcategoryInsert = { category_id: categoryId, name: name.trim(), name_bs: name_bs.trim() || null, name_ar: name_ar.trim() || null, sort_order: cat?.subcategories?.length ?? 0 };
    const { error } = await supabase.from('subcategories').insert(payload);
    if (error) { toast.error('Failed to add subcategory'); return; }
    toast.success('Subcategory added'); setAddingSubFor(null); await fetchMenu();
  };

  // ---- Rename ----
  const rename = async (kind: 'category' | 'subcategory', id: string, { name, name_bs, name_ar }: Names) => {
    if (!name.trim()) { toast.error('Name required'); return; }
    const patch = { name: name.trim(), name_bs: name_bs.trim() || null, name_ar: name_ar.trim() || null };
    const { error } = kind === 'category'
      ? await supabase.from('categories').update(patch).eq('id', id)
      : await supabase.from('subcategories').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Renamed'); setEditing(null); await fetchMenu();
  };

  // ---- Reorder (renormalizes sort_order) ----
  const persistOrder = async (table: 'categories' | 'menu_items', arr: { id: string }[]) => {
    const results = await Promise.all(arr.map((x, i) =>
      table === 'categories'
        ? supabase.from('categories').update({ sort_order: i }).eq('id', x.id)
        : supabase.from('menu_items').update({ sort_order: i }).eq('id', x.id),
    ));
    // Reordering is N writes and any one of them can fail, leaving the menu
    // half-renumbered. The refetch below would then quietly show the mixed
    // result as if it were what was asked for.
    const failed = results.filter((r) => r.error);
    if (failed.length > 0) {
      toast.error(`Could not save the new order (${failed.length} of ${arr.length} failed) — reloading`);
    }
    await fetchMenu();
  };
  const move = <T extends { id: string }>(table: 'categories' | 'menu_items', list: T[], id: string, dir: 'up' | 'down') => {
    const idx = list.findIndex((x) => x.id === id);
    const swap = dir === 'up' ? idx - 1 : idx + 1;
    if (swap < 0 || swap >= list.length) return;
    const arr = [...list];
    [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
    void persistOrder(table, arr);
  };

  // ---- Toggle / delete ----
  /** Patch one item in the local tree, without a refetch. */
  const patchItem = useCallback((id: string, changes: Partial<MenuItemRow>) => {
    setCategories((prev) => prev.map((cat) => ({
      ...cat,
      subcategories: (cat.subcategories ?? []).map((sub) => ({
        ...sub,
        menu_items: (sub.menu_items ?? []).map((it) => (it.id === id ? { ...it, ...changes } : it)),
      })),
    })));
  }, []);

  /**
   * Sold out / back on, applied on screen at once.
   *
   * It used to wait for the write and then refetch the whole three-level menu,
   * so the switch sat unchanged for a second and got tapped again — which
   * toggled it straight back. The write is now confirmed afterwards and undone
   * on screen if the database refuses it.
   */
  const toggleAvailability = async (item: MenuItemRow) => {
    const next = !item.is_available;
    patchItem(item.id, { is_available: next });
    const { error } = await supabase.from('menu_items').update({ is_available: next }).eq('id', item.id);
    if (error) {
      patchItem(item.id, { is_available: item.is_available });
      toast.error(`Could not update ${item.name}: ${error.message}`);
      return;
    }
    // Taking something off mid-service is a decision worth confirming out
    // loud — it is the single most common live menu action.
    toast.success(next ? `${item.name} is back on` : `86'd — ${item.name} is sold out`);
  };

  const remove = async (table: 'categories' | 'subcategories' | 'menu_items', id: string) => {
    const { error } = table === 'categories'
      ? await supabase.from('categories').delete().eq('id', id)
      : table === 'subcategories'
        ? await supabase.from('subcategories').delete().eq('id', id)
        : await supabase.from('menu_items').delete().eq('id', id);
    if (error) {
      if (isStillReferenced(error)) {
        if (table === 'menu_items') {
          setUndeletable(menuItemById(id));
        } else {
          toast.error('Some dishes in here are on past orders, so it cannot be deleted. Mark those dishes sold out instead.');
        }
        return;
      }
      toast.error(`Failed to delete: ${error.message}`);
      return;
    }
    toast.success('Deleted'); await fetchMenu();
  };

  const menuItemById = (id: string): MenuItemRow | null => {
    for (const cat of categories) {
      for (const sub of cat.subcategories ?? []) {
        const hit = (sub.menu_items ?? []).find((it) => it.id === id);
        if (hit) return hit;
      }
    }
    return null;
  };

  /**
   * A new price, from the list. Shown at once, written, and put back on
   * screen if the database refuses it — the same contract as the sold-out
   * switch.
   */
  const changePrice = async (item: MenuItemRow, price: number): Promise<boolean> => {
    const before = item.price;
    patchItem(item.id, { price });
    const { error } = await supabase.from('menu_items').update({ price }).eq('id', item.id);
    if (error) {
      patchItem(item.id, { price: before });
      toast.error(`Could not change the price of ${item.name}: ${error.message}`);
      return false;
    }
    toast.success(`${item.name}: ${Number(before).toFixed(2)} → ${price.toFixed(2)} KM`);
    return true;
  };

  /** "/" jumps to the search box, as on most admin tools. */
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const markSoldOutInstead = async (item: MenuItemRow) => {
    setUndeletable(null);
    if (!item.is_available) { toast.info(`${item.name} is already sold out`); return; }
    await toggleAvailability(item);
  };

  /**
   * What is currently off.
   *
   * A manager who 86'd four things at 19:00 has no way to remember them at
   * 22:00, and an item left off overnight is invisible revenue: it does not
   * appear anywhere, because "not on the menu" looks exactly like "we do not
   * sell that".
   */
  const offMenu = useMemo(() => {
    const out: MenuItemRow[] = [];
    for (const cat of categories) {
      for (const sub of cat.subcategories ?? []) {
        for (const item of sub.menu_items ?? []) {
          if (!item.is_available) out.push(item);
        }
      }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [categories]);

  /** Flat search across the whole menu, because the tree is three levels deep. */
  const searchHits = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return null;
    const out: { item: MenuItemRow; path: string }[] = [];
    for (const cat of categories) {
      for (const sub of cat.subcategories ?? []) {
        for (const item of sub.menu_items ?? []) {
          const haystack = `${item.name} ${item.name_bs ?? ''} ${item.name_ar ?? ''} ${item.description ?? ''}`.toLowerCase();
          if (haystack.includes(q)) out.push({ item, path: `${cat.name} › ${sub.name}` });
        }
      }
    }
    return out;
  }, [categories, search]);

  // ---- Tools ----
  const translateMenu = async (force = false) => {
    setIsTranslating(true);
    try {
      // The restaurant shown: the owner must name one; a restaurant admin's own is used regardless.
      const { data, error } = await supabase.functions.invoke<TranslateMenuResponse>('translate-menu', { body: { force, venue: shownVenueSlug() } });
      if (error) throw error;
      toast.success(`Translation complete: ${data?.message ?? 'menu updated'}`);
      await fetchMenu();
    } catch (err) {
      console.error('Translation error:', err);
      toast.error('Translation failed. Please try again.');
    } finally { setIsTranslating(false); }
  };
  const migrateImages = async () => {
    setIsMigrating(true); setMigrateResult(null);
    try {
      const { data, error } = await supabase.functions.invoke<MigrateImagesResponse>('migrate-images', { body: { venue: shownVenueSlug() } });
      if (error) throw error;
      if (!data) throw new Error('Image migration returned no result');
      const msg = `Migrated ${data.migrated} · Skipped ${data.skipped} · Failed ${data.failed}`;
      setMigrateResult(msg); toast.success(msg); await fetchMenu();
    } catch (err: unknown) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : 'Image migration failed');
    } finally { setIsMigrating(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-serif text-3xl font-bold text-foreground">Menu Management</h1>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={() => translateMenu(false)} disabled={isTranslating} variant="outline" size="sm" className="rounded-lg font-sans gap-1">
            {isTranslating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
            {isTranslating ? 'Translating…' : 'Auto-Translate'}
          </Button>
          <Button onClick={() => setConfirmRetranslate(true)} disabled={isTranslating} variant="outline" size="sm" className="rounded-lg font-sans gap-1">
            <RefreshCw className="w-4 h-4" /> Re-translate All
          </Button>
          <Button onClick={migrateImages} disabled={isMigrating} variant="outline" size="sm" className="rounded-lg font-sans gap-1" title="Download all external images and self-host them">
            {isMigrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            {isMigrating ? 'Migrating…' : 'Self-host Images'}
          </Button>
          <Button asChild variant="outline" size="sm" className="rounded-lg font-sans gap-1">
            <Link to="/admin/promotions">Promotions</Link>
          </Button>
          <Button onClick={() => setAddingCategory(true)} className="rounded-lg font-sans" size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add Category
          </Button>
        </div>
      </div>

      {migrateResult && <div className="mb-4 px-3 py-2 rounded-md bg-muted text-xs font-sans text-muted-foreground">{migrateResult}</div>}

      {/* Find anything, without walking a three-level tree. */}
      <div className="relative mb-4">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the whole menu… (press /)"
          className="pl-9 pr-10 h-11"
          aria-label="Search menu items"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="absolute right-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/*
        The 86 list.
        An item taken off at 19:00 is invisible by 22:00 — "not on the menu"
        looks exactly like "we do not sell that", so it never gets put back
        and the loss never shows up anywhere.
      */}
      {offMenu.length > 0 && !searchHits && (
        <Card className="mb-4 border-accent/40 bg-accent/5">
          <CardContent className="p-3">
            <p className="text-xs font-sans font-semibold text-accent uppercase tracking-wide flex items-center gap-1.5 mb-2">
              <EyeOff className="w-3.5 h-3.5" /> Off the menu right now ({offMenu.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {offMenu.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleAvailability(item)}
                  className="inline-flex items-center gap-1.5 px-2.5 min-h-[36px] rounded-full border border-accent/40 bg-card text-xs font-sans hover:bg-accent/10 transition-colors"
                  title={`Put ${item.name} back on the menu`}
                >
                  {item.name}
                  <span className="text-muted-foreground">· put back</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {searchHits && (
        <Card className="mb-4">
          <CardContent className="p-3">
            <p className="text-xs font-sans text-muted-foreground mb-2" aria-live="polite">
              {searchHits.length} {searchHits.length === 1 ? 'match' : 'matches'} for “{search.trim()}”
            </p>
            <div className="space-y-1">
              {searchHits.map(({ item, path }) => (
                <div key={item.id} className="flex items-center justify-between gap-2 py-2 px-2 rounded-lg hover:bg-muted/30">
                  <div className="min-w-0">
                    <p className={`text-sm font-sans font-medium truncate ${item.is_available ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground truncate flex flex-wrap items-center gap-x-1">
                      <span className="truncate">{path} ·</span>
                      <InlinePrice name={item.name} price={Number(item.price)} onSave={(p) => changePrice(item, p)} />
                    </p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <AvailabilitySwitch item={item} onToggle={toggleAvailability} />
                    <Button variant="ghost" size="icon" className="h-11 w-11" aria-label={`Edit ${item.name}`} onClick={() => setItemDialog({ item })}>
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {searchHits.length === 0 && (
                <p className="text-sm text-muted-foreground font-sans py-3 text-center">Nothing matches that.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}


      {addingCategory && (
        <Card className="mb-4 border-primary/20">
          <CardContent className="p-4">
            <NameEditor initial={{ name: '', name_bs: '', name_ar: '' }} label="Category name" onSave={addCategory} onCancel={() => setAddingCategory(false)} />
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : categories.length === 0 && !addingCategory ? (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <UtensilsCrossed className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
            <p className="font-serif text-lg font-semibold text-foreground">Build your menu</p>
            <p className="text-sm font-sans text-muted-foreground mt-1 mb-4">Start with a category like “Drinks”, then add subcategories and items.</p>
            <Button onClick={() => setAddingCategory(true)}><Plus className="w-4 h-4 mr-1" /> Add your first category</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {categories.map((cat, catIdx) => {
            const categoryOpen = expandedCategory === cat.id;
            const subs = cat.subcategories ?? [];
            return (
              <Card key={cat.id} className="border-border card-lux-hover">
                <div className="flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
                  <button type="button" className="min-w-0 flex flex-1 items-center gap-2 text-left" aria-expanded={categoryOpen} onClick={() => setExpandedCategory(categoryOpen ? null : cat.id)}>
                    {categoryOpen ? <ChevronDown className="w-4 h-4 shrink-0" /> : <ChevronRight className="w-4 h-4 shrink-0" />}
                    <span className="font-serif font-semibold text-foreground truncate">{cat.name}</span>
                    {cat.name_bs && <span className="text-xs text-muted-foreground truncate">({cat.name_bs})</span>}
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{subs.length} {subs.length === 1 ? 'subcategory' : 'subcategories'}</span>
                  </button>
                  {/* Five 32px buttons left a phone 0–9px for the category's
                      name; there they live behind one menu button, as on a dish. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="md:hidden h-11 w-11 shrink-0" aria-label={`More actions for ${cat.name}`}>
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem className="min-h-[44px]" onSelect={() => { setEditing({ kind: 'category', id: cat.id }); setExpandedCategory(cat.id); }}>
                        <Pencil className="w-4 h-4 mr-2" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-[44px]" onSelect={() => { setAddingSubFor(cat.id); setExpandedCategory(cat.id); }}>
                        <Plus className="w-4 h-4 mr-2" /> Add subcategory
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-[44px]" disabled={catIdx === 0} onSelect={() => move('categories', categories, cat.id, 'up')}>
                        <ChevronUp className="w-4 h-4 mr-2" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-[44px]" disabled={catIdx === categories.length - 1} onSelect={() => move('categories', categories, cat.id, 'down')}>
                        <ChevronDown className="w-4 h-4 mr-2" /> Move down
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-[44px] text-destructive focus:text-destructive" onSelect={() => setPendingCategoryDelete(cat)}>
                        <Trash2 className="w-4 h-4 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="hidden md:flex gap-0.5 items-center shrink-0">
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={catIdx === 0} aria-label="Move up" onClick={() => move('categories', categories, cat.id, 'up')}><ChevronUp className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" disabled={catIdx === categories.length - 1} aria-label="Move down" onClick={() => move('categories', categories, cat.id, 'down')}><ChevronDown className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Rename ${cat.name}`} onClick={() => { setEditing({ kind: 'category', id: cat.id }); setExpandedCategory(cat.id); }}><Pencil className="w-4 h-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Add subcategory to ${cat.name}`} onClick={() => { setAddingSubFor(cat.id); setExpandedCategory(cat.id); }}><Plus className="w-4 h-4" /></Button>
                    <ConfirmDelete
                      trigger={<Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Delete category ${cat.name}`}><Trash2 className="w-4 h-4 text-destructive" /></Button>}
                      title={`Delete “${cat.name}”?`}
                      description="This permanently deletes the category and all of its subcategories and items. This cannot be undone."
                      onConfirm={() => remove('categories', cat.id)}
                    />
                  </div>
                </div>

                {categoryOpen && (
                  <div className="px-4 pb-4 space-y-2">
                    {editing?.kind === 'category' && editing.id === cat.id && (
                      <NameEditor initial={{ name: cat.name, name_bs: cat.name_bs ?? '', name_ar: cat.name_ar ?? '' }} label="Category name" onSave={(v) => rename('category', cat.id, v)} onCancel={() => setEditing(null)} />
                    )}
                    {addingSubFor === cat.id && (
                      <NameEditor initial={{ name: '', name_bs: '', name_ar: '' }} label="Subcategory name" onSave={(v) => addSubcategory(cat.id, v)} onCancel={() => setAddingSubFor(null)} />
                    )}

                    {subs.map((sub) => {
                      const subOpen = expandedSubcategory === sub.id;
                      const items = sub.menu_items ?? [];
                      return (
                        <div key={sub.id} className="border border-border rounded-lg">
                          <div className="flex items-center justify-between px-3 py-2 hover:bg-muted/30">
                            <button type="button" className="min-w-0 flex flex-1 items-center gap-2 text-left" aria-expanded={subOpen} onClick={() => setExpandedSubcategory(subOpen ? null : sub.id)}>
                              {subOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />}
                              <span className="text-sm font-sans font-medium text-foreground truncate">{sub.name}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{items.length} items</span>
                            </button>
                            <div className="flex gap-0.5 shrink-0">
                              <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" aria-label={`Rename ${sub.name}`} onClick={() => { setEditing({ kind: 'subcategory', id: sub.id }); setExpandedSubcategory(sub.id); }}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" aria-label={`Add item to ${sub.name}`} onClick={() => { setItemDialog({ subcategoryId: sub.id }); setExpandedSubcategory(sub.id); }}><Plus className="w-3.5 h-3.5" /></Button>
                              <ConfirmDelete
                                trigger={<Button variant="ghost" size="icon" className="h-11 w-11 md:h-7 md:w-7" aria-label={`Delete subcategory ${sub.name}`}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                                title={`Delete “${sub.name}”?`}
                                description="This permanently deletes the subcategory and all of its items."
                                onConfirm={() => remove('subcategories', sub.id)}
                              />
                            </div>
                          </div>

                          {subOpen && (
                            <div className="px-3 pb-3 space-y-2">
                              {editing?.kind === 'subcategory' && editing.id === sub.id && (
                                <NameEditor initial={{ name: sub.name, name_bs: sub.name_bs ?? '', name_ar: sub.name_ar ?? '' }} label="Subcategory name" onSave={(v) => rename('subcategory', sub.id, v)} onCancel={() => setEditing(null)} />
                              )}
                              {items.length === 0 && (
                                <p className="text-xs text-muted-foreground font-sans px-2 py-3 text-center">No items yet. Use + to add one.</p>
                              )}
                              {items.map((item, itemIdx) => (
                                <div key={item.id} className="flex items-center justify-between gap-2 py-2 px-2 rounded-lg hover:bg-muted/30">
                                  <div className="min-w-0 flex items-center gap-3">
                                    {/* The photo guests see: the prepared one while it stands for this upload. */}
                                    {item.image_url
                                      ? <SmartImage src={item.image_url} id={item.id} alt={item.name} width={40} height={40} sizes="40px" square wrapperClassName="w-10 h-10 rounded-lg overflow-hidden shrink-0" />
                                      : <div className="w-10 h-10 rounded-lg bg-muted shrink-0 flex items-center justify-center text-muted-foreground/40 font-serif">{item.name[0]}</div>}
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5 min-w-0">
                                        <p className={`text-sm font-sans font-medium line-clamp-2 break-words ${item.is_available ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{item.name}</p>
                                        {getItemTags(item).length > 0 && (
                                          <span className="shrink-0 text-xs leading-none">{getItemTags(item).slice(0, 4).map((k) => DIET_BY_KEY[k]?.emoji).filter(Boolean).join(' ')}</span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground tabular-nums">
                                        <InlinePrice name={item.name} price={Number(item.price)} onSave={(p) => changePrice(item, p)} />
                                        {/* What a guest sees on it, at a glance. */}
                                        {saleScheduled(item) === 'running' && <span className="font-semibold text-sale">Sale</span>}
                                        {saleScheduled(item) === 'scheduled' && <span className="font-semibold">Sale soon</span>}
                                        {isNew(item) && <span className="font-semibold text-primary">New</span>}
                                        {item.featured_rank != null && <span className="font-semibold text-primary">Featured</span>}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <AvailabilitySwitch item={item} onToggle={toggleAvailability} />
                                    {/* Inline on a wide screen; on a phone the four small
                                        buttons crowded the switch off the row, so they live
                                        behind one menu button instead. */}
                                    <div className="hidden md:flex items-center gap-0.5">
                                      <Button variant="ghost" size="icon" className="h-9 w-9" disabled={itemIdx === 0} aria-label="Move up" onClick={() => move('menu_items', items, item.id, 'up')}><ChevronUp className="w-4 h-4" /></Button>
                                      <Button variant="ghost" size="icon" className="h-9 w-9" disabled={itemIdx === items.length - 1} aria-label="Move down" onClick={() => move('menu_items', items, item.id, 'down')}><ChevronDown className="w-4 h-4" /></Button>
                                      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Edit ${item.name}`} onClick={() => setItemDialog({ item })}><Pencil className="w-4 h-4" /></Button>
                                      <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={`Delete ${item.name}`} onClick={() => setPendingDelete(item)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                                    </div>
                                    <DropdownMenu>
                                      <DropdownMenuTrigger asChild>
                                        <Button variant="ghost" size="icon" className="md:hidden h-11 w-11" aria-label={`More actions for ${item.name}`}>
                                          <MoreVertical className="w-4 h-4" />
                                        </Button>
                                      </DropdownMenuTrigger>
                                      <DropdownMenuContent align="end">
                                        <DropdownMenuItem className="min-h-[44px]" onSelect={() => setItemDialog({ item })}>
                                          <Pencil className="w-4 h-4 mr-2" /> Edit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="min-h-[44px]" disabled={itemIdx === 0} onSelect={() => move('menu_items', items, item.id, 'up')}>
                                          <ChevronUp className="w-4 h-4 mr-2" /> Move up
                                        </DropdownMenuItem>
                                        <DropdownMenuItem className="min-h-[44px]" disabled={itemIdx === items.length - 1} onSelect={() => move('menu_items', items, item.id, 'down')}>
                                          <ChevronDown className="w-4 h-4 mr-2" /> Move down
                                        </DropdownMenuItem>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem className="min-h-[44px] text-destructive focus:text-destructive" onSelect={() => setPendingDelete(item)}>
                                          <Trash2 className="w-4 h-4 mr-2" /> Delete
                                        </DropdownMenuItem>
                                      </DropdownMenuContent>
                                    </DropdownMenu>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {subs.length === 0 && addingSubFor !== cat.id && (
                      <p className="text-xs text-muted-foreground font-sans px-2 py-2">No subcategories yet. Use + to add one (e.g. “Cocktails”).</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <AlertDialog open={confirmRetranslate} onOpenChange={setConfirmRetranslate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-translate the whole menu?</AlertDialogTitle>
            <AlertDialogDescription>
              Every Bosnian and Arabic name and description is replaced with a fresh machine translation —
              including any you corrected by hand. Use Auto-Translate instead to fill in only what is missing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Keep my translations</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void translateMenu(true); }}
            >
              Overwrite all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingCategoryDelete !== null} onOpenChange={(open) => { if (!open) setPendingCategoryDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingCategoryDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the category and all of its subcategories and items. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (pendingCategoryDelete) void remove('categories', pendingCategoryDelete.id); setPendingCategoryDelete(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the item from the menu. If it only needs to come off for tonight, mark it sold out instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (pendingDelete) void remove('menu_items', pendingDelete.id); setPendingDelete(null); }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={undeletable !== null} onOpenChange={(open) => { if (!open) setUndeletable(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>“{undeletable?.name}” can't be deleted</AlertDialogTitle>
            <AlertDialogDescription>
              This dish is on past orders, so it can't be deleted without breaking those records — receipts, the
              daily report and the reconciliation all point at it. Mark it sold out instead: guests stop seeing it,
              and the history stays intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Leave it</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px]"
              onClick={() => { if (undeletable) void markSoldOutInstead(undeletable); }}
            >
              Mark as sold out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <MenuItemDialog
        open={!!itemDialog}
        onOpenChange={(o) => { if (!o) setItemDialog(null); }}
        subcategoryId={itemDialog?.subcategoryId}
        item={itemDialog?.item}
        onSaved={fetchMenu}
      />
    </div>
  );
};

export default AdminMenu;
