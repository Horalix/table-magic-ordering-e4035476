import React, { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import SmartImage from '@/components/ui/SmartImage';
import { ChefHat, CupSoda, ImagePlus, Loader2, Upload, X } from 'lucide-react';
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
import { venueByDbId } from '@/lib/venues';
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
  /**
   * Where a new dish can go, when it is added without a subcategory (the
   * page's "Add dish" button): the editor then asks, at the top.
   */
  sectionChoices?: { id: string; label: string }[];
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
  <section
    id={`item-${id}`}
    aria-labelledby={`item-${id}-title`}
    className={`scroll-mt-16 rounded-xl border transition-colors ${checked ? 'border-primary/40 bg-primary/[0.03]' : 'border-border bg-card'}`}
  >
    {/* The whole row is the switch's label, so a thumb can hit it anywhere. */}
    <div className="flex min-h-[56px] items-center gap-3 px-3.5 py-3">
      <div className="flex-1 min-w-0">
        <Label id={`item-${id}-title`} htmlFor={`item-${id}-switch`} className="text-sm font-sans font-semibold text-foreground">{title}</Label>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground font-sans">{description}</p>
      </div>
      <Switch id={`item-${id}-switch`} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
    {checked && children && <div className="space-y-3 border-t border-primary/15 px-3.5 pb-3.5 pt-3">{children}</div>}
  </section>
);

/** A group of the editor, with an anchor the jump bar at the top scrolls to. */
const FormGroup = ({ id, title, hint, children }: { id: string; title: string; hint?: string; children: React.ReactNode }) => (
  <section id={`item-group-${id}`} aria-labelledby={`item-group-${id}-title`} className="scroll-mt-16 space-y-4">
    <div>
      <h3 id={`item-group-${id}-title`} className="font-serif text-base font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground font-sans">{hint}</p>}
    </div>
    {children}
  </section>
);

/** A field's label and its one line of help, the same everywhere in the form. */
const Field = ({ label, htmlFor, help, children, className }: {
  label: React.ReactNode; htmlFor?: string; help?: React.ReactNode; children: React.ReactNode; className?: string;
}) => (
  <div className={className}>
    <Label htmlFor={htmlFor} className="text-[13px] font-sans font-medium text-foreground">{label}</Label>
    <div className="mt-1.5">{children}</div>
    {help && <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground font-sans">{help}</p>}
  </div>
);

/** Three languages of one text, each marked, Arabic right to left. */
const LANGS = [
  { key: 'en', tag: 'EN', name: 'English' },
  { key: 'bs', tag: 'BS', name: 'Bosnian' },
  { key: 'ar', tag: 'AR', name: 'Arabic' },
] as const;

const LangTag = ({ tag }: { tag: string }) => (
  <span aria-hidden className="grid h-11 w-10 shrink-0 place-items-center rounded-md bg-muted text-[11px] font-sans font-semibold tracking-wide text-muted-foreground md:h-10">
    {tag}
  </span>
);

const JUMPS = [
  { id: 'dish', label: 'The dish' },
  { id: 'labels', label: 'Labels' },
  { id: 'promo', label: 'Promotions' },
  { id: 'kitchen', label: 'Kitchen' },
] as const;

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

/**
 * The restaurant folder a new photo goes in: '<slug>/', the restaurant this
 * admin is editing (the one the database answers for, current_venue(), which
 * is also where a new dish lands). The storage rules let a restaurant's admin
 * change only their own folder (20261031100000_admin_separation.sql). On a
 * database from before that, the root, as before.
 */
async function menuImageFolder(): Promise<string> {
  const { data, error } = await supabase.rpc('current_venue' as never);
  if (error) return '';
  const venue = venueByDbId(typeof data === 'string' ? data : null);
  return venue ? `${venue.slug}/` : '';
}

/** Upload an image to the menu-images bucket and return its public URL. */
async function uploadMenuImage(file: File): Promise<string> {
  const { blob, ext, type } = await shrinkImage(file);
  const path = `${await menuImageFolder()}${crypto.randomUUID()}.${ext}`;
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
    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-sans font-medium transition-colors sm:min-h-[36px] sm:px-3 ${
      on ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-foreground/30'
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
const MenuItemDialog = ({ open, onOpenChange, subcategoryId, item, onSaved, startAsCombo = false, focus, sectionChoices }: Props) => {
  const isEdit = !!item;
  /** A new dish with no place yet asks where it goes. */
  const asksSection = !isEdit && !subcategoryId && !!sectionChoices;
  const [pickedSection, setPickedSection] = useState('');
  const [name, setName] = useState('');
  const [nameBs, setNameBs] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [desc, setDesc] = useState('');
  const [descBs, setDescBs] = useState('');
  const [descAr, setDescAr] = useState('');
  const [price, setPrice] = useState('');
  /** What one portion costs to make, in KM; empty when not recorded. */
  const [cost, setCost] = useState('');
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
    setCost(item?.food_cost != null ? String(item.food_cost) : '');
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
    setPickedSection('');

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
    if (asksSection && !pickedSection) {
      toast.error('Choose where the dish goes on the menu');
      return;
    }
    if (!trimmedName || priceNum === null) {
      toast.error('Enter a name and a valid price, e.g. 4.50 or 4,50');
      return;
    }
    // Optional. Empty clears it, and Menu intelligence goes back to an estimate for this dish.
    const costNum = cost.trim() ? parsePrice(cost) : null;
    if (cost.trim() && costNum === null) {
      toast.error('Ingredient cost must be a number, e.g. 3.20 or 3,20');
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
      subcategory_id: item?.subcategory_id ?? subcategoryId ?? (pickedSection || ''),
      name: trimmedName,
      name_bs: nameBs.trim() || null,
      name_ar: nameAr.trim() || null,
      description: desc.trim() || null,
      description_bs: descBs.trim() || null,
      description_ar: descAr.trim() || null,
      price: priceNum,
      food_cost: costNum,
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
    } else {
      // Its id: a new combo needs it for its parts, and Undo to take it off again.
      const res = await supabase.from('menu_items').insert({ ...payload, sort_order: nextSort }).select('id').single();
      error = res.error;
      savedId = res.data?.id ?? null;
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

    /*
     * Undo, from the toast: an edit goes back to the fields as they were, a new
     * dish comes off again. Not for a combo, whose parts it would not bring
     * back. A replaced photo is only cleaned up once Undo is no longer on
     * offer, so undoing gets it back; the new one is cleaned up instead.
     */
    const replacedImage = originalImage.current && originalImage.current !== payload.image_url ? originalImage.current : null;
    const newImage = payload.image_url;
    const editedId = isEdit && item ? item.id : null;
    const addedId = !isEdit ? savedId : null;
    const was = isEdit && item
      ? Object.fromEntries(Object.keys(payload).filter((k) => k in item).map((k) => [k, (item as unknown as Record<string, unknown>)[k]]))
      : null;
    const undo = comboOn || wasCombo || !(editedId || addedId) ? null : async (): Promise<boolean> => {
      const { error: undoError } = editedId
        ? await supabase.from('menu_items').update(was as never).eq('id', editedId)
        : await supabase.from('menu_items').delete().eq('id', addedId!);
      if (undoError) { toast.error(`Could not undo: ${undoError.message}`); return false; }
      // The photo this save brought in, if it brought one: no dish uses it now.
      if (newImage && (addedId || replacedImage)) void deleteMenuImage(newImage);
      toast.success(editedId ? `${item?.name ?? 'The dish'} is back as it was` : `${payload.name} is off the menu again`);
      onSaved();
      return true;
    };
    let undone = false;
    let settled = false;
    const settle = () => {
      if (settled || undone) return;
      settled = true;
      if (replacedImage) void deleteMenuImage(replacedImage);
    };

    toast.success(isEdit ? `${trimmedName} saved` : `${trimmedName} added to the menu`, undo ? {
      duration: 10_000,
      action: {
        label: 'Undo',
        onClick: () => {
          undone = true;
          void undo().then((ok) => { if (!ok) { undone = false; settle(); } });
        },
      },
      onAutoClose: settle,
      onDismiss: settle,
    } : undefined);
    if (!undo) settle();
    onOpenChange(false);
    onSaved();
  };

  const jump = (id: string) => {
    document.getElementById(`item-group-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const priceInvalid = price.trim() !== '' && parsePrice(price) === null;
  const costHelp = (() => {
    const c = cost.trim() ? parsePrice(cost) : null;
    const p = parsePrice(price);
    if (c === null || p === null || p <= 0) {
      return 'Optional. What the ingredients of one portion cost you. Guests never see it; Menu intelligence uses it for exact margins instead of an estimate.';
    }
    return `You keep ${(p - c).toFixed(2)} KM a portion (${Math.round(((p - c) / p) * 100)}% of the price). Guests never see this.`;
  })();
  const names = { en: [name, setName], bs: [nameBs, setNameBs], ar: [nameAr, setNameAr] } as const;
  const descs = { en: [desc, setDesc], bs: [descBs, setDescBs], ar: [descAr, setDescAr] } as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        On a phone the editor is the whole screen: a header, the form scrolling
        under a bar of jump links, and Save pinned above the home indicator. On
        a wider screen a centred sheet, never stretched wider than a form reads.
      */}
      <DialogContent
        className="flex max-h-[92dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:border-0 max-sm:data-[state=open]:slide-in-from-left-0 max-sm:data-[state=open]:slide-in-from-top-0 max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:slide-out-to-left-0 max-sm:data-[state=closed]:slide-out-to-top-0 max-sm:data-[state=closed]:zoom-out-100"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b border-border px-5 pb-3 pe-14 pt-[calc(1rem+env(safe-area-inset-top))] text-start sm:pt-5">
          <DialogTitle className="font-serif text-xl">{isEdit ? 'Edit dish' : 'New dish'}</DialogTitle>
          <DialogDescription className="text-xs font-sans text-muted-foreground">
            {isEdit ? 'Changes reach guests as soon as you save.' : 'A name and a price are enough to start; the rest can follow.'}
          </DialogDescription>
        </DialogHeader>

        {/* min-w-0: one long dish name in a combo part would otherwise widen the whole form past a phone screen. */}
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
          <nav aria-label="Parts of the form" className="sticky top-0 z-10 flex gap-1 overflow-x-auto border-b border-border/60 bg-background/95 px-4 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            {JUMPS.map((j) => (
              <button
                key={j.id}
                type="button"
                onClick={() => jump(j.id)}
                className="min-h-[40px] shrink-0 rounded-full px-3 text-xs font-sans font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {j.label}
              </button>
            ))}
          </nav>

          <div className="space-y-9 px-5 pb-10 pt-5">
            <FormGroup id="dish" title="The dish" hint="Bosnian and Arabic can stay empty: Auto-translate on the Dishes page fills in only what is missing.">
              {asksSection && (
                <Field label="Goes in" htmlFor="item-section">
                  <select
                    id="item-section"
                    value={pickedSection}
                    onChange={(e) => setPickedSection(e.target.value)}
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-base md:h-10 md:text-sm"
                  >
                    <option value="" disabled>Choose a section…</option>
                    {(sectionChoices ?? []).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </Field>
              )}

              {/* Photo */}
              <div className="flex items-center gap-4">
                <div className="h-24 w-24 shrink-0 overflow-hidden rounded-xl border border-border bg-muted sm:h-28 sm:w-28">
                  {imageUrl ? (
                    // With the dish's id: the photo guests see, until a new one is uploaded here.
                    <SmartImage src={imageUrl} id={item?.id} alt={name || 'Dish photo'} width={112} height={112} square wrapperClassName="h-full w-full" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
                      aria-label="Add a photo"
                    >
                      <ImagePlus className="h-6 w-6" aria-hidden />
                      <span className="text-[11px] font-sans">Photo</span>
                    </button>
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} disabled={uploading} className="min-h-[44px] gap-1.5 md:min-h-[40px]">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {uploading ? 'Uploading…' : imageUrl ? 'Replace' : 'Upload'}
                    </Button>
                    {imageUrl && (
                      <Button type="button" variant="ghost" onClick={() => setImageUrl('')} className="min-h-[44px] gap-1.5 text-muted-foreground md:min-h-[40px]">
                        <X className="h-4 w-4" /> Remove
                      </Button>
                    )}
                  </div>
                  <Input
                    placeholder="…or paste image URL"
                    aria-label="Image URL"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="h-11 text-base md:h-9 md:text-xs"
                  />
                </div>
              </div>

              <fieldset>
                <legend className="text-[13px] font-sans font-medium text-foreground">Name</legend>
                <div className="mt-1.5 space-y-2">
                  {LANGS.map((l) => {
                    const [v, set] = names[l.key];
                    return (
                      <div key={l.key} className="flex items-center gap-2">
                        <LangTag tag={l.tag} />
                        <Input
                          aria-label={`Name in ${l.name}`}
                          placeholder={l.key === 'en' ? 'Item name (EN)' : `Name (${l.tag})`}
                          value={v}
                          onChange={(e) => set(e.target.value)}
                          autoFocus={l.key === 'en' && !isEdit}
                          dir={l.key === 'ar' ? 'rtl' : undefined}
                          className="h-11 md:h-10"
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">
                <Field
                  label={comboOn ? 'Combo price (KM)' : 'Price (KM)'}
                  htmlFor="item-price"
                  help={priceInvalid ? <span className="text-destructive">Use a number like 4,50 or 4.50</span> : undefined}
                >
                  {/* Text, not number: a number field drops "4,50" without a word. */}
                  <Input
                    id="item-price"
                    placeholder="4,50"
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    aria-invalid={priceInvalid}
                    className="h-11 tabular-nums md:h-10"
                  />
                </Field>
                <Field label="Portion" htmlFor="item-portion">
                  <Input id="item-portion" placeholder="e.g. 220 g · serves 2" value={portion} onChange={(e) => setPortion(e.target.value)} className="h-11 md:h-10" />
                </Field>
              </div>

              <fieldset>
                <legend className="text-[13px] font-sans font-medium text-foreground">Description</legend>
                <div className="mt-1.5 space-y-2">
                  {LANGS.map((l) => {
                    const [v, set] = descs[l.key];
                    return (
                      <div key={l.key} className="flex items-start gap-2">
                        <LangTag tag={l.tag} />
                        <Textarea
                          aria-label={`Description in ${l.name}`}
                          placeholder={l.key === 'en' ? 'Short description (EN)' : `Description (${l.tag})`}
                          value={v}
                          onChange={(e) => set(e.target.value)}
                          rows={2}
                          dir={l.key === 'ar' ? 'rtl' : undefined}
                          className="min-h-[64px] text-base md:text-sm"
                        />
                      </div>
                    );
                  })}
                </div>
              </fieldset>
            </FormGroup>

            <FormGroup id="labels" title="Labels" hint="What guests see on the card and can filter by.">
              {/* Dietary: a guest preference */}
              <Field label="Dietary" help="What a guest filters by. Shown on the card.">
                <div className="flex flex-wrap gap-1.5">
                  {DIET_TAGS.map((d) => (
                    <Chip key={d.key} on={diets.includes(d.key)} onClick={() => setDiets((p) => toggle(p, d.key))}>
                      <span aria-hidden>{d.emoji}</span>{t(d.labelKey)}
                    </Chip>
                  ))}
                </div>
              </Field>

              {/* Allergens: safety information, deliberately separate */}
              <Field label="Allergens" help="Printed on the kitchen ticket and shown to the guest. Not the same as a dietary tag.">
                <div className="flex flex-wrap gap-1.5">
                  {ALLERGENS.map((a) => (
                    <Chip key={a} on={allergens.includes(a)} onClick={() => setAllergens((p) => toggle(p, a))}>
                      {a}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Badges">
                <div className="flex flex-wrap gap-1.5">
                  {MERCH_TAGS.map((m) => (
                    <Chip key={m.key} on={merch.includes(m.key)} onClick={() => setMerch((p) => toggle(p, m.key))}>
                      {m.label}
                    </Chip>
                  ))}
                </div>
              </Field>
            </FormGroup>

            <FormGroup id="promo" title="Promotions" hint="Each is off until you switch it on.">
              {/* Hidden, not silently ignored, until the database can store them. */}
              {!promoAvailable && (
                <p className="rounded-lg bg-muted px-3 py-2 text-xs font-sans text-muted-foreground">
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
                <div className="flex flex-wrap items-center gap-2">
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
                      className="h-11 w-24 tabular-nums md:h-10"
                    />
                    <span className="text-sm text-muted-foreground">{sale.kind === 'percent' ? '% off' : 'KM'}</span>
                  </div>
                </div>
                <Field label="Label on the badge">
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sale label">
                    <Chip on={sale.label === ''} onClick={() => setSale((s) => ({ ...s, label: '' }))}>Just “−%”</Chip>
                    {SALE_LABELS.map((key) => (
                      <Chip key={key} on={sale.label === key} onClick={() => setSale((s) => ({ ...s, label: key }))}>{SALE_LABEL_NAMES[key]}</Chip>
                    ))}
                  </div>
                </Field>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Starts (empty = now)">
                    <div className="flex gap-1.5">
                      <Input type="date" value={sale.startDate} onChange={(e) => setSale((s) => ({ ...s, startDate: e.target.value }))} aria-label="Sale starts on" className="h-11 min-w-0 md:h-10" />
                      <Input type="time" value={sale.startTime} onChange={(e) => setSale((s) => ({ ...s, startTime: e.target.value }))} aria-label="Sale starts at" className="h-11 w-28 md:h-10" />
                    </div>
                  </Field>
                  <Field label="Ends (empty = until you end it)">
                    <div className="flex gap-1.5">
                      <Input type="date" value={sale.endDate} onChange={(e) => setSale((s) => ({ ...s, endDate: e.target.value }))} aria-label="Sale ends on" className="h-11 min-w-0 md:h-10" />
                      <Input type="time" value={sale.endTime} onChange={(e) => setSale((s) => ({ ...s, endTime: e.target.value }))} aria-label="Sale ends at" className="h-11 w-28 md:h-10" />
                    </div>
                  </Field>
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
                <p className="text-xs text-muted-foreground font-sans">Times are Sarajevo time.</p>
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

              <div id="item-highlight" className="scroll-mt-16 space-y-3">
                <PromoSection
                  id="new"
                  title="Mark as new"
                  description="A “New” badge and a place in the “New at …” row on the home screen. It ends by itself."
                  checked={newOn}
                  onCheckedChange={(on) => { setNewOn(on); if (on && !newUntil) setNewUntil(defaultNewUntil()); }}
                >
                  <Field label="New until" htmlFor="item-new-until">
                    <Input id="item-new-until" type="date" value={newUntil} onChange={(e) => setNewUntil(e.target.value)} className="h-11 w-48 md:h-10" />
                  </Field>
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
                  <Input value={featuredNote} onChange={(e) => setFeaturedNote(e.target.value)} maxLength={80} placeholder="Short line (EN), e.g. Our classic since 2019" aria-label="Featured line (EN)" className="h-11 md:h-10" />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <Input value={featuredNoteBs} onChange={(e) => setFeaturedNoteBs(e.target.value)} maxLength={80} placeholder="Line (BS)" aria-label="Featured line (BS)" className="h-11 md:h-10" />
                    <Input value={featuredNoteAr} onChange={(e) => setFeaturedNoteAr(e.target.value)} maxLength={80} placeholder="Line (AR)" dir="rtl" aria-label="Featured line (AR)" className="h-11 md:h-10" />
                  </div>
                </PromoSection>
                )}
              </div>
            </FormGroup>

            <FormGroup id="kitchen" title="Kitchen and costs" hint="How the dish is made and what it costs you.">
              <Field label="Made at" help="Decides which board and which ticket printer this dish goes to.">
                <div className="flex gap-1.5">
                  <Chip on={station === 'kitchen'} onClick={() => setStation('kitchen')}>
                    <ChefHat className="h-4 w-4" /> Kitchen
                  </Chip>
                  <Chip on={station === 'bar'} onClick={() => setStation('bar')}>
                    <CupSoda className="h-4 w-4" /> Bar
                  </Chip>
                </div>
              </Field>

              {/* Course, which is a different question from station. */}
              <Field label="Course" help="Used to time suggestions (dessert after mains) and to stop the app offering a second identical main. Leave blank if none fit.">
                <div className="flex flex-wrap gap-1.5">
                  {MEAL_ROLES.map((r) => (
                    <Chip key={r.key} on={mealRole === r.key} onClick={() => setMealRole(mealRole === r.key ? '' : r.key)}>
                      {r.label}
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Only available between" help="Leave empty for all day. Breakfast dishes stop being orderable outside their window.">
                <div className="flex items-center gap-2">
                  <Input type="time" value={from} onChange={(e) => setFrom(e.target.value)} className="h-11 min-w-0 flex-1 md:h-10" aria-label="Available from" />
                  <span className="text-sm text-muted-foreground">and</span>
                  <Input type="time" value={to} onChange={(e) => setTo(e.target.value)} className="h-11 min-w-0 flex-1 md:h-10" aria-label="Available until" />
                  {(from || to) && (
                    <Button type="button" variant="ghost" className="min-h-[44px] md:min-h-[40px]" onClick={() => { setFrom(''); setTo(''); }}>
                      Clear
                    </Button>
                  )}
                </div>
              </Field>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Prep minutes" htmlFor="item-prep" help="Drives the guest's estimate and the kitchen's load forecast.">
                  <Input
                    id="item-prep" type="number" min="0" max="240" step="1" placeholder="e.g. 12" value={prep}
                    inputMode="numeric" onChange={(e) => setPrep(e.target.value)} className="h-11 tabular-nums md:h-10"
                  />
                </Field>
                {/* Internal. It breaks ties between two equally relevant
                    suggestions; it never changes what a guest is told. */}
                <Field label="Margin score (0–100)" htmlFor="item-margin" help="Internal only, never shown. Higher wins a tie between two equally good suggestions.">
                  <Input
                    id="item-margin" type="number" min="0" max="100" step="1" value={margin}
                    inputMode="numeric" onChange={(e) => setMargin(e.target.value)} className="h-11 tabular-nums md:h-10"
                  />
                </Field>
              </div>
              <Field label="Ingredient cost per portion (KM)" htmlFor="item-food-cost" help={costHelp}>
                <Input
                  id="item-food-cost"
                  placeholder="e.g. 3,20"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={cost}
                  onChange={(e) => setCost(e.target.value)}
                  aria-invalid={cost.trim() !== '' && parsePrice(cost) === null}
                  className="h-11 tabular-nums sm:max-w-[16rem] md:h-10"
                />
              </Field>
            </FormGroup>
          </div>
        </div>

        {/* Always in reach: on a phone Save was once some 1,500px of scrolling below the price. */}
        <DialogFooter className="shrink-0 flex-row gap-2 border-t border-border bg-background px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:justify-end">
          <Button variant="outline" className="min-h-[44px] flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="min-h-[44px] flex-[2] gap-2 sm:min-w-[140px] sm:flex-none" onClick={save} disabled={saving || uploading}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : isEdit ? 'Save changes' : 'Add dish'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default MenuItemDialog;
