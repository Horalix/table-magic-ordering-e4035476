import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Plus, Trash2, ChevronDown, ChevronRight, Languages, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

const AdminMenu = () => {
  const [categories, setCategories] = useState<any[]>([]);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [expandedSubcategory, setExpandedSubcategory] = useState<string | null>(null);
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [isAddingSubcategory, setIsAddingSubcategory] = useState<string | null>(null);
  const [isAddingItem, setIsAddingItem] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newNameBs, setNewNameBs] = useState('');
  const [newNameAr, setNewNameAr] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newImageUrl, setNewImageUrl] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);

  const fetchMenu = async () => {
    const { data } = await supabase
      .from('categories')
      .select(`*, subcategories(*, menu_items(*))`)
      .order('sort_order');
    setCategories(data || []);
  };

  useEffect(() => { fetchMenu(); }, []);

  const addCategory = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('categories').insert({
      name: newName,
      name_bs: newNameBs || null,
      name_ar: newNameAr || null,
      sort_order: categories.length,
    } as any);
    if (error) toast.error('Failed to add category');
    else { toast.success('Category added'); setIsAddingCategory(false); resetForm(); fetchMenu(); }
  };

  const addSubcategory = async (categoryId: string) => {
    if (!newName.trim()) return;
    const { error } = await supabase.from('subcategories').insert({
      category_id: categoryId,
      name: newName,
      name_bs: newNameBs || null,
      name_ar: newNameAr || null,
      sort_order: 0,
    } as any);
    if (error) toast.error('Failed to add subcategory');
    else { toast.success('Subcategory added'); setIsAddingSubcategory(null); resetForm(); fetchMenu(); }
  };

  const addMenuItem = async (subcategoryId: string) => {
    if (!newName.trim() || !newPrice) return;
    const { error } = await supabase.from('menu_items').insert({
      subcategory_id: subcategoryId,
      name: newName,
      name_bs: newNameBs || null,
      name_ar: newNameAr || null,
      description: newDesc || null,
      price: parseFloat(newPrice),
      image_url: newImageUrl || null,
      sort_order: 0,
    } as any);
    if (error) toast.error('Failed to add item');
    else { toast.success('Item added'); setIsAddingItem(null); resetForm(); fetchMenu(); }
  };

  const resetForm = () => {
    setNewName(''); setNewNameBs(''); setNewNameAr(''); setNewDesc(''); setNewPrice(''); setNewImageUrl('');
  };

  const toggleAvailability = async (itemId: string, currentAvailable: boolean) => {
    const { error } = await supabase.from('menu_items').update({ is_available: !currentAvailable }).eq('id', itemId);
    if (error) toast.error('Failed to update');
    else fetchMenu();
  };

  const deleteItem = async (table: string, id: string) => {
    const { error } = await supabase.from(table as any).delete().eq('id', id);
    if (error) toast.error('Failed to delete');
    else { toast.success('Deleted'); fetchMenu(); }
  };

  const translateToArabic = async () => {
    setIsTranslating(true);
    try {
      const { data, error } = await supabase.functions.invoke('translate-menu');
      if (error) throw error;
      toast.success(`Translation complete: ${data.message}`);
      fetchMenu();
    } catch (err) {
      console.error('Translation error:', err);
      toast.error('Translation failed. Please try again.');
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-serif text-3xl font-bold text-foreground">Menu Management</h1>
        <div className="flex gap-2">
          <Button
            onClick={translateToArabic}
            disabled={isTranslating}
            variant="outline"
            size="sm"
            className="rounded-lg font-sans gap-1"
          >
            {isTranslating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
            {isTranslating ? 'Translating...' : 'Auto-Translate Arabic'}
          </Button>
          <Button onClick={() => { setIsAddingCategory(true); resetForm(); }} className="rounded-lg font-sans" size="sm">
            <Plus className="w-4 h-4 mr-1" /> Add Category
          </Button>
        </div>
      </div>

      {isAddingCategory && (
        <Card className="mb-4 border-primary/20">
          <CardContent className="p-4 space-y-3">
            <Input placeholder="Category name (EN)" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <Input placeholder="Category name (BS)" value={newNameBs} onChange={(e) => setNewNameBs(e.target.value)} />
            <Input placeholder="اسم الفئة (AR)" value={newNameAr} onChange={(e) => setNewNameAr(e.target.value)} dir="rtl" />
            <div className="flex gap-2">
              <Button onClick={addCategory} size="sm" className="font-sans">Save</Button>
              <Button onClick={() => setIsAddingCategory(false)} variant="outline" size="sm" className="font-sans">Cancel</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {categories.map((cat) => (
          <Card key={cat.id} className="border-border">
            <div
              className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => setExpandedCategory(expandedCategory === cat.id ? null : cat.id)}
            >
              <div className="flex items-center gap-2">
                {expandedCategory === cat.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span className="font-serif font-semibold text-foreground">{cat.name}</span>
                {cat.name_bs && <span className="text-xs text-muted-foreground">({cat.name_bs})</span>}
                {cat.name_ar && <span className="text-xs text-muted-foreground" dir="rtl">{cat.name_ar}</span>}
                <span className="text-xs text-muted-foreground ml-2">{cat.subcategories?.length || 0} subcategories</span>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); setIsAddingSubcategory(cat.id); resetForm(); }}>
                  <Plus className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); deleteItem('categories', cat.id); }}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>

            {expandedCategory === cat.id && (
              <div className="px-4 pb-4 space-y-2">
                {isAddingSubcategory === cat.id && (
                  <div className="p-3 bg-muted rounded-lg space-y-2">
                    <Input placeholder="Subcategory name (EN)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                    <Input placeholder="Subcategory name (BS)" value={newNameBs} onChange={(e) => setNewNameBs(e.target.value)} />
                    <Input placeholder="اسم الفئة الفرعية (AR)" value={newNameAr} onChange={(e) => setNewNameAr(e.target.value)} dir="rtl" />
                    <div className="flex gap-2">
                      <Button onClick={() => addSubcategory(cat.id)} size="sm" className="font-sans">Save</Button>
                      <Button onClick={() => setIsAddingSubcategory(null)} variant="outline" size="sm" className="font-sans">Cancel</Button>
                    </div>
                  </div>
                )}

                {cat.subcategories?.map((sub: any) => (
                  <div key={sub.id} className="border border-border rounded-lg">
                    <div
                      className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/30"
                      onClick={() => setExpandedSubcategory(expandedSubcategory === sub.id ? null : sub.id)}
                    >
                      <div className="flex items-center gap-2">
                        {expandedSubcategory === sub.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                        <span className="text-sm font-sans font-medium text-foreground">{sub.name}</span>
                        {sub.name_ar && <span className="text-xs text-muted-foreground" dir="rtl">{sub.name_ar}</span>}
                        <span className="text-xs text-muted-foreground">{sub.menu_items?.length || 0} items</span>
                      </div>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setIsAddingItem(sub.id); resetForm(); }}>
                          <Plus className="w-3 h-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); deleteItem('subcategories', sub.id); }}>
                          <Trash2 className="w-3 h-3 text-destructive" />
                        </Button>
                      </div>
                    </div>

                    {expandedSubcategory === sub.id && (
                      <div className="px-3 pb-3 space-y-2">
                        {isAddingItem === sub.id && (
                          <div className="p-3 bg-muted rounded-lg space-y-2">
                            <Input placeholder="Item name (EN)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                            <Input placeholder="Naziv stavke (BS)" value={newNameBs} onChange={(e) => setNewNameBs(e.target.value)} />
                            <Input placeholder="اسم العنصر (AR)" value={newNameAr} onChange={(e) => setNewNameAr(e.target.value)} dir="rtl" />
                            <Textarea placeholder="Description" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} rows={2} />
                            <Input placeholder="Price (KM)" type="number" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
                            <Input placeholder="Image URL" value={newImageUrl} onChange={(e) => setNewImageUrl(e.target.value)} />
                            <div className="flex gap-2">
                              <Button onClick={() => addMenuItem(sub.id)} size="sm" className="font-sans">Save</Button>
                              <Button onClick={() => setIsAddingItem(null)} variant="outline" size="sm" className="font-sans">Cancel</Button>
                            </div>
                          </div>
                        )}

                        {sub.menu_items?.map((item: any) => (
                          <div key={item.id} className="flex items-center justify-between py-2 px-2 rounded-lg hover:bg-muted/30">
                            <div className="flex items-center gap-3">
                              {item.image_url && (
                                <img src={item.image_url} alt={item.name} className="w-10 h-10 rounded-lg object-cover" />
                              )}
                              <div>
                                <p className="text-sm font-sans font-medium text-foreground">{item.name}</p>
                                {item.name_ar && <p className="text-xs text-muted-foreground" dir="rtl">{item.name_ar}</p>}
                                <p className="text-xs text-muted-foreground">{Number(item.price).toFixed(2)} KM</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Switch checked={item.is_available} onCheckedChange={() => toggleAvailability(item.id, item.is_available)} />
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => deleteItem('menu_items', item.id)}>
                                <Trash2 className="w-3 h-3 text-destructive" />
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
};

export default AdminMenu;
