import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import SmartImage from '@/components/ui/SmartImage';
import { ChefHat, CupSoda, Loader2, Upload, X } from 'lucide-react';
import ComboBuilder from '@/components/admin/ComboBuilder';
import { fetchCombos, type MenuItemRow } from '@/lib/promotions-api';
import { SALE_LABELS, SALE_LABEL_NAMES } from '@/lib/promotions';
import {
  defaultNewUntil, emptySale, saleColumns, saleDraftFromRow, saleEndPresets, salePreview, slotsFromCombo,
  slotsPayload, slotsProblem, type BuilderSlot, type SaleDraft,
} from '@/lib/admin-promotions';
import { toast } from 'sonner';
import { DIET_TAGS, getItemTags } from '@/lib/dietary';
import { useT } from '@/lib/i18n';
import type { Database } from '@/integrations/supabase/types';

type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when adding a new item. */
  subcategoryId?: string | null;
  /** Provided when editing an existing item. */
  item?: MenuItemRow | null;
  onSaved: () => void;
  /** Open with the Combo section switched on (Promotions → New combo). */
  startAsCombo?: boolean;
  /** Scroll to a section when the dialog opens. */
  focus?: 'sale' | 'combo' | 'highlight';
}

/**
 * One switchable section of the editor: Sale, Combo, New, Featured.
 * Off, it is one line; on, it opens what it needs and nothing else.
 */
const PromoSection = ({
  id, title, description, checked, onCheckedChange, disabled, children,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  disabled?: boolean;
  children?: React.ReactNode;
}) => (
  <section id={`item-${id}`} aria-labelledby={`item-${id}-title`} className={`rounded-xl border p-3 ${checked ? 'border-primary/40 bg-primary/[0.03]' : 'border-border'}`}>
    <div className="flex items-start gap-3">
      <div className="flex-1 min-w-0">
        <Label id={`item-${id}-title`} htmlFor={`item-${id}-switch`} className="text-sm font-sans font-semibold text-foreground">{title}</Label>
        <p className="text-[11px] text-muted-foreground font-sans">{description}</p>
      </div>
      <Switch id={`item-${id}-switch`} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
    {checked && children && <div className="mt-3 space-y-3">{children}</div>}
  </section>
);

/**
 * Allergens, kept separate from dietary tags.
 *
 * The old form labelled one chip group "Dietary / allergen tags" and wrote it
 * to `dietary_tags` only. Those are not the same thing and must not share a
 * field: "vegetarian" is a preference a guest filters by, "contains nuts" is
 * information that has to reach the kitchen ticket. Conflating them means an
 * allergen can be removed by someone tidying up the filters.
 */
const ALLERGENS = [
  'gluten', 'dairy', 'eggs', 'fish', 'shellfish', 'nuts', 'peanuts',
  'soy', 'sesame', 'celery', 'mustard', 'sulphites',
];

/**
 * Badges the guest sees on a card. Deliberately a short, fixed list.
 *
 * Free text here would become fake urgency within a week ("Only 2 left!"), and
 * that is exactly what the brief rules out.
 */
/**
 * What kind of thing a dish is.
 *
 * Separate from `station`, which says where it is MADE. A tiramisu and a steak
 * are both "kitchen"; an espresso and a beer are both "bar". Coursing rules —
 * "suggest a dessert once the mains are down", "a second coffee is fine but a
 * second steak is not" — need this axis, and cannot be expressed without it.
 */
const MEAL_ROLES: { key: string; label: string }[] = [
  { key: 'starter', label: 'Starter' },
  { key: 'main', label: 'Main' },
  { key: 'side', label: 'Side' },
  { key: 'dessert', label: 'Dessert' },
  { key: 'hot_drink', label: 'Hot drink' },
  { key: 'cold_drink', label: 'Cold drink' },
];

// "New" is not here: it has its own switch below, with an end date.
const MERCH_TAGS: { key: string; label: string }[] = [
  { key: 'signature', label: 'Signature' },
  { key: 'chef_pick', label: "Chef's pick" },
  { key: 'popular', label: 'Popular' },
  { key: 'seasonal', label: 'Seasonal' },
  { key: 'house_favourite', label: 'House favourite' },
];

/** Longest edge of a stored menu photo. A guest card never shows more. */
const MAX_IMAGE_EDGE = 1200;
/** A raw phone photo larger than this is almost certainly the wrong file. */
const MAX_RAW_BYTES = 20 * 1024 * 1024;

const canvasToBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/**
 * Shrink a photo before it leaves the device.
 *
 * Managers upload straight from a phone camera: 4000px, 5–8 MB. Every guest
 * then downloaded that original for an 80px thumbnail on a restaurant's wifi,
 * and the menu grid took seconds to fill. 1200px WebP is a few hundred KB and
 * still sharp on the largest card.
 *
 * WebP where the browser can encode it (Safari only recently could); JPEG
 * otherwise. A browser that silently falls back to PNG for an unsupported type
 * is detected by checking what actually came back. If decoding fails entirely
 * the original is uploaded rather than blocking the save.
 */
async function shrinkImage(file: File): Promise<{ blob: Blob; ext: string; type: string }> {
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') {
    // Animated or vector: re-encoding would destroy what makes them that.
    return { blob: file, ext: (file.name.split('.').pop() || 'img').toLowerCase(), type: file.type };
  }
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No 2D canvas');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const webp = await canvasToBlob(canvas, 'image/webp', 0.82);
    if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp', type: 'image/webp' };
    const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.85);
    if (jpeg) return { blob: jpeg, ext: 'jpg', type: 'image/jpeg' };
  } catch {
    // Fall through to the original; an unshrunk photo beats no photo.
  }
  return { blob: file, ext: (file.name.split('.').pop() || 'jpg').toLowerCase(), type: file.type };
}

/** Upload an image to the menu-images bucket and return its public URL. */
async function uploadMenuImage(file: File): Promise<string> {
  const { blob, ext, type } = await shrinkImage(file);
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from('menu-images')
    .upload(path, blob, { upsert: true, cacheControl: '31536000', contentType: type });
  if (error) throw error;
  const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
  return data.publicUrl;
}

/**
 * A price as a manager types it.
 *
 * Bosnian keyboards and habits write "4,50". The old `type="number"` field
 * silently rejected the comma (the value came back empty), and the form then
 * refused to save with "enter a valid price" over a price that looked valid.
 */
function parsePrice(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s|KM/gi, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Remove an image this dialog previously uploaded.
 *
 * Only for files in our own bucket, and best-effort: a failed delete must
 * never block a save. Without this the bucket grows an orphan every time
 * anyone changes a photo.
 */
async function deleteMenuImage(url: string | null | undefined) {
  if (!url) return;
  const marker = '/menu-images/';
  const at = url.indexOf(marker);
  if (at === -1) return;
  const path = url.slice(at + marker.length).split('?')[0];
  if (!path) return;
  await supabase.storage.from('menu-images').remove([path]).catch(() => undefined);
}

/** `time` columns come back as HH:MM:SS; the input wants HH:MM. */
const toTimeInput = (value: string | null | undefined) => (value ? value.slice(0, 5) : '');
const fromTimeInput = (value: string) => (value.trim() ? `${value}:00` : null);

const toggle = (list: string[], key: string) =>
  (list.includes(key) ? list.filter((k) => k !== key) : [...list, key]);

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={on}
    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs font-sans font-medium border transition-colors ${
      on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground'
    }`}
  >
    {children}
  </button>
);

/**
 * Add or edit a single menu item — the core CMS form.
 *
 * This form is also where the recommendation engine gets its fuel. `margin_score`
 * and `prep_minutes` had no editor anywhere, so margin was 0 for every item and
 * the profitability tiebreak in the engine was inert: it had been shipped and
 * had never once been able to fire.
 */
const MenuItemDialog = ({ open, onOpenChange, subcategoryId, item, onSaved, startAsCombo = false, focus }: Props) => {
  const isEdit = !!item;
  const [name, setName] = useState('');
  const [nameBs, setNameBs] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [desc, setDesc] = useState('');
  const [descBs, setDescBs] = useState('');
  const [descAr, setDescAr] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [diets, setDiets] = useState<string[]>([]);
  const [allergens, setAllergens] = useState<string[]>([]);
  const [merch, setMerch] = useState<string[]>([]);
  const [margin, setMargin] = useState('0');
  const [prep, setPrep] = useState('');
  const [portion, setPortion] = useState('');
  const [station, setStation] = useState<'kitchen' | 'bar'>('kitchen');
  const [mealRole, setMealRole] = useState<string>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  // ---- Promotions ----
  const [sale, setSale] = useState<SaleDraft>(emptySale);
  const [newOn, setNewOn] = useState(false);
  const [newUntil, setNewUntil] = useState('');
  const [featuredOn, setFeaturedOn] = useState(false);
  const [featuredNote, setFeaturedNote] = useState('');
  const [featuredNoteBs, setFeaturedNoteBs] = useState('');
  const [featuredNoteAr, setFeaturedNoteAr] = useState('');
  const [comboOn, setComboOn] = useState(false);
  const [wasCombo, setWasCombo] = useState(false);
  const [slots, setSlots] = useState<BuilderSlot[]>([]);
  /** Every dish, for picking a combo's choices. Loaded when the Combo section is first opened. */
  const [pickable, setPickable] = useState<{ id: string; name: string; price: number; subcategory_id: string; is_available: boolean }[]>([]);
  const [sections, setSections] = useState<{ id: string; name: string }[]>([]);
  const [comboIds, setComboIds] = useState<Set<string>>(new Set());
  /** Other dishes holding the three home-screen slots. */
  const [featuredOthers, setFeaturedOthers] = useState<{ id: string; name: string; featured_rank: number }[]>([]);
  /**
   * Whether the database has the promotion columns (20261026100000). Until it
   * does, the editor saves exactly what it saved before, so a frontend that
   * ships ahead of its migration cannot break saving a dish.
   */
  const [promoAvailable, setPromoAvailable] = useState(false);
  /** The image this dialog opened with, so a replaced one can be cleaned up. */
  const originalImage = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const t = useT();

  // Reset form whenever the dialog opens for a different item / add.
  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setNameBs(item?.name_bs ?? '');
    setNameAr(item?.name_ar ?? '');
    setDesc(item?.description ?? '');
    setDescBs(item?.description_bs ?? '');
    setDescAr(item?.description_ar ?? '');
    setPrice(item ? String(item.price) : '');
    setImageUrl(item?.image_url ?? '');
    originalImage.current = item?.image_url ?? null;
    setDiets(getItemTags(item));
    setAllergens(item?.allergens ?? []);
    setMerch(item?.merchandising_tags ?? []);
    setMargin(String(item?.margin_score ?? 0));
    setPrep(item?.prep_minutes != null ? String(item.prep_minutes) : '');
    setPortion(item?.portion_note ?? '');
    setStation((item?.station as 'kitchen' | 'bar') ?? 'kitchen');
    setMealRole((item as { meal_role?: string | null })?.meal_role ?? '');
    setFrom(toTimeInput(item?.available_from));
    setTo(toTimeInput(item?.available_to));

    setSale(saleDraftFromRow(item));
    const tags = item?.merchandising_tags ?? [];
    setNewOn(tags.includes('new'));
    setNewUntil(item?.new_until ?? '');
    setFeaturedOn(item?.featured_rank != null);
    setFeaturedNote(item?.featured_note ?? '');
    setFeaturedNoteBs(item?.featured_note_bs ?? '');
    setFeaturedNoteAr(item?.featured_note_ar ?? '');
    setComboOn(startAsCombo);
    setWasCombo(false);
    setSlots([]);
    setPromoAvailable(!!item && 'sale_kind' in item);

    let cancelled = false;
    // What the editor needs to know about the rest of the menu: which dishes
    // are featured, and which are combos (this one included).
    void (async () => {
      const featured = await supabase.from('menu_items').select('*').not('featured_rank', 'is', null);
      if (cancelled) return;
      if (!featured.error) {
        setPromoAvailable(true);
        setFeaturedOthers((featured.data as MenuItemRow[] ?? []).flatMap((r) =>
          r.id !== item?.id && r.featured_rank != null
            ? [{ id: r.id, name: r.name, featured_rank: r.featured_rank }] : []));
      }
      const combos = await fetchCombos();
      if (cancelled || !combos) return;
      setComboIds(new Set(combos.map((c) => c.combo_item_id)));
      const mine = item ? combos.find((c) => c.combo_item_id === item.id) : undefined;
      if (mine) {
        setWasCombo(true);
        setComboOn(true);
        setSlots(slotsFromCombo(mine));
      }
    })();
    return () => { cancelled = true; };
  }, [open, item, startAsCombo]);

  // The dishes a combo can be built from, once it is a combo.
  useEffect(() => {
    if (!open || !comboOn || pickable.length > 0) return;
    void (async () => {
      const [{ data: rows }, { data: subs }] = await Promise.all([
        supabase.from('menu_items').select('id, name, price, subcategory_id, is_available').order('name'),
        supabase.from('subcategories').select('id, name').order('sort_order'),
      ]);
      setPickable((rows ?? []).map((r) => ({ ...r, price: Number(r.price) })));
      setSections(subs ?? []);
    })();
  }, [open, comboOn, pickable.length]);

  // Opened from Promotions to do one thing: go straight to it.
  useEffect(() => {
    if (!open || !focus) return;
    const timer = setTimeout(() => document.getElementById(`item-${focus}`)?.scrollIntoView({ block: 'center' }), 150);
    return () => clearTimeout(timer);
  }, [open, focus]);

  const priceForPreview = parsePrice(price);
  const preview = useMemo(() => salePreview(sale, priceForPreview), [sale, priceForPreview]);
  const featuredFull = !item?.featured_rank && featuredOthers.length >= 3;

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    // Generous, because the photo is shrunk to ~1200px before upload.
    if (file.size > MAX_RAW_BYTES) { toast.error('Image must be under 20 MB'); return; }
    setUploading(true);
    try {
      const url = await uploadMenuImage(file);
      setImageUrl(url);
      toast.success('Image uploaded');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const trimmedName = name.trim();
    const priceNum = parsePrice(price);
    if (!trimmedName || priceNum === null) {
      toast.error('Enter an item name and a valid price, e.g. 4.50 or 4,50');
      return;
    }
    const marginNum = Math.max(0, Math.min(100, Math.round(Number(margin) || 0)));
    const prepNum = prep.trim() ? Math.max(0, Math.min(240, Math.round(Number(prep)))) : null;
    if (prep.trim() && !Number.isFinite(Number(prep))) {
      toast.error('Prep time must be a number of minutes');
      return;
    }
    // A window that ends before it starts hides the item all day, silently.
    if (from && to && from >= to) {
      toast.error('The "available until" time must be after the "available from" time');
      return;
    }

    const saleResult = saleColumns(sale, priceNum);
    if ('error' in saleResult) { toast.error(`Sale: ${saleResult.error}`); return; }
    if (comboOn) {
      const problem = slotsProblem(slots);
      if (problem) { toast.error(`Combo: ${problem}`); return; }
    }
    // The lowest free slot on the home screen, or the one it already has.
    let featuredRank: number | null = null;
    if (featuredOn) {
      const taken = new Set(featuredOthers.map((f) => f.featured_rank));
      featuredRank = item?.featured_rank ?? [1, 2, 3].find((r) => !taken.has(r)) ?? null;
      if (featuredRank === null) {
        toast.error(`Three dishes are already featured (${featuredOthers.map((f) => f.name).join(', ')}). Unpin one in Promotions first.`);
        return;
      }
    }

    setSaving(true);
    const payload: MenuItemInsert = {
      subcategory_id: item?.subcategory_id ?? subcategoryId ?? '',
      name: trimmedName,
      name_bs: nameBs.trim() || null,
      name_ar: nameAr.trim() || null,
      description: desc.trim() || null,
      description_bs: descBs.trim() || null,
      description_ar: descAr.trim() || null,
      price: priceNum,
      image_url: imageUrl.trim() || null,
      dietary_tags: diets,
      allergens,
      // "New" lives on its own switch.
      merchandising_tags: [...merch.filter((tag) => tag !== 'new'), ...(newOn ? ['new'] : [])],
      margin_score: marginNum,
      prep_minutes: prepNum,
      portion_note: portion.trim() || null,
      station,
      // Empty means unclassified, and the rules skip it rather than guessing.
      meal_role: (mealRole || null) as MenuItemInsert['meal_role'],
      available_from: fromTimeInput(from),
      available_to: fromTimeInput(to),
      ...(promoAvailable ? {
        ...saleResult.columns,
        new_until: newOn ? (newUntil || defaultNewUntil()) : null,
        featured_rank: featuredRank,
        featured_note: featuredOn ? featuredNote.trim() || null : null,
        featured_note_bs: featuredOn ? featuredNoteBs.trim() || null : null,
        featured_note_ar: featuredOn ? featuredNoteAr.trim() || null : null,
      } : {}),
    };

    /*
     * A new dish goes to the END of its subcategory.
     *
     * Every insert used sort_order 0, so each new item jumped to the top —
     * above the dishes someone had carefully ordered — and several new items
     * shared 0 and came out in whatever order the database liked that day.
     */
    let nextSort = 0;
    if (!isEdit) {
      const { data: last } = await supabase
        .from('menu_items')
        .select('sort_order')
        .eq('subcategory_id', payload.subcategory_id)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      nextSort = (last?.sort_order ?? -1) + 1;
    }

    // One write, no silent fallback. The old form retried without
    // dietary_tags when the column was missing and still toasted success, so a
    // manager could set tags, be told it worked, and find them gone.
    let savedId = item?.id ?? null;
    let error: { message: string } | null = null;
    if (isEdit && item) {
      ({ error } = await supabase.from('menu_items').update(payload).eq('id', item.id));
    } else if (comboOn) {
      // A new combo needs its id for its parts.
      const res = await supabase.from('menu_items').insert({ ...payload, sort_order: nextSort }).select('id').single();
      error = res.error;
      savedId = res.data?.id ?? null;
    } else {
      ({ error } = await supabase.from('menu_items').insert({ ...payload, sort_order: nextSort }));
    }

    if (error) { setSaving(false); toast.error(error.message); return; }

    if (savedId && (comboOn || wasCombo)) {
      const { error: comboError } = await supabase.rpc('admin_save_combo' as never, {
        _combo_item_id: savedId,
        _slots: comboOn ? slotsPayload(slots) : [],
      } as never);
      if (comboError) {
        setSaving(false);
        toast.error(`The dish is saved, but its combo parts are not: ${comboError.message}`);
        onSaved();
        return;
      }
    }
    setSaving(false);

    if (originalImage.current && originalImage.current !== payload.image_url) {
      void deleteMenuImage(originalImage.current);
    }

    toast.success(isEdit ? 'Item updated' : 'Item added');
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif">{isEdit ? 'Edit item' : 'Add item'}</DialogTitle>
        </DialogHeader>

        {/* min-w-0: the dialog is a grid, and one long dish name in a combo part would otherwise widen the whole form past a phone screen. */}
        <div className="space-y-3 min-w-0">
          {/* Image */}
          <div>
            <Label className="text-xs text-muted-foreground">Photo</Label>
            <div className="mt-1.5 flex items-center gap-3">
              <div className="w-20 h-20 rounded-lg overflow-hidden bg-muted shrink-0 border border-border">
                {imageUrl ? (
                  <SmartImage src={imageUrl} alt={name || 'item'} width={80} height={80} wrapperClassName="w-20 h-20" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-muted-foreground/40 text-2xl font-serif">
                    {(name || '·')[0]}
                  </div>
                )}
              </div>
              <div className="flex-1 space-y-2">
                <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={uploading} className="gap-1.5">
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                    {uploading ? 'Uploading…' : 'Upload'}
                  </Button>
                  {imageUrl && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl('')} className="gap-1.5 text-muted-foreground">
                      <X className="w-3.5 h-3.5" /> Remove
                    </Button>
                  )}
                </div>
                <Input placeholder="…or paste image URL" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Name</Label>
            <Input placeholder="Item name (EN)" value={name} onChange={(e) => setName(e.target.value)} autoFocus className="mt-1" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="Name (BS)" value={nameBs} onChange={(e) => setNameBs(e.target.value)} />
            <Input placeholder="Name (AR)" value={nameAr} onChange={(e) => setNameAr(e.target.value)} dir="rtl" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Description</Label>
            <Textarea placeholder="Short description (EN)" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="mt-1" />
            <div className="grid grid-cols-1 gap-2 mt-2">
              <Textarea placeholder="Description (BS)" value={descBs} onChange={(e) => setDescBs(e.target.value)} rows={2} />
              <Textarea placeholder="Description (AR)" value={descAr} onChange={(e) => setDescAr(e.target.value)} rows={2} dir="rtl" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">{comboOn ? 'Combo price (KM)' : 'Price (KM)'}</Label>
              {/* Text, not number: a number field drops "4,50" without a word. */}
              <Input
                placeholder="4,50"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                aria-invalid={price.trim() !== '' && parsePrice(price) === null}
                className="mt-1"
              />
              {price.trim() !== '' && parsePrice(price) === null && (
                <p className="text-[11px] text-destructive font-sans mt-1">Use a number like 4,50 or 4.50</p>
              )}
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Portion note</Label>
              <Input placeholder="e.g. 220 g · serves 2" value={portion} onChange={(e) => setPortion(e.target.value)} className="mt-1" />
            </div>
          </div>

          {/* Station */}
          <div>
            <Label className="text-xs text-muted-foreground">Made at</Label>
            <div className="mt-1.5 flex gap-2">
              <Chip on={station === 'kitchen'} onClick={() => setStation('kitchen')}>
                <ChefHat className="w-3.5 h-3.5" /> Kitchen
              </Chip>
              <Chip on={station === 'bar'} onClick={() => setStation('bar')}>
                <CupSoda className="w-3.5 h-3.5" /> Bar
              </Chip>
            </div>
            <p className="text-[11px] text-muted-foreground font-sans mt-1">
              Decides which board and which ticket printer this item goes to.
            </p>
          </div>

          {/* Course, which is a different question from station. */}
          <div>
            <Label className="text-xs text-muted-foreground">Course</Label>
            <p className="text-[11px] text-muted-foreground font-sans">
              Used to time suggestions — dessert after mains — and to stop the app offering
              a second identical main. Leave blank if none of these fit.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MEAL_ROLES.map((r) => (
                <Chip
                  key={r.key}
                  on={mealRole === r.key}
                  onClick={() => setMealRole(mealRole === r.key ? '' : r.key)}
                >
                  {r.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* Dietary — a guest preference */}
          <div>
            <Label className="text-xs text-muted-foreground">Dietary tags</Label>
            <p className="text-[11px] text-muted-foreground font-sans">What a guest filters by. Shown on the card.</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {DIET_TAGS.map((d) => (
                <Chip key={d.key} on={diets.includes(d.key)} onClick={() => setDiets((p) => toggle(p, d.key))}>
                  <span aria-hidden>{d.emoji}</span>{t(d.labelKey)}
                </Chip>
              ))}
            </div>
          </div>

          {/* Allergens — safety information, deliberately separate */}
          <div>
            <Label className="text-xs text-muted-foreground">Allergens</Label>
            <p className="text-[11px] text-muted-foreground font-sans">
              Printed on the kitchen ticket and shown to the guest. Not the same as a dietary tag.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {ALLERGENS.map((a) => (
                <Chip key={a} on={allergens.includes(a)} onClick={() => setAllergens((p) => toggle(p, a))}>
                  {a}
                </Chip>
              ))}
            </div>
          </div>

          {/* Merchandising */}
          <div>
            <Label className="text-xs text-muted-foreground">Badges</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {MERCH_TAGS.map((m) => (
                <Chip key={m.key} on={merch.includes(m.key)} onClick={() => setMerch((p) => toggle(p, m.key))}>
                  {m.label}
                </Chip>
              ))}
            </div>
          </div>

          {/* ---- Promotions ---- */}
          {/* Hidden, not silently ignored, until the database can store them. */}
          {!promoAvailable && (
            <p className="rounded-lg bg-muted px-3 py-2 text-[11px] font-sans text-muted-foreground">
              Sales, combos and featuring appear here once the database has the promotions migration (20261026100000).
            </p>
          )}
          {promoAvailable && (
          <PromoSection
            id="sale"
            title="Sale"
            description="A lower price for a while. Guests see the menu price struck through and pay the sale price, only while it runs."
            checked={sale.on}
            onCheckedChange={(on) => setSale((s) => ({ ...s, on }))}
          >
            <div className="flex gap-1.5" role="group" aria-label="Kind of sale">
              <Chip on={sale.kind === 'percent'} onClick={() => setSale((s) => ({ ...s, kind: 'percent' }))}>% off</Chip>
              <Chip on={sale.kind === 'price'} onClick={() => setSale((s) => ({ ...s, kind: 'price' }))}>Sale price</Chip>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={sale.value}
                onChange={(e) => setSale((s) => ({ ...s, value: e.target.value }))}
                placeholder={sale.kind === 'percent' ? '20' : '14,40'}
                inputMode="decimal"
                aria-label={sale.kind === 'percent' ? 'Percent off' : 'Sale price in KM'}
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">{sale.kind === 'percent' ? '% off' : 'KM'}</span>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Label on the badge</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Sale label">
                <Chip on={sale.label === ''} onClick={() => setSale((s) => ({ ...s, label: '' }))}>Just “−%”</Chip>
                {SALE_LABELS.map((key) => (
                  <Chip key={key} on={sale.label === key} onClick={() => setSale((s) => ({ ...s, label: key }))}>{SALE_LABEL_NAMES[key]}</Chip>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-xs text-muted-foreground">Starts (empty = now)</Label>
                <div className="mt-1 flex gap-1.5">
                  <Input type="date" value={sale.startDate} onChange={(e) => setSale((s) => ({ ...s, startDate: e.target.value }))} aria-label="Sale starts on" className="min-w-0" />
                  <Input type="time" value={sale.startTime} onChange={(e) => setSale((s) => ({ ...s, startTime: e.target.value }))} aria-label="Sale starts at" className="w-28" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Ends (empty = until you end it)</Label>
                <div className="mt-1 flex gap-1.5">
                  <Input type="date" value={sale.endDate} onChange={(e) => setSale((s) => ({ ...s, endDate: e.target.value }))} aria-label="Sale ends on" className="min-w-0" />
                  <Input type="time" value={sale.endTime} onChange={(e) => setSale((s) => ({ ...s, endTime: e.target.value }))} aria-label="Sale ends at" className="w-28" />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick end">
              {saleEndPresets().map((p) => (
                <Chip key={p.label} on={sale.endDate === p.date && sale.endTime === p.time} onClick={() => setSale((s) => ({ ...s, endDate: p.date, endTime: p.time }))}>
                  {p.label}
                </Chip>
              ))}
              {(sale.startDate || sale.endDate) && (
                <Chip on={false} onClick={() => setSale((s) => ({ ...s, startDate: '', startTime: '', endDate: '', endTime: '' }))}>No dates</Chip>
              )}
            </div>
            {preview && (
              <p
                data-testid="sale-preview"
                aria-live="polite"
                className={`rounded-lg px-3 py-2 text-sm font-sans font-semibold tabular-nums ${preview.tone === 'ok' ? 'bg-primary/10 text-primary' : 'bg-accent/10 text-accent'}`}
              >
                {preview.text}
              </p>
            )}
            <p className="text-[11px] text-muted-foreground font-sans">Times are Sarajevo time.</p>
          </PromoSection>
          )}

          {promoAvailable && (
          <PromoSection
            id="combo"
            title="Combo"
            description="Guests choose one dish for each part (a burger, a side, a drink). The price above becomes the combo price."
            checked={comboOn}
            onCheckedChange={setComboOn}
          >
            <ComboBuilder
              slots={slots}
              onChange={setSlots}
              items={pickable}
              sections={sections}
              comboPrice={parsePrice(price)}
              selfId={item?.id}
              comboIds={comboIds}
            />
          </PromoSection>
          )}

          <div id="item-highlight" className="space-y-3">
            <PromoSection
              id="new"
              title="Mark as new"
              description="A “New” badge and a place in “New at La Soul” on the home screen. It ends by itself."
              checked={newOn}
              onCheckedChange={(on) => { setNewOn(on); if (on && !newUntil) setNewUntil(defaultNewUntil()); }}
            >
              <div className="flex items-center gap-2">
                <Label htmlFor="item-new-until" className="text-xs text-muted-foreground shrink-0">New until</Label>
                <Input id="item-new-until" type="date" value={newUntil} onChange={(e) => setNewUntil(e.target.value)} className="w-44" />
              </div>
            </PromoSection>

            {promoAvailable && (
            <PromoSection
              id="featured"
              title="Feature on the home screen"
              description={featuredFull
                ? `Three dishes are featured already (${featuredOthers.map((f) => f.name).join(', ')}). Unpin one in Promotions first.`
                : 'One of up to three large cards at the top of the menu, with a short line if you like.'}
              checked={featuredOn}
              onCheckedChange={setFeaturedOn}
              disabled={!featuredOn && featuredFull}
            >
              <Input value={featuredNote} onChange={(e) => setFeaturedNote(e.target.value)} maxLength={80} placeholder="Short line (EN), e.g. Our classic since 2019" aria-label="Featured line (EN)" />
              <div className="grid grid-cols-2 gap-2">
                <Input value={featuredNoteBs} onChange={(e) => setFeaturedNoteBs(e.target.value)} maxLength={80} placeholder="Line (BS)" aria-label="Featured line (BS)" />
                <Input value={featuredNoteAr} onChange={(e) => setFeaturedNoteAr(e.target.value)} maxLength={80} placeholder="Line (AR)" dir="rtl" aria-label="Featured line (AR)" />
              </div>
            </PromoSection>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs text-muted-foreground">Margin score (0–100)</Label>
              <Input
                type="number" min="0" max="100" step="1" value={margin}
                onChange={(e) => setMargin(e.target.value)} className="mt-1"
              />
              {/* Internal. It breaks ties between two equally relevant
                  suggestions; it never changes what a guest is told. */}
              <p className="text-[11px] text-muted-foreground font-sans mt-1">
                Internal only, never shown. Higher wins a tie between two equally good suggestions.
              </p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Prep minutes</Label>
              <Input
                type="number" min="0" max="240" step="1" placeholder="e.g. 12" value={prep}
                onChange={(e) => setPrep(e.target.value)} className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground font-sans mt-1">
                Drives the guest's estimate and the kitchen's load forecast.
              </p>
            </div>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Only available between</Label>
            <div className="mt-1.5 flex items-center gap-2">
              <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="flex-1" aria-label="Available from" />
              <span className="text-muted-foreground text-sm">and</span>
              <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="flex-1" aria-label="Available until" />
              {(from || to) && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>
                  Clear
                </Button>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground font-sans mt-1">
              Leave empty for all day. Breakfast items stop being orderable outside their window.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || uploading}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isEdit ? 'Save changes' : 'Add item'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MenuItemDialog;
