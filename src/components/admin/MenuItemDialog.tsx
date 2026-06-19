import React, { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import SmartImage from '@/components/ui/SmartImage';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
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
 * Add or edit a single menu item — the core CMS form. Image can be uploaded
 * (stored in Supabase) or pasted as a URL. Translations are optional.
 */
const MenuItemDialog = ({ open, onOpenChange, subcategoryId, item, onSaved }: Props) => {
  const isEdit = !!item;
  const [name, setName] = useState('');
  const [nameBs, setNameBs] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [desc, setDesc] = useState('');
  const [price, setPrice] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Reset form whenever the dialog opens for a different item / add.
  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setNameBs(item?.name_bs ?? '');
    setNameAr(item?.name_ar ?? '');
    setDesc(item?.description ?? '');
    setPrice(item ? String(item.price) : '');
    setImageUrl(item?.image_url ?? '');
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
    setSaving(true);
    const payload: MenuItemInsert = {
      subcategory_id: item?.subcategory_id ?? subcategoryId ?? '',
      name: trimmedName,
      name_bs: nameBs.trim() || null,
      name_ar: nameAr.trim() || null,
      description: desc.trim() || null,
      price: priceNum,
      image_url: imageUrl.trim() || null,
    };
    const { error } = isEdit
      ? await supabase.from('menu_items').update(payload).eq('id', item!.id)
      : await supabase.from('menu_items').insert({ ...payload, sort_order: 0 });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(isEdit ? 'Item updated' : 'Item added');
    onOpenChange(false);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
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
            <Textarea placeholder="Short description" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Price (KM)</Label>
            <Input placeholder="0.00" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="mt-1" />
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
