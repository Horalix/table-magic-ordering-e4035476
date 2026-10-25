-- =====================================================================
-- Menu translations: a native-speaker pass over Bosnian and Arabic
--
-- English stays the source of truth and is not touched here. Every Bosnian
-- and Arabic name and description on the live menu (snapshot of 25 October
-- 2026) was reviewed; this file carries only the fields that change, plus the
-- one item that had no translation at all (Original Cheese Fries).
--
-- House style the corrections follow:
--   Bosnian  ijekavica as spoken in Sarajevo (kafa, hljeb, mlijeko, narandža,
--            sos), sentence case, no English words except real product names
--            (Espresso, Cappuccino, Mojito, Cold Brew, V60, Coca-Cola ...).
--            Burger buns are "pecivo", patties "juneća pljeskavica".
--   Arabic   Modern Standard Arabic as on Gulf/Levant cafe menus, Latin digits,
--            prices in KM like the rest of the app, برجر / إسبريسو / كابتشينو
--            / لاتيه / موهيتو / ماتشا / فرابيه / بودينغ everywhere, poached egg
--            بيضة بوشيه (not boiled), iceberg آيسبرغ (not romaine).
--   Diet     nuts, margarine, eggs, peanut and "non-alcoholic" facts kept or
--            made explicit; nothing added that the English does not say.
--
-- THE GUARD. Every UPDATE changes one field of one row and only fires while
-- that field still holds exactly the text the live menu had when this file
-- was written:
--
--     ... WHERE id = '<id>' AND name_bs IS NOT DISTINCT FROM $old$<old text>$old$
--
-- so anything the owner has edited by hand in Admin -> Menu since then is
-- left alone, and an edit to one field never blocks the others.
--
-- SAFE TO RE-RUN. A second run matches nothing (the old text is gone) and
-- changes nothing. The DO block at the end counts every intended value that
-- is not in the database afterwards and reports it with RAISE NOTICE only;
-- it never raises an exception.
--
-- Also here: public.menu_machine_translations, which lets the translate-menu
-- edge function tell its own output apart from a human's, so "Re-translate
-- All" refreshes only what the machine wrote (see the function).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. What the AI translator last wrote, per field
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.menu_machine_translations (
  source_table text NOT NULL CHECK (source_table IN ('categories', 'subcategories', 'menu_items')),
  row_id uuid NOT NULL,
  field text NOT NULL CHECK (field IN ('name_bs', 'name_ar', 'description_bs', 'description_ar')),
  value text NOT NULL,
  produced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_table, row_id, field)
);

-- Access first, then row level security (Supabase no longer grants new
-- tables to the API roles by default).
REVOKE ALL ON public.menu_machine_translations FROM PUBLIC, anon, authenticated;
-- Only the translate-menu Edge Function (server role) reads and writes it.
GRANT ALL ON public.menu_machine_translations TO service_role;

COMMENT ON TABLE public.menu_machine_translations IS
  'The value the translate-menu edge function last wrote into a translation '
  'field. A field whose live value still equals this is machine output and may '
  'be refreshed by a forced re-translate; any other non-empty value was edited '
  'by a person and is kept. Written only by the service role.';

ALTER TABLE public.menu_machine_translations ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. Categories and subcategories
-- ---------------------------------------------------------------------
-- Category: Food
UPDATE public.categories SET name_ar = $new$مأكولات$new$
 WHERE id = '30f16ea1-33e6-4509-b1fc-1501a6865e7f' AND name_ar IS NOT DISTINCT FROM $old$طعام$old$;
-- Category: Desserts
UPDATE public.categories SET name_bs = $new$Deserti$new$
 WHERE id = '0c8e2f72-3b73-4191-ba90-2e62b4dacd69' AND name_bs IS NOT DISTINCT FROM $old$Desert$old$;
-- Subcategory: Desserts
UPDATE public.subcategories SET name_bs = $new$Deserti$new$
 WHERE id = '306f4bdf-695b-446f-b0fd-e3547e8fb6a0' AND name_bs IS NOT DISTINCT FROM $old$Desert$old$;
-- Subcategory: Filter Coffee
UPDATE public.subcategories SET name_bs = $new$Filter kafa$new$
 WHERE id = 'b74b1d73-949b-4c35-9e54-c231da731801' AND name_bs IS NOT DISTINCT FROM $old$Filter Kafa$old$;
-- Subcategory: Iced Coffee
UPDATE public.subcategories SET name_bs = $new$Ledena kafa$new$
 WHERE id = '06550caf-be24-4686-9f35-7e62d712ec44' AND name_bs IS NOT DISTINCT FROM $old$Ledene Kafe$old$;
-- Subcategory: Hot Drinks
UPDATE public.subcategories SET name_bs = $new$Topli napici$new$
 WHERE id = 'e3fe5627-f5de-44d7-aefb-a68f8327f362' AND name_bs IS NOT DISTINCT FROM $old$Topla Pića$old$;
-- Subcategory: Special Drinks
UPDATE public.subcategories SET name_bs = $new$Specijalni napici$new$
 WHERE id = '87029c90-d23c-4dcb-b61b-525158bba4b9' AND name_bs IS NOT DISTINCT FROM $old$Specijalna Pića$old$;
-- Subcategory: Special Drinks
UPDATE public.subcategories SET name_ar = $new$مشروبات مميزة$new$
 WHERE id = '87029c90-d23c-4dcb-b61b-525158bba4b9' AND name_ar IS NOT DISTINCT FROM $old$مشروبات خاصة$old$;
-- Subcategory: Iced Tea
UPDATE public.subcategories SET name_bs = $new$Ledeni čaj$new$
 WHERE id = 'f34928f6-ffcc-4e86-9bd2-4044f241b834' AND name_bs IS NOT DISTINCT FROM $old$Ledeni Čaj$old$;
-- Subcategory: Fresh Juice
UPDATE public.subcategories SET name_bs = $new$Svježi sokovi$new$
 WHERE id = '825a9595-62a2-4ac7-a423-1978077cfa4d' AND name_bs IS NOT DISTINCT FROM $old$Svježi Sokovi$old$;
-- Subcategory: Fresh Juice
UPDATE public.subcategories SET name_ar = $new$عصائر طازجة$new$
 WHERE id = '825a9595-62a2-4ac7-a423-1978077cfa4d' AND name_ar IS NOT DISTINCT FROM $old$عصير طازج$old$;
-- Subcategory: Lemonade
UPDATE public.subcategories SET name_ar = $new$ليمونادة$new$
 WHERE id = 'a5dd9e6f-df5c-47f2-95c6-6b0d880749e7' AND name_ar IS NOT DISTINCT FROM $old$عصير الليمون$old$;
-- Subcategory: Breakfast
UPDATE public.subcategories SET name_ar = $new$فطور$new$
 WHERE id = 'b5528d1e-d540-4895-af4d-737cd71c533e' AND name_ar IS NOT DISTINCT FROM $old$إفطار$old$;
-- Subcategory: Appetizer
UPDATE public.subcategories SET name_bs = $new$Predjela$new$
 WHERE id = '3a8c9eef-ba95-425b-af01-879f0ad6eb83' AND name_bs IS NOT DISTINCT FROM $old$Predjelo$old$;
-- Subcategory: Sliders
UPDATE public.subcategories SET name_bs = $new$Slideri$new$
 WHERE id = '3e1d618b-ea9a-4d38-b235-7cb7408eb165' AND name_bs IS NOT DISTINCT FROM $old$Sliders$old$;
-- Subcategory: Risotto
UPDATE public.subcategories SET name_bs = $new$Rižoto$new$
 WHERE id = '0d2bf0db-3d84-4f63-ad2c-a3b7f3a8b25f' AND name_bs IS NOT DISTINCT FROM $old$Risotto$old$;

-- ---------------------------------------------------------------------
-- 3. Menu items, by subcategory
-- ---------------------------------------------------------------------

-- ===== Coffee
-- Americano
UPDATE public.menu_items SET description_bs = $new$Jednostavan, a snažan: Americano je espresso razrijeđen vrućom vodom, za bogat okus kafe.$new$, updated_at = now()
 WHERE id = '19828d06-5910-45eb-9744-27df058c99ed' AND description_bs IS NOT DISTINCT FROM $old$Jednostavan, a ipak snažan, Americano je espresso razrijeđen vrućom vodom, pružajući bogato iskustvo kave.$old$;
UPDATE public.menu_items SET description_ar = $new$بسيط وقوي: الأمريكانو إسبريسو مخفف بالماء الساخن، لتجربة قهوة غنية.$new$, updated_at = now()
 WHERE id = '19828d06-5910-45eb-9744-27df058c99ed' AND description_ar IS NOT DISTINCT FROM $old$بسيط وقوي، الأمريكانو هو إسبريسو مخفف بالماء الساخن، يقدم تجربة قهوة غنية.$old$;
-- Cappucino
UPDATE public.menu_items SET name_bs = $new$Cappuccino$new$, updated_at = now()
 WHERE id = '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62' AND name_bs IS NOT DISTINCT FROM $old$Cappucino$old$;
UPDATE public.menu_items SET description_bs = $new$Italijanski klasik: Cappuccino je espresso s obiljem mliječne pjene, idealan za početak dana.$new$, updated_at = now()
 WHERE id = '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62' AND description_bs IS NOT DISTINCT FROM $old$Klasik italijanske kuhinje, Cappucino je espresso sa izdašnom količinom pjenastog mlijeka, idealan za početak dana.$old$;
UPDATE public.menu_items SET description_ar = $new$كلاسيكية إيطالية: الكابتشينو إسبريسو مع وفرة من رغوة الحليب، مثالي لبداية اليوم.$new$, updated_at = now()
 WHERE id = '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62' AND description_ar IS NOT DISTINCT FROM $old$كلاسيكي من المطبخ الإيطالي، الكابتشينو هو إسبريسو مع كمية وفيرة من الحليب المخفوق، مثالي لبدء اليوم.$old$;
-- Cortado
UPDATE public.menu_items SET description_ar = $new$قهوة إسبريسو قوية مع قليل من رغوة الحليب، تجربة غنية لعشاق القهوة.$new$, updated_at = now()
 WHERE id = '27d8a2e7-3aa0-495e-ac7e-96dd2efd2c4e' AND description_ar IS NOT DISTINCT FROM $old$قهوة إسبريسو قوية مع كمية صغيرة من رغوة الحليب، كورتادو هي تجربة مكثفة لمحبي القهوة.$old$;
-- Double Espresso
UPDATE public.menu_items SET description_ar = $new$إسبريسو حقيقي في أنقى صوره، بنكهة نقية ومركّزة.$new$, updated_at = now()
 WHERE id = '445a26ba-ee0e-4008-97d2-74c88ba58be8' AND description_ar IS NOT DISTINCT FROM $old$قهوة إسبريسو حقيقية في أنقى صورها، الإسبريسو هو انفجار خالص ومركز من النكهة.$old$;
-- Espresso
UPDATE public.menu_items SET description_ar = $new$إسبريسو حقيقي في أنقى صوره: الإسبريسو السولو نكهة نقية ومركّزة.$new$, updated_at = now()
 WHERE id = '6d045710-1c52-4676-8a29-8c1df58b07f5' AND description_ar IS NOT DISTINCT FROM $old$قهوة إسبريسو حقيقية في أنقى صورها، إسبريسو سولو هو انفجار خالص ومركز من النكهة.$old$;
-- Flat White
UPDATE public.menu_items SET description_ar = $new$بسيط وأنيق: إسبريسو بنسبة متساوية من الحليب، لقهوة كريمية ومتوازنة.$new$, updated_at = now()
 WHERE id = '9eead00b-463c-40f0-9529-9e5b36ced112' AND description_ar IS NOT DISTINCT FROM $old$بسيط وأنيق، فلات وايت هو إسبريسو بنسبة متساوية من الحليب، مما يخلق قهوة كريمية ومتوازنة.$old$;
-- Piccolo
UPDATE public.menu_items SET name_ar = $new$بيكولو$new$, updated_at = now()
 WHERE id = '1c6f552e-0a8e-48d4-9bbf-c2b092e85198' AND name_ar IS NOT DISTINCT FROM $old$بيكو$old$;
UPDATE public.menu_items SET description_bs = $new$Mali, ali moćan: Piccolo je espresso s vrlo malo mliječne pjene i snažnim okusom.$new$, updated_at = now()
 WHERE id = '1c6f552e-0a8e-48d4-9bbf-c2b092e85198' AND description_bs IS NOT DISTINCT FROM $old$Mali, ali moćan, Piccolo je espresso sa minimalnom količinom mliječne pjene, nudeći snažan udarac okusa.$old$;
UPDATE public.menu_items SET description_ar = $new$صغير لكنه قوي: البيكولو إسبريسو مع قليل من رغوة الحليب، بنكهة قوية ومركّزة.$new$, updated_at = now()
 WHERE id = '1c6f552e-0a8e-48d4-9bbf-c2b092e85198' AND description_ar IS NOT DISTINCT FROM $old$صغير ولكنه قوي، بيكو هو إسبريسو مع أقل كمية من رغوة الحليب، يقدم نكهة قوية.$old$;
-- Spanish Cortado
UPDATE public.menu_items SET description_bs = $new$Intenzivna espresso kafa s malo vrućeg mlijeka; španski cortado je savršen izbor za ljubitelje jakog okusa kafe.$new$, updated_at = now()
 WHERE id = 'd4322b5b-0c65-409e-9783-a834c6a641a3' AND description_bs IS NOT DISTINCT FROM $old$Intenzivna espresso kafa sa malom količinom vrućeg mlijeka, Španski Cortado je savršen izbor za ljubitelje jakog okusa kafe.$old$;
-- Spanish Latte
UPDATE public.menu_items SET description_bs = $new$Kremasti latte sa slatkom mliječnom pjenom, za bogat okus kafe s daškom slatkoće.$new$, updated_at = now()
 WHERE id = 'df6a0352-89e5-4be6-8694-79fe8a6ac5bf' AND description_bs IS NOT DISTINCT FROM $old$Kremasti latte sa malo slatke mliječne pjene, pružajući bogato iskustvo kave sa daškom slatkoće.$old$;

-- ===== Filter Coffee
-- Arabic Coffee Black
UPDATE public.menu_items SET name_bs = $new$Crna arapska kafa$new$, updated_at = now()
 WHERE id = 'e6735123-1371-48fd-90f8-7d447995569b' AND name_bs IS NOT DISTINCT FROM $old$Arapska Kafa Crna$old$;
-- Arabic Coffee White
UPDATE public.menu_items SET name_bs = $new$Bijela arapska kafa$new$, updated_at = now()
 WHERE id = '0122746a-5148-4b26-a897-b032c91f8c72' AND name_bs IS NOT DISTINCT FROM $old$Arapska Kafa Bijela$old$;
-- Cold Brew
UPDATE public.menu_items SET name_bs = $new$Cold Brew$new$, updated_at = now()
 WHERE id = 'eac83ec6-f2d4-4630-ad80-0e8678d43ba9' AND name_bs IS NOT DISTINCT FROM $old$Hladna Kafa$old$;
-- V60 Cold
UPDATE public.menu_items SET name_bs = $new$V60 hladni$new$, updated_at = now()
 WHERE id = '0dbec3fe-d56c-4c73-a57f-3845bf2c21bf' AND name_bs IS NOT DISTINCT FROM $old$V60 Hladan$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajuća hladna kafa pripremljena V60 metodom, glatkog i bogatog okusa s blagim notama kiselosti.$new$, updated_at = now()
 WHERE id = '0dbec3fe-d56c-4c73-a57f-3845bf2c21bf' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajuća hladna kafa pripremljena V60 metodom, rezultira glatkim i bogatim profilom okusa sa suptilnim notama kiselosti.$old$;
-- V60 Hot
UPDATE public.menu_items SET name_bs = $new$V60 topli$new$, updated_at = now()
 WHERE id = 'f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb' AND name_bs IS NOT DISTINCT FROM $old$V60 Vruć$old$;
UPDATE public.menu_items SET description_bs = $new$Klasična topla kafa pripremljena V60 metodom, koja ističe složene okuse i arome zrna, s čistim završetkom.$new$, updated_at = now()
 WHERE id = 'f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb' AND description_bs IS NOT DISTINCT FROM $old$Klasična topla kafa pripremljena V60 metodom, izdvaja složene okuse i arome zrna sa čistim završetkom.$old$;
UPDATE public.menu_items SET description_ar = $new$قهوة ساخنة كلاسيكية محضّرة بطريقة V60، تُبرز نكهات الحبوب وروائحها الغنية بمذاق نهائي صافٍ.$new$, updated_at = now()
 WHERE id = 'f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb' AND description_ar IS NOT DISTINCT FROM $old$قهوة كلاسيكية محضرة ساخنة باستخدام طريقة V60، تبرز النكهات والروائح المعقدة للحبوب بلمسة نهائية نظيفة.$old$;

-- ===== Iced Coffee
-- Iced Americano
UPDATE public.menu_items SET description_ar = $new$بارد ومنعش، الأمريكانو المثلج مشروب بسيط وقوي يوقظ حواسك.$new$, updated_at = now()
 WHERE id = '7f63e56c-50f8-4600-9cdb-a480aad579dc' AND description_ar IS NOT DISTINCT FROM $old$بارد ومنعش، أمريكانو مثلج هو مشروب بسيط ولكنه مكثف يوقظ حواسك.$old$;
-- Iced Caramel Macchiato
UPDATE public.menu_items SET name_ar = $new$كراميل ماكياتو مثلج$new$, updated_at = now()
 WHERE id = 'a30ba69b-77b1-4b4f-8850-a47094a0fe06' AND name_ar IS NOT DISTINCT FROM $old$ماكياتو الكراميل المثلج$old$;
UPDATE public.menu_items SET description_bs = $new$Sladak i osvježavajući, ledeni caramel macchiato savršen je spoj kafe, mlijeka i slatkog karamela.$new$, updated_at = now()
 WHERE id = 'a30ba69b-77b1-4b4f-8850-a47094a0fe06' AND description_bs IS NOT DISTINCT FROM $old$Slatki i osvježavajući, ledeni karamel Macchiato je savršena kombinacija kafe, mlijeka i slatkog karamela.$old$;
UPDATE public.menu_items SET description_ar = $new$حلو ومنعش، الكراميل ماكياتو المثلج مزيج مثالي من القهوة والحليب والكراميل الحلو.$new$, updated_at = now()
 WHERE id = 'a30ba69b-77b1-4b4f-8850-a47094a0fe06' AND description_ar IS NOT DISTINCT FROM $old$حلو ومنعش، ماكياتو الكراميل المثلج هو المزيج المثالي من القهوة والحليب والكراميل الحلو.$old$;
-- Iced Rose Latte
UPDATE public.menu_items SET name_bs = $new$Ledeni Latte s ružom$new$, updated_at = now()
 WHERE id = '05fbb7cb-31d7-4384-8e55-b3a198e0fd22' AND name_bs IS NOT DISTINCT FROM $old$Ledeni Rose Latte$old$;
-- Iced Spanish Latte
UPDATE public.menu_items SET name_bs = $new$Ledeni španski Latte$new$, updated_at = now()
 WHERE id = 'eaee8853-0151-49d4-afef-3e56f7180760' AND name_bs IS NOT DISTINCT FROM $old$Ledeni Španski Latte$old$;

-- ===== Hot Drinks
-- Hot Caramel Macchiato
UPDATE public.menu_items SET name_ar = $new$كراميل ماكياتو ساخن$new$, updated_at = now()
 WHERE id = '31af65ef-f632-4a03-b557-75fca5d1ef61' AND name_ar IS NOT DISTINCT FROM $old$ماكياتو الكراميل الساخن$old$;
UPDATE public.menu_items SET description_bs = $new$Pravi se dodavanjem vanilije u espresso, zatim mliječne pjene i preljeva od karamel sosa. Karamel daje kafi sladak, karamelizovan okus.$new$, updated_at = now()
 WHERE id = '31af65ef-f632-4a03-b557-75fca5d1ef61' AND description_bs IS NOT DISTINCT FROM $old$Pravi se dodavanjem vanilije u espresso, zatim pjenastog mlijeka i preljeva od karamel sosa. Karamel dodaje sladak i karameliziran okus kafi.$old$;
UPDATE public.menu_items SET description_ar = $new$يُحضَّر بإضافة الفانيليا إلى شوت إسبريسو، ثم رغوة الحليب ورشّة من صلصة الكراميل في الأعلى. يمنح الكراميل القهوة نكهة حلوة مكرملة.$new$, updated_at = now()
 WHERE id = '31af65ef-f632-4a03-b557-75fca5d1ef61' AND description_ar IS NOT DISTINCT FROM $old$يُصنع بإضافة الفانيليا إلى جرعة من الإسبريسو، متبوعًا بالحليب الرغوي ورذاذ من صلصة الكراميل. يضيف الكراميل نكهة حلوة ومكرملة إلى القهوة.$old$;
-- Hot Chocolate
UPDATE public.menu_items SET description_bs = $new$Bogata i kremasta šoljica tople čokolade, savršena za opuštanje i slatki užitak.$new$, updated_at = now()
 WHERE id = '0f2be686-a58a-4863-bd8a-0adf997afd45' AND description_bs IS NOT DISTINCT FROM $old$Bogata i kremasta šoljica tople čokolade, savršena za opuštanje i uživanje u slatkoj udobnosti.$old$;
UPDATE public.menu_items SET description_ar = $new$كوب غني وكريمي من الشوكولاتة الساخنة، مثالي للاسترخاء والاستمتاع بلحظة دافئة وحلوة.$new$, updated_at = now()
 WHERE id = '0f2be686-a58a-4863-bd8a-0adf997afd45' AND description_ar IS NOT DISTINCT FROM $old$كوب غني وكريمي من الشوكولاتة الساخنة، مثالي للاسترخاء والاستمتاع بالراحة الحلوة.$old$;
-- Kurkum Latte
UPDATE public.menu_items SET name_ar = $new$لاتيه الكركم$new$, updated_at = now()
 WHERE id = '2ce645ad-a6f1-4e52-8f9a-3b402146a416' AND name_ar IS NOT DISTINCT FROM $old$كركم لاتيه$old$;
-- Latte/Karak Tea
UPDATE public.menu_items SET name_bs = $new$Latte/Karak čaj$new$, updated_at = now()
 WHERE id = 'ec380fef-c82a-4ed5-8411-55d7beccaefa' AND name_bs IS NOT DISTINCT FROM $old$Latte/Karak Čaj$old$;
-- Matcha Latte
UPDATE public.menu_items SET description_ar = $new$مزيج لذيذ من شاي الماتشا الأخضر والحليب الكريمي، يقدّم ماتشا لاتيه تجربة متوازنة بلمسات خفيفة من التوابل.$new$, updated_at = now()
 WHERE id = '7a8b578e-d53f-4892-bbe1-771240aed585' AND description_ar IS NOT DISTINCT FROM $old$مزيج لذيذ من شاي الماتشا الأخضر والحليب الكريمي، ماتشا لاتيه يوفر تجربة متوازنة مع نكهات حارة خفيفة.$old$;
-- Pumpkin Spice Latte
UPDATE public.menu_items SET name_bs = $new$Pumpkin Spice Latte$new$, updated_at = now()
 WHERE id = '0dc19452-4ac3-481a-867c-f2de8b70440d' AND name_bs IS NOT DISTINCT FROM $old$Latte sa začinima od bundeve$old$;
-- Rose Latte
UPDATE public.menu_items SET name_bs = $new$Latte s ružom$new$, updated_at = now()
 WHERE id = 'c139f3ad-1f5d-4e10-b649-07fdad93c457' AND name_bs IS NOT DISTINCT FROM $old$Rose Latte$old$;
-- Salted Caramel Hot Chocolate
UPDATE public.menu_items SET name_bs = $new$Topla čokolada sa slanim karamelom$new$, updated_at = now()
 WHERE id = 'f9fc6149-36ca-4a00-b5e8-85983dd12e4e' AND name_bs IS NOT DISTINCT FROM $old$Slana Karamel Topla Čokolada$old$;
UPDATE public.menu_items SET description_bs = $new$Bogata i topla čokolada sa slanim karamelom, savršen spoj slatkoće i slanoće za neodoljiv užitak.$new$, updated_at = now()
 WHERE id = 'f9fc6149-36ca-4a00-b5e8-85983dd12e4e' AND description_bs IS NOT DISTINCT FROM $old$Bogata i topla čokolada sa slanim karamelom, pružajući savršen balans slatkoće i slanoće za neodoljivu poslasticu.$old$;
UPDATE public.menu_items SET description_ar = $new$شوكولاتة غنية ودافئة بالكراميل المملح، توازن مثالي بين الحلاوة والملوحة لمتعة لا تُقاوم.$new$, updated_at = now()
 WHERE id = 'f9fc6149-36ca-4a00-b5e8-85983dd12e4e' AND description_ar IS NOT DISTINCT FROM $old$شوكولاتة غنية ودافئة بالكراميل المملح، توفر التوازن المثالي بين الحلاوة والملوحة لمعالجة لا تقاوم.$old$;

-- ===== Special Drinks
-- Affogato
UPDATE public.menu_items SET description_bs = $new$Desert inspirisan Italijom: sladoled od vanilije preliven espressom, sosom od pistaća i pistaćima.$new$, updated_at = now()
 WHERE id = '28b51e15-d230-4317-a57a-6330c5ba0623' AND description_bs IS NOT DISTINCT FROM $old$Desert inspirisan Italijom, sastoji se od sladoleda od vanilije prelivenog shotom espresso kafe, sosom od pistacija i pistaćima.$old$;
UPDATE public.menu_items SET description_ar = $new$حلوى إيطالية الطابع: آيس كريم الفانيليا يعلوه شوت إسبريسو وصلصة الفستق وحبات الفستق.$new$, updated_at = now()
 WHERE id = '28b51e15-d230-4317-a57a-6330c5ba0623' AND description_ar IS NOT DISTINCT FROM $old$حلوى مستوحاة من إيطاليا، تتكون من آيس كريم الفانيليا يعلوها شوت من قهوة الإسبريسو، صلصة الفستق والمكسرات.$old$;
-- Blue Beast
UPDATE public.menu_items SET description_bs = $new$Snažan i osvježavajući bezalkoholni koktel s plavim curaçao sirupom i energetskim pićem.$new$, updated_at = now()
 WHERE id = '0a2b9e5b-172c-45b9-a2fc-8df48a675f8c' AND description_bs IS NOT DISTINCT FROM $old$Snažan i osvježavajući koktel sa plavim curaçao i energetskim pićem.$old$;
UPDATE public.menu_items SET description_ar = $new$موكتيل خالٍ من الكحول، قوي ومنعش، بشراب البلو كوراساو ومشروب الطاقة.$new$, updated_at = now()
 WHERE id = '0a2b9e5b-172c-45b9-a2fc-8df48a675f8c' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل قوي ومنعش مع الكوراساو الأزرق ومشروب الطاقة.$old$;
-- Iced Matcha Latte
UPDATE public.menu_items SET description_ar = $new$مشروب مثلج، الخيار الأمثل لعشاق الماتشا.$new$, updated_at = now()
 WHERE id = '58009e34-157a-4e6e-9287-fb6f82e8b9da' AND description_ar IS NOT DISTINCT FROM $old$مشروب مثلج هو الخيار الأمثل لمحبي الماتشا.$old$;
-- La Soul Avo Macchiato
UPDATE public.menu_items SET name_ar = $new$أفو ماكياتو La Soul$new$, updated_at = now()
 WHERE id = 'bb021ff4-5c19-44a8-a63f-63ecc48405a9' AND name_ar IS NOT DISTINCT FROM $old$La Soul أفوماكياتو$old$;
UPDATE public.menu_items SET description_bs = $new$Ukusni frappe koji spaja kremasti avokado i kafu u savršenom skladu okusa.$new$, updated_at = now()
 WHERE id = 'bb021ff4-5c19-44a8-a63f-63ecc48405a9' AND description_bs IS NOT DISTINCT FROM $old$Ukusni Frappe koji kombinuje kremasti avokado i kafu pružajući savršenu harmoniju okusa.$old$;
-- Pina Colada
UPDATE public.menu_items SET name_ar = $new$بينا كولادا$new$, updated_at = now()
 WHERE id = 'f9a66811-55bc-4b39-9be9-cfc8606243e6' AND name_ar IS NOT DISTINCT FROM $old$ بينا كولادا$old$;
UPDATE public.menu_items SET description_bs = $new$Kremasti i osvježavajući bezalkoholni koktel s okusom ananasa i kokosa.$new$, updated_at = now()
 WHERE id = 'f9a66811-55bc-4b39-9be9-cfc8606243e6' AND description_bs IS NOT DISTINCT FROM $old$Kremasti i osvježavajući koktel s okusima ananasa i kokosa$old$;
UPDATE public.menu_items SET description_ar = $new$موكتيل كريمي ومنعش خالٍ من الكحول بنكهة الأناناس وجوز الهند.$new$, updated_at = now()
 WHERE id = 'f9a66811-55bc-4b39-9be9-cfc8606243e6' AND description_ar IS NOT DISTINCT FROM $old$ كوكتيل كريمي ومنعش بنكهات الأناناس وجوز الهند$old$;
-- Sunshine
UPDATE public.menu_items SET description_ar = $new$مشروب منعش يجمع بين عصير البرتقال والخوخ والباشن فروت.$new$, updated_at = now()
 WHERE id = 'c1242eb6-b906-41bd-b3f8-573d822352ad' AND description_ar IS NOT DISTINCT FROM $old$مشروب منعش يجمع بين عصير البرتقال والخوخ وفاكهة الباشن.$old$;
-- Virgin Sunrise
UPDATE public.menu_items SET description_bs = $new$Klasični bezalkoholni koktel od narandže, grenadina i limuna: osvježavajuća verzija originalnog koktela, bez grižnje savjesti.$new$, updated_at = now()
 WHERE id = 'a6e706ad-8e85-4c74-b1bb-c54598878ccd' AND description_bs IS NOT DISTINCT FROM $old$Klasični koktel koji kombinuje narandžu, grenadine i limun, pružajući osvježavajuće iskustvo bez krivice u poređenju sa originalnom koktel verzijom.$old$;
UPDATE public.menu_items SET description_ar = $new$موكتيل كلاسيكي خالٍ من الكحول يجمع البرتقال والغرينادين والليمون، نسخة منعشة من الكوكتيل الأصلي بلا شعور بالذنب.$new$, updated_at = now()
 WHERE id = 'a6e706ad-8e85-4c74-b1bb-c54598878ccd' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل كلاسيكي يجمع بين البرتقال، الغرينادين، والليمون يقدم تجربة منعشة خالية من الشعور بالذنب من نسخته الأصلية الكوكتيل.$old$;

-- ===== Tea
-- English Breakfast Tea
UPDATE public.menu_items SET name_bs = $new$English Breakfast čaj$new$, updated_at = now()
 WHERE id = '0cfa2bbc-a0b2-4bae-8fb8-be490990ea5f' AND name_bs IS NOT DISTINCT FROM $old$Engleski doručak čaj$old$;
UPDATE public.menu_items SET description_bs = $new$Bogat i snažan čaj punog tijela; English Breakfast je savršen izbor za energičan početak dana.$new$, updated_at = now()
 WHERE id = '0cfa2bbc-a0b2-4bae-8fb8-be490990ea5f' AND description_bs IS NOT DISTINCT FROM $old$Bogat i robustan čaj punog tijela, engleski doručak čaj je savršen izbor za energičan početak dana.$old$;
-- Hibiscus Tea
UPDATE public.menu_items SET description_ar = $new$شاي زهور الكركديه المنعش، بطعم مائل للحموضة ولون أحمر غني، مثالي للانتعاش والصحة.$new$, updated_at = now()
 WHERE id = '74d40491-629b-47e2-8aa8-9ab12a7bdc27' AND description_ar IS NOT DISTINCT FROM $old$شاي زهور الكركديه المنعش، مع طعم منعش خفيف ودرجات حمراء غنية، مثالي للانتعاش والصحة.$old$;

-- ===== Iced Tea
-- Peach Iced Tea
UPDATE public.menu_items SET description_bs = $new$Čaša ledenog čaja od breskve, bogatog voćnog okusa i osvježavajućih nota čaja, idealna za rashlađivanje tokom ljetnih vrućina.$new$, updated_at = now()
 WHERE id = '37bf2c55-d3f1-4b8f-8507-db9ae8bbd051' AND description_bs IS NOT DISTINCT FROM $old$Ledena čaša čaja od breskve, bogatog voćnog okusa i osvježavajućih nota čaja, idealan za rashlađivanje tokom ljetnih vrućina.$old$;
UPDATE public.menu_items SET description_ar = $new$كوب من شاي الخوخ المثلج بنكهة فاكهية غنية ولمسات شاي منعشة، مثالي للانتعاش في حر الصيف.$new$, updated_at = now()
 WHERE id = '37bf2c55-d3f1-4b8f-8507-db9ae8bbd051' AND description_ar IS NOT DISTINCT FROM $old$كوب مثلج من شاي الخوخ، بنكهة فاكهة غنية ونكهات شاي منعشة، مثالي للتبريد خلال حرارة الصيف.$old$;

-- ===== Fresh Juice
-- Fresh Lemon & Mint Juice
UPDATE public.menu_items SET name_bs = $new$Svježi sok od limuna i nane$new$, updated_at = now()
 WHERE id = '6407181b-495b-4a72-8c5a-92ba2a6ed742' AND name_bs IS NOT DISTINCT FROM $old$Svježi sok od limuna i mente$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajući sok od limuna i nane, savršena kombinacija za osvježenje i hidrataciju.$new$, updated_at = now()
 WHERE id = '6407181b-495b-4a72-8c5a-92ba2a6ed742' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući sok od limuna i mente, savršena kombinacija za osvježenje i hidrataciju.$old$;
-- Fresh Orange Juice
UPDATE public.menu_items SET description_bs = $new$Svježe cijeđeni sok od narandže, pun antioksidanata i vitamina C, za osvježenje i zdravlje.$new$, updated_at = now()
 WHERE id = 'b0b3385b-b5a9-420e-acf1-d7ef563df8dd' AND description_bs IS NOT DISTINCT FROM $old$Svježe cijeđeni sok od pomorandže, pun antioksidanata i vitamina C, za osvježenje i zdravlje.$old$;

-- ===== Mojito
-- Blue Ocean Mojito
UPDATE public.menu_items SET description_bs = $new$Osvježavajući koktel s nanom, limetom, šećerom, sodom i daškom plavog karambola.$new$, updated_at = now()
 WHERE id = 'fcf82ebd-8745-464e-9055-bf6d8ccb8438' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući koktel sa nanom, limetom, šećerom, sodom vodom i daškom plavog karambola.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل منعش بالنعناع والليمون الأخضر والسكر والصودا، مع لمسة من فاكهة النجمة الزرقاء.$new$, updated_at = now()
 WHERE id = 'fcf82ebd-8745-464e-9055-bf6d8ccb8438' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل منعش بالنعناع، الليمون، السكر، مياه الصودا، ورشة من فاكهة النجمة الزرقاء.$old$;
-- Classic Mojito
UPDATE public.menu_items SET description_bs = $new$Klasični koktel s nanom, limetom, šećerom i sodom.$new$, updated_at = now()
 WHERE id = 'f14ddc91-1fc8-4885-b7d2-9071c935add6' AND description_bs IS NOT DISTINCT FROM $old$Klasični koktel sa nanom, limetom, šećerom, sodom vodom.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل كلاسيكي بالنعناع والليمون الأخضر والسكر والصودا.$new$, updated_at = now()
 WHERE id = 'f14ddc91-1fc8-4885-b7d2-9071c935add6' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل كلاسيكي بالنعناع، الليمون، السكر، مياه الصودا.$old$;
-- Mango Mojito
UPDATE public.menu_items SET description_bs = $new$Osvježavajući koktel sa svježim mangom, nanom, limetom, šećerom i daškom sode.$new$, updated_at = now()
 WHERE id = 'cc4bcd04-5a83-4d02-8f72-113ff99c62e8' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući koktel sa svježim mangom, nanom, limetom, šećerom i daškom sode vode.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل منعش بالمانجو الطازج والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$new$, updated_at = now()
 WHERE id = 'cc4bcd04-5a83-4d02-8f72-113ff99c62e8' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل منعش بالمانجو الطازج، النعناع، الليمون، السكر، ورشة من مياه الصودا.$old$;
-- Passion Fruit Mojito
UPDATE public.menu_items SET name_ar = $new$موهيتو باشن فروت$new$, updated_at = now()
 WHERE id = '47b69d62-42c5-45f7-8f29-f78541207f1c' AND name_ar IS NOT DISTINCT FROM $old$موهيتو فاكهة الباشن$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajući koktel sa sokom od marakuje, nanom, limetom, šećerom i daškom sode.$new$, updated_at = now()
 WHERE id = '47b69d62-42c5-45f7-8f29-f78541207f1c' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući koktel sa sokom od marakuje, nanom, limetom, šećerom i daškom sode vode.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل منعش بعصير الباشن فروت والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$new$, updated_at = now()
 WHERE id = '47b69d62-42c5-45f7-8f29-f78541207f1c' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل منعش بعصير فاكهة الباشن، النعناع، الليمون، السكر، ورشة من مياه الصودا.$old$;
-- Peach Mojito
UPDATE public.menu_items SET description_bs = $new$Osvježavajući koktel sa svježim breskvama, nanom, limetom, šećerom i daškom sode.$new$, updated_at = now()
 WHERE id = 'd56f5cac-825a-4bae-b406-e4f4776ad751' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući koktel sa svježim breskvama, nanom, limetom, šećerom i daškom sode vode.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل منعش بالخوخ الطازج والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$new$, updated_at = now()
 WHERE id = 'd56f5cac-825a-4bae-b406-e4f4776ad751' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل منعش بالخوخ الطازج، النعناع، الليمون، السكر، ورشة من مياه الصودا.$old$;
-- Raspberry Mojito
UPDATE public.menu_items SET description_bs = $new$Osvježavajući koktel sa svježim malinama, nanom, limetom, šećerom i daškom sode.$new$, updated_at = now()
 WHERE id = '1d36f430-a209-459d-a0c5-bb18a2a2f85b' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući koktel sa svježim malinama, nanom, limetom, šećerom i daškom sode vode.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل منعش بتوت العليق الطازج والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$new$, updated_at = now()
 WHERE id = '1d36f430-a209-459d-a0c5-bb18a2a2f85b' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل منعش بتوت العليق الطازج، النعناع، الليمون، السكر، ورشة من مياه الصودا.$old$;
-- Strawberry Mojito
UPDATE public.menu_items SET description_bs = $new$Osvježavajući koktel sa svježim jagodama, nanom, limetom, šećerom i daškom sode.$new$, updated_at = now()
 WHERE id = 'f5adc58c-ab5e-4b9f-8a99-9678d9b00f67' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući koktel sa svježim jagodama, nanom, limetom, šećerom i daškom sode vode.$old$;
UPDATE public.menu_items SET description_ar = $new$كوكتيل منعش بالفراولة الطازجة والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$new$, updated_at = now()
 WHERE id = 'f5adc58c-ab5e-4b9f-8a99-9678d9b00f67' AND description_ar IS NOT DISTINCT FROM $old$كوكتيل منعش بالفراولة الطازجة، النعناع، الليمون، السكر، ورشة من مياه الصودا.$old$;

-- ===== Frappe
-- Choco Chip Frappe
UPDATE public.menu_items SET name_bs = $new$Frappe s komadićima čokolade$new$, updated_at = now()
 WHERE id = '3a482a88-6646-48b8-927a-1bd3bca6749c' AND name_bs IS NOT DISTINCT FROM $old$Frape sa čoko čipsom$old$;
UPDATE public.menu_items SET name_ar = $new$فرابيه بقطع الشوكولاتة$new$, updated_at = now()
 WHERE id = '3a482a88-6646-48b8-927a-1bd3bca6749c' AND name_ar IS NOT DISTINCT FROM $old$فرابيه بالشوكلت شيبس$old$;
UPDATE public.menu_items SET description_bs = $new$Uživajte u osvježavajućem frappeu s komadićima čokolade i kafom.$new$, updated_at = now()
 WHERE id = '3a482a88-6646-48b8-927a-1bd3bca6749c' AND description_bs IS NOT DISTINCT FROM $old$Uživajte u osvježavajućem frapeu sa čokoladnim komadićima i kafom.$old$;
UPDATE public.menu_items SET description_ar = $new$استمتع بفرابيه منعش بقطع الشوكولاتة والقهوة.$new$, updated_at = now()
 WHERE id = '3a482a88-6646-48b8-927a-1bd3bca6749c' AND description_ar IS NOT DISTINCT FROM $old$استمتع بفرابيه منعش مع رقائق الشوكولاتة والقهوة.$old$;
-- Classic Coffee Frappe
UPDATE public.menu_items SET name_bs = $new$Klasični Frappe od kafe$new$, updated_at = now()
 WHERE id = 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8' AND name_bs IS NOT DISTINCT FROM $old$Klasični Frape od Kafe$old$;
UPDATE public.menu_items SET name_ar = $new$فرابيه القهوة الكلاسيكي$new$, updated_at = now()
 WHERE id = 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8' AND name_ar IS NOT DISTINCT FROM $old$عصير قهوة فرابيه كلاسيك$old$;
UPDATE public.menu_items SET description_bs = $new$Bezvremenski favorit: bogata kafa, kremasto mlijeko i led, za glatko piće koje prija.$new$, updated_at = now()
 WHERE id = 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8' AND description_bs IS NOT DISTINCT FROM $old$Bezvemenski favorit, miješa bogatu kafu sa kremastim mlijekom i ledom, stvarajući glatko i zadovoljavajuće piće.$old$;
UPDATE public.menu_items SET description_ar = $new$المفضّل الدائم: قهوة غنية مع حليب كريمي وثلج، لمشروب ناعم ولذيذ.$new$, updated_at = now()
 WHERE id = 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8' AND description_ar IS NOT DISTINCT FROM $old$مفضل دائم، يمزج القهوة الغنية مع الحليب الكريمي والثلج، مما يخلق مشروبًا ناعمًا ومرضيًا.$old$;
-- Dark Mocha Frappe
UPDATE public.menu_items SET name_bs = $new$Tamni Mocha Frappe$new$, updated_at = now()
 WHERE id = '7e28193d-d487-46dd-8ef4-837685e62436' AND name_bs IS NOT DISTINCT FROM $old$Tamna Moka Frappe$old$;
UPDATE public.menu_items SET name_ar = $new$فرابيه الموكا الداكنة$new$, updated_at = now()
 WHERE id = '7e28193d-d487-46dd-8ef4-837685e62436' AND name_ar IS NOT DISTINCT FROM $old$موكا فرابيه داكنة$old$;
UPDATE public.menu_items SET description_bs = $new$Prepustite se raskoši tamnog mocha frappea: intenzivna čokolada i espresso za luksuzan užitak.$new$, updated_at = now()
 WHERE id = '7e28193d-d487-46dd-8ef4-837685e62436' AND description_bs IS NOT DISTINCT FROM $old$Prepustite se dekadenciji tamne moka frappe, kombinujući intenzivnu čokoladu sa espressom za luksuznu poslasticu.$old$;
UPDATE public.menu_items SET description_ar = $new$استمتع بفخامة فرابيه الموكا الداكنة، حيث تلتقي الشوكولاتة الغنية بالإسبريسو في متعة فاخرة.$new$, updated_at = now()
 WHERE id = '7e28193d-d487-46dd-8ef4-837685e62436' AND description_ar IS NOT DISTINCT FROM $old$استمتع بفخامة موكا فرابيه الداكنة، التي تجمع بين الشوكولاتة المكثفة والإسبريسو لتجربة فاخرة.$old$;
-- Nutella Frappe
UPDATE public.menu_items SET name_ar = $new$فرابيه نوتيلا$new$, updated_at = now()
 WHERE id = '3a894e38-b044-484a-b048-6fc8497d993c' AND name_ar IS NOT DISTINCT FROM $old$نوتيلا فرابيه$old$;
UPDATE public.menu_items SET description_bs = $new$Uživajte u osvježavajućem frappeu s bogatim okusom Nutelle, savršenom izboru za sve ljubitelje čokolade.$new$, updated_at = now()
 WHERE id = '3a894e38-b044-484a-b048-6fc8497d993c' AND description_bs IS NOT DISTINCT FROM $old$Uživajte u osvježavajućem frapeu sa bogatim okusom Nutelle, savršen izbor za sve ljubitelje čokolade.$old$;
-- Oreo Frappe
UPDATE public.menu_items SET name_ar = $new$فرابيه أوريو$new$, updated_at = now()
 WHERE id = '8527671f-2a25-4b06-92db-2bef34b5578a' AND name_ar IS NOT DISTINCT FROM $old$أوريو فرابيه$old$;
UPDATE public.menu_items SET description_bs = $new$Prepustite se osvježavajućem frappeu s komadićima Oreo keksa i daškom tamne čokolade.$new$, updated_at = now()
 WHERE id = '8527671f-2a25-4b06-92db-2bef34b5578a' AND description_bs IS NOT DISTINCT FROM $old$Prepustite se osvježavajućem frapeu sa komadićima Oreo keksa i daškom tamne čokolade.$old$;
UPDATE public.menu_items SET description_ar = $new$استمتع بفرابيه منعش مع قطع بسكويت أوريو ولمسة من الشوكولاتة الداكنة.$new$, updated_at = now()
 WHERE id = '8527671f-2a25-4b06-92db-2bef34b5578a' AND description_ar IS NOT DISTINCT FROM $old$استمتع بفرابيه منعش مع قطع كعكة أوريو ورشة من الشوكولاتة الداكنة.$old$;
-- Pistachio Frappe
UPDATE public.menu_items SET name_bs = $new$Frappe od pistaća$new$, updated_at = now()
 WHERE id = '9df37a24-15e2-4b11-ad52-e771713465a8' AND name_bs IS NOT DISTINCT FROM $old$Pistać Frape$old$;
UPDATE public.menu_items SET name_ar = $new$فرابيه الفستق$new$, updated_at = now()
 WHERE id = '9df37a24-15e2-4b11-ad52-e771713465a8' AND name_ar IS NOT DISTINCT FROM $old$فستق فرابيه$old$;
UPDATE public.menu_items SET description_bs = $new$Uživajte u osvježavajućem frappeu s bogatim okusom pistaća, savršenom izboru za one koji vole nešto drugačije.$new$, updated_at = now()
 WHERE id = '9df37a24-15e2-4b11-ad52-e771713465a8' AND description_bs IS NOT DISTINCT FROM $old$Uživajte u osvježavajućem frapeu sa bogatim okusom pistaća, savršen izbor za one koji vole nešto malo drugačije.$old$;
UPDATE public.menu_items SET description_ar = $new$استمتع بفرابيه منعش بنكهة الفستق الغنية، خيار مثالي لمن يحب شيئًا مختلفًا.$new$, updated_at = now()
 WHERE id = '9df37a24-15e2-4b11-ad52-e771713465a8' AND description_ar IS NOT DISTINCT FROM $old$استمتع بفرابيه منعش بنكهة الفستق الغنية، خيار مثالي لأولئك الذين يحبون شيئًا مختلفًا قليلاً.$old$;
-- Red Velvet Frappe
UPDATE public.menu_items SET name_ar = $new$فرابيه ريد فيلفيت$new$, updated_at = now()
 WHERE id = '85832ef4-2ea7-449c-bc6e-726d7be4e21b' AND name_ar IS NOT DISTINCT FROM $old$ريد فيلفيت فرابيه$old$;
UPDATE public.menu_items SET description_bs = $new$Prepustite se osvježavajućem frappeu s okusom red velveta, savršenom izboru za one koji žele slatku i kremastu poslasticu.$new$, updated_at = now()
 WHERE id = '85832ef4-2ea7-449c-bc6e-726d7be4e21b' AND description_bs IS NOT DISTINCT FROM $old$Prepustite se osvježavajućem frapeu sa okusom red velveta, savršen izbor za one koji traže slatku i kremastu poslasticu.$old$;
UPDATE public.menu_items SET description_ar = $new$استمتع بفرابيه منعش بنكهة الريد فيلفيت، خيار مثالي لمن يبحث عن متعة حلوة وكريمية.$new$, updated_at = now()
 WHERE id = '85832ef4-2ea7-449c-bc6e-726d7be4e21b' AND description_ar IS NOT DISTINCT FROM $old$استمتع بفرابيه منعش بنكهة ريد فيلفيت، خيار مثالي لأولئك الذين يبحثون عن حلوى حلوة وكريمية.$old$;
-- Strawberry Frappe
UPDATE public.menu_items SET name_bs = $new$Frappe od jagode$new$, updated_at = now()
 WHERE id = 'ab418172-5764-4920-9fe2-9fa2b0b7f58f' AND name_bs IS NOT DISTINCT FROM $old$Frape od Jagode$old$;
UPDATE public.menu_items SET name_ar = $new$فرابيه الفراولة$new$, updated_at = now()
 WHERE id = 'ab418172-5764-4920-9fe2-9fa2b0b7f58f' AND name_ar IS NOT DISTINCT FROM $old$فراولة فرابيه$old$;
UPDATE public.menu_items SET description_bs = $new$Uživajte u osvježavajućem frappeu s okusom jagode, jednostavno i bez okolišanja.$new$, updated_at = now()
 WHERE id = 'ab418172-5764-4920-9fe2-9fa2b0b7f58f' AND description_bs IS NOT DISTINCT FROM $old$Uživajte u osvježavajućem frapeu s okusom jagode, direktno na stvar.$old$;
UPDATE public.menu_items SET description_ar = $new$استمتع بفرابيه منعش بنكهة الفراولة، ببساطة ومن دون تعقيد.$new$, updated_at = now()
 WHERE id = 'ab418172-5764-4920-9fe2-9fa2b0b7f58f' AND description_ar IS NOT DISTINCT FROM $old$استمتع بفرابيه منعش بنكهة الفراولة على وجه التحديد.$old$;
-- Vanilla Frappe
UPDATE public.menu_items SET name_bs = $new$Frappe od vanilije$new$, updated_at = now()
 WHERE id = 'c75d11dc-e00d-4786-9ed6-d37877142d10' AND name_bs IS NOT DISTINCT FROM $old$Vanila Frappe$old$;
UPDATE public.menu_items SET name_ar = $new$فرابيه الفانيليا$new$, updated_at = now()
 WHERE id = 'c75d11dc-e00d-4786-9ed6-d37877142d10' AND name_ar IS NOT DISTINCT FROM $old$فانيليا فرابيه$old$;

-- ===== Lemonade
-- Passion Fruit Lemonade
UPDATE public.menu_items SET name_bs = $new$Limunada od marakuje$new$, updated_at = now()
 WHERE id = '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0' AND name_bs IS NOT DISTINCT FROM $old$Limonada od marakuje$old$;
UPDATE public.menu_items SET name_ar = $new$ليمونادة باشن فروت$new$, updated_at = now()
 WHERE id = '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0' AND name_ar IS NOT DISTINCT FROM $old$عصير الليمون بفاكهة الباشن$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajuća limunada s okusom marakuje.$new$, updated_at = now()
 WHERE id = '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajuća limonada s okusom marakuje.$old$;
UPDATE public.menu_items SET description_ar = $new$ليمونادة منعشة بنكهة الباشن فروت.$new$, updated_at = now()
 WHERE id = '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0' AND description_ar IS NOT DISTINCT FROM $old$عصير ليمون منعش بنكهة فاكهة الباشن.$old$;
-- Peach Lemonade
UPDATE public.menu_items SET name_bs = $new$Limunada od breskve$new$, updated_at = now()
 WHERE id = 'e8879448-6477-4e79-8327-b4424c2a6f8d' AND name_bs IS NOT DISTINCT FROM $old$Limonada od breskve$old$;
UPDATE public.menu_items SET name_ar = $new$ليمونادة الخوخ$new$, updated_at = now()
 WHERE id = 'e8879448-6477-4e79-8327-b4424c2a6f8d' AND name_ar IS NOT DISTINCT FROM $old$عصير الليمون بالخوخ$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajuća limunada s okusom breskve.$new$, updated_at = now()
 WHERE id = 'e8879448-6477-4e79-8327-b4424c2a6f8d' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajuća limonada s okusom breskve.$old$;
UPDATE public.menu_items SET description_ar = $new$ليمونادة منعشة بنكهة الخوخ.$new$, updated_at = now()
 WHERE id = 'e8879448-6477-4e79-8327-b4424c2a6f8d' AND description_ar IS NOT DISTINCT FROM $old$عصير ليمون منعش بنكهة الخوخ.$old$;
-- Strawberry Lemonade
UPDATE public.menu_items SET name_bs = $new$Limunada od jagode$new$, updated_at = now()
 WHERE id = 'c9a69b0a-986d-49b9-a6d9-016439c61fcb' AND name_bs IS NOT DISTINCT FROM $old$Limonada od jagode$old$;
UPDATE public.menu_items SET name_ar = $new$ليمونادة الفراولة$new$, updated_at = now()
 WHERE id = 'c9a69b0a-986d-49b9-a6d9-016439c61fcb' AND name_ar IS NOT DISTINCT FROM $old$عصير الليمون بالفراولة$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajuća limunada s okusom jagode.$new$, updated_at = now()
 WHERE id = 'c9a69b0a-986d-49b9-a6d9-016439c61fcb' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajuća limonada s okusom jagode.$old$;
UPDATE public.menu_items SET description_ar = $new$ليمونادة منعشة بنكهة الفراولة.$new$, updated_at = now()
 WHERE id = 'c9a69b0a-986d-49b9-a6d9-016439c61fcb' AND description_ar IS NOT DISTINCT FROM $old$عصير ليمون منعش بنكهة الفراولة.$old$;

-- ===== Other
-- Apple Juice
UPDATE public.menu_items SET description_bs = $new$Svjež i osvježavajući sok od jabuke, prirodno sladak i pun vitamina, idealan za osvježenje.$new$, updated_at = now()
 WHERE id = '6d75a749-8e65-442d-8b19-bca360fda7ed' AND description_bs IS NOT DISTINCT FROM $old$Svježi i hrskavi sok od jabuke, prirodno sladak i pun vitamina, idealan za osvježavajući napitak.$old$;
-- Sparkling Water
UPDATE public.menu_items SET name_bs = $new$Gazirana voda$new$, updated_at = now()
 WHERE id = 'bea1b69f-43c7-4ec4-b937-b53fcf4646d7' AND name_bs IS NOT DISTINCT FROM $old$Mineralna voda$old$;
-- Strawberry Juice
UPDATE public.menu_items SET description_ar = $new$عصير فراولة حلو، مليء بنكهة الفاكهة وحلاوتها الطبيعية، مثالي كمشروب منعش.$new$, updated_at = now()
 WHERE id = 'aa5ababb-c156-436b-a00a-5763c69d2471' AND description_ar IS NOT DISTINCT FROM $old$عصير فراولة حلو، مليء بنكهة الفاكهة وحلاوة طبيعية، مثالي لمعاملة منعشة.$old$;
-- Vitamin Mix
UPDATE public.menu_items SET name_bs = $new$Vitaminski miks$new$, updated_at = now()
 WHERE id = '2f963530-da9a-4b57-9046-9bfa137258ca' AND name_bs IS NOT DISTINCT FROM $old$Vitamin miks$old$;
UPDATE public.menu_items SET description_bs = $new$Osvježavajući vitaminski sok, mješavina svježeg voća punog vitamina i hranjivih sastojaka za zdrav podsticaj.$new$, updated_at = now()
 WHERE id = '2f963530-da9a-4b57-9046-9bfa137258ca' AND description_bs IS NOT DISTINCT FROM $old$Osvježavajući sok sa mješavinom vitamina, kombinacija svježeg voća punog vitamina i hranjivih tvari za zdrav podsticaj.$old$;
UPDATE public.menu_items SET description_ar = $new$عصير منعش من مزيج الفواكه الطازجة الغنية بالفيتامينات والمغذيات، لدفعة صحية من النشاط.$new$, updated_at = now()
 WHERE id = '2f963530-da9a-4b57-9046-9bfa137258ca' AND description_ar IS NOT DISTINCT FROM $old$عصير مزيج فيتامينات منعش، مزيج من الفواكه الطازجة المليئة بالفيتامينات والمغذيات لتعزيز صحي.$old$;

-- ===== Breakfast
-- Avocado on Toast
UPDATE public.menu_items SET name_bs = $new$Avokado na tostu$new$, updated_at = now()
 WHERE id = 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b' AND name_bs IS NOT DISTINCT FROM $old$Avokado na Tostu$old$;
UPDATE public.menu_items SET name_ar = $new$توست الأفوكادو$new$, updated_at = now()
 WHERE id = 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b' AND name_ar IS NOT DISTINCT FROM $old$أفوكادو على توست$old$;
UPDATE public.menu_items SET description_bs = $new$Kremasti avokado na kriškama raženog hljeba, poširano jaje, sjemenke bundeve, sjemenke nara, čili pahuljice, narezana crvena rotkvica, ukrašeno Sakura mješavinom.$new$, updated_at = now()
 WHERE id = 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b' AND description_bs IS NOT DISTINCT FROM $old$Kremasti Avokado na narezanom raženom hljebu, poširano jaje, sjemenke bundeve, sjemenke nara, čili pahuljice, narezana crvena rotkvica, ukrašeno Sakura mješavinom.$old$;
UPDATE public.menu_items SET description_ar = $new$أفوكادو كريمي على شرائح خبز الجاودار، بيضة بوشيه، بذور اليقطين، بذور الرمان، رقائق الفلفل الحار، شرائح الفجل الأحمر، ومزيّن بخلطة ساكورا.$new$, updated_at = now()
 WHERE id = 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b' AND description_ar IS NOT DISTINCT FROM $old$أفوكادو كريمي على خبز الجاودار المقطّع، بيض مسلوق، بذور اليقطين، بذور الرمان، رقائق الفلفل الحار، فجل أحمر شرائح، مزين بخلطة ساكورا.$old$;
-- Breakfast Platter
UPDATE public.menu_items SET name_bs = $new$Plata za doručak$new$, updated_at = now()
 WHERE id = '5a674711-02e2-416e-99de-7fa1e76003aa' AND name_bs IS NOT DISTINCT FROM $old$Doručak plata$old$;
UPDATE public.menu_items SET name_ar = $new$طبق الفطور$new$, updated_at = now()
 WHERE id = '5a674711-02e2-416e-99de-7fa1e76003aa' AND name_ar IS NOT DISTINCT FROM $old$طبق الإفطار$old$;
UPDATE public.menu_items SET description_bs = $new$Miješani sirevi u maslinovom ulju i začinskom bilju, crne i zelene masline, hrskavi prženi falafel, kuhano jaje, menemen i labneh sa zatarom, uz pita hljeb sa strane.$new$, updated_at = now()
 WHERE id = '5a674711-02e2-416e-99de-7fa1e76003aa' AND description_bs IS NOT DISTINCT FROM $old$Kombinacija miješanog sira u maslinovom ulju i bilju, crnih i zelenih maslina, hrskavo prženog falafela, kuhanog jajeta, menemen i labneh sa za'atarom, servirano sa pita hljebom sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$تشكيلة من الأجبان بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، منيمن ولبنة بالزعتر، تُقدَّم مع خبز عربي على الجانب.$new$, updated_at = now()
 WHERE id = '5a674711-02e2-416e-99de-7fa1e76003aa' AND description_ar IS NOT DISTINCT FROM $old$مزيج من الأجبان المتنوعة بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، بيض بالخضروات ولبنة بالزعتر تقدم مع خبز البيتا على الجانب.$old$;
-- Breakfast Platter for Two
UPDATE public.menu_items SET name_bs = $new$Plata za doručak za dvoje$new$, updated_at = now()
 WHERE id = '7382930d-240f-48c4-a3e1-5555e8561e60' AND name_bs IS NOT DISTINCT FROM $old$Doručak plata za dvoje$old$;
UPDATE public.menu_items SET name_ar = $new$طبق الفطور لشخصين$new$, updated_at = now()
 WHERE id = '7382930d-240f-48c4-a3e1-5555e8561e60' AND name_ar IS NOT DISTINCT FROM $old$طبق الإفطار لشخصين$old$;
UPDATE public.menu_items SET description_bs = $new$Miješani sirevi u maslinovom ulju i začinskom bilju, crne i zelene masline, hrskavi prženi falafel, kuhano jaje, menemen, labneh sa zatarom, med, kajmak i ful medames, uz pita hljeb sa strane.$new$, updated_at = now()
 WHERE id = '7382930d-240f-48c4-a3e1-5555e8561e60' AND description_bs IS NOT DISTINCT FROM $old$Kombinacija miješanog sira u maslinovom ulju i bilju, crnih i zelenih maslina, hrskavo prženog falafela, kuhanog jajeta, Menemen, labneh sa za'atarom, meda, kajmaka, foul mudammasa, servirano sa pita hljebom sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$تشكيلة من الأجبان بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، منيمن، لبنة بالزعتر، عسل، قشطة وفول مدمس، تُقدَّم مع خبز عربي على الجانب.$new$, updated_at = now()
 WHERE id = '7382930d-240f-48c4-a3e1-5555e8561e60' AND description_ar IS NOT DISTINCT FROM $old$مزيج من الأجبان المتنوعة بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، بيض بالخضروات، لبنة بالزعتر، عسل، قشطة، فول مدمس، تقدم مع خبز البيتا على الجانب.$old$;
-- Classic Egg Benedict
UPDATE public.menu_items SET name_bs = $new$Klasična jaja Benedikt$new$, updated_at = now()
 WHERE id = '894b970d-ba31-4382-9495-3e256af09a93' AND name_bs IS NOT DISTINCT FROM $old$Klasično jaje benedict$old$;
UPDATE public.menu_items SET description_bs = $new$Poširano jaje na engleskom mafinu, grilovana pureća šunka i sotirani špinat, preliveno holandez sosom, posuto paprikom i Sakura mješavinom, uz miješanu zelenu salatu i čeri paradajz sa strane.$new$, updated_at = now()
 WHERE id = '894b970d-ba31-4382-9495-3e256af09a93' AND description_bs IS NOT DISTINCT FROM $old$Poširano jaje na engleskom muffinu, grilani listići pureće šunke i sotirani špinat, preliveno Hollandaise umakom, posuto paprikom i Sakura mješavinom, servirano s miješanom salatom i cherry paradajzom sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$بيضة بوشيه على مافن إنجليزي، شرائح لحم ديك رومي مشوية وسبانخ سوتيه، تعلوها صلصة الهولنديز ورشة بابريكا وخلطة ساكورا، تُقدَّم مع خس مشكّل وطماطم كرزية على الجانب.$new$, updated_at = now()
 WHERE id = '894b970d-ba31-4382-9495-3e256af09a93' AND description_ar IS NOT DISTINCT FROM $old$بيض مسلوق على مافن إنجليزي، شرائح لحم ديك رومي مدخن مشوي وسبانخ سوتيه، مغطاة بصلصة الهولنديز، رشة بابريكا في الأعلى وخلطة ساكورا تقدم مع مزيج من الخس والطماطم الكرزية على الجانب.$old$;
-- French Toast
UPDATE public.menu_items SET description_bs = $new$Tostirani hljeb za francuski tost, kompot na vrhu, miješano zelenje, posuto šećerom u prahu, mrvljeni hljeb sa sladoledom, javorov sirup sa strane.$new$, updated_at = now()
 WHERE id = '7c9e6489-94ad-4ef5-a777-958f7f1bed9a' AND description_bs IS NOT DISTINCT FROM $old$Tostirani francuski tost hljeb, kompot na vrhu, miješano zelje. Posuto šećerom u prahu, krušne mrvice sa sladoledom, javorov sirup sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$خبز فرنش توست محمّص، كومبوت في الأعلى، خضار ورقية مشكّلة، رشة سكر بودرة، فتات خبز مع آيس كريم، وشراب القيقب على الجانب.$new$, updated_at = now()
 WHERE id = '7c9e6489-94ad-4ef5-a777-958f7f1bed9a' AND description_ar IS NOT DISTINCT FROM $old$خبز فرنش توست محمص، كومبوت في الأعلى، مزيج خضروات، رشة سكر بودرة، فتات خبز مع آيس كريم، شراب القيقب على الجانب.$old$;
-- Granola Bowl
UPDATE public.menu_items SET name_bs = $new$Zdjela granole$new$, updated_at = now()
 WHERE id = '609de519-2ef0-4fd5-af1a-26e59dc510b0' AND name_bs IS NOT DISTINCT FROM $old$Granola zdjela$old$;
UPDATE public.menu_items SET name_ar = $new$وعاء الجرانولا$new$, updated_at = now()
 WHERE id = '609de519-2ef0-4fd5-af1a-26e59dc510b0' AND name_ar IS NOT DISTINCT FROM $old$جرانولا بول$old$;
UPDATE public.menu_items SET description_bs = $new$Kremasti grčki jogurt s granolom i kompotom od miješanog bobičastog voća.$new$, updated_at = now()
 WHERE id = '609de519-2ef0-4fd5-af1a-26e59dc510b0' AND description_bs IS NOT DISTINCT FROM $old$Zdjela granole napravljena kombinovanjem kremastog grčkog jogurta, granole i miješanog bobičastog kompota.$old$;
UPDATE public.menu_items SET description_ar = $new$زبادي يوناني كريمي مع الجرانولا وكومبوت التوت المشكّل.$new$, updated_at = now()
 WHERE id = '609de519-2ef0-4fd5-af1a-26e59dc510b0' AND description_ar IS NOT DISTINCT FROM $old$وعاء جرانولا مصنوع من مزيج الزبادي اليوناني الكريمي والجرانولا ومزيج كومبوت التوت.$old$;
-- Puff Truffle Egg
UPDATE public.menu_items SET name_bs = $new$Lisnato s jajem i tartufom$new$, updated_at = now()
 WHERE id = 'fb101638-731c-41d8-b8f7-4ffff7402bb4' AND name_bs IS NOT DISTINCT FROM $old$Pufasta Jaja sa Tartufima$old$;
UPDATE public.menu_items SET name_ar = $new$بف باستري بالبيض والكمأة$new$, updated_at = now()
 WHERE id = 'fb101638-731c-41d8-b8f7-4ffff7402bb4' AND name_ar IS NOT DISTINCT FROM $old$بيض نفخة الكمأة$old$;
UPDATE public.menu_items SET description_bs = $new$Prozračno lisnato tijesto, sos od tartufa i gljiva, poširano jaje i pečena paprika, ukrašeno tostiranim gljivama s tartufom, naribanim parmezanom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = 'fb101638-731c-41d8-b8f7-4ffff7402bb4' AND description_bs IS NOT DISTINCT FROM $old$Pjenasto lisnato tijesto, umak od tartufa i gljiva, preliveno poširanim jajem, pečenom paprikom, ukrašeno tostiranim tartuf gljivama, naribanim parmezanom, ukrašeno Sakura mješavinom.$old$;
UPDATE public.menu_items SET description_ar = $new$عجينة بف باستري هشّة مع صلصة الكمأة والفطر، تعلوها بيضة بوشيه وفلفل رومي مشوي، ومزيّنة بفطر الكمأة المحمّص وجبنة البارميزان المبشورة وخلطة ساكورا.$new$, updated_at = now()
 WHERE id = 'fb101638-731c-41d8-b8f7-4ffff7402bb4' AND description_ar IS NOT DISTINCT FROM $old$عجينة نفخة رقيقة، صلصة الكمأة والفطر تعلوها بيضة مسلوقة، فلفل مشوي، مزينة بفطر الكمأة المحمص، جبنة البارميزان المبشورة، ومزينة بخلطة ساكورا.$old$;
-- Shakshuka Platter
UPDATE public.menu_items SET name_bs = $new$Šakšuka plata$new$, updated_at = now()
 WHERE id = 'f90e4414-312d-4e3e-bae4-524d3e716296' AND name_bs IS NOT DISTINCT FROM $old$Shakshuka Plata$old$;
UPDATE public.menu_items SET description_bs = $new$Paradajz sos sa svježim paradajzom i lukom, s jajima pripremljenim po vašem izboru, feta sirom na vrhu i Sakura mješavinom (uz pita hljeb sa strane).$new$, updated_at = now()
 WHERE id = 'f90e4414-312d-4e3e-bae4-524d3e716296' AND description_bs IS NOT DISTINCT FROM $old$Paradajz sos, sa svježim paradajzom i lukom, preliven jajetom po vašem izboru. Na vrhu Feta sir, ukrašeno Sakura mješavinom (servirano sa pita hljebom sa strane).$old$;
UPDATE public.menu_items SET description_ar = $new$صلصة طماطم بنكهة الطماطم الطازجة والبصل، يعلوها البيض حسب اختيارك وجبنة الفيتا، ومزيّنة بخلطة ساكورا (تُقدَّم مع خبز عربي على الجانب).$new$, updated_at = now()
 WHERE id = 'f90e4414-312d-4e3e-bae4-524d3e716296' AND description_ar IS NOT DISTINCT FROM $old$صلصة طماطم، منكهة بالطماطم والبصل الطازج، تعلوها بيض حسب اختيارك. تعلوها جبنة الفيتا، وتزين بخلطة ساكورا (تقدم مع خبز البيتا على الجانب).$old$;
-- Stuffed Croissant with Eggs & Cheese
UPDATE public.menu_items SET name_bs = $new$Punjeni kroasan s jajima i sirom$new$, updated_at = now()
 WHERE id = 'd95c9607-3f9f-4982-a40d-27b2448ef1d3' AND name_bs IS NOT DISTINCT FROM $old$Punjen kroasan sa jajima i sirom$old$;
UPDATE public.menu_items SET description_bs = $new$Svježi kroasan punjen omletom, mocarelom i bijelim sosom s gljivama, posut paprikom i Sakura mješavinom, uz miješanu zelenu salatu i čeri paradajz sa strane.$new$, updated_at = now()
 WHERE id = 'd95c9607-3f9f-4982-a40d-27b2448ef1d3' AND description_bs IS NOT DISTINCT FROM $old$Svježi kroasan punjen omletom od jaja, mocarelom, bijelim umakom s gljivama, posut paprikom i Sakura mješavinom, serviran s miješanom salatom i cherry paradajzom sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$كرواسون طازج محشو بالأومليت وجبنة الموزاريلا والصلصة البيضاء بالفطر، مع رشة بابريكا وخلطة ساكورا، يُقدَّم مع خس مشكّل وطماطم كرزية على الجانب.$new$, updated_at = now()
 WHERE id = 'd95c9607-3f9f-4982-a40d-27b2448ef1d3' AND description_ar IS NOT DISTINCT FROM $old$كرواسون طازج محشو ببيض الأومليت، جبنة الموزاريلا، صلصة بيضاء مع الفطر، يعلوها رشة بابريكا وخلطة ساكورا، يقدم مع مزيج من الخس والطماطم الكرزية على الجانب.$old$;
-- Truffle Egg Benedict
UPDATE public.menu_items SET name_bs = $new$Jaja Benedikt s tartufom$new$, updated_at = now()
 WHERE id = '3f002619-22fe-4b7e-91c3-3722c678665e' AND name_bs IS NOT DISTINCT FROM $old$Jaja Benedikt s Tartufima$old$;
UPDATE public.menu_items SET name_ar = $new$بيض بنديكت بالكمأة$new$, updated_at = now()
 WHERE id = '3f002619-22fe-4b7e-91c3-3722c678665e' AND name_ar IS NOT DISTINCT FROM $old$بيض بنديكت الكمأة$old$;
UPDATE public.menu_items SET description_bs = $new$Poširano jaje na engleskom mafinu, sos od tartufa i gljiva, preliveno holandez sosom i posuto tostiranim tartufom, uz miješanu zelenu salatu i čeri paradajz sa strane.$new$, updated_at = now()
 WHERE id = '3f002619-22fe-4b7e-91c3-3722c678665e' AND description_bs IS NOT DISTINCT FROM $old$Poširano jaje na engleskom muffinu, umak od tartufa i gljiva, preliveno Hollandaise umakom, posuto tostiranim tartufima, servirano s miješanom salatom i cherry paradajzom sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$بيضة بوشيه على مافن إنجليزي مع صلصة الكمأة والفطر، تعلوها صلصة الهولنديز ورشة من الكمأة المحمّصة، تُقدَّم مع خس مشكّل وطماطم كرزية على الجانب.$new$, updated_at = now()
 WHERE id = '3f002619-22fe-4b7e-91c3-3722c678665e' AND description_ar IS NOT DISTINCT FROM $old$بيض مسلوق على مافن إنجليزي، صلصة الكمأة والفطر، تعلوها صلصة الهولنديز، رشة من الكمأة المحمصة، تقدم مع مزيج من الخس والطماطم الكرزية على الجانب.$old$;
-- Turkish Egg
UPDATE public.menu_items SET name_bs = $new$Turska jaja$new$, updated_at = now()
 WHERE id = '818ee57e-d8e8-45d9-b3e0-cb498b02c705' AND name_bs IS NOT DISTINCT FROM $old$Turska Jaja$old$;
UPDATE public.menu_items SET description_ar = $new$زبادي كريمي بالثوم تعلوه بيضة بوشيه، مع رشة من الشبت المجفف ورقائق الفلفل الحار وزيت الفلفل الحار، ومزيّن بخلطة ساكورا. يُقدَّم مع خبز الجاودار المحمّص على الجانب.$new$, updated_at = now()
 WHERE id = '818ee57e-d8e8-45d9-b3e0-cb498b02c705' AND description_ar IS NOT DISTINCT FROM $old$زبادي كريمي مع الثوم، يعلوه بيض مسلوق، رشة من أوراق الشبت المجففة، رقائق الفلفل الحار وزيت الفلفل الحار، مزين بخلطة ساكورا. خبز الجاودار المحمص على الجانب.$old$;

-- ===== Appetizer
-- Boneless Sticky Chicken
UPDATE public.menu_items SET name_bs = $new$Glazirana piletina bez kostiju$new$, updated_at = now()
 WHERE id = '699add79-5dc1-4cc6-a37e-225440eb8901' AND name_bs IS NOT DISTINCT FROM $old$Piletina Bez Kosti Sticky$old$;
UPDATE public.menu_items SET description_bs = $new$Pohovana piletina bez kostiju, pržena i uvaljana u buffalo sos, s miješanim susamom, ukrašena mladim lukom i Sakura mješavinom; kiselo vrhnje sa strane.$new$, updated_at = now()
 WHERE id = '699add79-5dc1-4cc6-a37e-225440eb8901' AND description_bs IS NOT DISTINCT FROM $old$Pržena pohirana piletina bez kosti prelivena buffalo sosom, miješanim susamom, ukrašena mladim lukom i Sakura mješavinom, kisela pavlaka sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$قطع دجاج بلا عظم مقلية بطبقة مقرمشة، مقلّبة بصلصة البافلو ومزيج السمسم، مزيّنة بالبصل الأخضر وخلطة ساكورا، وتُقدَّم مع كريمة حامضة على الجانب.$new$, updated_at = now()
 WHERE id = '699add79-5dc1-4cc6-a37e-225440eb8901' AND description_ar IS NOT DISTINCT FROM $old$دجاج بدون عظم مقلي مغطى بصلصة البافلو، مزيج من السمسم، مزين بالبصل الأخضر وخلطة ساكورا، كريمة حامضة على الجانب.$old$;
-- Dynamite Chicken
UPDATE public.menu_items SET name_bs = $new$Dinamit piletina$new$, updated_at = now()
 WHERE id = '7f95bccf-38a4-449e-b9a1-2c0fafac4d2a' AND name_bs IS NOT DISTINCT FROM $old$Dinamit Piletina$old$;
UPDATE public.menu_items SET description_bs = $new$Pohovani hrskavi pileći zalogaji s dinamit sosom, zelenom salatom i miješanim susamom, ukrašeni mladim lukom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = '7f95bccf-38a4-449e-b9a1-2c0fafac4d2a' AND description_bs IS NOT DISTINCT FROM $old$Pohovani hrskavi pileći zalogaji sa dinamit sosom, salatom, miješanim susamom, ukrašeno mladim lukom i Sakura mješavinom.$old$;
-- Mac & Cheese Balls
UPDATE public.menu_items SET name_bs = $new$Mac & Cheese kuglice$new$, updated_at = now()
 WHERE id = 'cd05010d-d313-4cc2-8485-60f7c93d0ff7' AND name_bs IS NOT DISTINCT FROM $old$Mac & Cheese Kuglice$old$;
UPDATE public.menu_items SET description_bs = $new$Pržene kuglice od tjestenine s ružičastim sosom, sosom od sira i naribanim parmezanom, ukrašene mladim lukom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = 'cd05010d-d313-4cc2-8485-60f7c93d0ff7' AND description_bs IS NOT DISTINCT FROM $old$Pržene kuglice tjestenine sa ružičastim sosom, sirom, naribanim parmezanom, ukrašene mladim lukom i sakura mješavinom.$old$;

-- ===== Pasta
-- Alfredo Fettucine
UPDATE public.menu_items SET description_bs = $new$Fettuccine u kremastom alfredo sosu s grilovanim gljivama i naribanim parmezanom, ukrašeno Sakura mješavinom. Dodatak piletine +2 KM.$new$, updated_at = now()
 WHERE id = '2606d83c-f867-44c8-9181-cc5f019f4a2c' AND description_bs IS NOT DISTINCT FROM $old$Fettuccine tjestenina obložena kremastim alfredo sosom, grilovanim gljivama, naribanim parmezanom, ukrašena Sakura mješavinom. Dodatna piletina +2 KM.$old$;
UPDATE public.menu_items SET description_ar = $new$باستا فيتوتشيني بصلصة ألفريدو الكريمية مع فطر مشوي وجبنة بارميزان مبشورة، مزيّنة بخلطة ساكورا. إضافة دجاج +2 KM.$new$, updated_at = now()
 WHERE id = '2606d83c-f867-44c8-9181-cc5f019f4a2c' AND description_ar IS NOT DISTINCT FROM $old$باستا فيتوتشيني مغمورة بصلصة ألفريدو كريمية، فطر مشوي، جبنة بارميزان مبشورة، مزينة بخلطة ساكورا. إضافة دجاج +2 دينار.$old$;
-- Eggplant Spaghetti Truffle
UPDATE public.menu_items SET name_bs = $new$Špageti s patlidžanom i tartufom$new$, updated_at = now()
 WHERE id = '1a75511e-9975-4875-a41f-e5a9f4d9daa2' AND name_bs IS NOT DISTINCT FROM $old$Spaghetti od Patlidžana sa Tartufima$old$;
UPDATE public.menu_items SET description_bs = $new$Špageti u kremastom ružičastom sosu s pastom od tartufa, preliveni patlidžanom i parmezanom, ukrašeni Sakura mješavinom.$new$, updated_at = now()
 WHERE id = '1a75511e-9975-4875-a41f-e5a9f4d9daa2' AND description_bs IS NOT DISTINCT FROM $old$Spaghetti tjestenina, obložena kremastim ružičastim sosom, pastom od tartufa, preliveno patlidžanom, parmezanom i ukrašeno Sakura mješavinom.$old$;
UPDATE public.menu_items SET description_ar = $new$سباغيتي بصلصة وردية كريمية ومعجون الكمأة، يعلوها الباذنجان وجبنة البارميزان، ومزيّنة بخلطة ساكورا.$new$, updated_at = now()
 WHERE id = '1a75511e-9975-4875-a41f-e5a9f4d9daa2' AND description_ar IS NOT DISTINCT FROM $old$باستا سباغيتي، مغمورة بصلصة وردية كريمية، معجون الكمأة، تعلوها باذنجان، جبنة بارميزان ومزينة بخلطة ساكورا.$old$;
-- Pasta Arrabbiata
UPDATE public.menu_items SET name_bs = $new$Pasta arrabbiata$new$, updated_at = now()
 WHERE id = '153b5956-c40a-43c3-9a75-e9d5c8dbb9b3' AND name_bs IS NOT DISTINCT FROM $old$Tjestenina Arrabbiata$old$;
UPDATE public.menu_items SET description_bs = $new$Penne u crvenom arrabbiata sosu s naribanim parmezanom, ukrašene mladim lukom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = '153b5956-c40a-43c3-9a75-e9d5c8dbb9b3' AND description_bs IS NOT DISTINCT FROM $old$Penne tjestenina u crvenom Arrabbiata sosu, naribani parmezan, ukrašena mladim lukom i Sakura mješavinom.$old$;
-- Pesto Alfredo Fettuccine
UPDATE public.menu_items SET description_bs = $new$Fettuccine u kremastom alfredo pesto sosu s naribanim parmezanom, ukrašeno Sakura mješavinom. Dodatak piletine +2 KM.$new$, updated_at = now()
 WHERE id = '4d11027f-f28e-47a1-a4af-68d382c79b6a' AND description_bs IS NOT DISTINCT FROM $old$Fettuccine tjestenina obložena kremastim alfredo pesto sosom, naribanim parmezanom, ukrašena Sakura mješavinom. Dodatna piletina +2 KM.$old$;
UPDATE public.menu_items SET description_ar = $new$باستا فيتوتشيني بصلصة ألفريدو بالبيستو الكريمية مع جبنة بارميزان مبشورة، مزيّنة بخلطة ساكورا. إضافة دجاج +2 KM.$new$, updated_at = now()
 WHERE id = '4d11027f-f28e-47a1-a4af-68d382c79b6a' AND description_ar IS NOT DISTINCT FROM $old$باستا فيتوتشيني مغمورة بصلصة ألفريدو بيستو كريمية، جبنة بارميزان مبشورة، مزينة بخلطة ساكورا. إضافة دجاج +2 دينار.$old$;
-- Truffle Pasta
UPDATE public.menu_items SET name_bs = $new$Pasta s tartufom$new$, updated_at = now()
 WHERE id = 'ba488833-a8d2-4b27-8027-fbe131888eb5' AND name_bs IS NOT DISTINCT FROM $old$Tjestenina s Tartufima$old$;
UPDATE public.menu_items SET description_bs = $new$Fettuccine u kremastom alfredo sosu s pastom i uljem od tartufa i naribanim parmezanom, ukrašeno Sakura mješavinom. Dodatak piletine +2 KM.$new$, updated_at = now()
 WHERE id = 'ba488833-a8d2-4b27-8027-fbe131888eb5' AND description_bs IS NOT DISTINCT FROM $old$Fettuccine tjestenina obložena kremastim alfredo sosom, pastom od tartufa, uljem od tartufa, naribanim parmezanom, ukrašena Sakura mješavinom. Dodatna piletina +2 KM.$old$;
UPDATE public.menu_items SET description_ar = $new$باستا فيتوتشيني بصلصة ألفريدو الكريمية مع معجون الكمأة وزيت الكمأة وجبنة بارميزان مبشورة، مزيّنة بخلطة ساكورا. إضافة دجاج +2 KM.$new$, updated_at = now()
 WHERE id = 'ba488833-a8d2-4b27-8027-fbe131888eb5' AND description_ar IS NOT DISTINCT FROM $old$باستا فيتوتشيني مغمورة بصلصة ألفريدو كريمية، معجون الكمأة، زيت الكمأة، جبنة بارميزان مبشورة، مزينة بخلطة ساكورا. إضافة دجاج +2 دينار.$old$;

-- ===== Salads
-- Beetroot Salad
UPDATE public.menu_items SET description_bs = $new$Miješana zelena salata, preljev od limuna, kriške cvekle, pečeni orasi, sjemenke bundeve, sjemenke nara, kriške narandže, kremasti avokado, labneh, pire od cvekle, ukrašeno bijelim i crnim susamom.$new$, updated_at = now()
 WHERE id = 'fa33c027-e841-4b73-a334-9c7fabe88abe' AND description_bs IS NOT DISTINCT FROM $old$Miješana salata, preljev od limuna, narezana cvekla, pečeni orasi, sjemenke bundeve, sjemenke nara, narezani segmenti narandže, kremasti avokado, labneh, pire od cvekle, ukrašeno bijelim i crnim susamom.$old$;
-- Caesar Salad
UPDATE public.menu_items SET description_bs = $new$Ajsberg salata s Cezar dresingom i parmezanom, uz krutone i kriške limuna sa strane.$new$, updated_at = now()
 WHERE id = '26df45bb-0a62-484c-ae39-ed1b5a63329b' AND description_bs IS NOT DISTINCT FROM $old$Iceberg salata sa Cezar dresingom i parmezanom, krutonima i narezanim limunom sa strane.$old$;
UPDATE public.menu_items SET description_ar = $new$خس آيسبرغ بصلصة السيزر وجبنة البارميزان، مع خبز محمّص (كروتون) وشرائح ليمون على الجانب.$new$, updated_at = now()
 WHERE id = '26df45bb-0a62-484c-ae39-ed1b5a63329b' AND description_ar IS NOT DISTINCT FROM $old$خس روماني بصلصة السيزر وجبنة البارميزان، خبز محمص وشرائح ليمون على الجانب.$old$;
-- Caesar Salad with Chicken
UPDATE public.menu_items SET description_bs = $new$Ajsberg salata s Cezar dresingom i parmezanom, grilovana piletina, krutoni i kriške limuna.$new$, updated_at = now()
 WHERE id = '3270f1bd-c977-4bbd-819e-f2054111b1b7' AND description_bs IS NOT DISTINCT FROM $old$Iceberg salata sa Cezar dresingom i parmezanom, grilovanom piletinom, krutonima i narezanim limunom.$old$;
UPDATE public.menu_items SET description_ar = $new$خس آيسبرغ بصلصة السيزر وجبنة البارميزان، دجاج مشوي، خبز محمّص (كروتون) وشرائح ليمون.$new$, updated_at = now()
 WHERE id = '3270f1bd-c977-4bbd-819e-f2054111b1b7' AND description_ar IS NOT DISTINCT FROM $old$خس روماني بصلصة السيزر وجبنة البارميزان، دجاج مشوي، خبز محمص وشرائح ليمون.$old$;
-- Falafel Salad
UPDATE public.menu_items SET description_bs = $new$Hrskavi prženi falafel, miješana zelena salata, sjeckana crvena rotkvica, čeri paradajz, krastavac, luk, tahini sos i preljev od limuna.$new$, updated_at = now()
 WHERE id = '9e2930a8-10e8-4e7f-b710-6dc9c8b79fec' AND description_bs IS NOT DISTINCT FROM $old$Hrskavo prženi Falafel, miješana salata, sjeckana crvena rotkva, cherry paradajz, krastavac, luk, Tahini sos i preljev od limuna.$old$;
-- Quinoa Salad
UPDATE public.menu_items SET description_bs = $new$Kuhana crna i bijela kvinoja, rukola, sjemenke nara, preljev od limuna, čeri paradajz, posuto izmrvljenim feta sirom.$new$, updated_at = now()
 WHERE id = 'efd18b6c-f4c0-44cf-8439-3f4d4625bed0' AND description_bs IS NOT DISTINCT FROM $old$Kuhana crna i bijela kvinoja, rukola, sjemenke nara, preljev od limuna, cherry paradajz, preliveno drobljenim feta sirom.$old$;
-- Shopska Salad
UPDATE public.menu_items SET name_bs = $new$Šopska salata$new$, updated_at = now()
 WHERE id = 'e5cb4265-b20c-4040-bb35-0a590ca91976' AND name_bs IS NOT DISTINCT FROM $old$Šopska Salata$old$;
UPDATE public.menu_items SET description_bs = $new$Paradajz, žuta paprika, krastavac i luk narezani na kockice, s maslinovim uljem i sokom od bijelog grožđa, posuto izmrvljenim feta sirom i sjeckanim peršunom.$new$, updated_at = now()
 WHERE id = 'e5cb4265-b20c-4040-bb35-0a590ca91976' AND description_bs IS NOT DISTINCT FROM $old$Narezani paradajz, narezana žuta paprika, narezani krastavac, narezani luk, sa maslinovim uljem i bijelim sokom od grožđa, preliveno drobljenim feta sirom i ukrašeno sjeckanim peršunom.$old$;

-- ===== Burgers
-- Classic Crispy Chicken Burger
UPDATE public.menu_items SET name_bs = $new$Klasični burger s hrskavom piletinom$new$, updated_at = now()
 WHERE id = '57ffe3df-eed0-4842-8d8e-62a70672063b' AND name_bs IS NOT DISTINCT FROM $old$Klasični Burger sa Hrskavom Piletinom$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo sa susamom, pržena hrskava piletina, kriške čedar sira, paradajz, luk, zelena salata, sos od meda i senfa.$new$, updated_at = now()
 WHERE id = '57ffe3df-eed0-4842-8d8e-62a70672063b' AND description_bs IS NOT DISTINCT FROM $old$Brioche sezam bul, pržena hrskava piletina, narezani cheddar sir, paradajz, luk, zelena salata, sos od meda i senfa.$old$;
-- Dynamite Chicken Burger
UPDATE public.menu_items SET name_bs = $new$Dinamit pileći burger$new$, updated_at = now()
 WHERE id = '456e4131-b3ba-45ad-b609-6bfc89cf4dc2' AND name_bs IS NOT DISTINCT FROM $old$Dinamit Piletina Burger$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo sa susamom, pržena hrskava piletina, kisele jalapeño papričice, kriške paradajza, kolutovi luka, zelena salata, dinamit sos.$new$, updated_at = now()
 WHERE id = '456e4131-b3ba-45ad-b609-6bfc89cf4dc2' AND description_bs IS NOT DISTINCT FROM $old$Brioche sezam bul, pržena hrskava piletina, kiseli jalapeno biber, narezani paradajz, narezani luk, zelena salata, dinamit sos.$old$;
-- La Soul Burger
UPDATE public.menu_items SET name_ar = $new$برجر La Soul$new$, updated_at = now()
 WHERE id = '1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1' AND name_ar IS NOT DISTINCT FROM $old$La Soul برجر$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo sa susamom, juneća pljeskavica s mocarelom, kremasti avokado, hrskavi luk, specijalni sos i Fire House sos.$new$, updated_at = now()
 WHERE id = '1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1' AND description_bs IS NOT DISTINCT FROM $old$Brioche sezam punđa, pecivo od govedine sa mocarelom, preliveno kremastim avokadom, hrskavim lukom, specijalnim umakom i vatrenim umakom.$old$;
-- Manhattan Burger
UPDATE public.menu_items SET name_ar = $new$برجر مانهاتن$new$, updated_at = now()
 WHERE id = '6f618d6c-42a7-44a6-818a-13de098e1897' AND name_ar IS NOT DISTINCT FROM $old$مانهاتن برجر$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo sa susamom, juneća pljeskavica, kriške čedar sira, kiseli krastavci, paradajz, zelena salata, specijalni sos.$new$, updated_at = now()
 WHERE id = '6f618d6c-42a7-44a6-818a-13de098e1897' AND description_bs IS NOT DISTINCT FROM $old$Brioche sezam bul, pecivo od govedine, kriške cheddar sira, kiseli krastavci, paradajz, zelena salata, poseban sos.$old$;
-- Mushroom Burger
UPDATE public.menu_items SET name_ar = $new$برجر الفطر$new$, updated_at = now()
 WHERE id = '9592bf2c-6a81-4dad-89f1-db43ca9d5f1a' AND name_ar IS NOT DISTINCT FROM $old$برجر فطر$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo sa susamom, juneća pljeskavica, mocarela, grilovane gljive i luk, originalni sos, zelena salata.$new$, updated_at = now()
 WHERE id = '9592bf2c-6a81-4dad-89f1-db43ca9d5f1a' AND description_bs IS NOT DISTINCT FROM $old$Brioche sezam punđa, goveđe pecivo, mocarela sir, grilovani šampinjoni i luk, originalni sos, zelena salata.$old$;
-- Original Burger
UPDATE public.menu_items SET name_ar = $new$البرجر الأصلي$new$, updated_at = now()
 WHERE id = 'd428cbc8-229b-4a68-9b60-c0b13f56a92e' AND name_ar IS NOT DISTINCT FROM $old$برجر أصلي$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo sa susamom, juneća pljeskavica, kriške čedar sira, paradajz, luk, zelena salata, originalni sos.$new$, updated_at = now()
 WHERE id = 'd428cbc8-229b-4a68-9b60-c0b13f56a92e' AND description_bs IS NOT DISTINCT FROM $old$Brioche sezam punđa, goveđi odrezak, narezani cheddar sir, paradajz, luk, zelena salata, originalni sos.$old$;
-- Solar Gravity
UPDATE public.menu_items SET name_bs = $new$Solar Gravity$new$, updated_at = now()
 WHERE id = 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7' AND name_bs IS NOT DISTINCT FROM $old$Solarna Gravitacija$old$;
UPDATE public.menu_items SET name_ar = $new$سولار جرافيتي$new$, updated_at = now()
 WHERE id = 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7' AND name_ar IS NOT DISTINCT FROM $old$الجاذبية الشمسية$old$;
UPDATE public.menu_items SET description_bs = $new$Pecivo od cvekle sa susamom, dupla juneća pljeskavica s čedar sirom, hrskavi kolutovi luka, kiseli krastavac, Solar Gravity sos.$new$, updated_at = now()
 WHERE id = 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7' AND description_bs IS NOT DISTINCT FROM $old$Brioche pecivo od cvekle sa susamom, dvostruko goveđe pecivo, sa cheddar sirom, hrskave trake luka, kiseli krastavac, Solar Gravity sos.$old$;
UPDATE public.menu_items SET description_ar = $new$خبز الشمندر بالسمسم، شريحتا لحم بقري مع جبنة شيدر، حلقات بصل مقرمشة، خيار مخلل، وصلصة سولار جرافيتي.$new$, updated_at = now()
 WHERE id = 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7' AND description_ar IS NOT DISTINCT FROM $old$خبزة شمندر بالسمسم، شريحة لحم بقري مزدوجة، مع جبنة شيدر، بصل مقرمش، خيار مخلل، صلصة سولار جرافيتي.$old$;
-- Volcano Beef Burger
UPDATE public.menu_items SET name_bs = $new$Volcano juneći burger$new$, updated_at = now()
 WHERE id = 'da5762f6-ed01-432d-861e-52995c2248d8' AND name_bs IS NOT DISTINCT FROM $old$Volcano Beef Burger$old$;
UPDATE public.menu_items SET name_ar = $new$برجر فولكانو باللحم$new$, updated_at = now()
 WHERE id = 'da5762f6-ed01-432d-861e-52995c2248d8' AND name_ar IS NOT DISTINCT FROM $old$برجر لحم البقر البركاني$old$;
UPDATE public.menu_items SET description_bs = $new$Pecivo od cvekle sa susamom, juneća pljeskavica, kriške čedar sira, Volcano sos, hrskave krompir niti, paradajz, luk.$new$, updated_at = now()
 WHERE id = 'da5762f6-ed01-432d-861e-52995c2248d8' AND description_bs IS NOT DISTINCT FROM $old$Brioche pecivo od cvekle sa susamom, goveđe pecivo, narezani cheddar sir, Volcano sos, hrskavi krompir flos, paradajz, luk.$old$;
UPDATE public.menu_items SET description_ar = $new$خبز الشمندر بالسمسم، شريحة لحم بقري، شرائح جبنة شيدر، صلصة فولكانو، خيوط بطاطس مقرمشة، طماطم، بصل.$new$, updated_at = now()
 WHERE id = 'da5762f6-ed01-432d-861e-52995c2248d8' AND description_ar IS NOT DISTINCT FROM $old$خبزة شمندر بالسمسم، شريحة لحم بقري، شرائح جبنة شيدر، صلصة فولكانو، بطاطس مقرمشة، طماطم، بصل.$old$;
-- Volcano Crispy Chicken Burger
UPDATE public.menu_items SET name_bs = $new$Volcano burger s hrskavom piletinom$new$, updated_at = now()
 WHERE id = 'a07007ee-af4b-4c47-88a2-254a28fb7a53' AND name_bs IS NOT DISTINCT FROM $old$Volcano Hrskava Piletina Burger$old$;
UPDATE public.menu_items SET name_ar = $new$برجر فولكانو بالدجاج المقرمش$new$, updated_at = now()
 WHERE id = 'a07007ee-af4b-4c47-88a2-254a28fb7a53' AND name_ar IS NOT DISTINCT FROM $old$برجر دجاج فولكانو مقرمش$old$;
UPDATE public.menu_items SET description_bs = $new$Pecivo od cvekle sa susamom, pržena hrskava piletina, kriške čedar sira, Volcano sos, hrskave krompir niti, paradajz, luk.$new$, updated_at = now()
 WHERE id = 'a07007ee-af4b-4c47-88a2-254a28fb7a53' AND description_bs IS NOT DISTINCT FROM $old$Brioche pecivo od cvekle sa susamom, pržena hrskava piletina, narezani cheddar sir, Volcano sos, hrskavi krompir flos, paradajz, luk.$old$;
UPDATE public.menu_items SET description_ar = $new$خبز الشمندر بالسمسم، دجاج مقرمش مقلي، شرائح جبنة شيدر، صلصة فولكانو، خيوط بطاطس مقرمشة، طماطم، بصل.$new$, updated_at = now()
 WHERE id = 'a07007ee-af4b-4c47-88a2-254a28fb7a53' AND description_ar IS NOT DISTINCT FROM $old$خبزة شمندر بالسمسم، دجاج مقرمش مقلي، شرائح جبنة شيدر، صلصة فولكانو، بطاطس مقرمشة، طماطم، بصل.$old$;

-- ===== Sliders
-- Dangerous Slider
UPDATE public.menu_items SET name_bs = $new$Opasni slider$new$, updated_at = now()
 WHERE id = '1731a57b-6b84-42d2-81d3-0b8650442b3b' AND name_bs IS NOT DISTINCT FROM $old$Opasan Slider$old$;
UPDATE public.menu_items SET description_bs = $new$Pecivo od cvekle, hrskava piletina, čedar sir, sjeckana ajsberg salata, pržene jalapeño papričice, chimichurri sos.$new$, updated_at = now()
 WHERE id = '1731a57b-6b84-42d2-81d3-0b8650442b3b' AND description_bs IS NOT DISTINCT FROM $old$Pecivo od cvekle, hrskava piletina, cheddar sir, naribana ledena salata, prženi jalapeno, chimichurri sos.$old$;
UPDATE public.menu_items SET description_ar = $new$خبز الشمندر، دجاج مقرمش، جبنة شيدر، خس آيسبرغ مقطّع، هلابينو مقلي، صلصة تشيميتشوري.$new$, updated_at = now()
 WHERE id = '1731a57b-6b84-42d2-81d3-0b8650442b3b' AND description_ar IS NOT DISTINCT FROM $old$خبزة شمندر، دجاج مقرمش، جبنة شيدر، خس آيسبرغ مبشور، هلابينو مقلي، صلصة شيميتشوري.$old$;
-- Grilled Chicken Slider
UPDATE public.menu_items SET name_bs = $new$Grilovani pileći slider$new$, updated_at = now()
 WHERE id = '910ce450-63f6-4995-af20-9bcac0740414' AND name_bs IS NOT DISTINCT FROM $old$Grilovani Pileći Slider$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo, kisele jalapeño papričice, rukola, grilovana piletina, mocarela.$new$, updated_at = now()
 WHERE id = '910ce450-63f6-4995-af20-9bcac0740414' AND description_bs IS NOT DISTINCT FROM $old$Brioche punđa, kiseli jalapeno, rikula, grilovana piletina, mocarela sir.$old$;
-- Midnight Slider
UPDATE public.menu_items SET name_bs = $new$Midnight slider$new$, updated_at = now()
 WHERE id = 'b780b03b-e220-4f03-a49c-ee95fe9ea23a' AND name_bs IS NOT DISTINCT FROM $old$Midnight Slider$old$;
UPDATE public.menu_items SET description_bs = $new$Brioš pecivo, juneća pljeskavica, kriška čedar sira, sjeckana ajsberg salata, kiseli krastavac, Thousand Island sos.$new$, updated_at = now()
 WHERE id = 'b780b03b-e220-4f03-a49c-ee95fe9ea23a' AND description_bs IS NOT DISTINCT FROM $old$Brioche punđa, goveđe pecivo, narezani cheddar sir, naribana ledena salata, kiseli krastavac, umak Thousand Island.$old$;
UPDATE public.menu_items SET description_ar = $new$خبز بريوش، شريحة لحم بقري، شريحة جبنة شيدر، خس آيسبرغ مقطّع، خيار مخلل، صلصة ثاوزند آيلاند.$new$, updated_at = now()
 WHERE id = 'b780b03b-e220-4f03-a49c-ee95fe9ea23a' AND description_ar IS NOT DISTINCT FROM $old$خبزة بريوش، شريحة لحم بقري، شرائح جبنة شيدر، خس آيسبرغ مبشور، خيار مخلل، صلصة ثاوزند آيلاند.$old$;
-- Mix Slider
UPDATE public.menu_items SET name_bs = $new$Slider miks$new$, updated_at = now()
 WHERE id = '32d1fe9b-ae30-49fb-8afb-37e0e5edaa29' AND name_bs IS NOT DISTINCT FROM $old$Miks Slider$old$;
UPDATE public.menu_items SET description_bs = $new$Kombinacija Opasnog slidera, Midnight slidera i Povrtnog slidera.$new$, updated_at = now()
 WHERE id = '32d1fe9b-ae30-49fb-8afb-37e0e5edaa29' AND description_bs IS NOT DISTINCT FROM $old$Kombinacija Opasnog Slidera, Midnight Slidera, Vegetarijanskog Slidera.$old$;
-- Vegetable Slider
UPDATE public.menu_items SET name_bs = $new$Povrtni slider$new$, updated_at = now()
 WHERE id = 'c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9' AND name_bs IS NOT DISTINCT FROM $old$Vegetarijanski Slider$old$;
UPDATE public.menu_items SET description_bs = $new$Hrskava pljeskavica od falafela, sjeckana ajsberg salata, paradajz, specijalni sos.$new$, updated_at = now()
 WHERE id = 'c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9' AND description_bs IS NOT DISTINCT FROM $old$Hrskavo prženi falafel, naribana ledena salata, paradajz, poseban umak.$old$;
UPDATE public.menu_items SET description_ar = $new$قرص فلافل مقلي مقرمش، خس آيسبرغ مقطّع، طماطم، صلصة خاصة.$new$, updated_at = now()
 WHERE id = 'c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9' AND description_ar IS NOT DISTINCT FROM $old$شريحة فلافل مقلية مقرمشة، خس آيسبرغ مبشور، طماطم، صلصة خاصة.$old$;

-- ===== Risotto
-- Pesto Risotto
UPDATE public.menu_items SET name_bs = $new$Pesto rižoto$new$, updated_at = now()
 WHERE id = 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7' AND name_bs IS NOT DISTINCT FROM $old$Pesto Rižoto$old$;
UPDATE public.menu_items SET description_bs = $new$Rižoto u kremastom alfredo sosu s pesto sosom i čeri paradajzom, ukrašen Sakura mješavinom (dodatak piletine +2 KM).$new$, updated_at = now()
 WHERE id = 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7' AND description_bs IS NOT DISTINCT FROM $old$Rižoto riža u kremastom alfredo sosu, pesto sos, cherry paradajz, ukrašena Sakura mješavinom (dodatna piletina) 2KM.$old$;
UPDATE public.menu_items SET description_ar = $new$أرز ريزوتو بصلصة ألفريدو الكريمية وصلصة البيستو والطماطم الكرزية، مزيّن بخلطة ساكورا (إضافة دجاج +2 KM).$new$, updated_at = now()
 WHERE id = 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7' AND description_ar IS NOT DISTINCT FROM $old$أرز ريزوتو بصلصة ألفريدو كريمية، صلصة بيستو، طماطم كرزية، مزين بخلطة ساكورا (إضافة دجاج) 2 دينار.$old$;
-- Pink Sauce Risotto
UPDATE public.menu_items SET name_bs = $new$Rižoto u ružičastom sosu$new$, updated_at = now()
 WHERE id = '93693bf6-75ca-4667-8b00-852f305140b1' AND name_bs IS NOT DISTINCT FROM $old$Rižoto s Ružičastim Sosom$old$;
UPDATE public.menu_items SET name_ar = $new$ريزوتو بالصلصة الوردية$new$, updated_at = now()
 WHERE id = '93693bf6-75ca-4667-8b00-852f305140b1' AND name_ar IS NOT DISTINCT FROM $old$ريزوتو صلصة وردية$old$;
UPDATE public.menu_items SET description_bs = $new$Rižoto u kremastom ružičastom sosu s čeri paradajzom, crnim maslinama i balzamiko kremom, ukrašen Sakura mješavinom (dodatak piletine +2 KM).$new$, updated_at = now()
 WHERE id = '93693bf6-75ca-4667-8b00-852f305140b1' AND description_bs IS NOT DISTINCT FROM $old$Rižoto riža u kremastom ružičastom sosu, cherry paradajz, crne masline, balzamični krem, ukrašena Sakura mješavinom (dodatna piletina) 2KM.$old$;
UPDATE public.menu_items SET description_ar = $new$أرز ريزوتو بصلصة وردية كريمية مع طماطم كرزية وزيتون أسود وكريمة البلسميك، مزيّن بخلطة ساكورا (إضافة دجاج +2 KM).$new$, updated_at = now()
 WHERE id = '93693bf6-75ca-4667-8b00-852f305140b1' AND description_ar IS NOT DISTINCT FROM $old$أرز ريزوتو بصلصة وردية كريمية، طماطم كرزية، زيتون أسود، كريمة بلسميك، مزين بخلطة ساكورا (إضافة دجاج) 2 دينار.$old$;
-- Risotto in Alfredo Sauce with Mushroom
UPDATE public.menu_items SET name_bs = $new$Rižoto u alfredo sosu s gljivama$new$, updated_at = now()
 WHERE id = 'ad51bf28-159b-4938-b3ef-95bd3186b729' AND name_bs IS NOT DISTINCT FROM $old$Rižoto u Alfredo Sosu sa Gljivama$old$;
UPDATE public.menu_items SET description_bs = $new$Rižoto u kremastom alfredo sosu s grilovanim gljivama, ukrašen svježim timijanom (dodatak piletine +2 KM).$new$, updated_at = now()
 WHERE id = 'ad51bf28-159b-4938-b3ef-95bd3186b729' AND description_bs IS NOT DISTINCT FROM $old$Rižoto riža u kremastom alfredo sosu, grilovane gljive, ukrašena svježim timijanom (dodatna piletina) 2KM.$old$;
UPDATE public.menu_items SET description_ar = $new$أرز ريزوتو بصلصة ألفريدو الكريمية مع فطر مشوي، مزيّن بالزعتر الطازج (إضافة دجاج +2 KM).$new$, updated_at = now()
 WHERE id = 'ad51bf28-159b-4938-b3ef-95bd3186b729' AND description_ar IS NOT DISTINCT FROM $old$أرز ريزوتو بصلصة ألفريدو كريمية، فطر مشوي، مزين بالزعتر الطازج (إضافة دجاج) 2 دينار.$old$;
-- Truffle Risotto
UPDATE public.menu_items SET name_bs = $new$Rižoto s tartufom$new$, updated_at = now()
 WHERE id = '82c96deb-f1c9-4904-84cf-0160c9b48191' AND name_bs IS NOT DISTINCT FROM $old$Rižoto s Tartufima$old$;
UPDATE public.menu_items SET description_bs = $new$Rižoto u kremastom alfredo sosu s pastom od tartufa i grilovanim gljivama, ukrašen svježim timijanom (dodatak piletine +2 KM).$new$, updated_at = now()
 WHERE id = '82c96deb-f1c9-4904-84cf-0160c9b48191' AND description_bs IS NOT DISTINCT FROM $old$Rižoto riža u kremastom alfredo sosu, pasta od tartufa, grilovane gljive, ukrašena svježim timijanom (dodatna piletina) 2KM.$old$;
UPDATE public.menu_items SET description_ar = $new$أرز ريزوتو بصلصة ألفريدو الكريمية مع معجون الكمأة وفطر مشوي، مزيّن بالزعتر الطازج (إضافة دجاج +2 KM).$new$, updated_at = now()
 WHERE id = '82c96deb-f1c9-4904-84cf-0160c9b48191' AND description_ar IS NOT DISTINCT FROM $old$أرز ريزوتو بصلصة ألفريدو كريمية، معجون الكمأة، فطر مشوي، مزين بالزعتر الطازج (إضافة دجاج) 2 دينار.$old$;

-- ===== Fries
-- Commando Fries
UPDATE public.menu_items SET description_bs = $new$Pomfrit, sos od sira, Thousand Island sos, sjeckane kisele jalapeño papričice, hrskavi prženi luk, ukrašeno mladim lukom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = '0df96c54-2721-4dfd-b901-f0b47f535b9b' AND description_bs IS NOT DISTINCT FROM $old$Pomfrit, sos od sira, sos Thousand Island, seckani kiseli jalapeno, hrskavo prženi luk, ukrašen mladim lukom i Sakura mješavinom.$old$;
-- La Soul Fries
UPDATE public.menu_items SET description_bs = $new$Pomfrit, sos od sira, miješana paprika, kiselo vrhnje na vrhu, ukrašeno mladim lukom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = '342e5ad6-833c-4522-bcf1-3ff62e2d41d8' AND description_bs IS NOT DISTINCT FROM $old$Pomfrit, sos od sira, miješana paprika, kisela pavlaka na vrhu, ukrašena mladim lukom i Sakura mješavinom.$old$;
UPDATE public.menu_items SET description_ar = $new$بطاطس مقلية، صلصة جبنة، فلفل رومي مشكّل، كريمة حامضة في الأعلى، مزيّنة بالبصل الأخضر وخلطة ساكورا.$new$, updated_at = now()
 WHERE id = '342e5ad6-833c-4522-bcf1-3ff62e2d41d8' AND description_ar IS NOT DISTINCT FROM $old$بطاطس مقلية، صلصة جبنة، مزيج فلفل، كريمة حامضة في الأعلى، مزينة بالبصل الأخضر وخلطة ساكورا.$old$;
-- Original Cheese Fries
UPDATE public.menu_items SET name_bs = $new$Original pomfrit sa sirom$new$, updated_at = now()
 WHERE id = '78dfd2e2-d8a8-4df6-aa33-c5945daa166d' AND name_bs IS NOT DISTINCT FROM NULL;
UPDATE public.menu_items SET name_ar = $new$بطاطس بالجبن الأصلية$new$, updated_at = now()
 WHERE id = '78dfd2e2-d8a8-4df6-aa33-c5945daa166d' AND name_ar IS NOT DISTINCT FROM NULL;
UPDATE public.menu_items SET description_bs = $new$Pomfrit, sos od sira, originalni sos, sjeckane kisele jalapeño papričice, ukrašeno mladim lukom i Sakura mješavinom.$new$, updated_at = now()
 WHERE id = '78dfd2e2-d8a8-4df6-aa33-c5945daa166d' AND description_bs IS NOT DISTINCT FROM NULL;
UPDATE public.menu_items SET description_ar = $new$بطاطس مقلية، صلصة جبنة، الصلصة الأصلية، هلابينو مخلل مفروم، مزيّنة بالبصل الأخضر وخلطة ساكورا.$new$, updated_at = now()
 WHERE id = '78dfd2e2-d8a8-4df6-aa33-c5945daa166d' AND description_ar IS NOT DISTINCT FROM NULL;
-- Regular Fries
UPDATE public.menu_items SET name_bs = $new$Obični pomfrit$new$, updated_at = now()
 WHERE id = '8b74e59f-2730-4384-97c2-1d5f159af57b' AND name_bs IS NOT DISTINCT FROM $old$Regularni Pomfrit$old$;
-- Seasoned Truffle Fries
UPDATE public.menu_items SET name_bs = $new$Začinjeni pomfrit s tartufom$new$, updated_at = now()
 WHERE id = '027e08fc-6556-439f-896e-bfe78c39c735' AND name_bs IS NOT DISTINCT FROM $old$Začinjeni Pomfrit s Tartufima$old$;
UPDATE public.menu_items SET name_ar = $new$بطاطس متبّلة بالكمأة$new$, updated_at = now()
 WHERE id = '027e08fc-6556-439f-896e-bfe78c39c735' AND name_ar IS NOT DISTINCT FROM $old$بطاطس الكمأة المتبلة$old$;
UPDATE public.menu_items SET description_bs = $new$Pomfrit, sos od tartufa i gljiva s naribanim parmezanom, posut tostiranim tartufom.$new$, updated_at = now()
 WHERE id = '027e08fc-6556-439f-896e-bfe78c39c735' AND description_bs IS NOT DISTINCT FROM $old$Pomfrit, umak od tartufa i gljiva sa naribanim parmezanom preliven tostiranim tartufom.$old$;

-- ===== Kids Menu
-- Chicken Burger
UPDATE public.menu_items SET name_bs = $new$Pileći burger$new$, updated_at = now()
 WHERE id = '1141a6bb-8d91-47fc-a985-9d744646d127' AND name_bs IS NOT DISTINCT FROM $old$Pileći Burger$old$;
-- Chicken Burger Combo
UPDATE public.menu_items SET name_bs = $new$Pileći burger meni$new$, updated_at = now()
 WHERE id = 'ca56673c-0329-4d5f-ba49-cb602e2cda71' AND name_bs IS NOT DISTINCT FROM $old$Kombinacija Pilećeg Burgera$old$;
UPDATE public.menu_items SET description_bs = $new$Mali burger s hrskavom piletinom, pomfrit i piće (Coca-Cola ili svježi sok od narandže).$new$, updated_at = now()
 WHERE id = 'ca56673c-0329-4d5f-ba49-cb602e2cda71' AND description_bs IS NOT DISTINCT FROM $old$Mali burger sa hrskavom piletinom, pomfritom, pićem (Coca-Cola ili svježi sok od narandže).$old$;
-- Chicken Strips
UPDATE public.menu_items SET name_ar = $new$أصابع الدجاج$new$, updated_at = now()
 WHERE id = '2f1e8504-ded4-4b6c-8749-ca0f7678b2e6' AND name_ar IS NOT DISTINCT FROM $old$شرائح دجاج$old$;
UPDATE public.menu_items SET description_bs = $new$Pohovani pileći štapići s hrskavom koricom, uz slatko-kiseli sos.$new$, updated_at = now()
 WHERE id = '2f1e8504-ded4-4b6c-8749-ca0f7678b2e6' AND description_bs IS NOT DISTINCT FROM $old$Pržene pileće trake sa hrskavom oblogom, servirane sa slatko-kiselim sosom.$old$;
UPDATE public.menu_items SET description_ar = $new$أصابع دجاج مقلية مقرمشة، تُقدَّم مع صلصة الحلو والحامض.$new$, updated_at = now()
 WHERE id = '2f1e8504-ded4-4b6c-8749-ca0f7678b2e6' AND description_ar IS NOT DISTINCT FROM $old$شرائح دجاج مقلية بتغطية مقرمشة، تقدم مع صلصة حامض حلو.$old$;
-- Chicken Strips Combo
UPDATE public.menu_items SET name_bs = $new$Pileći štapići meni$new$, updated_at = now()
 WHERE id = 'c06f4ec2-1bda-4c16-ab49-36f88a059f52' AND name_bs IS NOT DISTINCT FROM $old$Kombinacija Pilećih Štapića$old$;
UPDATE public.menu_items SET name_ar = $new$وجبة أصابع الدجاج$new$, updated_at = now()
 WHERE id = 'c06f4ec2-1bda-4c16-ab49-36f88a059f52' AND name_ar IS NOT DISTINCT FROM $old$وجبة شرائح دجاج$old$;
UPDATE public.menu_items SET description_bs = $new$Pohovani pileći štapići s hrskavom koricom, uz pomfrit, slatko-kiseli sos i osvježavajuće piće (Coca-Cola ili svježi sok od narandže).$new$, updated_at = now()
 WHERE id = 'c06f4ec2-1bda-4c16-ab49-36f88a059f52' AND description_bs IS NOT DISTINCT FROM $old$Pržene pileće trake sa hrskavom oblogom, servirane sa pomfritom, slatko-kiselim sosom i osvježavajućim pićem (Coca-Cola ili svježi sok od narandže).$old$;
UPDATE public.menu_items SET description_ar = $new$أصابع دجاج مقلية مقرمشة، تُقدَّم مع بطاطس مقلية وصلصة الحلو والحامض ومشروب منعش (كوكا كولا أو عصير برتقال طازج).$new$, updated_at = now()
 WHERE id = 'c06f4ec2-1bda-4c16-ab49-36f88a059f52' AND description_ar IS NOT DISTINCT FROM $old$شرائح دجاج مقلية بتغطية مقرمشة، تقدم مع بطاطس مقلية، صلصة حامض حلو، ومشروب منعش (كوكا كولا أو عصير برتقال طازج).$old$;
-- Mozarella Sticks
UPDATE public.menu_items SET name_bs = $new$Štapići od mocarele$new$, updated_at = now()
 WHERE id = 'a372aceb-d87e-427e-8631-57cfdaf5a461' AND name_bs IS NOT DISTINCT FROM $old$Mozzarella Štapići$old$;
-- Mozarella Sticks Combo
UPDATE public.menu_items SET name_bs = $new$Štapići od mocarele meni$new$, updated_at = now()
 WHERE id = '821f3185-5ab7-4046-818f-55460b7d0288' AND name_bs IS NOT DISTINCT FROM $old$Kombinacija Mozzarella Štapića$old$;
UPDATE public.menu_items SET name_ar = $new$وجبة أصابع موزاريلا$new$, updated_at = now()
 WHERE id = '821f3185-5ab7-4046-818f-55460b7d0288' AND name_ar IS NOT DISTINCT FROM $old$وجبة أصابع موتزاريلا$old$;
-- White Sauce Pasta Combo
UPDATE public.menu_items SET name_bs = $new$Tjestenina u bijelom sosu meni$new$, updated_at = now()
 WHERE id = '4d2fdded-496d-4eda-9e1e-0c413b8730f1' AND name_bs IS NOT DISTINCT FROM $old$Kombinacija Tjestenine u Bijelom Sosu$old$;
UPDATE public.menu_items SET description_bs = $new$Tjestenina u bijelom sosu + gazirano piće ili sok od narandže.$new$, updated_at = now()
 WHERE id = '4d2fdded-496d-4eda-9e1e-0c413b8730f1' AND description_bs IS NOT DISTINCT FROM $old$Tjestenina u Bijelom Sosu + Gazirano Piće Ili Sok Od Narandže.$old$;

-- ===== Desserts
-- Asseda
UPDATE public.menu_items SET description_bs = $new$Asseda fondant od svježe pasirane bundeve s raznim začinima, preliven sladoledom od vanilije.$new$, updated_at = now()
 WHERE id = '7cac5bf1-daed-4382-8a08-91095b03f202' AND description_bs IS NOT DISTINCT FROM $old$Asseda fondant, napravljena od svježe pasirane bundeve, sa različitim začinima i prelita sladoledom od vanilije.$old$;
UPDATE public.menu_items SET description_ar = $new$عصيدة بقوام الفوندان من اليقطين الطازج المهروس مع تشكيلة من البهارات، يعلوها آيس كريم الفانيليا.$new$, updated_at = now()
 WHERE id = '7cac5bf1-daed-4382-8a08-91095b03f202' AND description_ar IS NOT DISTINCT FROM $old$عصيدة الفوندان، مصنوعة من اليقطين الطازج المهروس، مع بهارات مختلفة ومغطاة بآيس كريم الفانيليا.$old$;
-- Butter Croissant
UPDATE public.menu_items SET description_bs = $new$Klasični kroasan puterastog okusa, prhak i lisnat, pripremljen s margarinom, s lijepom strukturom saća iznutra; uz domaći džem od jagoda.$new$, updated_at = now()
 WHERE id = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5' AND description_bs IS NOT DISTINCT FROM $old$Običan kroasan s puterom i listićima, napravljen od margarina, predivnog dizajna saća iznutra, serviran sa domaćim džemom od jagoda.$old$;
UPDATE public.menu_items SET description_ar = $new$كرواسون سادة بطعم الزبدة، هشّ ومورّق، محضّر بالمارجرين، بتجاويف جميلة كخلية النحل من الداخل، يُقدَّم مع مربى الفراولة المنزلي.$new$, updated_at = now()
 WHERE id = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5' AND description_ar IS NOT DISTINCT FROM $old$كرواسون عادي زبدي ورقائق، مصنوع من المارجرين، تصميم خلية نحل جميل من الداخل، يقدم مع مربى الفراولة المصنوع منزليًا.$old$;
-- Caramel Mousse Cup
UPDATE public.menu_items SET name_bs = $new$Karamel mus u čaši$new$, updated_at = now()
 WHERE id = '74deca31-bc41-499a-83a8-8a8b27854f90' AND name_bs IS NOT DISTINCT FROM $old$Karamel Mousse Kup$old$;
UPDATE public.menu_items SET description_bs = $new$Karamel mus spaja svilenkasto glatku teksturu karamela s hrskavim orašastim plodovima.$new$, updated_at = now()
 WHERE id = '74deca31-bc41-499a-83a8-8a8b27854f90' AND description_bs IS NOT DISTINCT FROM $old$Kremasti karamel mousse kombinuje svilenkasto-glatku teksturu karamela sa zadovoljavajućom hrskavošću orašastih plodova.$old$;
UPDATE public.menu_items SET description_ar = $new$يجمع موس الكراميل بين قوام الكراميل الحريري وقرمشة المكسرات الشهية.$new$, updated_at = now()
 WHERE id = '74deca31-bc41-499a-83a8-8a8b27854f90' AND description_ar IS NOT DISTINCT FROM $old$موس الكراميل يجمع بين قوام الكراميل الناعم واللذيذ مع قرمشة المكسرات المرضية.$old$;
-- Chocolate Bomb
UPDATE public.menu_items SET name_bs = $new$Čokoladna bomba$new$, updated_at = now()
 WHERE id = 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887' AND name_bs IS NOT DISTINCT FROM $old$Čoko Bomba$old$;
UPDATE public.menu_items SET name_ar = $new$قنبلة الشوكولاتة$new$, updated_at = now()
 WHERE id = 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887' AND name_ar IS NOT DISTINCT FROM $old$شوكلت بومب$old$;
UPDATE public.menu_items SET description_bs = $new$Čokoladna bomba punjena čokoladnim musom, dulce de leche i čokoladnim biskvitom, sa sladoledom od vanilije i čokoladnim ganacheom na vrhu.$new$, updated_at = now()
 WHERE id = 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887' AND description_bs IS NOT DISTINCT FROM $old$Čokoladna bomba punjena čokoladnim musom, karamelom i čokoladnom spužvom nakon sladoleda od vanilije i čokoladnog ganache preljeva.$old$;
UPDATE public.menu_items SET description_ar = $new$قنبلة شوكولاتة محشوة بموس الشوكولاتة ودولسي دي ليتشي وكيك الشوكولاتة الإسفنجي، يعلوها آيس كريم الفانيليا وغاناش الشوكولاتة.$new$, updated_at = now()
 WHERE id = 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887' AND description_ar IS NOT DISTINCT FROM $old$قنبلة شوكولاتة محشوة بموس الشوكولاتة ودولسي دي ليتشي وكعكة الشوكولاتة الإسفنجية بعد آيس كريم الفانيليا وغاناش الشوكولاتة في الأعلى.$old$;
-- Chocolate Mousse Cup
UPDATE public.menu_items SET name_bs = $new$Čokoladni mus u čaši$new$, updated_at = now()
 WHERE id = '097b3ea3-1ba2-46f5-a0a0-d70731ddf837' AND name_bs IS NOT DISTINCT FROM $old$Čokoladni Mousse Kup$old$;
UPDATE public.menu_items SET name_ar = $new$كوب موس الشوكولاتة$new$, updated_at = now()
 WHERE id = '097b3ea3-1ba2-46f5-a0a0-d70731ddf837' AND name_ar IS NOT DISTINCT FROM $old$كوب موس الشوكولاته$old$;
UPDATE public.menu_items SET description_ar = $new$نكهة الشوكولاتة الغنية تجعله حلوى فاخرة لكل عشاق الشوكولاتة.$new$, updated_at = now()
 WHERE id = '097b3ea3-1ba2-46f5-a0a0-d70731ddf837' AND description_ar IS NOT DISTINCT FROM $old$نكهة الشوكولاتة الغنية تجعلها حلوى فاخرة لأي محب للشوكولاتة.$old$;
-- Churros
UPDATE public.menu_items SET description_bs = $new$Churros su prženo tijesto od choux mase, vruće i hrskavo izvana, a mekano iznutra, uz čokoladni sos.$new$, updated_at = now()
 WHERE id = '4bdf76b3-b150-46f5-b059-0f228d48c56d' AND description_bs IS NOT DISTINCT FROM $old$Churros je prženo tijesto napravljeno od choux tijesta, vruće i hrskavo izvana, pjenasto iznutra, servirano sa čokoladnim sosom.$old$;
UPDATE public.menu_items SET description_ar = $new$التشوروز عجينة مقلية من عجينة الشو، ساخنة ومقرمشة من الخارج وهشة من الداخل، تُقدَّم مع صلصة الشوكولاتة.$new$, updated_at = now()
 WHERE id = '4bdf76b3-b150-46f5-b059-0f228d48c56d' AND description_ar IS NOT DISTINCT FROM $old$تشوروز هو عجينة مقلية مصنوعة من عجينة الشو، ساخن ومقرمش من الخارج، رقيق من الداخل، يقدم مع صلصة الشوكولاتة.$old$;
-- Creme Brulee
UPDATE public.menu_items SET description_bs = $new$Desert od bogate kreme s hrskavim slojem karamelizovanog šećera na vrhu.$new$, updated_at = now()
 WHERE id = '0517de46-e686-4529-a965-7a4bd6f06bfd' AND description_bs IS NOT DISTINCT FROM $old$Desert koji se sastoji od bogate kreme prekrivene slojem tvrdog karamelizovanog šećera.$old$;
UPDATE public.menu_items SET description_ar = $new$حلوى من قاعدة كاسترد غنية تعلوها طبقة مقرمشة من السكر المكرمل.$new$, updated_at = now()
 WHERE id = '0517de46-e686-4529-a965-7a4bd6f06bfd' AND description_ar IS NOT DISTINCT FROM $old$حلوى تتكون من قاعدة كاسترد غنية تعلوها طبقة من السكر المكرمل الصلب.$old$;
-- Dubai Chocolate Cup
UPDATE public.menu_items SET name_bs = $new$Dubai čokolada u čaši$new$, updated_at = now()
 WHERE id = '0cca7a58-b664-42f7-8655-21e1e55db6fe' AND name_bs IS NOT DISTINCT FROM $old$Dubai Čokoladni Kup$old$;
UPDATE public.menu_items SET description_bs = $new$Slojeviti desert inspirisan viralnom dubai čokoladom.$new$, updated_at = now()
 WHERE id = '0cca7a58-b664-42f7-8655-21e1e55db6fe' AND description_bs IS NOT DISTINCT FROM $old$Slojeviti desert inspiriran viralnom Dubai čokoladnom pločicom.$old$;
UPDATE public.menu_items SET description_ar = $new$حلوى بطبقات مستوحاة من لوح شوكولاتة دبي الشهير.$new$, updated_at = now()
 WHERE id = '0cca7a58-b664-42f7-8655-21e1e55db6fe' AND description_ar IS NOT DISTINCT FROM $old$حلوى طبقات مستوحاة من قالب الشوكولاتة الشهير بدبي.$old$;
-- Dubai Pudding
UPDATE public.menu_items SET name_bs = $new$Dubai puding$new$, updated_at = now()
 WHERE id = '305546e4-7051-4eff-95ba-ca4811f5fab1' AND name_bs IS NOT DISTINCT FROM $old$Dubajski Puding$old$;
UPDATE public.menu_items SET name_ar = $new$بودينغ دبي$new$, updated_at = now()
 WHERE id = '305546e4-7051-4eff-95ba-ca4811f5fab1' AND name_ar IS NOT DISTINCT FROM $old$بودنغ دبي$old$;
UPDATE public.menu_items SET description_bs = $new$Izvanredan puding s pistaćima na topljenoj čokoladi, sve na podlozi od kadaifa.$new$, updated_at = now()
 WHERE id = '305546e4-7051-4eff-95ba-ca4811f5fab1' AND description_bs IS NOT DISTINCT FROM $old$Izvanredan puding sa pistaćima na vrhu topljene čokolade, a sve to sa bazom od kadaifa.$old$;
UPDATE public.menu_items SET description_ar = $new$بودينغ استثنائي مع الفستق فوق الشوكولاتة الذائبة، على قاعدة من الكنافة.$new$, updated_at = now()
 WHERE id = '305546e4-7051-4eff-95ba-ca4811f5fab1' AND description_ar IS NOT DISTINCT FROM $old$بودنغ استثنائي مع الفستق على قمة شوكولاتة ذائبة، وكل ذلك مع قاعدة من الكنافة.$old$;
-- La Soul Pudding
UPDATE public.menu_items SET name_ar = $new$بودينغ La Soul$new$, updated_at = now()
 WHERE id = '1b32868f-09ea-4b0e-ba0b-29fe366ff0e8' AND name_ar IS NOT DISTINCT FROM $old$La Soul بودينغ$old$;
UPDATE public.menu_items SET description_bs = $new$Kremasti slojeviti puding od medenih keksa i karamela s krem sirom.$new$, updated_at = now()
 WHERE id = '1b32868f-09ea-4b0e-ba0b-29fe366ff0e8' AND description_bs IS NOT DISTINCT FROM $old$Puding od keksa je kremasti slojeviti puding napravljen od medenih keksa i karamela sa krem sirom.$old$;
UPDATE public.menu_items SET description_ar = $new$بودينغ بسكويت كريمي بطبقات من بسكويت العسل والكراميل مع كريمة الجبن.$new$, updated_at = now()
 WHERE id = '1b32868f-09ea-4b0e-ba0b-29fe366ff0e8' AND description_ar IS NOT DISTINCT FROM $old$بودينغ البسكويت هو طبقات كريمية مصنوعة من بسكويت العسل والكراميل مع كريمة الجبن.$old$;
-- Lava Cake
UPDATE public.menu_items SET name_bs = $new$Lava kolač$new$, updated_at = now()
 WHERE id = '8ecbbf48-1572-4f8f-afc8-81bbc0c43643' AND name_bs IS NOT DISTINCT FROM $old$Lava Kolač$old$;
UPDATE public.menu_items SET name_ar = $new$لافا كيك$new$, updated_at = now()
 WHERE id = '8ecbbf48-1572-4f8f-afc8-81bbc0c43643' AND name_ar IS NOT DISTINCT FROM $old$كيكة الحمم البركانية$old$;
-- Malt Brownie with Ice Cream
UPDATE public.menu_items SET name_bs = $new$Malt Brownie sa sladoledom$new$, updated_at = now()
 WHERE id = '1a9f5477-4ce9-4120-b9c5-51c4dfc460c2' AND name_bs IS NOT DISTINCT FROM $old$Malt Brownie sa Sladoledom$old$;
UPDATE public.menu_items SET description_bs = $new$Čokoladni brownie s puterom, žvakav izvana i mekan iznutra, posut šećerom u prahu i bademovim listićima, uz kuglu sladoleda od vanilije.$new$, updated_at = now()
 WHERE id = '1a9f5477-4ce9-4120-b9c5-51c4dfc460c2' AND description_bs IS NOT DISTINCT FROM $old$To je čokoladni, sočni i žvakavi brauni sa puterom, hrskav izvana, a mekan iznutra, preliven šećerom u prahu, bademovim listićima i kuglom sladoleda od vanilije.$old$;
UPDATE public.menu_items SET description_ar = $new$براوني شوكولاتة بالزبدة، مطاطي من الخارج وطري من الداخل، مع رشة سكر بودرة ورقائق اللوز وكرة من آيس كريم الفانيليا.$new$, updated_at = now()
 WHERE id = '1a9f5477-4ce9-4120-b9c5-51c4dfc460c2' AND description_ar IS NOT DISTINCT FROM $old$إنه شوكولاتة مطاطية بالزبدة من الخارج وناعمة من الداخل على قمة سكر بودرة، رقائق اللوز ومغرفة من آيس كريم الفانيليا.$old$;
-- Red Velvet Cup
UPDATE public.menu_items SET name_bs = $new$Red Velvet u čaši$new$, updated_at = now()
 WHERE id = 'af9206a4-9de2-46a7-8162-2b028bacdf7e' AND name_bs IS NOT DISTINCT FROM $old$Red Velvet Kup$old$;
UPDATE public.menu_items SET description_bs = $new$Red velvet kolač u čaši: klasičan, blago kiselkast i sočan.$new$, updated_at = now()
 WHERE id = 'af9206a4-9de2-46a7-8162-2b028bacdf7e' AND description_bs IS NOT DISTINCT FROM $old$Crveni baršunasti kolač kombinuje klasičan, oštar i vlažan red velvet.$old$;
UPDATE public.menu_items SET description_ar = $new$كيك ريد فيلفيت كلاسيكي في كوب، بقوام طري ونكهة مائلة للحموضة.$new$, updated_at = now()
 WHERE id = 'af9206a4-9de2-46a7-8162-2b028bacdf7e' AND description_ar IS NOT DISTINCT FROM $old$كوب كيك ريد فيلفيت يجمع بين الكلاسيكية، الحادة والرطبة.$old$;
-- Saffron Milk Cake
UPDATE public.menu_items SET name_bs = $new$Mliječni kolač sa šafranom$new$, updated_at = now()
 WHERE id = 'b6b9bc9d-820d-4f81-be70-9805797e2e57' AND name_bs IS NOT DISTINCT FROM $old$Saffron Mliječni Kolač$old$;
UPDATE public.menu_items SET description_bs = $new$Biskvit natopljen šafranovim sosom, prekriven šlagom, zlatnim listićima i nitima šafrana.$new$, updated_at = now()
 WHERE id = 'b6b9bc9d-820d-4f81-be70-9805797e2e57' AND description_bs IS NOT DISTINCT FROM $old$Spužvasta tekstura natopljena šafranovim umakom, preliveno slatkom pavlakom, zlatnim listićima i sjemenkama šafrana na vrhu.$old$;
UPDATE public.menu_items SET description_ar = $new$كيك إسفنجي مشبع بصلصة الزعفران، تعلوه كريمة مخفوقة وورق الذهب وخيوط الزعفران.$new$, updated_at = now()
 WHERE id = 'b6b9bc9d-820d-4f81-be70-9805797e2e57' AND description_ar IS NOT DISTINCT FROM $old$نسيج إسفنجي مشرب بصلصة الزعفران، ومغطى بكريمة خفق، أوراق ذهبية وبذور الزعفران في الأعلى.$old$;
-- Saffron Milk Cake Cup
UPDATE public.menu_items SET name_bs = $new$Mliječni kolač sa šafranom u čaši$new$, updated_at = now()
 WHERE id = 'f943db31-5714-42ce-83a9-e065ba20efc8' AND name_bs IS NOT DISTINCT FROM $old$Saffron Mliječni Kolač Kup$old$;
UPDATE public.menu_items SET name_ar = $new$كيكة الحليب بالزعفران في كوب$new$, updated_at = now()
 WHERE id = 'f943db31-5714-42ce-83a9-e065ba20efc8' AND name_ar IS NOT DISTINCT FROM $old$كوب كيك حليب بالزعفران$old$;
UPDATE public.menu_items SET description_bs = $new$Bogat, zlatan i aromatičan mliječni kolač s blago cvjetnim okusom šafrana.$new$, updated_at = now()
 WHERE id = 'f943db31-5714-42ce-83a9-e065ba20efc8' AND description_bs IS NOT DISTINCT FROM $old$Mliječni kolač od šafrana bogat je, zlatan, aromatičan i blago cvjetnog okusa šafrana.$old$;
UPDATE public.menu_items SET description_ar = $new$كيكة حليب بالزعفران غنية وذهبية وعطرية، بنكهة زهرية خفيفة.$new$, updated_at = now()
 WHERE id = 'f943db31-5714-42ce-83a9-e065ba20efc8' AND description_ar IS NOT DISTINCT FROM $old$كيكة حليب الزعفران غنية وذهبية وعطرية وذات نكهة زهرية خفيفة من الزعفران.$old$;
-- San Sebastian Cheesecake
UPDATE public.menu_items SET description_bs = $new$Gusti, kremasti fil od sira, jaja i šećera na tankoj kori, preliven čokoladnim sosom.$new$, updated_at = now()
 WHERE id = '09af75d1-cdfc-49b4-bdd8-85fafc5fc656' AND description_bs IS NOT DISTINCT FROM $old$Debeli, kremasti fil od sira, jaja i šećera preko tanje kore i preliven čokoladnim sosom.$old$;
-- Sticky Dates Pudding
UPDATE public.menu_items SET name_bs = $new$Puding od datulja$new$, updated_at = now()
 WHERE id = 'e91c133c-4345-4425-9a69-7fb4e1c91af4' AND name_bs IS NOT DISTINCT FROM $old$Sticky Dates Puding$old$;
UPDATE public.menu_items SET name_ar = $new$بودينغ التمر$new$, updated_at = now()
 WHERE id = 'e91c133c-4345-4425-9a69-7fb4e1c91af4' AND name_ar IS NOT DISTINCT FROM $old$بودنغ التمر اللزج$old$;
UPDATE public.menu_items SET description_bs = $new$Sočan biskvit od sitno sjeckanih datulja, preliven karamel sosom, uz sladoled od vanilije.$new$, updated_at = now()
 WHERE id = 'e91c133c-4345-4425-9a69-7fb4e1c91af4' AND description_bs IS NOT DISTINCT FROM $old$Vlažan spužvasti kolač, napravljen od sitno sjeckanih datulja, prekriven karamel sosom i poslužen sa sladoledom od vanilije.$old$;
-- Tiramisu Cup
UPDATE public.menu_items SET name_bs = $new$Tiramisu u čaši$new$, updated_at = now()
 WHERE id = 'f665c769-e1b0-47f7-87b0-63961e44ee2a' AND name_bs IS NOT DISTINCT FROM $old$Tiramisu Kup$old$;
UPDATE public.menu_items SET description_bs = $new$Kremasti tiramisu s okusom kafe, po italijanskom receptu.$new$, updated_at = now()
 WHERE id = 'f665c769-e1b0-47f7-87b0-63961e44ee2a' AND description_bs IS NOT DISTINCT FROM $old$Tiramisu, kremast i sa okusom kafe, baziran na italijanskoj recepturi.$old$;
-- Tiramisu with Espresso Coffee Shot
UPDATE public.menu_items SET name_bs = $new$Tiramisu s espressom$new$, updated_at = now()
 WHERE id = '450cbb3c-a0ca-4774-b3fc-d47705559ab3' AND name_bs IS NOT DISTINCT FROM $old$Tiramisu sa Espresso Shotom$old$;
UPDATE public.menu_items SET name_ar = $new$تيراميسو مع شوت إسبريسو$new$, updated_at = now()
 WHERE id = '450cbb3c-a0ca-4774-b3fc-d47705559ab3' AND name_ar IS NOT DISTINCT FROM $old$تيراميسو مع شوت قهوة إسبريسو$old$;
UPDATE public.menu_items SET description_bs = $new$Piškote u slojevima s umućenom smjesom jaja, šećera i mascarponea, s okusom kafe, uz espresso.$new$, updated_at = now()
 WHERE id = '450cbb3c-a0ca-4774-b3fc-d47705559ab3' AND description_bs IS NOT DISTINCT FROM $old$Napravljeno od piškota, slojevito sa umućenom smjesom jaja, šećera i mascarponea, aromatizirano kafom, posluženo sa shotom kafe.$old$;

-- ---------------------------------------------------------------------
-- 4. Report what did not land (NOTICE only, never an error)
-- ---------------------------------------------------------------------
DO $verify$
DECLARE
  v_total int;
  v_changed int;
  v_missing int;
  r record;
BEGIN
  CREATE TEMP TABLE _menu_translation_check ON COMMIT DROP AS
  SELECT i.tbl, i.id, i.field,
         CASE i.tbl
           WHEN 'menu_items' THEN EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = i.id)
           WHEN 'subcategories' THEN EXISTS (SELECT 1 FROM public.subcategories s WHERE s.id = i.id)
           ELSE EXISTS (SELECT 1 FROM public.categories c WHERE c.id = i.id)
         END AS row_exists,
         CASE i.tbl
           WHEN 'menu_items' THEN (
             SELECT CASE i.field WHEN 'name_bs' THEN m.name_bs WHEN 'name_ar' THEN m.name_ar
                                 WHEN 'description_bs' THEN m.description_bs ELSE m.description_ar END
               FROM public.menu_items m WHERE m.id = i.id)
           WHEN 'subcategories' THEN (
             SELECT CASE i.field WHEN 'name_bs' THEN s.name_bs ELSE s.name_ar END
               FROM public.subcategories s WHERE s.id = i.id)
           ELSE (
             SELECT CASE i.field WHEN 'name_bs' THEN c.name_bs ELSE c.name_ar END
               FROM public.categories c WHERE c.id = i.id)
         END IS NOT DISTINCT FROM i.val AS landed
    FROM (VALUES
    ('categories', '30f16ea1-33e6-4509-b1fc-1501a6865e7f'::uuid, 'name_ar', $v$مأكولات$v$),
    ('categories', '0c8e2f72-3b73-4191-ba90-2e62b4dacd69'::uuid, 'name_bs', $v$Deserti$v$),
    ('subcategories', '306f4bdf-695b-446f-b0fd-e3547e8fb6a0'::uuid, 'name_bs', $v$Deserti$v$),
    ('subcategories', 'b74b1d73-949b-4c35-9e54-c231da731801'::uuid, 'name_bs', $v$Filter kafa$v$),
    ('subcategories', '06550caf-be24-4686-9f35-7e62d712ec44'::uuid, 'name_bs', $v$Ledena kafa$v$),
    ('subcategories', 'e3fe5627-f5de-44d7-aefb-a68f8327f362'::uuid, 'name_bs', $v$Topli napici$v$),
    ('subcategories', '87029c90-d23c-4dcb-b61b-525158bba4b9'::uuid, 'name_bs', $v$Specijalni napici$v$),
    ('subcategories', '87029c90-d23c-4dcb-b61b-525158bba4b9'::uuid, 'name_ar', $v$مشروبات مميزة$v$),
    ('subcategories', 'f34928f6-ffcc-4e86-9bd2-4044f241b834'::uuid, 'name_bs', $v$Ledeni čaj$v$),
    ('subcategories', '825a9595-62a2-4ac7-a423-1978077cfa4d'::uuid, 'name_bs', $v$Svježi sokovi$v$),
    ('subcategories', '825a9595-62a2-4ac7-a423-1978077cfa4d'::uuid, 'name_ar', $v$عصائر طازجة$v$),
    ('subcategories', 'a5dd9e6f-df5c-47f2-95c6-6b0d880749e7'::uuid, 'name_ar', $v$ليمونادة$v$),
    ('subcategories', 'b5528d1e-d540-4895-af4d-737cd71c533e'::uuid, 'name_ar', $v$فطور$v$),
    ('subcategories', '3a8c9eef-ba95-425b-af01-879f0ad6eb83'::uuid, 'name_bs', $v$Predjela$v$),
    ('subcategories', '3e1d618b-ea9a-4d38-b235-7cb7408eb165'::uuid, 'name_bs', $v$Slideri$v$),
    ('subcategories', '0d2bf0db-3d84-4f63-ad2c-a3b7f3a8b25f'::uuid, 'name_bs', $v$Rižoto$v$),
    ('menu_items', '699add79-5dc1-4cc6-a37e-225440eb8901'::uuid, 'name_bs', $v$Glazirana piletina bez kostiju$v$),
    ('menu_items', '699add79-5dc1-4cc6-a37e-225440eb8901'::uuid, 'description_bs', $v$Pohovana piletina bez kostiju, pržena i uvaljana u buffalo sos, s miješanim susamom, ukrašena mladim lukom i Sakura mješavinom; kiselo vrhnje sa strane.$v$),
    ('menu_items', '699add79-5dc1-4cc6-a37e-225440eb8901'::uuid, 'description_ar', $v$قطع دجاج بلا عظم مقلية بطبقة مقرمشة، مقلّبة بصلصة البافلو ومزيج السمسم، مزيّنة بالبصل الأخضر وخلطة ساكورا، وتُقدَّم مع كريمة حامضة على الجانب.$v$),
    ('menu_items', '7f95bccf-38a4-449e-b9a1-2c0fafac4d2a'::uuid, 'name_bs', $v$Dinamit piletina$v$),
    ('menu_items', '7f95bccf-38a4-449e-b9a1-2c0fafac4d2a'::uuid, 'description_bs', $v$Pohovani hrskavi pileći zalogaji s dinamit sosom, zelenom salatom i miješanim susamom, ukrašeni mladim lukom i Sakura mješavinom.$v$),
    ('menu_items', 'cd05010d-d313-4cc2-8485-60f7c93d0ff7'::uuid, 'name_bs', $v$Mac & Cheese kuglice$v$),
    ('menu_items', 'cd05010d-d313-4cc2-8485-60f7c93d0ff7'::uuid, 'description_bs', $v$Pržene kuglice od tjestenine s ružičastim sosom, sosom od sira i naribanim parmezanom, ukrašene mladim lukom i Sakura mješavinom.$v$),
    ('menu_items', 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b'::uuid, 'name_bs', $v$Avokado na tostu$v$),
    ('menu_items', 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b'::uuid, 'description_bs', $v$Kremasti avokado na kriškama raženog hljeba, poširano jaje, sjemenke bundeve, sjemenke nara, čili pahuljice, narezana crvena rotkvica, ukrašeno Sakura mješavinom.$v$),
    ('menu_items', 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b'::uuid, 'name_ar', $v$توست الأفوكادو$v$),
    ('menu_items', 'be3ebd70-3235-4abd-b2dc-e71dc0b5a30b'::uuid, 'description_ar', $v$أفوكادو كريمي على شرائح خبز الجاودار، بيضة بوشيه، بذور اليقطين، بذور الرمان، رقائق الفلفل الحار، شرائح الفجل الأحمر، ومزيّن بخلطة ساكورا.$v$),
    ('menu_items', '5a674711-02e2-416e-99de-7fa1e76003aa'::uuid, 'name_bs', $v$Plata za doručak$v$),
    ('menu_items', '5a674711-02e2-416e-99de-7fa1e76003aa'::uuid, 'description_bs', $v$Miješani sirevi u maslinovom ulju i začinskom bilju, crne i zelene masline, hrskavi prženi falafel, kuhano jaje, menemen i labneh sa zatarom, uz pita hljeb sa strane.$v$),
    ('menu_items', '5a674711-02e2-416e-99de-7fa1e76003aa'::uuid, 'name_ar', $v$طبق الفطور$v$),
    ('menu_items', '5a674711-02e2-416e-99de-7fa1e76003aa'::uuid, 'description_ar', $v$تشكيلة من الأجبان بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، منيمن ولبنة بالزعتر، تُقدَّم مع خبز عربي على الجانب.$v$),
    ('menu_items', '7382930d-240f-48c4-a3e1-5555e8561e60'::uuid, 'name_bs', $v$Plata za doručak za dvoje$v$),
    ('menu_items', '7382930d-240f-48c4-a3e1-5555e8561e60'::uuid, 'description_bs', $v$Miješani sirevi u maslinovom ulju i začinskom bilju, crne i zelene masline, hrskavi prženi falafel, kuhano jaje, menemen, labneh sa zatarom, med, kajmak i ful medames, uz pita hljeb sa strane.$v$),
    ('menu_items', '7382930d-240f-48c4-a3e1-5555e8561e60'::uuid, 'name_ar', $v$طبق الفطور لشخصين$v$),
    ('menu_items', '7382930d-240f-48c4-a3e1-5555e8561e60'::uuid, 'description_ar', $v$تشكيلة من الأجبان بزيت الزيتون والأعشاب، زيتون أسود وأخضر، فلافل مقلية مقرمشة، بيض مسلوق، منيمن، لبنة بالزعتر، عسل، قشطة وفول مدمس، تُقدَّم مع خبز عربي على الجانب.$v$),
    ('menu_items', '894b970d-ba31-4382-9495-3e256af09a93'::uuid, 'name_bs', $v$Klasična jaja Benedikt$v$),
    ('menu_items', '894b970d-ba31-4382-9495-3e256af09a93'::uuid, 'description_bs', $v$Poširano jaje na engleskom mafinu, grilovana pureća šunka i sotirani špinat, preliveno holandez sosom, posuto paprikom i Sakura mješavinom, uz miješanu zelenu salatu i čeri paradajz sa strane.$v$),
    ('menu_items', '894b970d-ba31-4382-9495-3e256af09a93'::uuid, 'description_ar', $v$بيضة بوشيه على مافن إنجليزي، شرائح لحم ديك رومي مشوية وسبانخ سوتيه، تعلوها صلصة الهولنديز ورشة بابريكا وخلطة ساكورا، تُقدَّم مع خس مشكّل وطماطم كرزية على الجانب.$v$),
    ('menu_items', '7c9e6489-94ad-4ef5-a777-958f7f1bed9a'::uuid, 'description_bs', $v$Tostirani hljeb za francuski tost, kompot na vrhu, miješano zelenje, posuto šećerom u prahu, mrvljeni hljeb sa sladoledom, javorov sirup sa strane.$v$),
    ('menu_items', '7c9e6489-94ad-4ef5-a777-958f7f1bed9a'::uuid, 'description_ar', $v$خبز فرنش توست محمّص، كومبوت في الأعلى، خضار ورقية مشكّلة، رشة سكر بودرة، فتات خبز مع آيس كريم، وشراب القيقب على الجانب.$v$),
    ('menu_items', '609de519-2ef0-4fd5-af1a-26e59dc510b0'::uuid, 'name_bs', $v$Zdjela granole$v$),
    ('menu_items', '609de519-2ef0-4fd5-af1a-26e59dc510b0'::uuid, 'description_bs', $v$Kremasti grčki jogurt s granolom i kompotom od miješanog bobičastog voća.$v$),
    ('menu_items', '609de519-2ef0-4fd5-af1a-26e59dc510b0'::uuid, 'name_ar', $v$وعاء الجرانولا$v$),
    ('menu_items', '609de519-2ef0-4fd5-af1a-26e59dc510b0'::uuid, 'description_ar', $v$زبادي يوناني كريمي مع الجرانولا وكومبوت التوت المشكّل.$v$),
    ('menu_items', 'fb101638-731c-41d8-b8f7-4ffff7402bb4'::uuid, 'name_bs', $v$Lisnato s jajem i tartufom$v$),
    ('menu_items', 'fb101638-731c-41d8-b8f7-4ffff7402bb4'::uuid, 'description_bs', $v$Prozračno lisnato tijesto, sos od tartufa i gljiva, poširano jaje i pečena paprika, ukrašeno tostiranim gljivama s tartufom, naribanim parmezanom i Sakura mješavinom.$v$),
    ('menu_items', 'fb101638-731c-41d8-b8f7-4ffff7402bb4'::uuid, 'name_ar', $v$بف باستري بالبيض والكمأة$v$),
    ('menu_items', 'fb101638-731c-41d8-b8f7-4ffff7402bb4'::uuid, 'description_ar', $v$عجينة بف باستري هشّة مع صلصة الكمأة والفطر، تعلوها بيضة بوشيه وفلفل رومي مشوي، ومزيّنة بفطر الكمأة المحمّص وجبنة البارميزان المبشورة وخلطة ساكورا.$v$),
    ('menu_items', 'f90e4414-312d-4e3e-bae4-524d3e716296'::uuid, 'name_bs', $v$Šakšuka plata$v$),
    ('menu_items', 'f90e4414-312d-4e3e-bae4-524d3e716296'::uuid, 'description_bs', $v$Paradajz sos sa svježim paradajzom i lukom, s jajima pripremljenim po vašem izboru, feta sirom na vrhu i Sakura mješavinom (uz pita hljeb sa strane).$v$),
    ('menu_items', 'f90e4414-312d-4e3e-bae4-524d3e716296'::uuid, 'description_ar', $v$صلصة طماطم بنكهة الطماطم الطازجة والبصل، يعلوها البيض حسب اختيارك وجبنة الفيتا، ومزيّنة بخلطة ساكورا (تُقدَّم مع خبز عربي على الجانب).$v$),
    ('menu_items', 'd95c9607-3f9f-4982-a40d-27b2448ef1d3'::uuid, 'name_bs', $v$Punjeni kroasan s jajima i sirom$v$),
    ('menu_items', 'd95c9607-3f9f-4982-a40d-27b2448ef1d3'::uuid, 'description_bs', $v$Svježi kroasan punjen omletom, mocarelom i bijelim sosom s gljivama, posut paprikom i Sakura mješavinom, uz miješanu zelenu salatu i čeri paradajz sa strane.$v$),
    ('menu_items', 'd95c9607-3f9f-4982-a40d-27b2448ef1d3'::uuid, 'description_ar', $v$كرواسون طازج محشو بالأومليت وجبنة الموزاريلا والصلصة البيضاء بالفطر، مع رشة بابريكا وخلطة ساكورا، يُقدَّم مع خس مشكّل وطماطم كرزية على الجانب.$v$),
    ('menu_items', '3f002619-22fe-4b7e-91c3-3722c678665e'::uuid, 'name_bs', $v$Jaja Benedikt s tartufom$v$),
    ('menu_items', '3f002619-22fe-4b7e-91c3-3722c678665e'::uuid, 'description_bs', $v$Poširano jaje na engleskom mafinu, sos od tartufa i gljiva, preliveno holandez sosom i posuto tostiranim tartufom, uz miješanu zelenu salatu i čeri paradajz sa strane.$v$),
    ('menu_items', '3f002619-22fe-4b7e-91c3-3722c678665e'::uuid, 'name_ar', $v$بيض بنديكت بالكمأة$v$),
    ('menu_items', '3f002619-22fe-4b7e-91c3-3722c678665e'::uuid, 'description_ar', $v$بيضة بوشيه على مافن إنجليزي مع صلصة الكمأة والفطر، تعلوها صلصة الهولنديز ورشة من الكمأة المحمّصة، تُقدَّم مع خس مشكّل وطماطم كرزية على الجانب.$v$),
    ('menu_items', '818ee57e-d8e8-45d9-b3e0-cb498b02c705'::uuid, 'name_bs', $v$Turska jaja$v$),
    ('menu_items', '818ee57e-d8e8-45d9-b3e0-cb498b02c705'::uuid, 'description_ar', $v$زبادي كريمي بالثوم تعلوه بيضة بوشيه، مع رشة من الشبت المجفف ورقائق الفلفل الحار وزيت الفلفل الحار، ومزيّن بخلطة ساكورا. يُقدَّم مع خبز الجاودار المحمّص على الجانب.$v$),
    ('menu_items', '57ffe3df-eed0-4842-8d8e-62a70672063b'::uuid, 'name_bs', $v$Klasični burger s hrskavom piletinom$v$),
    ('menu_items', '57ffe3df-eed0-4842-8d8e-62a70672063b'::uuid, 'description_bs', $v$Brioš pecivo sa susamom, pržena hrskava piletina, kriške čedar sira, paradajz, luk, zelena salata, sos od meda i senfa.$v$),
    ('menu_items', '456e4131-b3ba-45ad-b609-6bfc89cf4dc2'::uuid, 'name_bs', $v$Dinamit pileći burger$v$),
    ('menu_items', '456e4131-b3ba-45ad-b609-6bfc89cf4dc2'::uuid, 'description_bs', $v$Brioš pecivo sa susamom, pržena hrskava piletina, kisele jalapeño papričice, kriške paradajza, kolutovi luka, zelena salata, dinamit sos.$v$),
    ('menu_items', '1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1'::uuid, 'description_bs', $v$Brioš pecivo sa susamom, juneća pljeskavica s mocarelom, kremasti avokado, hrskavi luk, specijalni sos i Fire House sos.$v$),
    ('menu_items', '1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1'::uuid, 'name_ar', $v$برجر La Soul$v$),
    ('menu_items', '6f618d6c-42a7-44a6-818a-13de098e1897'::uuid, 'description_bs', $v$Brioš pecivo sa susamom, juneća pljeskavica, kriške čedar sira, kiseli krastavci, paradajz, zelena salata, specijalni sos.$v$),
    ('menu_items', '6f618d6c-42a7-44a6-818a-13de098e1897'::uuid, 'name_ar', $v$برجر مانهاتن$v$),
    ('menu_items', '9592bf2c-6a81-4dad-89f1-db43ca9d5f1a'::uuid, 'description_bs', $v$Brioš pecivo sa susamom, juneća pljeskavica, mocarela, grilovane gljive i luk, originalni sos, zelena salata.$v$),
    ('menu_items', '9592bf2c-6a81-4dad-89f1-db43ca9d5f1a'::uuid, 'name_ar', $v$برجر الفطر$v$),
    ('menu_items', 'd428cbc8-229b-4a68-9b60-c0b13f56a92e'::uuid, 'description_bs', $v$Brioš pecivo sa susamom, juneća pljeskavica, kriške čedar sira, paradajz, luk, zelena salata, originalni sos.$v$),
    ('menu_items', 'd428cbc8-229b-4a68-9b60-c0b13f56a92e'::uuid, 'name_ar', $v$البرجر الأصلي$v$),
    ('menu_items', 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7'::uuid, 'name_bs', $v$Solar Gravity$v$),
    ('menu_items', 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7'::uuid, 'description_bs', $v$Pecivo od cvekle sa susamom, dupla juneća pljeskavica s čedar sirom, hrskavi kolutovi luka, kiseli krastavac, Solar Gravity sos.$v$),
    ('menu_items', 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7'::uuid, 'name_ar', $v$سولار جرافيتي$v$),
    ('menu_items', 'e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7'::uuid, 'description_ar', $v$خبز الشمندر بالسمسم، شريحتا لحم بقري مع جبنة شيدر، حلقات بصل مقرمشة، خيار مخلل، وصلصة سولار جرافيتي.$v$),
    ('menu_items', 'da5762f6-ed01-432d-861e-52995c2248d8'::uuid, 'name_bs', $v$Volcano juneći burger$v$),
    ('menu_items', 'da5762f6-ed01-432d-861e-52995c2248d8'::uuid, 'description_bs', $v$Pecivo od cvekle sa susamom, juneća pljeskavica, kriške čedar sira, Volcano sos, hrskave krompir niti, paradajz, luk.$v$),
    ('menu_items', 'da5762f6-ed01-432d-861e-52995c2248d8'::uuid, 'name_ar', $v$برجر فولكانو باللحم$v$),
    ('menu_items', 'da5762f6-ed01-432d-861e-52995c2248d8'::uuid, 'description_ar', $v$خبز الشمندر بالسمسم، شريحة لحم بقري، شرائح جبنة شيدر، صلصة فولكانو، خيوط بطاطس مقرمشة، طماطم، بصل.$v$),
    ('menu_items', 'a07007ee-af4b-4c47-88a2-254a28fb7a53'::uuid, 'name_bs', $v$Volcano burger s hrskavom piletinom$v$),
    ('menu_items', 'a07007ee-af4b-4c47-88a2-254a28fb7a53'::uuid, 'description_bs', $v$Pecivo od cvekle sa susamom, pržena hrskava piletina, kriške čedar sira, Volcano sos, hrskave krompir niti, paradajz, luk.$v$),
    ('menu_items', 'a07007ee-af4b-4c47-88a2-254a28fb7a53'::uuid, 'name_ar', $v$برجر فولكانو بالدجاج المقرمش$v$),
    ('menu_items', 'a07007ee-af4b-4c47-88a2-254a28fb7a53'::uuid, 'description_ar', $v$خبز الشمندر بالسمسم، دجاج مقرمش مقلي، شرائح جبنة شيدر، صلصة فولكانو، خيوط بطاطس مقرمشة، طماطم، بصل.$v$),
    ('menu_items', '19828d06-5910-45eb-9744-27df058c99ed'::uuid, 'description_bs', $v$Jednostavan, a snažan: Americano je espresso razrijeđen vrućom vodom, za bogat okus kafe.$v$),
    ('menu_items', '19828d06-5910-45eb-9744-27df058c99ed'::uuid, 'description_ar', $v$بسيط وقوي: الأمريكانو إسبريسو مخفف بالماء الساخن، لتجربة قهوة غنية.$v$),
    ('menu_items', '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62'::uuid, 'name_bs', $v$Cappuccino$v$),
    ('menu_items', '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62'::uuid, 'description_bs', $v$Italijanski klasik: Cappuccino je espresso s obiljem mliječne pjene, idealan za početak dana.$v$),
    ('menu_items', '238b7bdb-fab3-4ed9-b7aa-59ab01c2de62'::uuid, 'description_ar', $v$كلاسيكية إيطالية: الكابتشينو إسبريسو مع وفرة من رغوة الحليب، مثالي لبداية اليوم.$v$),
    ('menu_items', '27d8a2e7-3aa0-495e-ac7e-96dd2efd2c4e'::uuid, 'description_ar', $v$قهوة إسبريسو قوية مع قليل من رغوة الحليب، تجربة غنية لعشاق القهوة.$v$),
    ('menu_items', '445a26ba-ee0e-4008-97d2-74c88ba58be8'::uuid, 'description_ar', $v$إسبريسو حقيقي في أنقى صوره، بنكهة نقية ومركّزة.$v$),
    ('menu_items', '6d045710-1c52-4676-8a29-8c1df58b07f5'::uuid, 'description_ar', $v$إسبريسو حقيقي في أنقى صوره: الإسبريسو السولو نكهة نقية ومركّزة.$v$),
    ('menu_items', '9eead00b-463c-40f0-9529-9e5b36ced112'::uuid, 'description_ar', $v$بسيط وأنيق: إسبريسو بنسبة متساوية من الحليب، لقهوة كريمية ومتوازنة.$v$),
    ('menu_items', '1c6f552e-0a8e-48d4-9bbf-c2b092e85198'::uuid, 'description_bs', $v$Mali, ali moćan: Piccolo je espresso s vrlo malo mliječne pjene i snažnim okusom.$v$),
    ('menu_items', '1c6f552e-0a8e-48d4-9bbf-c2b092e85198'::uuid, 'name_ar', $v$بيكولو$v$),
    ('menu_items', '1c6f552e-0a8e-48d4-9bbf-c2b092e85198'::uuid, 'description_ar', $v$صغير لكنه قوي: البيكولو إسبريسو مع قليل من رغوة الحليب، بنكهة قوية ومركّزة.$v$),
    ('menu_items', 'd4322b5b-0c65-409e-9783-a834c6a641a3'::uuid, 'description_bs', $v$Intenzivna espresso kafa s malo vrućeg mlijeka; španski cortado je savršen izbor za ljubitelje jakog okusa kafe.$v$),
    ('menu_items', 'df6a0352-89e5-4be6-8694-79fe8a6ac5bf'::uuid, 'description_bs', $v$Kremasti latte sa slatkom mliječnom pjenom, za bogat okus kafe s daškom slatkoće.$v$),
    ('menu_items', '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5'::uuid, 'description_bs', $v$Klasični kroasan puterastog okusa, prhak i lisnat, pripremljen s margarinom, s lijepom strukturom saća iznutra; uz domaći džem od jagoda.$v$),
    ('menu_items', '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5'::uuid, 'description_ar', $v$كرواسون سادة بطعم الزبدة، هشّ ومورّق، محضّر بالمارجرين، بتجاويف جميلة كخلية النحل من الداخل، يُقدَّم مع مربى الفراولة المنزلي.$v$),
    ('menu_items', '7cac5bf1-daed-4382-8a08-91095b03f202'::uuid, 'description_bs', $v$Asseda fondant od svježe pasirane bundeve s raznim začinima, preliven sladoledom od vanilije.$v$),
    ('menu_items', '7cac5bf1-daed-4382-8a08-91095b03f202'::uuid, 'description_ar', $v$عصيدة بقوام الفوندان من اليقطين الطازج المهروس مع تشكيلة من البهارات، يعلوها آيس كريم الفانيليا.$v$),
    ('menu_items', '74deca31-bc41-499a-83a8-8a8b27854f90'::uuid, 'name_bs', $v$Karamel mus u čaši$v$),
    ('menu_items', '74deca31-bc41-499a-83a8-8a8b27854f90'::uuid, 'description_bs', $v$Karamel mus spaja svilenkasto glatku teksturu karamela s hrskavim orašastim plodovima.$v$),
    ('menu_items', '74deca31-bc41-499a-83a8-8a8b27854f90'::uuid, 'description_ar', $v$يجمع موس الكراميل بين قوام الكراميل الحريري وقرمشة المكسرات الشهية.$v$),
    ('menu_items', 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887'::uuid, 'name_bs', $v$Čokoladna bomba$v$),
    ('menu_items', 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887'::uuid, 'description_bs', $v$Čokoladna bomba punjena čokoladnim musom, dulce de leche i čokoladnim biskvitom, sa sladoledom od vanilije i čokoladnim ganacheom na vrhu.$v$),
    ('menu_items', 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887'::uuid, 'name_ar', $v$قنبلة الشوكولاتة$v$),
    ('menu_items', 'f9ab0a76-39a6-4e37-ac19-96d66cf2d887'::uuid, 'description_ar', $v$قنبلة شوكولاتة محشوة بموس الشوكولاتة ودولسي دي ليتشي وكيك الشوكولاتة الإسفنجي، يعلوها آيس كريم الفانيليا وغاناش الشوكولاتة.$v$),
    ('menu_items', '097b3ea3-1ba2-46f5-a0a0-d70731ddf837'::uuid, 'name_bs', $v$Čokoladni mus u čaši$v$),
    ('menu_items', '097b3ea3-1ba2-46f5-a0a0-d70731ddf837'::uuid, 'name_ar', $v$كوب موس الشوكولاتة$v$),
    ('menu_items', '097b3ea3-1ba2-46f5-a0a0-d70731ddf837'::uuid, 'description_ar', $v$نكهة الشوكولاتة الغنية تجعله حلوى فاخرة لكل عشاق الشوكولاتة.$v$),
    ('menu_items', '4bdf76b3-b150-46f5-b059-0f228d48c56d'::uuid, 'description_bs', $v$Churros su prženo tijesto od choux mase, vruće i hrskavo izvana, a mekano iznutra, uz čokoladni sos.$v$),
    ('menu_items', '4bdf76b3-b150-46f5-b059-0f228d48c56d'::uuid, 'description_ar', $v$التشوروز عجينة مقلية من عجينة الشو، ساخنة ومقرمشة من الخارج وهشة من الداخل، تُقدَّم مع صلصة الشوكولاتة.$v$),
    ('menu_items', '0517de46-e686-4529-a965-7a4bd6f06bfd'::uuid, 'description_bs', $v$Desert od bogate kreme s hrskavim slojem karamelizovanog šećera na vrhu.$v$),
    ('menu_items', '0517de46-e686-4529-a965-7a4bd6f06bfd'::uuid, 'description_ar', $v$حلوى من قاعدة كاسترد غنية تعلوها طبقة مقرمشة من السكر المكرمل.$v$),
    ('menu_items', '0cca7a58-b664-42f7-8655-21e1e55db6fe'::uuid, 'name_bs', $v$Dubai čokolada u čaši$v$),
    ('menu_items', '0cca7a58-b664-42f7-8655-21e1e55db6fe'::uuid, 'description_bs', $v$Slojeviti desert inspirisan viralnom dubai čokoladom.$v$),
    ('menu_items', '0cca7a58-b664-42f7-8655-21e1e55db6fe'::uuid, 'description_ar', $v$حلوى بطبقات مستوحاة من لوح شوكولاتة دبي الشهير.$v$),
    ('menu_items', '305546e4-7051-4eff-95ba-ca4811f5fab1'::uuid, 'name_bs', $v$Dubai puding$v$),
    ('menu_items', '305546e4-7051-4eff-95ba-ca4811f5fab1'::uuid, 'description_bs', $v$Izvanredan puding s pistaćima na topljenoj čokoladi, sve na podlozi od kadaifa.$v$),
    ('menu_items', '305546e4-7051-4eff-95ba-ca4811f5fab1'::uuid, 'name_ar', $v$بودينغ دبي$v$),
    ('menu_items', '305546e4-7051-4eff-95ba-ca4811f5fab1'::uuid, 'description_ar', $v$بودينغ استثنائي مع الفستق فوق الشوكولاتة الذائبة، على قاعدة من الكنافة.$v$),
    ('menu_items', '1b32868f-09ea-4b0e-ba0b-29fe366ff0e8'::uuid, 'description_bs', $v$Kremasti slojeviti puding od medenih keksa i karamela s krem sirom.$v$),
    ('menu_items', '1b32868f-09ea-4b0e-ba0b-29fe366ff0e8'::uuid, 'name_ar', $v$بودينغ La Soul$v$),
    ('menu_items', '1b32868f-09ea-4b0e-ba0b-29fe366ff0e8'::uuid, 'description_ar', $v$بودينغ بسكويت كريمي بطبقات من بسكويت العسل والكراميل مع كريمة الجبن.$v$),
    ('menu_items', '8ecbbf48-1572-4f8f-afc8-81bbc0c43643'::uuid, 'name_bs', $v$Lava kolač$v$),
    ('menu_items', '8ecbbf48-1572-4f8f-afc8-81bbc0c43643'::uuid, 'name_ar', $v$لافا كيك$v$),
    ('menu_items', '1a9f5477-4ce9-4120-b9c5-51c4dfc460c2'::uuid, 'name_bs', $v$Malt Brownie sa sladoledom$v$),
    ('menu_items', '1a9f5477-4ce9-4120-b9c5-51c4dfc460c2'::uuid, 'description_bs', $v$Čokoladni brownie s puterom, žvakav izvana i mekan iznutra, posut šećerom u prahu i bademovim listićima, uz kuglu sladoleda od vanilije.$v$),
    ('menu_items', '1a9f5477-4ce9-4120-b9c5-51c4dfc460c2'::uuid, 'description_ar', $v$براوني شوكولاتة بالزبدة، مطاطي من الخارج وطري من الداخل، مع رشة سكر بودرة ورقائق اللوز وكرة من آيس كريم الفانيليا.$v$),
    ('menu_items', 'af9206a4-9de2-46a7-8162-2b028bacdf7e'::uuid, 'name_bs', $v$Red Velvet u čaši$v$),
    ('menu_items', 'af9206a4-9de2-46a7-8162-2b028bacdf7e'::uuid, 'description_bs', $v$Red velvet kolač u čaši: klasičan, blago kiselkast i sočan.$v$),
    ('menu_items', 'af9206a4-9de2-46a7-8162-2b028bacdf7e'::uuid, 'description_ar', $v$كيك ريد فيلفيت كلاسيكي في كوب، بقوام طري ونكهة مائلة للحموضة.$v$),
    ('menu_items', 'b6b9bc9d-820d-4f81-be70-9805797e2e57'::uuid, 'name_bs', $v$Mliječni kolač sa šafranom$v$),
    ('menu_items', 'b6b9bc9d-820d-4f81-be70-9805797e2e57'::uuid, 'description_bs', $v$Biskvit natopljen šafranovim sosom, prekriven šlagom, zlatnim listićima i nitima šafrana.$v$),
    ('menu_items', 'b6b9bc9d-820d-4f81-be70-9805797e2e57'::uuid, 'description_ar', $v$كيك إسفنجي مشبع بصلصة الزعفران، تعلوه كريمة مخفوقة وورق الذهب وخيوط الزعفران.$v$),
    ('menu_items', 'f943db31-5714-42ce-83a9-e065ba20efc8'::uuid, 'name_bs', $v$Mliječni kolač sa šafranom u čaši$v$),
    ('menu_items', 'f943db31-5714-42ce-83a9-e065ba20efc8'::uuid, 'description_bs', $v$Bogat, zlatan i aromatičan mliječni kolač s blago cvjetnim okusom šafrana.$v$),
    ('menu_items', 'f943db31-5714-42ce-83a9-e065ba20efc8'::uuid, 'name_ar', $v$كيكة الحليب بالزعفران في كوب$v$),
    ('menu_items', 'f943db31-5714-42ce-83a9-e065ba20efc8'::uuid, 'description_ar', $v$كيكة حليب بالزعفران غنية وذهبية وعطرية، بنكهة زهرية خفيفة.$v$),
    ('menu_items', '09af75d1-cdfc-49b4-bdd8-85fafc5fc656'::uuid, 'description_bs', $v$Gusti, kremasti fil od sira, jaja i šećera na tankoj kori, preliven čokoladnim sosom.$v$),
    ('menu_items', 'e91c133c-4345-4425-9a69-7fb4e1c91af4'::uuid, 'name_bs', $v$Puding od datulja$v$),
    ('menu_items', 'e91c133c-4345-4425-9a69-7fb4e1c91af4'::uuid, 'description_bs', $v$Sočan biskvit od sitno sjeckanih datulja, preliven karamel sosom, uz sladoled od vanilije.$v$),
    ('menu_items', 'e91c133c-4345-4425-9a69-7fb4e1c91af4'::uuid, 'name_ar', $v$بودينغ التمر$v$),
    ('menu_items', 'f665c769-e1b0-47f7-87b0-63961e44ee2a'::uuid, 'name_bs', $v$Tiramisu u čaši$v$),
    ('menu_items', 'f665c769-e1b0-47f7-87b0-63961e44ee2a'::uuid, 'description_bs', $v$Kremasti tiramisu s okusom kafe, po italijanskom receptu.$v$),
    ('menu_items', '450cbb3c-a0ca-4774-b3fc-d47705559ab3'::uuid, 'name_bs', $v$Tiramisu s espressom$v$),
    ('menu_items', '450cbb3c-a0ca-4774-b3fc-d47705559ab3'::uuid, 'description_bs', $v$Piškote u slojevima s umućenom smjesom jaja, šećera i mascarponea, s okusom kafe, uz espresso.$v$),
    ('menu_items', '450cbb3c-a0ca-4774-b3fc-d47705559ab3'::uuid, 'name_ar', $v$تيراميسو مع شوت إسبريسو$v$),
    ('menu_items', 'e6735123-1371-48fd-90f8-7d447995569b'::uuid, 'name_bs', $v$Crna arapska kafa$v$),
    ('menu_items', '0122746a-5148-4b26-a897-b032c91f8c72'::uuid, 'name_bs', $v$Bijela arapska kafa$v$),
    ('menu_items', 'eac83ec6-f2d4-4630-ad80-0e8678d43ba9'::uuid, 'name_bs', $v$Cold Brew$v$),
    ('menu_items', '0dbec3fe-d56c-4c73-a57f-3845bf2c21bf'::uuid, 'name_bs', $v$V60 hladni$v$),
    ('menu_items', '0dbec3fe-d56c-4c73-a57f-3845bf2c21bf'::uuid, 'description_bs', $v$Osvježavajuća hladna kafa pripremljena V60 metodom, glatkog i bogatog okusa s blagim notama kiselosti.$v$),
    ('menu_items', 'f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb'::uuid, 'name_bs', $v$V60 topli$v$),
    ('menu_items', 'f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb'::uuid, 'description_bs', $v$Klasična topla kafa pripremljena V60 metodom, koja ističe složene okuse i arome zrna, s čistim završetkom.$v$),
    ('menu_items', 'f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb'::uuid, 'description_ar', $v$قهوة ساخنة كلاسيكية محضّرة بطريقة V60، تُبرز نكهات الحبوب وروائحها الغنية بمذاق نهائي صافٍ.$v$),
    ('menu_items', '3a482a88-6646-48b8-927a-1bd3bca6749c'::uuid, 'name_bs', $v$Frappe s komadićima čokolade$v$),
    ('menu_items', '3a482a88-6646-48b8-927a-1bd3bca6749c'::uuid, 'description_bs', $v$Uživajte u osvježavajućem frappeu s komadićima čokolade i kafom.$v$),
    ('menu_items', '3a482a88-6646-48b8-927a-1bd3bca6749c'::uuid, 'name_ar', $v$فرابيه بقطع الشوكولاتة$v$),
    ('menu_items', '3a482a88-6646-48b8-927a-1bd3bca6749c'::uuid, 'description_ar', $v$استمتع بفرابيه منعش بقطع الشوكولاتة والقهوة.$v$),
    ('menu_items', 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8'::uuid, 'name_bs', $v$Klasični Frappe od kafe$v$),
    ('menu_items', 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8'::uuid, 'description_bs', $v$Bezvremenski favorit: bogata kafa, kremasto mlijeko i led, za glatko piće koje prija.$v$),
    ('menu_items', 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8'::uuid, 'name_ar', $v$فرابيه القهوة الكلاسيكي$v$),
    ('menu_items', 'dd94f4d0-ace7-48e1-b0a2-5fe6d00917c8'::uuid, 'description_ar', $v$المفضّل الدائم: قهوة غنية مع حليب كريمي وثلج، لمشروب ناعم ولذيذ.$v$),
    ('menu_items', '7e28193d-d487-46dd-8ef4-837685e62436'::uuid, 'name_bs', $v$Tamni Mocha Frappe$v$),
    ('menu_items', '7e28193d-d487-46dd-8ef4-837685e62436'::uuid, 'description_bs', $v$Prepustite se raskoši tamnog mocha frappea: intenzivna čokolada i espresso za luksuzan užitak.$v$),
    ('menu_items', '7e28193d-d487-46dd-8ef4-837685e62436'::uuid, 'name_ar', $v$فرابيه الموكا الداكنة$v$),
    ('menu_items', '7e28193d-d487-46dd-8ef4-837685e62436'::uuid, 'description_ar', $v$استمتع بفخامة فرابيه الموكا الداكنة، حيث تلتقي الشوكولاتة الغنية بالإسبريسو في متعة فاخرة.$v$),
    ('menu_items', '3a894e38-b044-484a-b048-6fc8497d993c'::uuid, 'description_bs', $v$Uživajte u osvježavajućem frappeu s bogatim okusom Nutelle, savršenom izboru za sve ljubitelje čokolade.$v$),
    ('menu_items', '3a894e38-b044-484a-b048-6fc8497d993c'::uuid, 'name_ar', $v$فرابيه نوتيلا$v$),
    ('menu_items', '8527671f-2a25-4b06-92db-2bef34b5578a'::uuid, 'description_bs', $v$Prepustite se osvježavajućem frappeu s komadićima Oreo keksa i daškom tamne čokolade.$v$),
    ('menu_items', '8527671f-2a25-4b06-92db-2bef34b5578a'::uuid, 'name_ar', $v$فرابيه أوريو$v$),
    ('menu_items', '8527671f-2a25-4b06-92db-2bef34b5578a'::uuid, 'description_ar', $v$استمتع بفرابيه منعش مع قطع بسكويت أوريو ولمسة من الشوكولاتة الداكنة.$v$),
    ('menu_items', '9df37a24-15e2-4b11-ad52-e771713465a8'::uuid, 'name_bs', $v$Frappe od pistaća$v$),
    ('menu_items', '9df37a24-15e2-4b11-ad52-e771713465a8'::uuid, 'description_bs', $v$Uživajte u osvježavajućem frappeu s bogatim okusom pistaća, savršenom izboru za one koji vole nešto drugačije.$v$),
    ('menu_items', '9df37a24-15e2-4b11-ad52-e771713465a8'::uuid, 'name_ar', $v$فرابيه الفستق$v$),
    ('menu_items', '9df37a24-15e2-4b11-ad52-e771713465a8'::uuid, 'description_ar', $v$استمتع بفرابيه منعش بنكهة الفستق الغنية، خيار مثالي لمن يحب شيئًا مختلفًا.$v$),
    ('menu_items', '85832ef4-2ea7-449c-bc6e-726d7be4e21b'::uuid, 'description_bs', $v$Prepustite se osvježavajućem frappeu s okusom red velveta, savršenom izboru za one koji žele slatku i kremastu poslasticu.$v$),
    ('menu_items', '85832ef4-2ea7-449c-bc6e-726d7be4e21b'::uuid, 'name_ar', $v$فرابيه ريد فيلفيت$v$),
    ('menu_items', '85832ef4-2ea7-449c-bc6e-726d7be4e21b'::uuid, 'description_ar', $v$استمتع بفرابيه منعش بنكهة الريد فيلفيت، خيار مثالي لمن يبحث عن متعة حلوة وكريمية.$v$),
    ('menu_items', 'ab418172-5764-4920-9fe2-9fa2b0b7f58f'::uuid, 'name_bs', $v$Frappe od jagode$v$),
    ('menu_items', 'ab418172-5764-4920-9fe2-9fa2b0b7f58f'::uuid, 'description_bs', $v$Uživajte u osvježavajućem frappeu s okusom jagode, jednostavno i bez okolišanja.$v$),
    ('menu_items', 'ab418172-5764-4920-9fe2-9fa2b0b7f58f'::uuid, 'name_ar', $v$فرابيه الفراولة$v$),
    ('menu_items', 'ab418172-5764-4920-9fe2-9fa2b0b7f58f'::uuid, 'description_ar', $v$استمتع بفرابيه منعش بنكهة الفراولة، ببساطة ومن دون تعقيد.$v$),
    ('menu_items', 'c75d11dc-e00d-4786-9ed6-d37877142d10'::uuid, 'name_bs', $v$Frappe od vanilije$v$),
    ('menu_items', 'c75d11dc-e00d-4786-9ed6-d37877142d10'::uuid, 'name_ar', $v$فرابيه الفانيليا$v$),
    ('menu_items', '6407181b-495b-4a72-8c5a-92ba2a6ed742'::uuid, 'name_bs', $v$Svježi sok od limuna i nane$v$),
    ('menu_items', '6407181b-495b-4a72-8c5a-92ba2a6ed742'::uuid, 'description_bs', $v$Osvježavajući sok od limuna i nane, savršena kombinacija za osvježenje i hidrataciju.$v$),
    ('menu_items', 'b0b3385b-b5a9-420e-acf1-d7ef563df8dd'::uuid, 'description_bs', $v$Svježe cijeđeni sok od narandže, pun antioksidanata i vitamina C, za osvježenje i zdravlje.$v$),
    ('menu_items', '0df96c54-2721-4dfd-b901-f0b47f535b9b'::uuid, 'description_bs', $v$Pomfrit, sos od sira, Thousand Island sos, sjeckane kisele jalapeño papričice, hrskavi prženi luk, ukrašeno mladim lukom i Sakura mješavinom.$v$),
    ('menu_items', '342e5ad6-833c-4522-bcf1-3ff62e2d41d8'::uuid, 'description_bs', $v$Pomfrit, sos od sira, miješana paprika, kiselo vrhnje na vrhu, ukrašeno mladim lukom i Sakura mješavinom.$v$),
    ('menu_items', '342e5ad6-833c-4522-bcf1-3ff62e2d41d8'::uuid, 'description_ar', $v$بطاطس مقلية، صلصة جبنة، فلفل رومي مشكّل، كريمة حامضة في الأعلى، مزيّنة بالبصل الأخضر وخلطة ساكورا.$v$),
    ('menu_items', '78dfd2e2-d8a8-4df6-aa33-c5945daa166d'::uuid, 'name_bs', $v$Original pomfrit sa sirom$v$),
    ('menu_items', '78dfd2e2-d8a8-4df6-aa33-c5945daa166d'::uuid, 'description_bs', $v$Pomfrit, sos od sira, originalni sos, sjeckane kisele jalapeño papričice, ukrašeno mladim lukom i Sakura mješavinom.$v$),
    ('menu_items', '78dfd2e2-d8a8-4df6-aa33-c5945daa166d'::uuid, 'name_ar', $v$بطاطس بالجبن الأصلية$v$),
    ('menu_items', '78dfd2e2-d8a8-4df6-aa33-c5945daa166d'::uuid, 'description_ar', $v$بطاطس مقلية، صلصة جبنة، الصلصة الأصلية، هلابينو مخلل مفروم، مزيّنة بالبصل الأخضر وخلطة ساكورا.$v$),
    ('menu_items', '8b74e59f-2730-4384-97c2-1d5f159af57b'::uuid, 'name_bs', $v$Obični pomfrit$v$),
    ('menu_items', '027e08fc-6556-439f-896e-bfe78c39c735'::uuid, 'name_bs', $v$Začinjeni pomfrit s tartufom$v$),
    ('menu_items', '027e08fc-6556-439f-896e-bfe78c39c735'::uuid, 'description_bs', $v$Pomfrit, sos od tartufa i gljiva s naribanim parmezanom, posut tostiranim tartufom.$v$),
    ('menu_items', '027e08fc-6556-439f-896e-bfe78c39c735'::uuid, 'name_ar', $v$بطاطس متبّلة بالكمأة$v$),
    ('menu_items', '31af65ef-f632-4a03-b557-75fca5d1ef61'::uuid, 'description_bs', $v$Pravi se dodavanjem vanilije u espresso, zatim mliječne pjene i preljeva od karamel sosa. Karamel daje kafi sladak, karamelizovan okus.$v$),
    ('menu_items', '31af65ef-f632-4a03-b557-75fca5d1ef61'::uuid, 'name_ar', $v$كراميل ماكياتو ساخن$v$),
    ('menu_items', '31af65ef-f632-4a03-b557-75fca5d1ef61'::uuid, 'description_ar', $v$يُحضَّر بإضافة الفانيليا إلى شوت إسبريسو، ثم رغوة الحليب ورشّة من صلصة الكراميل في الأعلى. يمنح الكراميل القهوة نكهة حلوة مكرملة.$v$),
    ('menu_items', '0f2be686-a58a-4863-bd8a-0adf997afd45'::uuid, 'description_bs', $v$Bogata i kremasta šoljica tople čokolade, savršena za opuštanje i slatki užitak.$v$),
    ('menu_items', '0f2be686-a58a-4863-bd8a-0adf997afd45'::uuid, 'description_ar', $v$كوب غني وكريمي من الشوكولاتة الساخنة، مثالي للاسترخاء والاستمتاع بلحظة دافئة وحلوة.$v$),
    ('menu_items', '2ce645ad-a6f1-4e52-8f9a-3b402146a416'::uuid, 'name_ar', $v$لاتيه الكركم$v$),
    ('menu_items', 'ec380fef-c82a-4ed5-8411-55d7beccaefa'::uuid, 'name_bs', $v$Latte/Karak čaj$v$),
    ('menu_items', '7a8b578e-d53f-4892-bbe1-771240aed585'::uuid, 'description_ar', $v$مزيج لذيذ من شاي الماتشا الأخضر والحليب الكريمي، يقدّم ماتشا لاتيه تجربة متوازنة بلمسات خفيفة من التوابل.$v$),
    ('menu_items', '0dc19452-4ac3-481a-867c-f2de8b70440d'::uuid, 'name_bs', $v$Pumpkin Spice Latte$v$),
    ('menu_items', 'c139f3ad-1f5d-4e10-b649-07fdad93c457'::uuid, 'name_bs', $v$Latte s ružom$v$),
    ('menu_items', 'f9fc6149-36ca-4a00-b5e8-85983dd12e4e'::uuid, 'name_bs', $v$Topla čokolada sa slanim karamelom$v$),
    ('menu_items', 'f9fc6149-36ca-4a00-b5e8-85983dd12e4e'::uuid, 'description_bs', $v$Bogata i topla čokolada sa slanim karamelom, savršen spoj slatkoće i slanoće za neodoljiv užitak.$v$),
    ('menu_items', 'f9fc6149-36ca-4a00-b5e8-85983dd12e4e'::uuid, 'description_ar', $v$شوكولاتة غنية ودافئة بالكراميل المملح، توازن مثالي بين الحلاوة والملوحة لمتعة لا تُقاوم.$v$),
    ('menu_items', '7f63e56c-50f8-4600-9cdb-a480aad579dc'::uuid, 'description_ar', $v$بارد ومنعش، الأمريكانو المثلج مشروب بسيط وقوي يوقظ حواسك.$v$),
    ('menu_items', 'a30ba69b-77b1-4b4f-8850-a47094a0fe06'::uuid, 'description_bs', $v$Sladak i osvježavajući, ledeni caramel macchiato savršen je spoj kafe, mlijeka i slatkog karamela.$v$),
    ('menu_items', 'a30ba69b-77b1-4b4f-8850-a47094a0fe06'::uuid, 'name_ar', $v$كراميل ماكياتو مثلج$v$),
    ('menu_items', 'a30ba69b-77b1-4b4f-8850-a47094a0fe06'::uuid, 'description_ar', $v$حلو ومنعش، الكراميل ماكياتو المثلج مزيج مثالي من القهوة والحليب والكراميل الحلو.$v$),
    ('menu_items', '05fbb7cb-31d7-4384-8e55-b3a198e0fd22'::uuid, 'name_bs', $v$Ledeni Latte s ružom$v$),
    ('menu_items', 'eaee8853-0151-49d4-afef-3e56f7180760'::uuid, 'name_bs', $v$Ledeni španski Latte$v$),
    ('menu_items', '37bf2c55-d3f1-4b8f-8507-db9ae8bbd051'::uuid, 'description_bs', $v$Čaša ledenog čaja od breskve, bogatog voćnog okusa i osvježavajućih nota čaja, idealna za rashlađivanje tokom ljetnih vrućina.$v$),
    ('menu_items', '37bf2c55-d3f1-4b8f-8507-db9ae8bbd051'::uuid, 'description_ar', $v$كوب من شاي الخوخ المثلج بنكهة فاكهية غنية ولمسات شاي منعشة، مثالي للانتعاش في حر الصيف.$v$),
    ('menu_items', '1141a6bb-8d91-47fc-a985-9d744646d127'::uuid, 'name_bs', $v$Pileći burger$v$),
    ('menu_items', 'ca56673c-0329-4d5f-ba49-cb602e2cda71'::uuid, 'name_bs', $v$Pileći burger meni$v$),
    ('menu_items', 'ca56673c-0329-4d5f-ba49-cb602e2cda71'::uuid, 'description_bs', $v$Mali burger s hrskavom piletinom, pomfrit i piće (Coca-Cola ili svježi sok od narandže).$v$),
    ('menu_items', '2f1e8504-ded4-4b6c-8749-ca0f7678b2e6'::uuid, 'description_bs', $v$Pohovani pileći štapići s hrskavom koricom, uz slatko-kiseli sos.$v$),
    ('menu_items', '2f1e8504-ded4-4b6c-8749-ca0f7678b2e6'::uuid, 'name_ar', $v$أصابع الدجاج$v$),
    ('menu_items', '2f1e8504-ded4-4b6c-8749-ca0f7678b2e6'::uuid, 'description_ar', $v$أصابع دجاج مقلية مقرمشة، تُقدَّم مع صلصة الحلو والحامض.$v$),
    ('menu_items', 'c06f4ec2-1bda-4c16-ab49-36f88a059f52'::uuid, 'name_bs', $v$Pileći štapići meni$v$),
    ('menu_items', 'c06f4ec2-1bda-4c16-ab49-36f88a059f52'::uuid, 'description_bs', $v$Pohovani pileći štapići s hrskavom koricom, uz pomfrit, slatko-kiseli sos i osvježavajuće piće (Coca-Cola ili svježi sok od narandže).$v$),
    ('menu_items', 'c06f4ec2-1bda-4c16-ab49-36f88a059f52'::uuid, 'name_ar', $v$وجبة أصابع الدجاج$v$),
    ('menu_items', 'c06f4ec2-1bda-4c16-ab49-36f88a059f52'::uuid, 'description_ar', $v$أصابع دجاج مقلية مقرمشة، تُقدَّم مع بطاطس مقلية وصلصة الحلو والحامض ومشروب منعش (كوكا كولا أو عصير برتقال طازج).$v$),
    ('menu_items', 'a372aceb-d87e-427e-8631-57cfdaf5a461'::uuid, 'name_bs', $v$Štapići od mocarele$v$),
    ('menu_items', '821f3185-5ab7-4046-818f-55460b7d0288'::uuid, 'name_bs', $v$Štapići od mocarele meni$v$),
    ('menu_items', '821f3185-5ab7-4046-818f-55460b7d0288'::uuid, 'name_ar', $v$وجبة أصابع موزاريلا$v$),
    ('menu_items', '4d2fdded-496d-4eda-9e1e-0c413b8730f1'::uuid, 'name_bs', $v$Tjestenina u bijelom sosu meni$v$),
    ('menu_items', '4d2fdded-496d-4eda-9e1e-0c413b8730f1'::uuid, 'description_bs', $v$Tjestenina u bijelom sosu + gazirano piće ili sok od narandže.$v$),
    ('menu_items', '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0'::uuid, 'name_bs', $v$Limunada od marakuje$v$),
    ('menu_items', '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0'::uuid, 'description_bs', $v$Osvježavajuća limunada s okusom marakuje.$v$),
    ('menu_items', '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0'::uuid, 'name_ar', $v$ليمونادة باشن فروت$v$),
    ('menu_items', '59da62dc-7598-4d6f-8d3c-cc4fbb8009a0'::uuid, 'description_ar', $v$ليمونادة منعشة بنكهة الباشن فروت.$v$),
    ('menu_items', 'e8879448-6477-4e79-8327-b4424c2a6f8d'::uuid, 'name_bs', $v$Limunada od breskve$v$),
    ('menu_items', 'e8879448-6477-4e79-8327-b4424c2a6f8d'::uuid, 'description_bs', $v$Osvježavajuća limunada s okusom breskve.$v$),
    ('menu_items', 'e8879448-6477-4e79-8327-b4424c2a6f8d'::uuid, 'name_ar', $v$ليمونادة الخوخ$v$),
    ('menu_items', 'e8879448-6477-4e79-8327-b4424c2a6f8d'::uuid, 'description_ar', $v$ليمونادة منعشة بنكهة الخوخ.$v$),
    ('menu_items', 'c9a69b0a-986d-49b9-a6d9-016439c61fcb'::uuid, 'name_bs', $v$Limunada od jagode$v$),
    ('menu_items', 'c9a69b0a-986d-49b9-a6d9-016439c61fcb'::uuid, 'description_bs', $v$Osvježavajuća limunada s okusom jagode.$v$),
    ('menu_items', 'c9a69b0a-986d-49b9-a6d9-016439c61fcb'::uuid, 'name_ar', $v$ليمونادة الفراولة$v$),
    ('menu_items', 'c9a69b0a-986d-49b9-a6d9-016439c61fcb'::uuid, 'description_ar', $v$ليمونادة منعشة بنكهة الفراولة.$v$),
    ('menu_items', 'fcf82ebd-8745-464e-9055-bf6d8ccb8438'::uuid, 'description_bs', $v$Osvježavajući koktel s nanom, limetom, šećerom, sodom i daškom plavog karambola.$v$),
    ('menu_items', 'fcf82ebd-8745-464e-9055-bf6d8ccb8438'::uuid, 'description_ar', $v$كوكتيل منعش بالنعناع والليمون الأخضر والسكر والصودا، مع لمسة من فاكهة النجمة الزرقاء.$v$),
    ('menu_items', 'f14ddc91-1fc8-4885-b7d2-9071c935add6'::uuid, 'description_bs', $v$Klasični koktel s nanom, limetom, šećerom i sodom.$v$),
    ('menu_items', 'f14ddc91-1fc8-4885-b7d2-9071c935add6'::uuid, 'description_ar', $v$كوكتيل كلاسيكي بالنعناع والليمون الأخضر والسكر والصودا.$v$),
    ('menu_items', 'cc4bcd04-5a83-4d02-8f72-113ff99c62e8'::uuid, 'description_bs', $v$Osvježavajući koktel sa svježim mangom, nanom, limetom, šećerom i daškom sode.$v$),
    ('menu_items', 'cc4bcd04-5a83-4d02-8f72-113ff99c62e8'::uuid, 'description_ar', $v$كوكتيل منعش بالمانجو الطازج والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$v$),
    ('menu_items', '47b69d62-42c5-45f7-8f29-f78541207f1c'::uuid, 'description_bs', $v$Osvježavajući koktel sa sokom od marakuje, nanom, limetom, šećerom i daškom sode.$v$),
    ('menu_items', '47b69d62-42c5-45f7-8f29-f78541207f1c'::uuid, 'name_ar', $v$موهيتو باشن فروت$v$),
    ('menu_items', '47b69d62-42c5-45f7-8f29-f78541207f1c'::uuid, 'description_ar', $v$كوكتيل منعش بعصير الباشن فروت والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$v$),
    ('menu_items', 'd56f5cac-825a-4bae-b406-e4f4776ad751'::uuid, 'description_bs', $v$Osvježavajući koktel sa svježim breskvama, nanom, limetom, šećerom i daškom sode.$v$),
    ('menu_items', 'd56f5cac-825a-4bae-b406-e4f4776ad751'::uuid, 'description_ar', $v$كوكتيل منعش بالخوخ الطازج والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$v$),
    ('menu_items', '1d36f430-a209-459d-a0c5-bb18a2a2f85b'::uuid, 'description_bs', $v$Osvježavajući koktel sa svježim malinama, nanom, limetom, šećerom i daškom sode.$v$),
    ('menu_items', '1d36f430-a209-459d-a0c5-bb18a2a2f85b'::uuid, 'description_ar', $v$كوكتيل منعش بتوت العليق الطازج والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$v$),
    ('menu_items', 'f5adc58c-ab5e-4b9f-8a99-9678d9b00f67'::uuid, 'description_bs', $v$Osvježavajući koktel sa svježim jagodama, nanom, limetom, šećerom i daškom sode.$v$),
    ('menu_items', 'f5adc58c-ab5e-4b9f-8a99-9678d9b00f67'::uuid, 'description_ar', $v$كوكتيل منعش بالفراولة الطازجة والنعناع والليمون الأخضر والسكر، مع لمسة من الصودا.$v$),
    ('menu_items', '6d75a749-8e65-442d-8b19-bca360fda7ed'::uuid, 'description_bs', $v$Svjež i osvježavajući sok od jabuke, prirodno sladak i pun vitamina, idealan za osvježenje.$v$),
    ('menu_items', 'bea1b69f-43c7-4ec4-b937-b53fcf4646d7'::uuid, 'name_bs', $v$Gazirana voda$v$),
    ('menu_items', 'aa5ababb-c156-436b-a00a-5763c69d2471'::uuid, 'description_ar', $v$عصير فراولة حلو، مليء بنكهة الفاكهة وحلاوتها الطبيعية، مثالي كمشروب منعش.$v$),
    ('menu_items', '2f963530-da9a-4b57-9046-9bfa137258ca'::uuid, 'name_bs', $v$Vitaminski miks$v$),
    ('menu_items', '2f963530-da9a-4b57-9046-9bfa137258ca'::uuid, 'description_bs', $v$Osvježavajući vitaminski sok, mješavina svježeg voća punog vitamina i hranjivih sastojaka za zdrav podsticaj.$v$),
    ('menu_items', '2f963530-da9a-4b57-9046-9bfa137258ca'::uuid, 'description_ar', $v$عصير منعش من مزيج الفواكه الطازجة الغنية بالفيتامينات والمغذيات، لدفعة صحية من النشاط.$v$),
    ('menu_items', '2606d83c-f867-44c8-9181-cc5f019f4a2c'::uuid, 'description_bs', $v$Fettuccine u kremastom alfredo sosu s grilovanim gljivama i naribanim parmezanom, ukrašeno Sakura mješavinom. Dodatak piletine +2 KM.$v$),
    ('menu_items', '2606d83c-f867-44c8-9181-cc5f019f4a2c'::uuid, 'description_ar', $v$باستا فيتوتشيني بصلصة ألفريدو الكريمية مع فطر مشوي وجبنة بارميزان مبشورة، مزيّنة بخلطة ساكورا. إضافة دجاج +2 KM.$v$),
    ('menu_items', '1a75511e-9975-4875-a41f-e5a9f4d9daa2'::uuid, 'name_bs', $v$Špageti s patlidžanom i tartufom$v$),
    ('menu_items', '1a75511e-9975-4875-a41f-e5a9f4d9daa2'::uuid, 'description_bs', $v$Špageti u kremastom ružičastom sosu s pastom od tartufa, preliveni patlidžanom i parmezanom, ukrašeni Sakura mješavinom.$v$),
    ('menu_items', '1a75511e-9975-4875-a41f-e5a9f4d9daa2'::uuid, 'description_ar', $v$سباغيتي بصلصة وردية كريمية ومعجون الكمأة، يعلوها الباذنجان وجبنة البارميزان، ومزيّنة بخلطة ساكورا.$v$),
    ('menu_items', '153b5956-c40a-43c3-9a75-e9d5c8dbb9b3'::uuid, 'name_bs', $v$Pasta arrabbiata$v$),
    ('menu_items', '153b5956-c40a-43c3-9a75-e9d5c8dbb9b3'::uuid, 'description_bs', $v$Penne u crvenom arrabbiata sosu s naribanim parmezanom, ukrašene mladim lukom i Sakura mješavinom.$v$),
    ('menu_items', '4d11027f-f28e-47a1-a4af-68d382c79b6a'::uuid, 'description_bs', $v$Fettuccine u kremastom alfredo pesto sosu s naribanim parmezanom, ukrašeno Sakura mješavinom. Dodatak piletine +2 KM.$v$),
    ('menu_items', '4d11027f-f28e-47a1-a4af-68d382c79b6a'::uuid, 'description_ar', $v$باستا فيتوتشيني بصلصة ألفريدو بالبيستو الكريمية مع جبنة بارميزان مبشورة، مزيّنة بخلطة ساكورا. إضافة دجاج +2 KM.$v$),
    ('menu_items', 'ba488833-a8d2-4b27-8027-fbe131888eb5'::uuid, 'name_bs', $v$Pasta s tartufom$v$),
    ('menu_items', 'ba488833-a8d2-4b27-8027-fbe131888eb5'::uuid, 'description_bs', $v$Fettuccine u kremastom alfredo sosu s pastom i uljem od tartufa i naribanim parmezanom, ukrašeno Sakura mješavinom. Dodatak piletine +2 KM.$v$),
    ('menu_items', 'ba488833-a8d2-4b27-8027-fbe131888eb5'::uuid, 'description_ar', $v$باستا فيتوتشيني بصلصة ألفريدو الكريمية مع معجون الكمأة وزيت الكمأة وجبنة بارميزان مبشورة، مزيّنة بخلطة ساكورا. إضافة دجاج +2 KM.$v$),
    ('menu_items', 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7'::uuid, 'name_bs', $v$Pesto rižoto$v$),
    ('menu_items', 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7'::uuid, 'description_bs', $v$Rižoto u kremastom alfredo sosu s pesto sosom i čeri paradajzom, ukrašen Sakura mješavinom (dodatak piletine +2 KM).$v$),
    ('menu_items', 'f13a527b-ed1f-4b16-a4c0-7b14f70bbce7'::uuid, 'description_ar', $v$أرز ريزوتو بصلصة ألفريدو الكريمية وصلصة البيستو والطماطم الكرزية، مزيّن بخلطة ساكورا (إضافة دجاج +2 KM).$v$),
    ('menu_items', '93693bf6-75ca-4667-8b00-852f305140b1'::uuid, 'name_bs', $v$Rižoto u ružičastom sosu$v$),
    ('menu_items', '93693bf6-75ca-4667-8b00-852f305140b1'::uuid, 'description_bs', $v$Rižoto u kremastom ružičastom sosu s čeri paradajzom, crnim maslinama i balzamiko kremom, ukrašen Sakura mješavinom (dodatak piletine +2 KM).$v$),
    ('menu_items', '93693bf6-75ca-4667-8b00-852f305140b1'::uuid, 'name_ar', $v$ريزوتو بالصلصة الوردية$v$),
    ('menu_items', '93693bf6-75ca-4667-8b00-852f305140b1'::uuid, 'description_ar', $v$أرز ريزوتو بصلصة وردية كريمية مع طماطم كرزية وزيتون أسود وكريمة البلسميك، مزيّن بخلطة ساكورا (إضافة دجاج +2 KM).$v$),
    ('menu_items', 'ad51bf28-159b-4938-b3ef-95bd3186b729'::uuid, 'name_bs', $v$Rižoto u alfredo sosu s gljivama$v$),
    ('menu_items', 'ad51bf28-159b-4938-b3ef-95bd3186b729'::uuid, 'description_bs', $v$Rižoto u kremastom alfredo sosu s grilovanim gljivama, ukrašen svježim timijanom (dodatak piletine +2 KM).$v$),
    ('menu_items', 'ad51bf28-159b-4938-b3ef-95bd3186b729'::uuid, 'description_ar', $v$أرز ريزوتو بصلصة ألفريدو الكريمية مع فطر مشوي، مزيّن بالزعتر الطازج (إضافة دجاج +2 KM).$v$),
    ('menu_items', '82c96deb-f1c9-4904-84cf-0160c9b48191'::uuid, 'name_bs', $v$Rižoto s tartufom$v$),
    ('menu_items', '82c96deb-f1c9-4904-84cf-0160c9b48191'::uuid, 'description_bs', $v$Rižoto u kremastom alfredo sosu s pastom od tartufa i grilovanim gljivama, ukrašen svježim timijanom (dodatak piletine +2 KM).$v$),
    ('menu_items', '82c96deb-f1c9-4904-84cf-0160c9b48191'::uuid, 'description_ar', $v$أرز ريزوتو بصلصة ألفريدو الكريمية مع معجون الكمأة وفطر مشوي، مزيّن بالزعتر الطازج (إضافة دجاج +2 KM).$v$),
    ('menu_items', 'fa33c027-e841-4b73-a334-9c7fabe88abe'::uuid, 'description_bs', $v$Miješana zelena salata, preljev od limuna, kriške cvekle, pečeni orasi, sjemenke bundeve, sjemenke nara, kriške narandže, kremasti avokado, labneh, pire od cvekle, ukrašeno bijelim i crnim susamom.$v$),
    ('menu_items', '26df45bb-0a62-484c-ae39-ed1b5a63329b'::uuid, 'description_bs', $v$Ajsberg salata s Cezar dresingom i parmezanom, uz krutone i kriške limuna sa strane.$v$),
    ('menu_items', '26df45bb-0a62-484c-ae39-ed1b5a63329b'::uuid, 'description_ar', $v$خس آيسبرغ بصلصة السيزر وجبنة البارميزان، مع خبز محمّص (كروتون) وشرائح ليمون على الجانب.$v$),
    ('menu_items', '3270f1bd-c977-4bbd-819e-f2054111b1b7'::uuid, 'description_bs', $v$Ajsberg salata s Cezar dresingom i parmezanom, grilovana piletina, krutoni i kriške limuna.$v$),
    ('menu_items', '3270f1bd-c977-4bbd-819e-f2054111b1b7'::uuid, 'description_ar', $v$خس آيسبرغ بصلصة السيزر وجبنة البارميزان، دجاج مشوي، خبز محمّص (كروتون) وشرائح ليمون.$v$),
    ('menu_items', '9e2930a8-10e8-4e7f-b710-6dc9c8b79fec'::uuid, 'description_bs', $v$Hrskavi prženi falafel, miješana zelena salata, sjeckana crvena rotkvica, čeri paradajz, krastavac, luk, tahini sos i preljev od limuna.$v$),
    ('menu_items', 'efd18b6c-f4c0-44cf-8439-3f4d4625bed0'::uuid, 'description_bs', $v$Kuhana crna i bijela kvinoja, rukola, sjemenke nara, preljev od limuna, čeri paradajz, posuto izmrvljenim feta sirom.$v$),
    ('menu_items', 'e5cb4265-b20c-4040-bb35-0a590ca91976'::uuid, 'name_bs', $v$Šopska salata$v$),
    ('menu_items', 'e5cb4265-b20c-4040-bb35-0a590ca91976'::uuid, 'description_bs', $v$Paradajz, žuta paprika, krastavac i luk narezani na kockice, s maslinovim uljem i sokom od bijelog grožđa, posuto izmrvljenim feta sirom i sjeckanim peršunom.$v$),
    ('menu_items', '1731a57b-6b84-42d2-81d3-0b8650442b3b'::uuid, 'name_bs', $v$Opasni slider$v$),
    ('menu_items', '1731a57b-6b84-42d2-81d3-0b8650442b3b'::uuid, 'description_bs', $v$Pecivo od cvekle, hrskava piletina, čedar sir, sjeckana ajsberg salata, pržene jalapeño papričice, chimichurri sos.$v$),
    ('menu_items', '1731a57b-6b84-42d2-81d3-0b8650442b3b'::uuid, 'description_ar', $v$خبز الشمندر، دجاج مقرمش، جبنة شيدر، خس آيسبرغ مقطّع، هلابينو مقلي، صلصة تشيميتشوري.$v$),
    ('menu_items', '910ce450-63f6-4995-af20-9bcac0740414'::uuid, 'name_bs', $v$Grilovani pileći slider$v$),
    ('menu_items', '910ce450-63f6-4995-af20-9bcac0740414'::uuid, 'description_bs', $v$Brioš pecivo, kisele jalapeño papričice, rukola, grilovana piletina, mocarela.$v$),
    ('menu_items', 'b780b03b-e220-4f03-a49c-ee95fe9ea23a'::uuid, 'name_bs', $v$Midnight slider$v$),
    ('menu_items', 'b780b03b-e220-4f03-a49c-ee95fe9ea23a'::uuid, 'description_bs', $v$Brioš pecivo, juneća pljeskavica, kriška čedar sira, sjeckana ajsberg salata, kiseli krastavac, Thousand Island sos.$v$),
    ('menu_items', 'b780b03b-e220-4f03-a49c-ee95fe9ea23a'::uuid, 'description_ar', $v$خبز بريوش، شريحة لحم بقري، شريحة جبنة شيدر، خس آيسبرغ مقطّع، خيار مخلل، صلصة ثاوزند آيلاند.$v$),
    ('menu_items', '32d1fe9b-ae30-49fb-8afb-37e0e5edaa29'::uuid, 'name_bs', $v$Slider miks$v$),
    ('menu_items', '32d1fe9b-ae30-49fb-8afb-37e0e5edaa29'::uuid, 'description_bs', $v$Kombinacija Opasnog slidera, Midnight slidera i Povrtnog slidera.$v$),
    ('menu_items', 'c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9'::uuid, 'name_bs', $v$Povrtni slider$v$),
    ('menu_items', 'c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9'::uuid, 'description_bs', $v$Hrskava pljeskavica od falafela, sjeckana ajsberg salata, paradajz, specijalni sos.$v$),
    ('menu_items', 'c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9'::uuid, 'description_ar', $v$قرص فلافل مقلي مقرمش، خس آيسبرغ مقطّع، طماطم، صلصة خاصة.$v$),
    ('menu_items', '28b51e15-d230-4317-a57a-6330c5ba0623'::uuid, 'description_bs', $v$Desert inspirisan Italijom: sladoled od vanilije preliven espressom, sosom od pistaća i pistaćima.$v$),
    ('menu_items', '28b51e15-d230-4317-a57a-6330c5ba0623'::uuid, 'description_ar', $v$حلوى إيطالية الطابع: آيس كريم الفانيليا يعلوه شوت إسبريسو وصلصة الفستق وحبات الفستق.$v$),
    ('menu_items', '0a2b9e5b-172c-45b9-a2fc-8df48a675f8c'::uuid, 'description_bs', $v$Snažan i osvježavajući bezalkoholni koktel s plavim curaçao sirupom i energetskim pićem.$v$),
    ('menu_items', '0a2b9e5b-172c-45b9-a2fc-8df48a675f8c'::uuid, 'description_ar', $v$موكتيل خالٍ من الكحول، قوي ومنعش، بشراب البلو كوراساو ومشروب الطاقة.$v$),
    ('menu_items', '58009e34-157a-4e6e-9287-fb6f82e8b9da'::uuid, 'description_ar', $v$مشروب مثلج، الخيار الأمثل لعشاق الماتشا.$v$),
    ('menu_items', 'bb021ff4-5c19-44a8-a63f-63ecc48405a9'::uuid, 'description_bs', $v$Ukusni frappe koji spaja kremasti avokado i kafu u savršenom skladu okusa.$v$),
    ('menu_items', 'bb021ff4-5c19-44a8-a63f-63ecc48405a9'::uuid, 'name_ar', $v$أفو ماكياتو La Soul$v$),
    ('menu_items', 'f9a66811-55bc-4b39-9be9-cfc8606243e6'::uuid, 'description_bs', $v$Kremasti i osvježavajući bezalkoholni koktel s okusom ananasa i kokosa.$v$),
    ('menu_items', 'f9a66811-55bc-4b39-9be9-cfc8606243e6'::uuid, 'name_ar', $v$بينا كولادا$v$),
    ('menu_items', 'f9a66811-55bc-4b39-9be9-cfc8606243e6'::uuid, 'description_ar', $v$موكتيل كريمي ومنعش خالٍ من الكحول بنكهة الأناناس وجوز الهند.$v$),
    ('menu_items', 'c1242eb6-b906-41bd-b3f8-573d822352ad'::uuid, 'description_ar', $v$مشروب منعش يجمع بين عصير البرتقال والخوخ والباشن فروت.$v$),
    ('menu_items', 'a6e706ad-8e85-4c74-b1bb-c54598878ccd'::uuid, 'description_bs', $v$Klasični bezalkoholni koktel od narandže, grenadina i limuna: osvježavajuća verzija originalnog koktela, bez grižnje savjesti.$v$),
    ('menu_items', 'a6e706ad-8e85-4c74-b1bb-c54598878ccd'::uuid, 'description_ar', $v$موكتيل كلاسيكي خالٍ من الكحول يجمع البرتقال والغرينادين والليمون، نسخة منعشة من الكوكتيل الأصلي بلا شعور بالذنب.$v$),
    ('menu_items', '0cfa2bbc-a0b2-4bae-8fb8-be490990ea5f'::uuid, 'name_bs', $v$English Breakfast čaj$v$),
    ('menu_items', '0cfa2bbc-a0b2-4bae-8fb8-be490990ea5f'::uuid, 'description_bs', $v$Bogat i snažan čaj punog tijela; English Breakfast je savršen izbor za energičan početak dana.$v$),
    ('menu_items', '74d40491-629b-47e2-8aa8-9ab12a7bdc27'::uuid, 'description_ar', $v$شاي زهور الكركديه المنعش، بطعم مائل للحموضة ولون أحمر غني، مثالي للانتعاش والصحة.$v$)
    ) AS i(tbl, id, field, val);

  SELECT count(*),
         count(*) FILTER (WHERE row_exists AND NOT landed),
         count(*) FILTER (WHERE NOT row_exists)
    INTO v_total, v_changed, v_missing
    FROM _menu_translation_check;

  RAISE NOTICE 'menu translations: % of % fields hold the new text; % skipped because the live value had been changed by hand, % skipped because the row no longer exists',
    v_total - v_changed - v_missing, v_total, v_changed, v_missing;

  FOR r IN SELECT tbl, id, field FROM _menu_translation_check WHERE row_exists AND NOT landed ORDER BY tbl, id, field LOOP
    RAISE NOTICE '  kept the hand edit: %.% on %', r.tbl, r.field, r.id;
  END LOOP;

  DROP TABLE _menu_translation_check;
END $verify$;
