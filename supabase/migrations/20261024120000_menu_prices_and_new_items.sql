-- =====================================================================
-- October 2026 price list, and four dishes the order app never had
--
-- menu.lasoul.net (the old static menu) carried the current prices; the order
-- app was still on the previous list. 65 items move, almost all by 1 KM.
-- Arabic Coffee White is deliberately not here: the old site showed 15 KM on
-- the card and 25 KM in the pop-up, and 15 KM is what the database already has.
--
-- Each update only fires while the row still holds the old price, so a price an
-- admin has changed by hand since is left alone, and re-running is a no-op.
-- =====================================================================

DO $$
DECLARE
  v_changed int;
BEGIN
  WITH new_prices(id, price, was) AS (VALUES
  ('19828d06-5910-45eb-9744-27df058c99ed'::uuid, 6.00, 5.00), -- Americano
  ('1d94a936-20c2-4d98-9a70-ed0751c154f5'::uuid, 7.00, 6.00), -- Caffe Latte
  ('c4450a03-a1bb-49c4-9ad5-72117f2b1fda'::uuid, 9.00, 8.00), -- Caffe Mocha
  ('445a26ba-ee0e-4008-97d2-74c88ba58be8'::uuid, 5.00, 4.00), -- Double Espresso
  ('6d045710-1c52-4676-8a29-8c1df58b07f5'::uuid, 3.00, 2.00), -- Espresso
  ('9eead00b-463c-40f0-9529-9e5b36ced112'::uuid, 8.00, 6.00), -- Flat White
  ('df6a0352-89e5-4be6-8694-79fe8a6ac5bf'::uuid, 9.00, 8.00), -- Spanish Latte
  ('f1d72e8a-b0be-4b7a-b12a-9cc7a15277fb'::uuid, 15.00, 14.00), -- V60 Hot
  ('0dbec3fe-d56c-4c73-a57f-3845bf2c21bf'::uuid, 15.00, 14.00), -- V60 Cold
  ('eac83ec6-f2d4-4630-ad80-0e8678d43ba9'::uuid, 15.00, 14.00), -- Cold Brew
  ('7f63e56c-50f8-4600-9cdb-a480aad579dc'::uuid, 6.00, 5.00), -- Iced Americano
  ('a30ba69b-77b1-4b4f-8850-a47094a0fe06'::uuid, 9.00, 8.00), -- Iced Caramel Macchiato
  ('eaee8853-0151-49d4-afef-3e56f7180760'::uuid, 9.00, 8.00), -- Iced Spanish Latte
  ('31af65ef-f632-4a03-b557-75fca5d1ef61'::uuid, 9.00, 8.00), -- Hot Caramel Macchiato
  ('0f2be686-a58a-4863-bd8a-0adf997afd45'::uuid, 8.00, 7.00), -- Hot Chocolate
  ('f9fc6149-36ca-4a00-b5e8-85983dd12e4e'::uuid, 9.00, 8.00), -- Salted Caramel Hot Chocolate
  ('c139f3ad-1f5d-4e10-b649-07fdad93c457'::uuid, 8.00, 6.00), -- Rose Latte
  ('f9a66811-55bc-4b39-9be9-cfc8606243e6'::uuid, 9.00, 8.00), -- Pina Colada
  ('c1242eb6-b906-41bd-b3f8-573d822352ad'::uuid, 9.00, 7.00), -- Sunshine
  ('a6e706ad-8e85-4c74-b1bb-c54598878ccd'::uuid, 9.00, 8.00), -- Virgin Sunrise
  ('28b51e15-d230-4317-a57a-6330c5ba0623'::uuid, 13.00, 12.00), -- Affogato
  ('5512621a-08b3-49b9-b7c5-1ec4030ed4d0'::uuid, 9.00, 7.00), -- Camomile Tea
  ('0cfa2bbc-a0b2-4bae-8fb8-be490990ea5f'::uuid, 9.00, 7.00), -- English Breakfast Tea
  ('a69d4ceb-4a8b-43e8-abd0-c000e2ab3013'::uuid, 9.00, 7.00), -- Green Tea
  ('74d40491-629b-47e2-8aa8-9ab12a7bdc27'::uuid, 9.00, 7.00), -- Hibiscus Tea
  ('212a59c8-e0a1-47fe-991c-d006db6e887e'::uuid, 8.00, 7.00), -- Hibiscus Iced Tea
  ('9638392b-d507-4d94-9c9a-977752be9048'::uuid, 8.00, 7.00), -- Lemon Iced Tea
  ('37bf2c55-d3f1-4b8f-8507-db9ae8bbd051'::uuid, 8.00, 7.00), -- Peach Iced Tea
  ('67e0101b-21c0-492d-8593-a17fed0436b7'::uuid, 8.00, 7.00), -- Strawberry Iced Tea
  ('6407181b-495b-4a72-8c5a-92ba2a6ed742'::uuid, 9.00, 8.00), -- Fresh Lemon & Mint Juice
  ('b0b3385b-b5a9-420e-acf1-d7ef563df8dd'::uuid, 7.00, 6.00), -- Fresh Orange Juice
  ('fcf82ebd-8745-464e-9055-bf6d8ccb8438'::uuid, 9.00, 8.00), -- Blue Ocean Mojito
  ('f14ddc91-1fc8-4885-b7d2-9071c935add6'::uuid, 8.00, 7.00), -- Classic Mojito
  ('cc4bcd04-5a83-4d02-8f72-113ff99c62e8'::uuid, 9.00, 8.00), -- Mango Mojito
  ('47b69d62-42c5-45f7-8f29-f78541207f1c'::uuid, 9.00, 8.00), -- Passion Fruit Mojito
  ('d56f5cac-825a-4bae-b406-e4f4776ad751'::uuid, 9.00, 8.00), -- Peach Mojito
  ('1d36f430-a209-459d-a0c5-bb18a2a2f85b'::uuid, 9.00, 8.00), -- Raspberry Mojito
  ('f5adc58c-ab5e-4b9f-8a99-9678d9b00f67'::uuid, 9.00, 8.00), -- Strawberry Mojito
  ('59da62dc-7598-4d6f-8d3c-cc4fbb8009a0'::uuid, 8.00, 7.00), -- Passion Fruit Lemonade
  ('e8879448-6477-4e79-8327-b4424c2a6f8d'::uuid, 8.00, 7.00), -- Peach Lemonade
  ('c9a69b0a-986d-49b9-a6d9-016439c61fcb'::uuid, 8.00, 7.00), -- Strawberry Lemonade
  ('85eb8977-9bd9-4d8a-86b7-285060783db4'::uuid, 4.00, 3.00), -- Coca-Cola
  ('578910ce-2b05-4a7e-9f99-8c32674cee6f'::uuid, 4.00, 3.00), -- Coca-Cola Zero
  ('74bd507f-04c6-4112-8c1f-47beef9f68ad'::uuid, 4.00, 3.00), -- Fanta
  ('28c3dc08-f6a2-4e34-a221-d0f35a6f3f08'::uuid, 4.00, 3.00), -- Sprite
  ('7c9e6489-94ad-4ef5-a777-958f7f1bed9a'::uuid, 18.50, 17.50), -- French Toast
  ('609de519-2ef0-4fd5-af1a-26e59dc510b0'::uuid, 15.00, 14.00), -- Granola Bowl
  ('5a674711-02e2-416e-99de-7fa1e76003aa'::uuid, 25.00, 17.50), -- Breakfast Platter
  ('7382930d-240f-48c4-a3e1-5555e8561e60'::uuid, 35.00, 27.00), -- Breakfast Platter for Two
  ('f90e4414-312d-4e3e-bae4-524d3e716296'::uuid, 17.00, 15.00), -- Shakshuka Platter
  ('d95c9607-3f9f-4982-a40d-27b2448ef1d3'::uuid, 18.00, 16.00), -- Stuffed Croissant with Eggs & Cheese
  ('818ee57e-d8e8-45d9-b3e0-cb498b02c705'::uuid, 15.50, 14.50), -- Turkish Egg
  ('1dd974a0-8e3a-4a86-b0d3-d2cff08b06e1'::uuid, 16.50, 15.50), -- La Soul Burger
  ('6f618d6c-42a7-44a6-818a-13de098e1897'::uuid, 15.00, 14.00), -- Manhattan Burger
  ('9592bf2c-6a81-4dad-89f1-db43ca9d5f1a'::uuid, 16.50, 15.50), -- Mushroom Burger
  ('d428cbc8-229b-4a68-9b60-c0b13f56a92e'::uuid, 15.00, 14.00), -- Original Burger
  ('e4ffaa6d-83b9-4eb8-a89c-e07ca01616c7'::uuid, 19.00, 18.00), -- Solar Gravity
  ('da5762f6-ed01-432d-861e-52995c2248d8'::uuid, 16.00, 15.00), -- Volcano Beef Burger
  ('57ffe3df-eed0-4842-8d8e-62a70672063b'::uuid, 16.50, 15.50), -- Classic Crispy Chicken Burger
  ('456e4131-b3ba-45ad-b609-6bfc89cf4dc2'::uuid, 16.50, 15.50), -- Dynamite Chicken Burger
  ('a07007ee-af4b-4c47-88a2-254a28fb7a53'::uuid, 16.50, 15.50), -- Volcano Crispy Chicken Burger
  ('1731a57b-6b84-42d2-81d3-0b8650442b3b'::uuid, 15.00, 14.00), -- Dangerous Slider
  ('32d1fe9b-ae30-49fb-8afb-37e0e5edaa29'::uuid, 18.00, 17.00), -- Mix Slider
  ('b780b03b-e220-4f03-a49c-ee95fe9ea23a'::uuid, 13.00, 12.00), -- Midnight Slider
  ('c50bcd41-0b89-4a1b-b2c4-9ea1dca986a9'::uuid, 10.00, 9.00)  -- Vegetable Slider
  ), updated AS (
    UPDATE public.menu_items m
       SET price = n.price, updated_at = now()
      FROM new_prices n
     WHERE m.id = n.id AND m.price = n.was
    RETURNING m.id
  )
  SELECT count(*) INTO v_changed FROM updated;
  RAISE NOTICE 'menu prices updated: % of 65', v_changed;
END $$;

-- ---------------------------------------------------------------------
-- New items. Photos live at the same paths the old site used; this app now
-- serves those paths from public/img, so the URLs survive the domain moving.
-- Allergens are left empty, like every other item, until the kitchen confirms
-- them in Admin -> Menu.
-- ---------------------------------------------------------------------
INSERT INTO public.menu_items
  (id, subcategory_id, name, name_bs, name_ar, description, description_bs, description_ar,
   price, image_url, station, meal_role, sort_order)
SELECT v.id, s.id, v.name, v.name_bs, v.name_ar, v.description, v.description_bs, v.description_ar,
       v.price, v.image_url, v.station, v.meal_role::public.meal_role, v.sort_order
  FROM (VALUES
    ('7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c01'::uuid, 'Filter Coffee',
     'Chemex Hot', 'Chemex Hot', 'كيميكس هوت',
     'Brewed with 100% Arabica beans for filter coffee lovers. Lighter, with a cleaner taste.',
     'Pripremljeno od 100% arabica zrna za ljubitelje filter kafe. Lakšeg i čišćeg okusa.',
     'تُحضَّر من حبوب أرابيكا ١٠٠٪ لعشاق القهوة المفلترة. أخف وذات طعم أنقى.',
     12.00, 'https://menu.lasoul.net/img/drink/chemex.jpg', 'bar', 'hot_drink', 6),
    ('7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c02'::uuid, 'Burgers',
     'Healthy Beef Burger', 'Healthy Beef Burger', 'برجر لحم بقري صحي',
     'Juicy beef patty with low-fat cheddar, iceberg lettuce, tomato, cucumber and onion, with a light creamy labneh sauce in a multigrain wholewheat bun.',
     'Sočni juneći burger sa low-fat cheddar sirom, svježom iceberg salatom, paradajzom, krastavcima i lukom, uz light kremasti labneh sos u višezrnastom integralnom pecivu.',
     'برجر لحم بقري طري مع جبن شيدر قليل الدسم وخس آيسبرغ وطماطم وخيار وبصل، مع صلصة لبنة كريمية خفيفة في خبز متعدد الحبوب من القمح الكامل.',
     18.50, 'https://menu.lasoul.net/img/food/healthybeefburger.jpg', 'kitchen', 'main', 10),
    ('7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c03'::uuid, 'Burgers',
     'Healthy Chicken Burger', 'Healthy Chicken Burger', 'برجر دجاج صحي',
     'Grilled chicken with low-fat cheddar, rocket, cucumber and onion, with a light creamy pesto sauce in a soft multigrain wholewheat bun.',
     'Grilovana piletina sa low-fat cheddar sirom, rukolom, krastavcima i lukom, uz light kremasti pesto sos u mekanom višezrnastom integralnom pecivu.',
     'دجاج مشوي مع جبن شيدر قليل الدسم وجرجير وخيار وبصل، مع صلصة بيستو كريمية خفيفة في خبز طري متعدد الحبوب من القمح الكامل.',
     18.50, 'https://menu.lasoul.net/img/food/healthychickenburger.jpg', 'kitchen', 'main', 11),
    ('7c1e2a40-5b0d-4c8e-9a51-1f6d3e2b9c04'::uuid, 'Desserts',
     'Banana Pudding', 'Banana Puding', 'بودينغ الموز',
     'Creamy banana pudding layered with banana cream, fresh banana and whipped cream, finished with peanut butter.',
     'Kremasti banana puding u slojevima od kreme od banane, svježih banana i šlaga na vrhu, preliven maslacem od kikirikija.',
     'بودينغ الموز الكريمي بطبقات من كريمة الموز والموز الطازج والكريمة المخفوقة، مغطى بزبدة الفول السوداني.',
     13.00, 'https://menu.lasoul.net/img/bananapudding.jpg', 'kitchen', 'dessert', 22)
  ) AS v(id, subcategory_name, name, name_bs, name_ar, description, description_bs, description_ar,
         price, image_url, station, meal_role, sort_order)
  JOIN public.subcategories s ON s.name = v.subcategory_name
 WHERE NOT EXISTS (SELECT 1 FROM public.menu_items m WHERE m.id = v.id OR m.name = v.name);
