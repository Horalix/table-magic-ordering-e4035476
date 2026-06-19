import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ChevronDown, ChevronRight, ChevronUp, Image as ImageIcon, Languages,
  Loader2, Pencil, Plus, RefreshCw, Trash2, UtensilsCrossed,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import MenuItemDialog from '@/components/admin/MenuItemDialog';
import type { Database } from '@/integrations/supabase/types';

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];
type SubcategoryInsert = Database['public']['Tables']['subcategories']['Insert'];
type MenuItemRow = Database['public']['Tables']['menu_items']['Row'];
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

const AdminMenu = () => {
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedSubcategory, setExpandedSubcategory] = useState<string | null>(null);

  const [addingCategory, setAddingCategory] = useState(false);
  const [addingSubFor, setAddingSubFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ kind: 'category' | 'subcategory'; id: string } | null>(null);

  const [itemDialog, setItemDialog] = useState<{ subcategoryId?: string; item?: MenuItemRow } | null>(null);

  const [isTranslating, setIsTranslating] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

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
    await Promise.all(arr.map((x, i) =>
      table === 'categories'
        ? supabase.from('categories').update({ sort_order: i }).eq('id', x.id)
        : supabase.from('menu_items').update({ sort_order: i }).eq('id', x.id),
    ));
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
  const toggleAvailability = async (item: MenuItemRow) => {
    const { error } = await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id);
    if (error) { toast.error('Failed to update item'); return; }
    await fetchMenu();
  };
  const remove = async (table: 'categories' | 'subcategories' | 'menu_items', id: string) => {
    const { error } = table === 'categories'
      ? await supabase.from('categories').delete().eq('id', id)
      : table === 'subcategories'
        ? await supabase.from('subcategories').delete().eq('id', id)
        : await supabase.from('menu_items').delete().eq('id', id);
    if (error) { toast.error('Failed to delete'); return; }
    toast.success('Deleted'); await fetchMenu();
  };

  // ---- Tools ----
  const translateMenu = async (force = false) => {
    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke<TranslateMenuResponse>('translate-menu', { body: { force } });
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
      const { data, error } = await supabase.functions.invoke<MigrateImagesResponse>('migrate-images');
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
          <Button onClick={() => translateMenu(true)} disabled={isTranslating} variant="outline" size="sm" className="rounded-lg font-sans gap-1">
            <RefreshCw className="w-4 h-4" /> Re-translate All
          </Button>
          <Button onClick={migrateImages} disabled={isMigrating} variant="outline" size="sm" className="rounded-lg font-sans gap-1" title="Download all external images and self-host them">
            {isMigrating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            {isMigrating ? 'Migrating…' : 'Self-host Images'}
          </Button>
          <Button onClick={() => setAddingCategory(true)} className="rounded-lg font-sans" size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add Category
          </Button>
        </div>
      </div>

      {migrateResult && <div className="mb-4 px-3 py-2 rounded-md bg-muted text-xs font-sans text-muted-foreground">{migrateResult}</div>}

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
                    <span className="text-xs text-muted-foreground ml-2 shrink-0">{subs.length} subcategories</span>
                  </button>
                  <div className="flex gap-0.5 items-center shrink-0">
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
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Rename ${sub.name}`} onClick={() => { setEditing({ kind: 'subcategory', id: sub.id }); setExpandedSubcategory(sub.id); }}><Pencil className="w-3.5 h-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Add item to ${sub.name}`} onClick={() => { setItemDialog({ subcategoryId: sub.id }); setExpandedSubcategory(sub.id); }}><Plus className="w-3.5 h-3.5" /></Button>
                              <ConfirmDelete
                                trigger={<Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete subcategory ${sub.name}`}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
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
                                <div key={item.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/30">
                                  <div className="min-w-0 flex items-center gap-3">
                                    {item.image_url
                                      ? <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-lg object-cover shrink-0" />
                                      : <div className="w-10 h-10 rounded-lg bg-muted shrink-0 flex items-center justify-center text-muted-foreground/40 font-serif">{item.name[0]}</div>}
                                    <div className="min-w-0">
                                      <p className={`text-sm font-sans font-medium truncate ${item.is_available ? 'text-foreground' : 'text-muted-foreground line-through'}`}>{item.name}</p>
                                      <p className="text-xs text-muted-foreground tabular-nums">{Number(item.price).toFixed(2)} KM</p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-0.5 shrink-0">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={itemIdx === 0} aria-label="Move up" onClick={() => move('menu_items', items, item.id, 'up')}><ChevronUp className="w-3.5 h-3.5" /></Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled={itemIdx === items.length - 1} aria-label="Move down" onClick={() => move('menu_items', items, item.id, 'down')}><ChevronDown className="w-3.5 h-3.5" /></Button>
                                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" aria-label={`${item.is_available ? 'Hide' : 'Show'} ${item.name}`} onClick={() => toggleAvailability(item)}>
                                      {item.is_available ? 'On' : 'Off'}
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Edit ${item.name}`} onClick={() => setItemDialog({ item })}><Pencil className="w-3.5 h-3.5" /></Button>
                                    <ConfirmDelete
                                      trigger={<Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Delete ${item.name}`}><Trash2 className="w-3.5 h-3.5 text-destructive" /></Button>}
                                      title={`Delete “${item.name}”?`}
                                      description="This permanently removes the item from the menu."
                                      onConfirm={() => remove('menu_items', item.id)}
                                    />
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
