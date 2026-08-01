import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import SmartImage from '@/components/ui/SmartImage';
import { ChefHat, CupSoda, Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { DIET_TAGS, getItemTags } from '@/lib/dietary';
import { useT } from '@/lib/i18n';
import type { Database } from '@/integrations/supabase/types';

type MenuItemRow = Database['public']['Tables']['menu_items']['Row'];
type MenuItemInsert = Database['public']['Tables']['menu_items']['Insert'];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Provided when adding a new item. */
  subcategoryId?: string | null;
  /** Provided when editing an existing item. */
  item?: MenuItemRow | null;
  onSaved: () => void;
}

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
const MERCH_TAGS: { key: string; label: string }[] = [
  { key: 'signature', label: 'Signature' },
  { key: 'chef_pick', label: "Chef's pick" },
  { key: 'popular', label: 'Popular' },
  { key: 'new', label: 'New' },
  { key: 'seasonal', label: 'Seasonal' },
  { key: 'house_favourite', label: 'House favourite' },
];

/** Upload an image to the menu-images bucket and return its public URL. */
async function uploadMenuImage(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from('menu-images')
    .upload(path, file, { upsert: true, cacheControl: '31536000', contentType: file.type });
  if (error) throw error;
  const { data } = supabase.storage.from('menu-images').getPublicUrl(path);
  return data.publicUrl;
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
const MenuItemDialog = ({ open, onOpenChange, subcategoryId, item, onSaved }: Props) => {
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
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
    setFrom(toTimeInput(item?.available_from));
    setTo(toTimeInput(item?.available_to));
  }, [open, item]);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Please choose an image file'); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error('Image must be under 8 MB'); return; }
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
    const priceNum = Number.parseFloat(price);
    if (!trimmedName || !Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error('Enter an item name and a valid price');
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
      merchandising_tags: merch,
      margin_score: marginNum,
      prep_minutes: prepNum,
      portion_note: portion.trim() || null,
      station,
      available_from: fromTimeInput(from),
      available_to: fromTimeInput(to),
    };

    // One write, no silent fallback. The old form retried without
    // dietary_tags when the column was missing and still toasted success, so a
    // manager could set tags, be told it worked, and find them gone.
    const { error } = isEdit
      ? await supabase.from('menu_items').update(payload).eq('id', item!.id)
      : await supabase.from('menu_items').insert({ ...payload, sort_order: 0 });

    setSaving(false);
    if (error) { toast.error(error.message); return; }

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

        <div className="space-y-3">
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
              <Label className="text-xs text-muted-foreground">Price (KM)</Label>
              <Input placeholder="0.00" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
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
