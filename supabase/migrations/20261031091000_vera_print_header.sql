-- Vera Italia's kitchen tickets print "Vera Italia" at the top, not "La Soul".
--
-- Its settings row (20261028090000_two_restaurants_foundation.sql) was created
-- with the column defaults, and print_header defaults to 'La Soul'
-- (20260620180000_printing_tipping_reports.sql). Every kitchen and bar ticket
-- Vera Italia printed would have been headed with the other restaurant's name.
--
-- Only the untouched default is replaced: a header the owner has already typed
-- for Vera Italia stays. Running this again changes nothing.

UPDATE public.restaurant_settings
   SET print_header = 'Vera Italia'
 WHERE venue_id = 'a5000000-0000-4000-8000-000000000002'
   AND print_header = 'La Soul';
