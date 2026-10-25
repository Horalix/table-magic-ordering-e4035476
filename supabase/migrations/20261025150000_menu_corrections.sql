-- =====================================================================
-- Menu corrections confirmed by the owner, 25 Oct 2026, and the halal rule.
--
--   * Butter Croissant is made with butter (the text said margarine).
--   * Shopska Salad is dressed with vinegar (the text said white grape juice).
--   * English spelling fixes across the menu.
--   * La Soul is fully halal and serves no alcohol: nothing may carry the
--     'alcohol' meal role, and the mocktail copy says so plainly.
--
-- Every UPDATE is guarded on the text it replaces (exact for English, which
-- 20261025140000_menu_translations left alone; a keyword for Bosnian and
-- Arabic, which that migration rewrote), so an edit the owner has made since
-- is never overwritten and re-running changes nothing. Runs after
-- 20261025140000_menu_translations.sql.
-- =====================================================================

-- ---- Butter Croissant: butter, not margarine --------------------------
UPDATE public.menu_items SET name = 'Butter Croissant', updated_at = now()
 WHERE id = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5' AND name = ' Butter Croissant';

UPDATE public.menu_items
   SET description = $t$A classic all-butter croissant, flaky and golden, with a beautiful honeycomb crumb inside; served with homemade strawberry jam.$t$,
       updated_at = now()
 WHERE id = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5' AND description ILIKE '%margarine%';

UPDATE public.menu_items
   SET description_bs = $t$Klasični kroasan s puterom, prhak i zlatan, s lijepom strukturom saća iznutra; uz domaći džem od jagoda.$t$,
       updated_at = now()
 WHERE id = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5' AND description_bs ILIKE '%margarin%';

UPDATE public.menu_items
   SET description_ar = $t$كرواسون كلاسيكي بالزبدة، هشّ وذهبي، بتجاويف جميلة كخلية النحل من الداخل، يُقدَّم مع مربى الفراولة المنزلي.$t$,
       updated_at = now()
 WHERE id = '9dd68273-ee8c-4c6f-a859-550f2b8d9ed5' AND description_ar LIKE '%مارجرين%';

-- ---- Shopska Salad: vinegar, not grape juice --------------------------
UPDATE public.menu_items
   SET description = $t$Diced tomato, yellow bell pepper, cucumber and onion with olive oil and white vinegar, topped with crumbled feta cheese and chopped parsley.$t$,
       updated_at = now()
 WHERE id = 'e5cb4265-b20c-4040-bb35-0a590ca91976' AND description ILIKE '%grape juice%';

UPDATE public.menu_items
   SET description_bs = $t$Paradajz, žuta paprika, krastavac i luk narezani na kockice, s maslinovim uljem i bijelim sirćetom, posuto izmrvljenim feta sirom i sjeckanim peršunom.$t$,
       updated_at = now()
 WHERE id = 'e5cb4265-b20c-4040-bb35-0a590ca91976' AND description_bs ILIKE '%grožđ%';

UPDATE public.menu_items
   SET description_ar = $t$مكعبات طماطم وفلفل أصفر وخيار وبصل، مع زيت الزيتون والخل الأبيض، تعلوها جبنة فيتا مفتتة وبقدونس مفروم.$t$,
       updated_at = now()
 WHERE id = 'e5cb4265-b20c-4040-bb35-0a590ca91976' AND description_ar LIKE '%عنب%';

-- ---- English spelling (exact old text) ----------------------------------
UPDATE public.menu_items AS m SET name = v.new_name, updated_at = now()
  FROM (VALUES
    ('238b7bdb'::text, 'Cappucino', 'Cappuccino'),
    ('2606d83c', 'Alfredo Fettucine', 'Alfredo Fettuccine'),
    ('a372aceb', 'Mozarella Sticks', 'Mozzarella Sticks'),
    ('821f3185', 'Mozarella Sticks Combo', 'Mozzarella Sticks Combo')
  ) AS v(id_prefix, old_name, new_name)
 WHERE m.id::text LIKE v.id_prefix || '%' AND m.name = v.old_name;

UPDATE public.menu_items AS m SET description = v.new_desc, updated_at = now()
  FROM (VALUES
    ('238b7bdb'::text,
     $o$A classic of Italian cuisine, Cappucino is espresso with a generous amount of frothed milk, ideal for starting the day.$o$,
     $n$A classic of Italian coffee: espresso with a generous layer of frothed milk, ideal for starting the day.$n$),
    ('a372aceb',
     $o$Crispy mozarella sticks served with marinara sauce.$o$,
     $n$Crispy mozzarella sticks served with marinara sauce.$n$),
    ('821f3185',
     $o$Crispy mozarella sticks served with fries and a refreshing drink (coca cola or fresh orange juice).$o$,
     $n$Crispy mozzarella sticks served with fries and a refreshing drink (Coca-Cola or fresh orange juice).$n$),
    ('7cac5bf1',
     $o$Aseeda fondant, is made of fresh mashed pumpkin, with different spicies and topped with the vanilla ice cream.$o$,
     $n$Asseda fondant made from fresh mashed pumpkin and warm spices, topped with vanilla ice cream.$n$),
    ('699add79',
     $o$Fried coated boneless chicken toast with buffalo sauce, mix sesame seed, garnish with spring onion & Sakura mix, sour cream on the side.$o$,
     $n$Crispy coated boneless chicken tossed in buffalo sauce with mixed sesame seeds, garnished with spring onion and Sakura mix, with sour cream on the side.$n$),
    ('305546e4',
     $o$Extraordinary pudding with pistacios on top of a melted chocolate, and all with a base of kadaif.$o$,
     $n$An extraordinary pudding on a base of kadaif, with melted chocolate and pistachios on top.$n$),
    ('93693bf6',
     $o$Risotto rice in creamy pink sauce, cherry tomato, black olive, balsamic cream, garnish with Sakura mix (additional chicken) 2km.$o$,
     $n$Risotto in a creamy pink sauce with cherry tomato, black olive and balsamic cream, garnished with Sakura mix. Add chicken +2 KM.$n$),
    ('f13a527b',
     $o$Risotto rice in creamy alfredo sauce, pesto sauce, cherry tomato, garnish with Sakura mix (additional chicken) 2km.$o$,
     $n$Risotto in a creamy Alfredo sauce with pesto and cherry tomato, garnished with Sakura mix. Add chicken +2 KM.$n$),
    ('ad51bf28',
     $o$Risotto rice in creamy alfredo sauce, grilled mushroom, garnish with fresh thyme (additional chicken) 2km.$o$,
     $n$Risotto in a creamy Alfredo sauce with grilled mushroom, garnished with fresh thyme. Add chicken +2 KM.$n$),
    ('82c96deb',
     $o$Risotto rice in creamy alfredo sauce, truffle paste, grilled mushroom, garnish with fresh thyme (additional chicken) 2km.$o$,
     $n$Risotto in a creamy Alfredo sauce with truffle paste and grilled mushroom, garnished with fresh thyme. Add chicken +2 KM.$n$),
    ('fa33c027',
     $o$Mix lettuce, Lemon Dressing, Sliced Beetroot, Roosted walnut, pumpkin seed, pomegranate seed, sliced orange segment, Creamy Avocado, labneh, beetroot Puree, garnish with white & black sesame seed.$o$,
     $n$Mixed lettuce with lemon dressing, sliced beetroot, roasted walnuts, pumpkin seeds, pomegranate, orange segments, creamy avocado, labneh and beetroot purée, garnished with white and black sesame.$n$),
    ('f9ab0a76',
     $o$Chocolate bomb filled with chocolate mousse, dulce de leche, and chocolate sponge after vanilla ice cream and chocolate ganache on topped.$o$,
     $n$A chocolate bomb filled with chocolate mousse, dulce de leche and chocolate sponge, topped with vanilla ice cream and chocolate ganache.$n$),
    ('4bdf76b3',
     $o$Churos is fried dough made with choux pastry its hot and crispy on the outside, fluffy on the inside, a side with chocolate sauce.$o$,
     $n$Churros: choux pastry fried until hot and crisp outside and fluffy inside, with chocolate sauce on the side.$n$),
    ('e4ffaa6d',
     $o$Beetroot Sesame Bun, doble beef patty, with Cheddar cheese, crispy onion string, pickle cucumber, Solar Gravity Sauce.$o$,
     $n$Beetroot sesame bun with a double beef patty, cheddar cheese, crispy onion strings, pickles and Solar Gravity sauce.$n$),
    -- Halal and alcohol-free: no "cocktail version", no unexplained curaçao.
    ('0a2b9e5b',
     $o$Strong and refreshing mocktail with blue caracao and energy drink$o$,
     $n$A strong, refreshing alcohol-free mocktail with blue curaçao syrup and an energy drink.$n$),
    ('a6e706ad',
     $o$A classic mocktail that combines orange, grenadine, and lemon providing a guilt-free refreshing experience from it's original cocktail version$o$,
     $n$A classic alcohol-free mocktail of orange, grenadine and lemon: bright, fruity and refreshing.$n$)
  ) AS v(id_prefix, old_desc, new_desc)
 WHERE m.id::text LIKE v.id_prefix || '%' AND m.description = v.old_desc;

-- ---- Halal: nothing on this menu is alcohol ------------------------------
DO $$
DECLARE n int;
BEGIN
  UPDATE public.menu_items SET meal_role = 'cold_drink', updated_at = now() WHERE meal_role = 'alcohol';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n > 0 THEN
    RAISE NOTICE 'menu_corrections: % item(s) had the alcohol role; La Soul serves no alcohol, set to cold_drink', n;
  END IF;
END $$;

-- The menu promises it; the database keeps the promise.
ALTER TABLE public.menu_items DROP CONSTRAINT IF EXISTS menu_items_no_alcohol;
ALTER TABLE public.menu_items ADD CONSTRAINT menu_items_no_alcohol
  CHECK (meal_role IS DISTINCT FROM 'alcohol') NOT VALID;
ALTER TABLE public.menu_items VALIDATE CONSTRAINT menu_items_no_alcohol;
