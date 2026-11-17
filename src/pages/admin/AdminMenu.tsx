import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import SmartImage from '@/components/ui/SmartImage';
import {
  AlertTriangle, ChevronDown, ChevronRight, ChevronUp, EyeOff, Image as ImageIcon, Languages,
  Loader2, MoreHorizontal, MoreVertical, Pencil, Plus, RefreshCw, RotateCcw, Search, Tag, Trash2, UtensilsCrossed, X,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import MenuItemDialog from '@/components/admin/MenuItemDialog';
import InlinePrice from '@/components/admin/InlinePrice';
import { AdminPageHeader, AdminToolbar } from '@/components/admin/AdminPage';
import { AdminCard, EmptyState } from '@/components/admin/AdminCard';
import { cn } from '@/lib/utils';
import { DIET_BY_KEY, getItemTags } from '@/lib/dietary';
import { Link, useSearchParams } from 'react-router-dom';
import { isNew, saleScheduled } from '@/lib/promotions';
import { shownVenueSlug } from '@/lib/current-venue';
import {
  SHOW_DELETED, binEntries, binReady, deleteMenuEntry, deletedWhen, liveMenu, restoreMenuEntry, whatWent,
  type BinKind, type Binnable,
} from '@/lib/menu-bin';
import type { Database } from '@/integrations/supabase/types';

type CategoryInsert = Database['public']['Tables']['categories']['Insert'];
type SubcategoryInsert = Database['public']['Tables']['subcategories']['Insert'];
type MenuItemRow = import('@/lib/promotions-api').MenuItemRow;
type AdminSubcategory = Database['public']['Tables']['subcategories']['Row'] & Binnable & { menu_items?: MenuItemRow[] | null };
type AdminCategory = Database['public']['Tables']['categories']['Row'] & Binnable & { subcategories?: AdminSubcategory[] | null };

const BIN_KIND = { categories: 'category', subcategories: 'subcategory', menu_items: 'item' } as const satisfies Record<string, BinKind>;
/** How long a toast's Undo stays on screen. */
const UNDO_MS = 10_000;

interface TranslateMenuResponse { message?: string }
interface MigrateImagesResponse { migrated: number; skipped: number; failed: number }

type Names = { name: string; name_bs: string; name_ar: string };

const NAME_LANGS = [
  { key: 'name', tag: 'EN', lang: 'English' },
  { key: 'name_bs', tag: 'BS', lang: 'Bosnian' },
  { key: 'name_ar', tag: 'AR', lang: 'Arabic' },
] as const;

/** Reusable EN/BS/AR name editor — used for adding and renaming. Enter saves. */
const NameEditor = ({ initial, label, onSave, onCancel }: {
  initial: Names; label: string; onSave: (v: Names) => void; onCancel: () => void;
}) => {
  const [v, setV] = useState(initial);
  return (
    <form
      className="space-y-2 rounded-xl border border-primary/25 bg-primary/[0.03] p-3 sm:p-4"
      onSubmit={(e) => { e.preventDefault(); onSave(v); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
    >
      <p className="text-[13px] font-sans font-semibold text-foreground">{label}</p>
      {NAME_LANGS.map((l) => (
        <div key={l.key} className="flex items-center gap-2">
          <span aria-hidden className="grid h-11 w-10 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-sans font-semibold tracking-wide text-muted-foreground md:h-10">{l.tag}</span>
          <Input
            placeholder={`${label} (${l.tag})`}
            aria-label={`${label} in ${l.lang}`}
            value={v[l.key]}
            autoFocus={l.key === 'name'}
            dir={l.key === 'name_ar' ? 'rtl' : undefined}
            onChange={(e) => setV({ ...v, [l.key]: e.target.value })}
            className="h-11 md:h-10"
          />
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button type="submit" className="min-h-[44px] font-sans md:min-h-[38px]">Save</Button>
        <Button type="button" variant="ghost" className="min-h-[44px] font-sans md:min-h-[38px]" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
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
        <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm} className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

const sortByOrder = <T extends { sort_order: number }>(arr?: T[] | null): T[] =>
  [...(arr ?? [])].sort((a, b) => a.sort_order - b.sort_order);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
    className={cn(
      'inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-2 rounded-lg px-1.5 text-xs font-sans font-semibold transition-colors sm:px-2.5',
      item.is_available ? 'text-primary hover:bg-primary/10' : 'text-destructive hover:bg-destructive/10',
    )}
  >
    <span
      aria-hidden
      className={cn('relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors', item.is_available ? 'bg-primary' : 'bg-muted-foreground/30')}
    >
      <span className={cn('absolute top-0.5 h-5 w-5 rounded-full bg-background shadow-sm transition-transform motion-reduce:transition-none', item.is_available ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </span>
    {/* The word only where there is room for it and the dish's name; the
        switch's own label says it either way, and the row says "Sold out". */}
    <span className="hidden w-[54px] text-start sm:inline">{item.is_available ? 'Available' : 'Sold out'}</span>
  </button>
);

/** What a guest sees on a dish, as small quiet pills. */
const DishBadges = ({ item }: { item: MenuItemRow }) => {
  const sale = saleScheduled(item);
  return (
    <>
      {!item.is_available && <span className="rounded-full bg-destructive/10 px-1.5 py-px text-[11px] font-semibold text-destructive sm:hidden">Sold out</span>}
      {sale === 'running' && <span className="rounded-full bg-sale/10 px-1.5 py-px text-[11px] font-semibold text-sale">Sale</span>}
      {sale === 'scheduled' && <span className="rounded-full bg-muted px-1.5 py-px text-[11px] font-semibold text-muted-foreground">Sale soon</span>}
      {isNew(item) && <span className="rounded-full bg-primary/10 px-1.5 py-px text-[11px] font-semibold text-primary">New</span>}
      {item.featured_rank != null && <span className="rounded-full bg-primary/10 px-1.5 py-px text-[11px] font-semibold text-primary">Featured</span>}
    </>
  );
};

/**
 * One dish, the same in the menu tree and in search results: photo, name,
 * price you can tap to change, what guests see on it, the sold-out switch,
 * then the rarer actions (inline on a wide screen, behind one button on a
 * phone, where they crowded the switch off the row).
 */
const DishRow = ({
  item, path, onToggle, onPrice, onEdit, onDelete, onMoveUp, onMoveDown,
}: {
  item: MenuItemRow;
  /** Where it lives, in search results. */
  path?: string;
  onToggle: (item: MenuItemRow) => void;
  onPrice: (item: MenuItemRow, price: number) => Promise<boolean>;
  onEdit: (item: MenuItemRow) => void;
  onDelete: (item: MenuItemRow) => void;
  /** Absent in search results, disabled-at-the-ends as `null`. */
  onMoveUp?: (() => void) | null;
  onMoveDown?: (() => void) | null;
}) => {
  const tags = getItemTags(item).slice(0, 4).map((k) => DIET_BY_KEY[k]?.emoji).filter(Boolean).join(' ');
  const reorder = onMoveUp !== undefined;
  return (
    <li className="flex items-center gap-3 py-2.5 ps-3 pe-1 sm:ps-4 sm:pe-2">
      {/* The photo guests see: the prepared one while it stands for this upload. Tapping it opens the dish. */}
      <button type="button" tabIndex={-1} aria-hidden onClick={() => onEdit(item)} className={cn('shrink-0 rounded-lg', !item.is_available && 'opacity-50 grayscale')}>
        {item.image_url
          ? <SmartImage src={item.image_url} id={item.id} alt="" width={44} height={44} sizes="44px" square wrapperClassName="h-11 w-11 overflow-hidden rounded-lg" />
          : <span className="grid h-11 w-11 place-items-center rounded-lg bg-muted font-serif text-muted-foreground/50">{item.name[0]}</span>}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('flex min-w-0 items-center gap-1.5 text-sm font-sans font-medium leading-snug', item.is_available ? 'text-foreground' : 'text-muted-foreground')}>
          <span className="line-clamp-2 break-words">{item.name}</span>
          {tags && <span className="shrink-0 text-xs leading-none" aria-hidden>{tags}</span>}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
          <InlinePrice name={item.name} price={Number(item.price)} onSave={(p) => onPrice(item, p)} />
          <DishBadges item={item} />
          {path && <span className="min-w-0 truncate">{path}</span>}
        </div>
      </div>
      <AvailabilitySwitch item={item} onToggle={onToggle} />
      <div className="hidden items-center md:flex">
        {reorder && (
          <>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" disabled={!onMoveUp} aria-label="Move up" onClick={() => onMoveUp?.()}><ChevronUp className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" disabled={!onMoveDown} aria-label="Move down" onClick={() => onMoveDown?.()}><ChevronDown className="h-4 w-4" /></Button>
          </>
        )}
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label={`Edit ${item.name}`} onClick={() => onEdit(item)}><Pencil className="h-4 w-4" /></Button>
        <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete ${item.name}`} onClick={() => onDelete(item)}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground md:hidden" aria-label={`More actions for ${item.name}`}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[12rem]">
          <DropdownMenuItem className="min-h-[44px]" onSelect={() => onEdit(item)}>
            <Pencil className="me-2 h-4 w-4" /> Edit
          </DropdownMenuItem>
          {reorder && (
            <>
              <DropdownMenuItem className="min-h-[44px]" disabled={!onMoveUp} onSelect={() => onMoveUp?.()}>
                <ChevronUp className="me-2 h-4 w-4" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem className="min-h-[44px]" disabled={!onMoveDown} onSelect={() => onMoveDown?.()}>
                <ChevronDown className="me-2 h-4 w-4" /> Move down
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="min-h-[44px] text-destructive focus:text-destructive" onSelect={() => onDelete(item)}>
            <Trash2 className="me-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};

/** Quick views of the whole menu, each a question a manager asks. */
type Filter = 'all' | 'soldout' | 'sale' | 'nophoto' | 'untranslated';
const FILTERS: { key: Filter; label: string; test: (i: MenuItemRow) => boolean }[] = [
  { key: 'all', label: 'All', test: () => true },
  { key: 'soldout', label: 'Sold out', test: (i) => !i.is_available },
  { key: 'sale', label: 'On sale', test: (i) => saleScheduled(i) === 'running' || saleScheduled(i) === 'scheduled' },
  { key: 'nophoto', label: 'No photo', test: (i) => !i.image_url },
  { key: 'untranslated', label: 'Missing a translation', test: (i) => !i.name_bs?.trim() || !i.name_ar?.trim() },
];

/** A row of toggle buttons under the search box; 44px on a phone. */
const FilterChip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={cn(
      'inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-sans font-medium transition-colors sm:min-h-[34px] sm:px-3',
      on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground',
    )}
  >
    {children}
  </button>
);

const AdminMenu = () => {
  /** Everything the database sent, the bin included; the page shows `categories`. */
  const [menuRows, setMenuRows] = useState<AdminCategory[]>([]);
  /** The menu as guests see it. */
  const categories = useMemo(() => liveMenu(menuRows), [menuRows]);
  /** The bin, newest first, and whether this database has one yet. */
  const bin = useMemo(() => binEntries(menuRows), [menuRows]);
  const binOn = binReady(menuRows) === true;
  const [binOpen, setBinOpen] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const binRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  /** Which categories and sections are open; several at once, so a manager can compare. */
  const [openCats, setOpenCats] = useState<Set<string>>(() => new Set());
  const [openSubs, setOpenSubs] = useState<Set<string>>(() => new Set());
  const flip = (set: Set<string>, id: string, to?: boolean) => {
    const next = new Set(set);
    if (to ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  };
  const toggleCat = (id: string) => setOpenCats((s) => flip(s, id));
  const openCat = (id: string) => setOpenCats((s) => flip(s, id, true));
  const toggleSub = (id: string) => setOpenSubs((s) => flip(s, id));
  const openSub = (id: string) => setOpenSubs((s) => flip(s, id, true));
  /** A quick view of the whole menu: sold out, on sale, no photo, untranslated. */
  const [filter, setFilter] = useState<Filter>('all');

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
  /** The same, for a section deleted from the phone menu. */
  const [pendingSubDelete, setPendingSubDelete] = useState<AdminSubcategory | null>(null);
  /** An item the database refused to delete because past orders point at it. */
  const [undeletable, setUndeletable] = useState<MenuItemRow | null>(null);

  /** The menu did not load: said as that, never as an empty menu to build again. */
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchMenu = useCallback(async () => {
    const { data, error } = await supabase
      .from('categories')
      .select('*, subcategories(*, menu_items(*))')
      // The bin's rows too; the database shows them to this restaurant's staff only.
      .setHeader(SHOW_DELETED[0], SHOW_DELETED[1])
      .order('sort_order');
    if (error) { setLoadFailed(true); setLoading(false); return; }
    setLoadFailed(false);
    const sorted = (data ?? []).map((cat) => ({
      ...cat,
      subcategories: sortByOrder(cat.subcategories).map((sub) => ({ ...sub, menu_items: sortByOrder(sub.menu_items) })),
    }));
    setMenuRows(sorted);
    setLoading(false);
  }, []);

  useEffect(() => { void fetchMenu(); }, [fetchMenu]);

  // "Edit dish" on a Menu intelligence card lands here as ?dish=<id>: the dish's editor opens, once.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantedDish = searchParams.get('dish');
  useEffect(() => {
    if (!wantedDish || loading) return;
    const item = menuRows.flatMap((c) => c.subcategories ?? []).flatMap((s) => s.menu_items ?? [])
      .find((i) => i.id === wantedDish && !(i as { deleted_at?: string | null }).deleted_at);
    if (item) setItemDialog({ item: item as MenuItemRow });
    else toast.message('That dish is no longer on the menu');
    setSearchParams((prev) => { prev.delete('dish'); return prev; }, { replace: true });
  }, [wantedDish, loading, menuRows, setSearchParams]);

  // ---- Create ----
  const addCategory = async ({ name, name_bs, name_ar }: Names) => {
    if (!name.trim()) return;
    const payload: CategoryInsert = { name: name.trim(), name_bs: name_bs.trim() || null, name_ar: name_ar.trim() || null, sort_order: categories.length };
    const { error } = await supabase.from('categories').insert(payload);
    if (error) { toast.error('Could not add the category'); return; }
    toast.success('Category added'); setAddingCategory(false); await fetchMenu();
  };

  const addSubcategory = async (categoryId: string, { name, name_bs, name_ar }: Names) => {
    if (!name.trim()) return;
    const cat = categories.find((c) => c.id === categoryId);
    const payload: SubcategoryInsert = { category_id: categoryId, name: name.trim(), name_bs: name_bs.trim() || null, name_ar: name_ar.trim() || null, sort_order: cat?.subcategories?.length ?? 0 };
    const { error } = await supabase.from('subcategories').insert(payload);
    if (error) { toast.error('Could not add the section'); return; }
    toast.success('Section added'); setAddingSubFor(null); await fetchMenu();
  };

  // ---- Rename ----
  /** `was`: the names being replaced, which an Undo passes on (its own page state is older). */
  const rename = async (kind: 'category' | 'subcategory', id: string, { name, name_bs, name_ar }: Names, was?: Names) => {
    if (!name.trim()) { toast.error('Name required'); return; }
    const row = kind === 'category'
      ? categories.find((c) => c.id === id)
      : categories.flatMap((c) => c.subcategories ?? []).find((s) => s.id === id);
    const before: Names | null = was ?? (row ? { name: row.name, name_bs: row.name_bs ?? '', name_ar: row.name_ar ?? '' } : null);
    const patch = { name: name.trim(), name_bs: name_bs.trim() || null, name_ar: name_ar.trim() || null };
    const { error } = kind === 'category'
      ? await supabase.from('categories').update(patch).eq('id', id)
      : await supabase.from('subcategories').update(patch).eq('id', id);
    if (error) { toast.error(error.message); return; }
    const now: Names = { name: patch.name, name_bs: patch.name_bs ?? '', name_ar: patch.name_ar ?? '' };
    toast.success(before ? `Renamed “${before.name}” to “${patch.name}”` : 'Renamed', before ? {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => { void rename(kind, id, before, now); } },
    } : undefined);
    setEditing(null); await fetchMenu();
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
    setMenuRows((prev) => prev.map((cat) => ({
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
    // loud — it is the single most common live menu action. A wrong tap is
    // one more tap to put right.
    toast.success(next ? `${item.name} is back on the menu` : `${item.name} is now sold out`, {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => { void toggleAvailability({ ...item, is_available: next }); } },
    });
  };

  /**
   * Put it in the bin: guests stop seeing it at once, past orders keep it,
   * and the toast's Undo (or Restore in "Recently deleted", any time later)
   * puts back exactly what went.
   */
  const moveToBin = async (kind: BinKind, id: string) => {
    const { data, error } = await deleteMenuEntry(kind, id);
    if (error) { toast.error(`Could not delete: ${error.message}`); return; }
    await fetchMenu();
    const label = whatWent({
      kind, name: data?.name ?? 'It',
      sections: data?.subcategories ?? 0, dishes: kind === 'item' ? 0 : data?.items ?? 0,
    });
    toast.success(`Deleted ${label}`, {
      description: 'Guests no longer see it. Undo, or restore it later from “Recently deleted” at the bottom of this page.',
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => { void restoreFromBin(kind, id); } },
    });
  };

  const restoreFromBin = async (kind: BinKind, id: string) => {
    setRestoring(id);
    const { data, error } = await restoreMenuEntry(kind, id);
    setRestoring(null);
    if (error) { toast.error(`Could not restore: ${error.message}`); return; }
    await fetchMenu();
    toast.success(`${data?.name ?? 'It'} is back on the menu`);
  };

  /** Show the bin, from the button at the top of the page. */
  const openBin = () => {
    setBinOpen(true);
    requestAnimationFrame(() => binRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const remove = async (table: 'categories' | 'subcategories' | 'menu_items', id: string) => {
    if (binOn) { await moveToBin(BIN_KIND[table], id); return; }
    // A database without the bin yet (20261105120000): the old, final delete.
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
    toast.success(`${item.name}: ${Number(before).toFixed(2)} → ${price.toFixed(2)} KM`, {
      duration: UNDO_MS,
      action: { label: 'Undo', onClick: () => { void changePrice({ ...item, price }, Number(before)); } },
    });
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

  /**
   * A dish goes straight to the bin, with Undo in the toast: a mistake is one
   * tap to put right, so it no longer needs asking first. Without the bin
   * (an older database) it is final, and asks.
   */
  const deleteItem = (item: MenuItemRow) => {
    if (binOn) void remove('menu_items', item.id);
    else setPendingDelete(item);
  };

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

  /** Every dish with where it lives, for search, the quick filters and the counts. */
  const allDishes = useMemo(() => {
    const out: { item: MenuItemRow; path: string }[] = [];
    for (const cat of categories) {
      for (const sub of cat.subcategories ?? []) {
        for (const item of sub.menu_items ?? []) out.push({ item, path: `${cat.name} › ${sub.name}` });
      }
    }
    return out;
  }, [categories]);
  const filterCounts = useMemo(() => Object.fromEntries(
    FILTERS.map((f) => [f.key, allDishes.filter(({ item }) => f.test(item)).length]),
  ) as Record<Filter, number>, [allDishes]);
  /** What the flat list shows: a search, a quick filter, or both. Null shows the menu tree. */
  const listed = useMemo(() => {
    if (!searchHits && filter === 'all') return null;
    const test = FILTERS.find((f) => f.key === filter)!.test;
    return (searchHits ?? allDishes).filter(({ item }) => test(item));
  }, [searchHits, filter, allDishes]);

  /** Where "Add dish" can put a new one. */
  const sectionChoices = useMemo(() => categories.flatMap((c) =>
    (c.subcategories ?? []).map((s) => ({ id: s.id, label: `${c.name} › ${s.name}` }))), [categories]);

  const dishProps = {
    onToggle: toggleAvailability,
    onPrice: changePrice,
    onEdit: (item: MenuItemRow) => setItemDialog({ item }),
    onDelete: deleteItem,
  };

  const busyTool = isTranslating ? 'Translating…' : isMigrating ? 'Moving images…' : null;

  return (
    <div>
      <AdminPageHeader
        title="Dishes"
        description="Mark a dish sold out or back, change a price, add something new. Guests see every change at once."
        loading={!!busyTool}
        actions={(
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="min-h-[44px] gap-1.5 rounded-lg font-sans md:min-h-[38px]" aria-label="Menu tools">
                  {busyTool ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                  {busyTool ?? 'More'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Menu</DropdownMenuLabel>
                <DropdownMenuItem className="min-h-[44px]" onSelect={() => setAddingCategory(true)}>
                  <Plus className="me-2 h-4 w-4" /> Add category
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-[44px]" asChild>
                  <Link to="/admin/promotions"><Tag className="me-2 h-4 w-4" /> Promotions</Link>
                </DropdownMenuItem>
                {bin.length > 0 && (
                  <DropdownMenuItem className="min-h-[44px]" onSelect={openBin}>
                    <Trash2 className="me-2 h-4 w-4" /> Recently deleted ({bin.length})
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Translations and photos</DropdownMenuLabel>
                <DropdownMenuItem className="min-h-[44px] items-start py-2" disabled={isTranslating} onSelect={() => { void translateMenu(false); }}>
                  <Languages className="me-2 mt-0.5 h-4 w-4 shrink-0" />
                  <span><span className="block">Auto-translate</span><span className="block text-xs text-muted-foreground">Fills in only what is missing</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-[44px] items-start py-2" disabled={isTranslating} onSelect={() => setConfirmRetranslate(true)}>
                  <RefreshCw className="me-2 mt-0.5 h-4 w-4 shrink-0" />
                  <span><span className="block">Re-translate everything…</span><span className="block text-xs text-muted-foreground">Replaces hand-made translations</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem className="min-h-[44px] items-start py-2" disabled={isMigrating} onSelect={() => { void migrateImages(); }}>
                  <ImageIcon className="me-2 mt-0.5 h-4 w-4 shrink-0" />
                  <span><span className="block">Self-host images</span><span className="block text-xs text-muted-foreground">Copies linked photos to our own storage</span></span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {sectionChoices.length > 0 ? (
              <Button className="min-h-[44px] gap-1.5 rounded-lg font-sans md:min-h-[38px]" onClick={() => setItemDialog({})}>
                <Plus className="h-4 w-4" /> Add dish
              </Button>
            ) : !loading && !loadFailed && (
              <Button className="min-h-[44px] gap-1.5 rounded-lg font-sans md:min-h-[38px]" onClick={() => setAddingCategory(true)}>
                <Plus className="h-4 w-4" /> Add category
              </Button>
            )}
          </>
        )}
      />

      {migrateResult && (
        <p className="mb-4 flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-xs font-sans text-muted-foreground">
          <ImageIcon className="h-3.5 w-3.5 shrink-0" /> Images: {migrateResult}
        </p>
      )}

      {/* Find anything, without walking a three-level tree. */}
      {!loading && !loadFailed && allDishes.length > 0 && (
        <div className="mb-5 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); }}
              placeholder="Search dishes, in any language"
              className="h-12 rounded-xl bg-card ps-10 pe-12 shadow-lux md:h-11"
              aria-label="Search menu items"
              enterKeyHint="search"
            />
            {search ? (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear search"
                className="absolute end-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground md:h-9 md:w-9"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute end-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 font-sans text-[11px] text-muted-foreground md:block">/</kbd>
            )}
          </div>
          <AdminToolbar role="group" aria-label="Show">
            {FILTERS.filter((f) => f.key === 'all' || filterCounts[f.key] > 0 || filter === f.key).map((f) => (
              <FilterChip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
                {f.label}
                <span className={cn('tabular-nums', filter === f.key ? 'text-background/70' : 'text-muted-foreground/70')}>{filterCounts[f.key]}</span>
              </FilterChip>
            ))}
          </AdminToolbar>
        </div>
      )}

      {/*
        The 86 list.
        An item taken off at 19:00 is invisible by 22:00 — "not on the menu"
        looks exactly like "we do not sell that", so it never gets put back
        and the loss never shows up anywhere.
      */}
      {offMenu.length > 0 && !listed && (
        <AdminCard className="mb-5 p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive" aria-hidden>
              <EyeOff className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-serif text-base font-semibold text-foreground">
                {offMenu.length === 1 ? '1 dish is sold out right now' : `${offMenu.length} dishes are sold out right now`}
              </p>
              <p className="mt-0.5 text-[13px] font-sans text-muted-foreground">Guests cannot order these. Tap one when it is back in stock.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {offMenu.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => toggleAvailability(item)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-border bg-card ps-3.5 pe-2 text-[13px] font-sans font-medium text-foreground shadow-sm transition-colors hover:border-primary/40 hover:bg-primary/5 sm:min-h-[38px]"
                    title={`Put ${item.name} back on the menu`}
                  >
                    {item.name}
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Back on</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </AdminCard>
      )}

      {listed && (
        <AdminCard className="mb-5 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3 sm:px-5">
            <p className="text-[13px] font-sans text-muted-foreground" aria-live="polite">
              <span className="font-semibold text-foreground tabular-nums">{listed.length}</span>
              {' of '}<span className="tabular-nums">{allDishes.length}</span>{' dishes'}
              {searchHits && <> matching “{search.trim()}”</>}
              {filter !== 'all' && <> · {FILTERS.find((f) => f.key === filter)!.label.toLowerCase()}</>}
            </p>
            <Button variant="ghost" size="sm" className="min-h-[44px] text-muted-foreground md:min-h-[32px]" onClick={() => { setSearch(''); setFilter('all'); }}>
              Show the whole menu
            </Button>
          </div>
          {listed.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {listed.map(({ item, path }) => <DishRow key={item.id} item={item} path={path} {...dishProps} />)}
            </ul>
          ) : (
            <EmptyState icon={Search} title="Nothing matches that" hint="Try another word, or a name in Bosnian or Arabic." />
          )}
        </AdminCard>
      )}

      {addingCategory && (
        <div className="mb-4">
          <NameEditor initial={{ name: '', name_bs: '', name_ar: '' }} label="Category name" onSave={addCategory} onCancel={() => setAddingCategory(false)} />
        </div>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the menu">
          <Skeleton className="h-12 w-full rounded-xl" />
          {[1, 2, 3, 4, 5].map((i) => (
            <AdminCard key={i} className="flex items-center gap-3 px-5 py-4">
              <Skeleton className="h-4 w-4 rounded" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-28" />
              </div>
            </AdminCard>
          ))}
        </div>
      ) : loadFailed ? (
        <AdminCard role="alert" className="border-destructive/30">
          <EmptyState icon={AlertTriangle} tone="destructive" title="The menu could not be loaded" hint="Nothing is lost. Check the internet connection and try again." className="pb-4" />
          <div className="flex justify-center pb-8">
            <Button variant="outline" className="min-h-[44px]" onClick={() => { setLoading(true); void fetchMenu(); }}>Try again</Button>
          </div>
        </AdminCard>
      ) : categories.length === 0 && !addingCategory ? (
        <AdminCard className="border-dashed">
          <EmptyState icon={UtensilsCrossed} tone="primary" title="Build your menu" hint="Start with a category like “Drinks”, then add sections and dishes." className="pb-4" />
          <div className="flex justify-center pb-10">
            <Button className="min-h-[44px]" onClick={() => setAddingCategory(true)}><Plus className="me-1 h-4 w-4" /> Add your first category</Button>
          </div>
        </AdminCard>
      ) : !listed && (
        <div className="space-y-3">
          {categories.map((cat, catIdx) => {
            const categoryOpen = openCats.has(cat.id);
            const subs = cat.subcategories ?? [];
            const dishes = subs.flatMap((s) => s.menu_items ?? []);
            const soldOut = dishes.filter((d) => !d.is_available).length;
            return (
              <AdminCard key={cat.id} className="overflow-hidden">
                <div className="flex items-center gap-1 pe-1.5 sm:pe-3">
                  <button
                    type="button"
                    className="flex min-h-[64px] min-w-0 flex-1 items-center gap-3 ps-4 text-start sm:ps-5"
                    aria-expanded={categoryOpen}
                    onClick={() => toggleCat(cat.id)}
                  >
                    <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', categoryOpen && 'rotate-90')} />
                    <span className="min-w-0">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate font-serif text-lg font-semibold text-foreground">{cat.name}</span>
                        {cat.name_bs && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{cat.name_bs}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs font-sans text-muted-foreground tabular-nums">
                        {plural(subs.length, 'section', 'sections')} · {plural(dishes.length, 'dish', 'dishes')}
                        {soldOut > 0 && <span className="text-destructive"> · {soldOut} sold out</span>}
                      </span>
                    </span>
                  </button>
                  {/* Five buttons left a phone 0–9px for the category's name;
                      there they live behind one menu button, as on a dish. */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground md:hidden" aria-label={`More actions for ${cat.name}`}>
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[12rem]">
                      <DropdownMenuItem className="min-h-[44px]" onSelect={() => { setAddingSubFor(cat.id); openCat(cat.id); }}>
                        <Plus className="me-2 h-4 w-4" /> Add section
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-[44px]" onSelect={() => { setEditing({ kind: 'category', id: cat.id }); openCat(cat.id); }}>
                        <Pencil className="me-2 h-4 w-4" /> Rename
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-[44px]" disabled={catIdx === 0} onSelect={() => move('categories', categories, cat.id, 'up')}>
                        <ChevronUp className="me-2 h-4 w-4" /> Move up
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-[44px]" disabled={catIdx === categories.length - 1} onSelect={() => move('categories', categories, cat.id, 'down')}>
                        <ChevronDown className="me-2 h-4 w-4" /> Move down
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="min-h-[44px] text-destructive focus:text-destructive" onSelect={() => setPendingCategoryDelete(cat)}>
                        <Trash2 className="me-2 h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="hidden shrink-0 items-center gap-0.5 md:flex">
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" disabled={catIdx === 0} aria-label="Move up" onClick={() => move('categories', categories, cat.id, 'up')}><ChevronUp className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground" disabled={catIdx === categories.length - 1} aria-label="Move down" onClick={() => move('categories', categories, cat.id, 'down')}><ChevronDown className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label={`Rename ${cat.name}`} onClick={() => { setEditing({ kind: 'category', id: cat.id }); openCat(cat.id); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label={`Add section to ${cat.name}`} onClick={() => { setAddingSubFor(cat.id); openCat(cat.id); }}><Plus className="h-4 w-4" /></Button>
                    <ConfirmDelete
                      trigger={<Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete category ${cat.name}`}><Trash2 className="h-4 w-4" /></Button>}
                      title={`Delete “${cat.name}”?`}
                      description={binOn
                        ? 'Guests stop seeing it, with all of its sections and dishes. You can undo this, or restore it later from “Recently deleted”.'
                        : 'This permanently deletes the category and all of its sections and dishes. This cannot be undone.'}
                      onConfirm={() => remove('categories', cat.id)}
                    />
                  </div>
                </div>

                {categoryOpen && (
                  <div className="space-y-2.5 border-t border-border/70 bg-muted/20 p-2.5 sm:p-4">
                    {editing?.kind === 'category' && editing.id === cat.id && (
                      <NameEditor initial={{ name: cat.name, name_bs: cat.name_bs ?? '', name_ar: cat.name_ar ?? '' }} label="Category name" onSave={(v) => rename('category', cat.id, v)} onCancel={() => setEditing(null)} />
                    )}
                    {addingSubFor === cat.id && (
                      <NameEditor initial={{ name: '', name_bs: '', name_ar: '' }} label="Section name" onSave={(v) => addSubcategory(cat.id, v)} onCancel={() => setAddingSubFor(null)} />
                    )}

                    {subs.map((sub) => {
                      const subOpen = openSubs.has(sub.id);
                      const items = sub.menu_items ?? [];
                      const subSoldOut = items.filter((d) => !d.is_available).length;
                      return (
                        <div key={sub.id} className="overflow-hidden rounded-xl border border-border/80 bg-card">
                          <div className="flex items-center gap-0.5 pe-1">
                            <button
                              type="button"
                              className="flex min-h-[52px] min-w-0 flex-1 items-center gap-2.5 ps-3 text-start sm:ps-4"
                              aria-expanded={subOpen}
                              onClick={() => toggleSub(sub.id)}
                            >
                              <ChevronRight className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', subOpen && 'rotate-90')} />
                              <span className="truncate text-sm font-sans font-semibold text-foreground">{sub.name}</span>
                              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                                {plural(items.length, 'dish', 'dishes')}
                                {subSoldOut > 0 && <span className="text-destructive"> · {subSoldOut} sold out</span>}
                              </span>
                            </button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 text-muted-foreground md:hidden" aria-label={`Section actions for ${sub.name}`}>
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="min-w-[12rem]">
                                <DropdownMenuItem className="min-h-[44px]" onSelect={() => { setItemDialog({ subcategoryId: sub.id }); openSub(sub.id); }}>
                                  <Plus className="me-2 h-4 w-4" /> Add a dish here
                                </DropdownMenuItem>
                                <DropdownMenuItem className="min-h-[44px]" onSelect={() => { setEditing({ kind: 'subcategory', id: sub.id }); openSub(sub.id); }}>
                                  <Pencil className="me-2 h-4 w-4" /> Rename
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="min-h-[44px] text-destructive focus:text-destructive" onSelect={() => setPendingSubDelete(sub)}>
                                  <Trash2 className="me-2 h-4 w-4" /> Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <div className="hidden shrink-0 items-center gap-0.5 md:flex">
                              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label={`Rename ${sub.name}`} onClick={() => { setEditing({ kind: 'subcategory', id: sub.id }); openSub(sub.id); }}><Pencil className="h-3.5 w-3.5" /></Button>
                              <Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:text-foreground" aria-label={`Add a dish to ${sub.name}`} onClick={() => { setItemDialog({ subcategoryId: sub.id }); openSub(sub.id); }}><Plus className="h-3.5 w-3.5" /></Button>
                              <ConfirmDelete
                                trigger={<Button variant="ghost" size="icon" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" aria-label={`Delete section ${sub.name}`}><Trash2 className="h-3.5 w-3.5" /></Button>}
                                title={`Delete “${sub.name}”?`}
                                description={binOn
                                  ? 'Guests stop seeing it and its dishes. You can undo this, or restore it later from “Recently deleted”.'
                                  : 'This permanently deletes the section and all of its dishes.'}
                                onConfirm={() => remove('subcategories', sub.id)}
                              />
                            </div>
                          </div>

                          {subOpen && (
                            <div className="border-t border-border/60">
                              {editing?.kind === 'subcategory' && editing.id === sub.id && (
                                <div className="p-3">
                                  <NameEditor initial={{ name: sub.name, name_bs: sub.name_bs ?? '', name_ar: sub.name_ar ?? '' }} label="Section name" onSave={(v) => rename('subcategory', sub.id, v)} onCancel={() => setEditing(null)} />
                                </div>
                              )}
                              {items.length > 0 && (
                                <ul className="divide-y divide-border/60">
                                  {items.map((item, itemIdx) => (
                                    <DishRow
                                      key={item.id}
                                      item={item}
                                      {...dishProps}
                                      onMoveUp={itemIdx > 0 ? () => move('menu_items', items, item.id, 'up') : null}
                                      onMoveDown={itemIdx < items.length - 1 ? () => move('menu_items', items, item.id, 'down') : null}
                                    />
                                  ))}
                                </ul>
                              )}
                              <div className="border-t border-border/60 p-1.5">
                                <button
                                  type="button"
                                  onClick={() => setItemDialog({ subcategoryId: sub.id })}
                                  className="flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-lg text-[13px] font-sans font-medium text-primary hover:bg-primary/5"
                                >
                                  <Plus className="h-4 w-4" /> {items.length === 0 ? `Add the first dish to ${sub.name}` : `Add a dish to ${sub.name}`}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {subs.length === 0 && addingSubFor !== cat.id && (
                      <div className="flex flex-col items-center gap-2 px-2 py-6 text-center">
                        <p className="text-[13px] font-sans text-muted-foreground">No sections yet. A section groups dishes, like “Cocktails”.</p>
                        <Button variant="outline" className="min-h-[44px] gap-1.5 md:min-h-[36px]" onClick={() => setAddingSubFor(cat.id)}>
                          <Plus className="h-4 w-4" /> Add section
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </AdminCard>
            );
          })}
        </div>
      )}

      {/*
        The bin. Everything deleted stays here, newest first: a dish deleted by
        mistake last week is one tap away, with its photo, prices, translations
        and pairings. Guests never see it.
      */}
      {binOn && bin.length > 0 && (
        <AdminCard ref={binRef} className="mt-8 scroll-mt-4 overflow-hidden">
          <button
            type="button"
            className="flex min-h-[56px] w-full items-center gap-3 px-4 text-start sm:px-5"
            aria-expanded={binOpen}
            onClick={() => setBinOpen(!binOpen)}
          >
            <ChevronRight className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', binOpen && 'rotate-90')} />
            <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="font-serif text-base font-semibold text-foreground">Recently deleted</span>
            {' '}<span className="text-xs text-muted-foreground tabular-nums">({bin.length})</span>
          </button>
          {binOpen && (
            <div className="border-t border-border/70">
              <p className="px-4 pt-3 text-xs font-sans text-muted-foreground sm:px-5">
                Guests don't see these. Restore puts one back where it was, as it was.
              </p>
              <ul className="divide-y divide-border/60">
                {bin.map((entry) => (
                  <li key={`${entry.kind}:${entry.id}`} className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
                    <div className="min-w-0">
                      <p className="break-words text-sm font-sans font-medium text-foreground">{whatWent(entry)}</p>
                      <p className="text-xs text-muted-foreground">
                        {entry.kind === 'category' ? 'Category' : entry.kind === 'subcategory' ? `Section in ${entry.where}` : entry.where}
                        {' · deleted '}{deletedWhen(entry.deletedAt)}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px] shrink-0 gap-1.5 md:min-h-[36px]"
                      disabled={restoring !== null}
                      aria-label={`Restore ${entry.name}`}
                      onClick={() => { void restoreFromBin(entry.kind, entry.id); }}
                    >
                      {restoring === entry.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </AdminCard>
      )}

      <AlertDialog open={confirmRetranslate} onOpenChange={setConfirmRetranslate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-translate the whole menu?</AlertDialogTitle>
            <AlertDialogDescription>
              Every Bosnian and Arabic name and description is replaced with a fresh machine translation —
              including any you corrected by hand. Use Auto-translate instead to fill in only what is missing.
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
              {binOn
                ? 'Guests stop seeing it, with all of its sections and dishes. You can undo this, or restore it later from “Recently deleted”.'
                : 'This permanently deletes the category and all of its sections and dishes. This cannot be undone.'}
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

      <AlertDialog open={pendingSubDelete !== null} onOpenChange={(open) => { if (!open) setPendingSubDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{pendingSubDelete?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              {binOn
                ? 'Guests stop seeing it and its dishes. You can undo this, or restore it later from “Recently deleted”.'
                : 'This permanently deletes the section and all of its dishes.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-[44px]">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="min-h-[44px] bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (pendingSubDelete) void remove('subcategories', pendingSubDelete.id); setPendingSubDelete(null); }}
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
        sectionChoices={sectionChoices}
        onSaved={fetchMenu}
      />
    </div>
  );
};

export default AdminMenu;
