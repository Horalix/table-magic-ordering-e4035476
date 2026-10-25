import { create } from 'zustand';
import { useCallback, useMemo } from 'react';

export type Locale = 'en' | 'bs' | 'ar';

interface LanguageStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

/**
 * The language a guest sees before choosing one.
 *
 * A saved choice always wins. Otherwise a phone set to Bosnian, Croatian or
 * Serbian gets Bosnian and one set to Arabic gets Arabic: most guests at a
 * Sarajevo table never touch the language switch, so defaulting everyone to
 * English made the first screen foreign to the majority of them.
 */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem('lasoul-lang');
    if (saved === 'en' || saved === 'bs' || saved === 'ar') return saved;
  } catch { /* storage blocked: fall through to the device language */ }
  const lang = (typeof navigator !== 'undefined' ? navigator.language : 'en').toLowerCase();
  if (/^(bs|hr|sr|sh)(-|$)/.test(lang)) return 'bs';
  if (lang.startsWith('ar')) return 'ar';
  return 'en';
}

/**
 * Staff screens (kitchen, waiter, admin) are English-only by design. The guest
 * language must never reach them: an Arabic phone used to turn the kitchen
 * display right-to-left because this module set `dir` globally on load.
 */
export const isStaffPath = (path: string) => /^\/(admin|kitchen|waiter)(\/|$)/.test(path);

/**
 * `lang` matters for every locale, not just Arabic: screen readers pick the
 * pronunciation from it, and Bosnian read aloud in an English voice is close
 * to unintelligible.
 */
export function applyDocumentLocale(locale: Locale, path = typeof window !== 'undefined' ? window.location.pathname : '/') {
  if (typeof document === 'undefined') return;
  const staff = isStaffPath(path);
  document.documentElement.lang = staff ? 'en' : locale;
  document.documentElement.dir = !staff && locale === 'ar' ? 'rtl' : 'ltr';
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  locale: initialLocale(),
  setLocale: (locale) => {
    // Storage can be blocked (private mode, embedded browsers); the switch
    // must still work for this visit.
    try { localStorage.setItem('lasoul-lang', locale); } catch { /* not remembered */ }
    applyDocumentLocale(locale);
    set({ locale });
  },
}));

applyDocumentLocale(initialLocale());

const translations: Record<string, Record<Locale, string>> = {
  // Navigation & General
  'menu': { en: 'Menu', bs: 'Meni', ar: 'القائمة' },
  'your_order': { en: 'Your Order', bs: 'Vaša narudžba', ar: 'طلبك' },
  'your_tab': { en: 'Your Tab', bs: 'Vaš račun', ar: 'فاتورتك' },
  'table': { en: 'Table', bs: 'Sto', ar: 'الطاولة' },
  'back_to_menu': { en: 'Back to Menu', bs: 'Nazad na meni', ar: 'العودة إلى القائمة' },
  'browse_menu': { en: 'Just browse the menu', bs: 'Pogledaj meni bez naručivanja', ar: 'تصفّح القائمة فقط' },

  // Ordering safely
  'send_order': { en: 'Send order', bs: 'Pošalji narudžbu', ar: 'أرسل الطلب' },
  'order_sent_title': { en: 'Order sent to the kitchen', bs: 'Narudžba je poslana u kuhinju', ar: 'تم إرسال الطلب إلى المطبخ' },
  'to_pay': { en: 'To pay', bs: 'Za plaćanje', ar: 'المبلغ المستحق' },
  'pay_waiter_when_ready': { en: 'Pay your waiter whenever you’re ready — there’s no need to do it now.', bs: 'Platite konobaru kad god želite — ne morate odmah.', ar: 'ادفع للنادل متى شئت — لا داعي للدفع الآن.' },
  'item_unavailable_now': { en: 'No longer available — remove it to send your order', bs: 'Više nije dostupno — uklonite da pošaljete narudžbu', ar: 'لم يعد متوفرًا — احذفه لإرسال طلبك' },
  'some_items_unavailable': { en: 'Some items are no longer available. They’re marked below.', bs: 'Neke stavke više nisu dostupne. Označene su ispod.', ar: 'بعض الأصناف لم تعد متوفرة. تم تحديدها أدناه.' },
  'prices_updated': { en: 'Prices were updated to today’s menu.', bs: 'Cijene su ažurirane prema današnjem meniju.', ar: 'تم تحديث الأسعار وفق قائمة اليوم.' },
  'order_not_sent_retry': { en: 'Your order wasn’t sent and nothing was charged. Please try again.', bs: 'Narudžba nije poslana i ništa nije naplaćeno. Pokušajte ponovo.', ar: 'لم يُرسل طلبك ولم يتم خصم أي مبلغ. حاول مجددًا.' },
  'slow_down': { en: 'Too many orders at once — please wait a moment.', bs: 'Previše narudžbi odjednom — sačekajte trenutak.', ar: 'طلبات كثيرة في وقت واحد — يرجى الانتظار قليلًا.' },
  'order_too_large': { en: 'That’s a very big order — please send it in two parts, or ask your waiter.', bs: 'To je jako velika narudžba — pošaljite je u dva dijela ili se obratite konobaru.', ar: 'هذا طلب كبير جدًا — يرجى إرساله على دفعتين أو سؤال النادل.' },
  // Held for staff (see order_abuse_guards). Never say why: the guest is almost always real.
  'order_received_title': { en: 'Order received', bs: 'Narudžba je primljena', ar: 'تم استلام الطلب' },
  'order_waiter_will_confirm': { en: 'Your waiter will confirm it in a moment, then it goes straight to the kitchen.', bs: 'Vaš konobar će je potvrditi za trenutak, a zatim ide pravo u kuhinju.', ar: 'سيؤكده النادل خلال لحظات، ثم يذهب مباشرة إلى المطبخ.' },
  'waiting_for_waiter_confirm': { en: 'Waiting for your waiter to confirm', bs: 'Čeka potvrdu konobara', ar: 'بانتظار تأكيد النادل' },
  'no_payment_options': { en: 'Ordering from your phone is paused right now — please ask your waiter.', bs: 'Naručivanje s telefona je trenutno pauzirano — obratite se konobaru.', ar: 'الطلب من الهاتف متوقف حاليًا — يرجى سؤال النادل.' },
  'leave_table_q': { en: 'Leave this table?', bs: 'Napustiti ovaj sto?', ar: 'مغادرة هذه الطاولة؟' },
  'leave_table_body': { en: 'Anything you haven’t sent yet will be cleared. Orders already sent stay on the table’s tab.', bs: 'Sve što još niste poslali bit će obrisano. Poslane narudžbe ostaju na računu stola.', ar: 'سيتم مسح كل ما لم ترسله بعد. الطلبات المرسلة تبقى على حساب الطاولة.' },
  'leave': { en: 'Leave', bs: 'Napusti', ar: 'مغادرة' },
  'stay': { en: 'Stay', bs: 'Ostani', ar: 'البقاء' },
  'browse_scan_banner': { en: 'You’re browsing. Scan the QR code on your table to order.', bs: 'Trenutno samo razgledate meni. Skenirajte QR kod na stolu da biste naručili.', ar: 'أنت تتصفح القائمة. امسح رمز QR على طاولتك للطلب.' },
  'load_failed': { en: 'Couldn’t load this. Check your connection.', bs: 'Učitavanje nije uspjelo. Provjerite internet vezu.', ar: 'تعذر التحميل. تحقق من اتصالك.' },
  'subtotal': { en: 'Subtotal', bs: 'Međuzbir', ar: 'المجموع الفرعي' },
  'orders_count_one': { en: 'order', bs: 'narudžba', ar: 'طلب' },
  'orders_count_other': { en: 'orders', bs: 'narudžbe', ar: 'طلبات' },
  'bill_request_failed': { en: 'Couldn’t ask for the bill. Please try again.', bs: 'Zahtjev za račun nije poslan. Pokušajte ponovo.', ar: 'تعذر طلب الفاتورة. حاول مجددًا.' },
  'menu_item_fallback': { en: 'Item', bs: 'Stavka', ar: 'صنف' },
  'badge_chef_pick': { en: 'Chef’s pick', bs: 'Preporuka kuhara', ar: 'اختيار الشيف' },
  'badge_seasonal': { en: 'Seasonal', bs: 'Sezonsko', ar: 'موسمي' },
  'badge_house_favourite': { en: 'House favourite', bs: 'Omiljeno kod nas', ar: 'المفضّل لدينا' },
  'name_too_long': { en: 'Please use a shorter name.', bs: 'Molimo unesite kraće ime.', ar: 'يرجى استخدام اسم أقصر.' },
  'waiter_call_failed': { en: 'Couldn’t reach your waiter. Please try again.', bs: 'Konobar nije obaviješten. Pokušajte ponovo.', ar: 'تعذر إبلاغ النادل. حاول مجددًا.' },
  'rough_estimate': { en: 'rough estimate', bs: 'okvirna procjena', ar: 'تقدير تقريبي' },
  'more_waiting': { en: 'more waiting', bs: 'još čeka', ar: 'آخرون بالانتظار' },
  'fewer_people': { en: 'Fewer people', bs: 'Manje osoba', ar: 'أشخاص أقل' },
  'more_people': { en: 'More people', bs: 'Više osoba', ar: 'أشخاص أكثر' },
  'change_language': { en: 'Change language', bs: 'Promijeni jezik', ar: 'تغيير اللغة' },
  'back': { en: 'Back', bs: 'Nazad', ar: 'رجوع' },
  'goes_with_your': { en: 'Goes with your {name}', bs: 'Odlično uz {name}', ar: 'مثالي مع {name}' },
  'add_more_items': { en: 'Add more items', bs: 'Dodaj još', ar: 'أضف المزيد' },
  'minutes_short': { en: 'min', bs: 'min', ar: 'دقيقة' },
  'hours_short': { en: 'h', bs: 'h', ar: 'ساعة' },

  // Categories
  'drinks': { en: 'Drinks', bs: 'Pića', ar: 'المشروبات' },
  'food': { en: 'Food', bs: 'Hrana', ar: 'الطعام' },
  'desserts': { en: 'Desserts', bs: 'Deserti', ar: 'الحلويات' },
  'drinks_desc': { en: 'Coffee, tea, mojitos & fresh juice', bs: 'Kafa, čaj, mojito i svježi sokovi', ar: 'قهوة، شاي، موهيتو وعصائر طازجة' },
  'food_desc': { en: 'Breakfast, burgers, pasta & more', bs: 'Doručak, burgeri, tjestenina i još mnogo toga', ar: 'فطور، برجر، باستا والمزيد' },
  'jump_to': { en: 'Jump to', bs: 'Idi na', ar: 'انتقل إلى' },
  'menu_sections': { en: 'Menu sections', bs: 'Dijelovi menija', ar: 'أقسام القائمة' },
  'call_us': { en: 'Call us', bs: 'Pozovite nas', ar: 'اتصل بنا' },
  'find_us': { en: 'Find us', bs: 'Pronađite nas', ar: 'موقعنا' },
  'desserts_desc': { en: 'A sweet finish', bs: 'Nešto slatko za kraj', ar: 'ختامها حلو' },

  // Cart
  'place_order': { en: 'Place Order', bs: 'Naruči', ar: 'تقديم الطلب' },
  'placing_order': { en: 'Placing Order...', bs: 'Naručujem...', ar: 'جارٍ تقديم الطلب...' },
  'order_empty': { en: 'Your order is empty', bs: 'Vaša narudžba je prazna', ar: 'طلبك فارغ' },
  'browse_menu_to_add': { en: 'Browse the menu to add items', bs: 'Pogledajte meni i dodajte nešto.', ar: 'تصفّح القائمة لإضافة أصناف' },
  'total': { en: 'Total', bs: 'Ukupno', ar: 'المجموع' },
  'view_order': { en: 'View Order', bs: 'Pogledaj narudžbu', ar: 'عرض الطلب' },
  'view_your_tab': { en: 'View Your Tab', bs: 'Pogledaj račun', ar: 'عرض فاتورتك' },
  'add_to_order': { en: 'Add to order', bs: 'Dodaj u narudžbu', ar: 'أضف إلى الطلب' },
  'special_requests': { en: 'Special requests', bs: 'Posebni zahtjevi', ar: 'طلبات خاصة' },
  'special_requests_placeholder': { en: 'E.g. no onions, extra sauce...', bs: 'Npr. bez luka, više sosa…', ar: 'مثال: بدون بصل، صوص إضافي...' },

  // No-refund confirmation
  'confirm_order': { en: 'Confirm Your Order', bs: 'Potvrdite narudžbu', ar: 'تأكيد طلبك' },
  'no_refund_message': { en: 'Once placed, this order cannot be cancelled or refunded. Please review your items carefully.', bs: 'Nakon narudžbe, nije moguće otkazati ili vratiti novac. Molimo pažljivo pregledajte stavke.', ar: 'بمجرد تقديم الطلب، لا يمكن إلغاؤه أو استرداد المبلغ. يرجى مراجعة الأصناف بعناية.' },
  'go_back': { en: 'Go Back', bs: 'Nazad', ar: 'رجوع' },
  'confirm_and_order': { en: 'Confirm Order', bs: 'Potvrdi narudžbu', ar: 'تأكيد الطلب' },

  // Order Success
  'order_confirmed': { en: 'Order Confirmed!', bs: 'Narudžba potvrđena!', ar: 'تم تأكيد الطلب!' },
  'order_sent_kitchen': { en: 'Your order has been sent to the kitchen.', bs: 'Vaša narudžba je poslana u kuhinju.', ar: 'تم إرسال طلبك إلى المطبخ.' },
  'order_more': { en: 'Order More', bs: 'Naruči više', ar: 'اطلب المزيد' },

  // Browse / status / dietary (added features)
  'order_again': { en: 'Order again', bs: 'Naruči ponovo', ar: 'اطلب مرة أخرى' },
  'got_it': { en: 'Got it', bs: 'U redu', ar: 'حسناً' },
  'order_progress': { en: 'Order progress', bs: 'Status narudžbe', ar: 'حالة الطلب' },
  'status_received': { en: 'Received', bs: 'Primljeno', ar: 'تم الاستلام' },
  'list_view': { en: 'List', bs: 'Lista', ar: 'عرض كقائمة' },
  'grid_view': { en: 'Grid', bs: 'Mreža', ar: 'عرض كشبكة' },
  'filters': { en: 'Filters', bs: 'Filteri', ar: 'الفلاتر' },
  'clear_filters': { en: 'Clear', bs: 'Očisti', ar: 'مسح' },
  'diet_vegetarian': { en: 'Vegetarian', bs: 'Vegetarijansko', ar: 'نباتي' },
  'diet_vegan': { en: 'Vegan', bs: 'Vegansko', ar: 'نباتي بالكامل' },
  'diet_spicy': { en: 'Spicy', bs: 'Ljuto', ar: 'حار' },
  'diet_gluten_free': { en: 'Gluten-free', bs: 'Bez glutena', ar: 'خالٍ من الغلوتين' },
  'diet_dairy_free': { en: 'Dairy-free', bs: 'Bez mliječnih proizvoda', ar: 'خالٍ من الألبان' },
  'diet_contains_nuts': { en: 'Contains nuts', bs: 'Sadrži orašaste plodove', ar: 'يحتوي على مكسرات' },
  'diet_halal': { en: 'Halal', bs: 'Halal', ar: 'حلال' },
  'sold_out': { en: 'Sold out', bs: 'Trenutno nema', ar: 'نفدت الكمية' },

  // Single-QR table entry
  'which_table': { en: 'Which table are you at?', bs: 'Za kojim ste stolom?', ar: 'على أي طاولة أنت؟' },
  'which_table_sub': { en: 'Enter your table number to start ordering.', bs: 'Unesite broj stola da započnete narudžbu.', ar: 'أدخل رقم طاولتك لبدء الطلب.' },
  'table_number_placeholder': { en: 'Table number', bs: 'Broj stola', ar: 'رقم الطاولة' },

  // Running Tab
  'running_total': { en: 'Running Total', bs: 'Ukupni račun', ar: 'المجموع الجاري' },
  'no_active_session': { en: 'You’re not at a table yet', bs: 'Još niste za stolom', ar: 'لم تنضمّ إلى طاولة بعد' },
  'scan_qr_tab': { en: 'Scan the QR code at your table to see your tab.', bs: 'Skenirajte QR kod na stolu da vidite račun.', ar: 'امسح رمز QR على طاولتك لمشاهدة فاتورتك.' },
  'no_orders_yet': { en: 'No orders yet', bs: 'Još nema narudžbi', ar: 'لا توجد طلبات بعد' },
  'browse_menu_start': { en: 'Browse the menu to get started.', bs: 'Pogledajte meni da započnete.', ar: 'تصفح القائمة للبدء.' },
  'request_bill': { en: 'Request Bill', bs: 'Zatraži račun', ar: 'اطلب الفاتورة' },
  'requesting': { en: 'Requesting...', bs: 'Šaljem zahtjev…', ar: 'جارٍ الطلب...' },
  'bill_requested': { en: 'Bill requested', bs: 'Račun zatražen', ar: 'تم طلب الفاتورة' },
  'server_notified': { en: 'Your server has been notified.', bs: 'Vaš konobar je obaviješten.', ar: 'تم إخطار النادل.' },

  // Call Waiter
  'call_waiter': { en: 'Call Waiter', bs: 'Pozovi konobara', ar: 'استدعاء النادل' },
  'calling': { en: 'Calling...', bs: 'Pozivam...', ar: 'جارٍ الاستدعاء...' },
  'waiter_notified': { en: 'Waiter notified', bs: 'Konobar je obaviješten', ar: 'تم إخطار النادل' },

  // QR Scan prompts
  'scan_qr_order': { en: 'Scan the QR code at your table to place an order', bs: 'Skenirajte QR kod na stolu da biste naručili.', ar: 'امسح رمز QR على طاولتك لتقديم طلب' },
  'scan_qr_to_order': { en: 'Scan the QR code at your table to order', bs: 'Skenirajte QR kod na stolu da biste naručili.', ar: 'امسح رمز QR على طاولتك للطلب' },
  'scan_qr_again': { en: 'Please scan the QR code at your table to place an order', bs: 'Molimo skenirajte QR kod na stolu da biste naručili.', ar: 'يرجى مسح رمز QR على طاولتك لتقديم طلب' },

  // Statuses
  'status_pending': { en: 'Pending', bs: 'Na čekanju', ar: 'قيد الانتظار' },
  'status_confirmed': { en: 'Confirmed', bs: 'Potvrđeno', ar: 'مؤكد' },
  'status_preparing': { en: 'Preparing', bs: 'U pripremi', ar: 'قيد التحضير' },
  'status_ready': { en: 'Ready', bs: 'Spremno', ar: 'جاهز' },
  'status_served': { en: 'Served', bs: 'Servirano', ar: 'تم التقديم' },
  'status_cancelled': { en: 'Cancelled', bs: 'Otkazano', ar: 'ملغى' },

  // Table Entry
  'setting_up_table': { en: 'Connecting you to your table…', bs: 'Povezujemo vas sa stolom…', ar: 'جارٍ ربطك بطاولتك…' },
  'invalid_qr': { en: 'Invalid QR code. Please ask your waiter for assistance.', bs: 'Nevažeći QR kod. Zamolite konobara za pomoć.', ar: 'رمز QR غير صالح. يرجى طلب المساعدة من النادل.' },
  'qr_expired': { en: 'This QR code is invalid or expired. Please ask your waiter to help you scan.', bs: 'Ovaj QR kod je nevažeći ili je istekao. Zamolite konobara za pomoć.', ar: 'رمز QR هذا غير صالح أو منتهي الصلاحية. اطلب من النادل المساعدة.' },
  'session_failed': { en: 'Could not start your session. Please try again.', bs: 'Nismo uspjeli otvoriti vaš sto. Pokušajte ponovo.', ar: 'تعذر بدء الجلسة. يرجى المحاولة مرة أخرى.' },
  'something_wrong': { en: 'Something went wrong. Please try scanning again.', bs: 'Nešto je pošlo naopako. Pokušajte ponovo skenirati.', ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.' },

  // Guest name
  'welcome': { en: 'Welcome!', bs: 'Dobrodošli!', ar: 'أهلاً وسهلاً!' },
  'enter_your_name': { en: 'Enter your name', bs: 'Unesite svoje ime', ar: 'أدخل اسمك' },
  'name_placeholder': { en: 'Your name', bs: 'Vaše ime', ar: 'اسمك' },
  'continue': { en: 'Continue', bs: 'Nastavi', ar: 'متابعة' },
  'name_required': { en: 'Please enter your name', bs: 'Molimo unesite svoje ime', ar: 'يرجى إدخال اسمك' },

  // Session expired
  'session_expired': { en: 'Your session has expired. Please scan the QR code again.', bs: 'Vaša sesija je istekla. Skenirajte QR kod ponovo.', ar: 'انتهت جلستك. يرجى مسح رمز QR مرة أخرى.' },

  // Contact
  'phone': { en: '033 877-779', bs: '033 877-779', ar: '033 877-779' },
  'address': { en: 'Butmirska cesta 16A | 16B, Sarajevo', bs: 'Butmirska cesta 16A | 16B, Sarajevo', ar: 'Butmirska cesta 16A | 16B، سراييفو' },

  // No items
  'no_items_category': { en: 'No items available in this category yet.', bs: 'Još nema stavki u ovoj kategoriji.', ar: 'لا توجد أصناف في هذه الفئة بعد.' },
  'search_placeholder': { en: 'Search dishes, drinks, desserts…', bs: 'Pretraži jela, pića, deserte…', ar: 'ابحث عن الأطباق والمشروبات والحلويات…' },
  'no_results_title': { en: 'No dishes found', bs: 'Nema rezultata', ar: 'لم يتم العثور على أطباق' },
  'no_results_hint': { en: 'Try another search or browse categories.', bs: 'Pokušajte s drugim pojmom ili pogledajte kategorije.', ar: 'جرب بحثًا آخر أو تصفح الفئات.' },
  'added_to_order': { en: 'Added to order', bs: 'Dodano u narudžbu', ar: 'تمت الإضافة إلى الطلب' },
  'items_count_one': { en: 'item', bs: 'stavka', ar: 'صنف' },
  'items_count_other': { en: 'items', bs: 'stavki', ar: 'أصناف' },
  'clear_search': { en: 'Clear search', bs: 'Očisti pretragu', ar: 'مسح البحث' },

  // Just now / time
  'just_now': { en: 'Just now', bs: 'Upravo', ar: 'الآن' },

  // Review / Rating
  'how_was_experience': { en: 'How was your experience?', bs: 'Kako vam se svidjelo kod nas?', ar: 'كيف كانت تجربتك؟' },
  'rate_your_visit': { en: 'Tap a star to rate your visit', bs: 'Dodirnite zvjezdicu i ocijenite posjet', ar: 'اضغط على نجمة لتقييم زيارتك' },
  'thank_you_feedback': { en: 'Thank you for your feedback!', bs: 'Hvala na ocjeni!', ar: 'شكراً لملاحظاتك!' },
  'help_discover_lasoul': { en: 'Help others discover La Soul', bs: 'Pomozite drugima da otkriju La Soul', ar: 'ساعد الآخرين في اكتشاف La Soul' },
  'leave_google_review': { en: 'Leave a Google Review', bs: 'Ostavite Google recenziju', ar: 'اترك تقييماً على Google' },
  'close': { en: 'Close', bs: 'Zatvori', ar: 'إغلاق' },

  // Anti-spam
  'order_cooldown': { en: 'Please wait before placing another order.', bs: 'Molimo pričekajte prije sljedeće narudžbe.', ar: 'يرجى الانتظار قبل تقديم طلب آخر.' },
  'too_many_items': { en: 'Maximum 20 items per order.', bs: 'Maksimalno 20 stavki po narudžbi.', ar: 'الحد الأقصى 20 صنفًا لكل طلب.' },
  'max_quantity': { en: 'Maximum quantity is 10 per item.', bs: 'Maksimalna količina je 10 po stavci.', ar: 'الحد الأقصى 10 لكل صنف.' },
  'large_order_suggestion': { en: 'For large orders, feel free to call a server for assistance.', bs: 'Za veće narudžbe, slobodno pozovite konobara za pomoć.', ar: 'للطلبات الكبيرة، لا تتردد في استدعاء النادل للمساعدة.' },

  // Server rating
  'rate_your_server': { en: 'How was your server?', bs: 'Kako vas je uslužio konobar?', ar: 'كيف كانت خدمة النادل؟' },
  'served_by': { en: 'Served by', bs: 'Vaš konobar:', ar: 'النادل:' },
  'optional_comment': { en: 'Add a comment (optional)', bs: 'Dodajte komentar (nije obavezno)', ar: 'أضف تعليقًا (اختياري)' },
  'submit': { en: 'Submit', bs: 'Pošalji', ar: 'إرسال' },
  'skip': { en: 'Skip', bs: 'Preskoči', ar: 'تخطي' },
  'next': { en: 'Next', bs: 'Dalje', ar: 'التالي' },

  // Sections / waiter / admin
  'section': { en: 'Section', bs: 'Dio sale', ar: 'القسم' },
  'sections': { en: 'Sections', bs: 'Dijelovi sale', ar: 'الأقسام' },
  'waiter': { en: 'Waiter', bs: 'Konobar', ar: 'النادل' },
  'waiters': { en: 'Waiters', bs: 'Konobari', ar: 'النوادل' },
  'unassigned': { en: 'Unassigned', bs: 'Nedodijeljeno', ar: 'غير معيّن' },
  'occupied_for': { en: 'Occupied for', bs: 'Zauzet', ar: 'مشغولة منذ' },
  'waiting': { en: 'Waiting', bs: 'Čeka', ar: 'في الانتظار' },
  'performance': { en: 'Performance', bs: 'Performanse', ar: 'الأداء' },

  // Shared table — join + approval
  'waiting_to_join': { en: 'Waiting for the table to let you in…', bs: 'Čekamo da vas neko za stolom primi…', ar: 'بانتظار أن تسمح لك الطاولة بالدخول…' },
  'waiting_to_join_sub': { en: 'Someone at the table just needs to accept you — ask them to check their phone.', bs: 'Neko za stolom vas treba prihvatiti — zamolite ih da pogledaju telefon.', ar: 'يحتاج شخص ما على الطاولة إلى قبولك — اطلب منه التحقق من هاتفه.' },
  'wants_to_join': { en: 'wants to join your table', bs: 'želi se pridružiti vašem stolu', ar: 'يريد الانضمام إلى طاولتك' },
  'someone_wants_to_join': { en: 'Someone wants to join your table', bs: 'Neko se želi pridružiti vašem stolu', ar: 'شخص ما يريد الانضمام إلى طاولتك' },
  'accept': { en: 'Accept', bs: 'Prihvati', ar: 'قبول' },
  'decline': { en: 'Decline', bs: 'Odbij', ar: 'رفض' },
  'join_approved': { en: "You’re in — welcome to the table!", bs: 'Ušli ste — dobrodošli za sto!', ar: 'تم قبولك — أهلاً بك على الطاولة!' },
  'join_declined': { en: 'The table didn’t accept your request.', bs: 'Sto nije prihvatio vaš zahtjev.', ar: 'لم تقبل الطاولة طلبك.' },
  'joining_table': { en: 'Joining the table…', bs: 'Pridruživanje stolu…', ar: 'جارٍ الانضمام إلى الطاولة…' },
  'at_this_table': { en: 'At this table', bs: 'Za ovim stolom', ar: 'على هذه الطاولة' },
  'table_not_active': { en: 'This table is no longer active. Please scan the QR code again.', bs: 'Ovaj sto više nije aktivan. Skenirajte QR kod ponovo.', ar: 'هذه الطاولة لم تعد نشطة. يرجى مسح رمز QR مرة أخرى.' },
  'new_guest': { en: 'New guest', bs: 'Novi gost', ar: 'ضيف جديد' },
  'try_again': { en: 'Try again', bs: 'Pokušaj ponovo', ar: 'حاول مرة أخرى' },

  // Checkout & payment
  'checkout': { en: 'Checkout', bs: 'Plaćanje', ar: 'الدفع' },
  'choose_how_to_pay': { en: 'How would you like to pay?', bs: 'Kako želite platiti?', ar: 'كيف تودّ الدفع؟' },
  'pay_now_card': { en: 'Pay now by card', bs: 'Plati odmah karticom', ar: 'ادفع الآن بالبطاقة' },
  'pay_now_card_sub': { en: 'Instant — no waiting', bs: 'Odmah — bez čekanja', ar: 'فوري — بدون انتظار' },
  'call_waiter_to_pay': { en: 'Call a waiter', bs: 'Pozovi konobara', ar: 'استدعِ النادل' },
  'call_waiter_to_pay_sub': { en: 'Pay at the table — cash or card', bs: 'Platite za stolom — gotovinom ili karticom', ar: 'ادفع على الطاولة — نقداً أو بالبطاقة' },
  'no_refund_short': { en: 'Orders can’t be cancelled or refunded once placed.', bs: 'Narudžbe se ne mogu otkazati ni vratiti nakon slanja.', ar: 'لا يمكن إلغاء الطلبات أو استردادها بعد تقديمها.' },
  'card_coming_soon_title': { en: 'Card payment is coming soon', bs: 'Plaćanje karticom uskoro', ar: 'الدفع بالبطاقة قريباً' },
  'card_coming_soon_body': { en: 'Online card payment isn’t available just yet. A waiter can bring the card terminal or take cash.', bs: 'Online plaćanje karticom još nije dostupno. Konobar može donijeti terminal ili uzeti gotovinu.', ar: 'الدفع الإلكتروني بالبطاقة غير متاح بعد. يمكن للنادل إحضار جهاز البطاقة أو أخذ النقود.' },
  'order_in_kitchen': { en: 'Your order has been sent to the kitchen', bs: 'Vaša narudžba je poslana u kuhinju', ar: 'تم إرسال طلبك إلى المطبخ' },
  'waiter_on_the_way': { en: 'A waiter is on the way', bs: 'Konobar je na putu', ar: 'النادل في الطريق' },
  'sending': { en: 'Sending…', bs: 'Šaljem…', ar: 'جارٍ الإرسال…' },
  'popular': { en: 'Popular', bs: 'Popularno', ar: 'الأكثر طلباً' },
  'popular_picks': { en: 'Popular picks', bs: 'Popularni izbori', ar: 'الأكثر طلباً' },

  // Card payment (Monri)
  'pay_by_card': { en: 'Pay by card', bs: 'Plati karticom', ar: 'الدفع بالبطاقة' },
  'paying': { en: 'Processing…', bs: 'Obrada…', ar: 'جارٍ المعالجة…' },
  'payment_received': { en: 'Payment received — thank you!', bs: 'Plaćanje primljeno — hvala!', ar: 'تم استلام الدفعة — شكراً!' },
  'payment_failed': { en: 'Payment could not be processed. Please try again.', bs: 'Plaćanje nije uspjelo. Pokušajte ponovo.', ar: 'تعذّر إتمام الدفع. يرجى المحاولة مرة أخرى.' },
  'payment_declined': { en: 'Card declined. Try another card or call a waiter.', bs: 'Kartica odbijena. Probajte drugu karticu ili pozovite konobara.', ar: 'تم رفض البطاقة. جرّب بطاقة أخرى أو استدعِ النادل.' },
  'secure_payment_monri': { en: 'Secure payment processed by Monri', bs: 'Sigurno plaćanje putem Monrija', ar: 'دفع آمن عبر Monri' },
  'paid': { en: 'Paid', bs: 'Plaćeno', ar: 'مدفوع' },
  'card_pending': { en: 'Card · pending', bs: 'Kartica · na čekanju', ar: 'بطاقة · معلّق' },
  'privacy_security': { en: 'Privacy & security', bs: 'Privatnost i sigurnost', ar: 'الخصوصية والأمان' },
  'add_a_tip': { en: 'Add a tip?', bs: 'Dodati napojnicu?', ar: 'هل تودّ إضافة إكرامية؟' },
  'no_tip': { en: 'No tip', bs: 'Bez napojnice', ar: 'بدون إكرامية' },
  'custom': { en: 'Other amount', bs: 'Drugi iznos', ar: 'مبلغ آخر' },
  'tip': { en: 'Tip', bs: 'Napojnica', ar: 'إكرامية' },

  // Split the bill
  'split_bill': { en: 'Split the bill', bs: 'Podijeli račun', ar: 'تقسيم الفاتورة' },
  'split_evenly': { en: 'Evenly', bs: 'Podjednako', ar: 'بالتساوي' },
  'split_by_person': { en: 'By person', bs: 'Po osobi', ar: 'حسب الشخص' },
  'each_pays': { en: 'Each pays', bs: 'Svako plaća', ar: 'يدفع كل شخص' },
  'people': { en: 'people', bs: 'osoba', ar: 'أشخاص' },
  'your_share': { en: 'Your share', bs: 'Vaš dio', ar: 'حصتك' },
  'split_hint': { en: 'Show this to your waiter, or call them to settle up.', bs: 'Pokažite ovo konobaru ili ga pozovite za naplatu.', ar: 'أظهر هذا للنادل أو استدعِه لإتمام الدفع.' },
  'settle_with_waiter': { en: 'Call the waiter to settle', bs: 'Pozovi konobara za naplatu', ar: 'استدعِ النادل للدفع' },

  // Upsell
  'you_might_like': { en: 'You might also like', bs: 'Moglo bi vam se svidjeti', ar: 'قد يعجبك أيضاً' },
  'add_a_drink': { en: 'Add a drink or dessert?', bs: 'Dodati piće ili desert?', ar: 'إضافة مشروب أو حلوى؟' },
  'install_app': { en: 'Install app', bs: 'Instaliraj aplikaciju', ar: 'تثبيت التطبيق' },

  // ---- Payment: honest states. Never say "paid" before the server says so.
  'pay_at_table': { en: 'Pay at the table', bs: 'Plati za stolom', ar: 'الدفع على الطاولة' },
  'pay_cash': { en: 'Cash', bs: 'Gotovina', ar: 'نقدًا' },
  'pay_cash_sub': { en: 'Your waiter will bring the bill.', bs: 'Konobar će donijeti račun.', ar: 'سيحضر النادل الفاتورة.' },
  'pay_pos': { en: 'Card at the table', bs: 'Kartica za stolom', ar: 'بالبطاقة على الطاولة' },
  'pay_pos_sub': { en: 'Your waiter will bring the card terminal.', bs: 'Konobar će donijeti POS terminal.', ar: 'سيحضر النادل جهاز البطاقات.' },
  'pay_online_sub': { en: 'Secure card payment, before your order is sent.', bs: 'Sigurno plaćanje karticom, prije slanja narudžbe.', ar: 'دفع آمن بالبطاقة قبل إرسال طلبك.' },
  'order_number': { en: 'Order no.', bs: 'Broj narudžbe', ar: 'رقم الطلب' },
  'payment_confirming_title': { en: 'Confirming your payment', bs: 'Potvrđujemo vaše plaćanje', ar: 'جارٍ تأكيد الدفع' },
  'payment_confirming_body': { en: 'This usually takes a few seconds. Please keep this screen open.', bs: 'Ovo obično traje nekoliko sekundi. Ostanite na ovom ekranu.', ar: 'يستغرق هذا عادةً بضع ثوانٍ. يرجى إبقاء هذه الشاشة مفتوحة.' },
  'payment_delayed_title': { en: 'Still confirming', bs: 'Još potvrđujemo', ar: 'ما زلنا نؤكد' },
  'payment_delayed_body': { en: 'Your payment is still being confirmed. Please do not pay again. Show this order number to our staff if you need help.', bs: 'Vaše plaćanje se još potvrđuje. Molimo ne plaćajte ponovo. Ako trebate pomoć, pokažite ovaj broj narudžbe osoblju.', ar: 'ما زال يتم تأكيد دفعتك. يرجى عدم الدفع مرة أخرى. أظهر رقم الطلب لموظفينا إذا احتجت المساعدة.' },
  'payment_received_title': { en: 'Payment received', bs: 'Plaćanje primljeno', ar: 'تم استلام الدفعة' },
  'payment_declined_title': { en: 'Payment was not completed', bs: 'Plaćanje nije završeno', ar: 'لم يكتمل الدفع' },
  'payment_declined_body': { en: 'Your card was not charged. You can try again or pay at the table.', bs: 'Vaša kartica nije terećena. Pokušajte ponovo ili platite za stolom.', ar: 'لم يتم خصم أي مبلغ من بطاقتك. يمكنك المحاولة مرة أخرى أو الدفع على الطاولة.' },
  'try_card_again': { en: 'Try card again', bs: 'Pokušaj ponovo karticom', ar: 'حاول بالبطاقة مرة أخرى' },
  'switch_to_pay_at_table': { en: 'Pay at the table instead', bs: 'Radije plati za stolom', ar: 'الدفع على الطاولة بدلاً من ذلك' },
  'order_not_sent_yet': { en: 'Not sent to the kitchen yet', bs: 'Još nije poslano u kuhinju', ar: 'لم يُرسل إلى المطبخ بعد' },
  'order_in_kitchen_now': { en: 'Your order is with the kitchen.', bs: 'Vaša narudžba je u kuhinji.', ar: 'طلبك في المطبخ الآن.' },
  'ordering_paused_title': { en: 'Ordering is paused', bs: 'Naručivanje je pauzirano', ar: 'الطلب متوقف مؤقتاً' },
  'ordering_paused_body': { en: 'Please ask your waiter — they will take your order.', bs: 'Molimo pitajte konobara — on će primiti vašu narudžbu.', ar: 'يرجى سؤال النادل — سيأخذ طلبك.' },
  'card_unavailable_now': { en: 'Card payment in the app is not available right now.', bs: 'Plaćanje karticom u aplikaciji trenutno nije dostupno.', ar: 'الدفع بالبطاقة في التطبيق غير متاح حالياً.' },
  'kitchen_busy_notice': { en: 'The kitchen is busy — dishes may take a little longer.', bs: 'Kuhinja je zauzeta — jela mogu potrajati malo duže.', ar: 'المطبخ مزدحم — قد تستغرق الأطباق وقتاً أطول قليلاً.' },
  'terms_accept': { en: 'By ordering you accept our', bs: 'Narudžbom prihvatate naše', ar: 'بتقديم الطلب فإنك تقبل' },
  'terms_link': { en: 'terms and privacy notice', bs: 'uslove i obavijest o privatnosti', ar: 'الشروط وإشعار الخصوصية' },
  'track_order': { en: 'Track your order', bs: 'Prati narudžbu', ar: 'تتبع طلبك' },
  'connection_lost': { en: 'No connection', bs: 'Nema veze', ar: 'لا يوجد اتصال' },
  'connection_lost_body': { en: 'Your order was not sent. Nothing was charged. Please try again when you are back online.', bs: 'Vaša narudžba nije poslana i ništa nije naplaćeno. Pokušajte ponovo kada se veza vrati.', ar: 'لم يتم إرسال طلبك ولم يتم خصم أي مبلغ. يرجى المحاولة عند عودة الاتصال.' },

  // ---- Discovery
  'search': { en: 'Search', bs: 'Pretraga', ar: 'بحث' },
  'search_no_results': { en: 'Nothing matched', bs: 'Nema rezultata', ar: 'لا توجد نتائج' },
  'search_no_results_sub': { en: 'Try a shorter word, or browse the categories.', bs: 'Pokušajte kraću riječ ili pregledajte kategorije.', ar: 'جرب كلمة أقصر أو تصفح الفئات.' },
  'badge_popular': { en: 'Popular', bs: 'Popularno', ar: 'الأكثر طلباً' },
  'badge_signature': { en: 'Signature', bs: 'Specijalitet kuće', ar: 'من تخصصاتنا' },
  'badge_new': { en: 'New', bs: 'Novo', ar: 'جديد' },
  'badge_staff_favourite': { en: 'Staff favourite', bs: 'Izbor osoblja', ar: 'اختيار الطاقم' },
  'badge_fast': { en: 'Ready quickly', bs: 'Brzo gotovo', ar: 'جاهز بسرعة' },

  // ---- Recommendations (one at a time, always skippable)
  'goes_well_with': { en: 'Goes well with this', bs: 'Odlično ide uz ovo', ar: 'يتناسب معه جيدًا' },
  'complete_your_order': { en: 'Complete your order', bs: 'Upotpunite narudžbu', ar: 'أكمل طلبك' },
  'anything_else': { en: 'Anything else?', bs: 'Još nešto?', ar: 'أي شيء آخر؟' },
  // Social proof. Deliberately "ordered with", never "add" — the affinity data
  // says these appear in the same visit, not that the suggestion caused it.
  'your_usual': { en: 'Your usual', bs: 'Kao i obično', ar: 'طلبك المعتاد' },
  'usual_add': { en: 'Add it again', bs: 'Dodaj ponovo', ar: 'أضفه مرة أخرى' },
  'forget_device': { en: 'Forget what this phone has ordered', bs: 'Zaboravi šta je ovaj telefon naručio', ar: 'انسَ ما طلبه هذا الهاتف' },
  'forget_device_done': { en: 'Forgotten. This phone starts fresh.', bs: 'Zaboravljeno. Ovaj telefon počinje ispočetka.', ar: 'تم المسح. يبدأ هذا الهاتف من جديد.' },
  'often_ordered_with': { en: 'Often ordered with this', bs: 'Često se naručuje uz ovo', ar: 'كثيرًا ما يُطلب مع هذا' },
  'ordered_by_share': { en: '{pct}% of tables order this too', bs: '{pct}% stolova naručuje i ovo', ar: '{pct}% من الطاولات تطلب هذا أيضًا' },
  'no_thanks': { en: 'No thanks', bs: 'Ne, hvala', ar: 'لا، شكراً' },
  'add': { en: 'Add', bs: 'Dodaj', ar: 'أضف' },

  // ---- Cart controls (screen-reader labels)
  'remove': { en: 'Remove', bs: 'Ukloni', ar: 'إزالة' },
  'increase': { en: 'One more', bs: 'Povećaj količinu', ar: 'زيادة الكمية' },
  'decrease': { en: 'One fewer', bs: 'Smanji količinu', ar: 'إنقاص الكمية' },
  'dismiss': { en: 'Dismiss', bs: 'Zatvori', ar: 'إغلاق' },
  'feedback_failed': { en: 'We could not save your feedback. Please tell a member of staff.', bs: 'Nismo mogli sačuvati vašu ocjenu. Molimo recite osoblju.', ar: 'تعذّر حفظ ملاحظاتك. يرجى إبلاغ أحد الموظفين.' },

  // ---- Table entry (one venue QR, table typed each visit)
  'table_number_range': { en: 'Please enter a table number between 1 and {max}.', bs: 'Unesite broj stola između 1 i {max}.', ar: 'يرجى إدخال رقم طاولة بين 1 و {max}.' },
  'change_table': { en: 'Change table', bs: 'Promijeni sto', ar: 'تغيير الطاولة' },
  'not_your_table': { en: 'Not at this table?', bs: 'Niste za ovim stolom?', ar: 'لست على هذه الطاولة؟' },

  // ---- Allergens (a safety field, never abbreviated)
  'allergens': { en: 'Allergens', bs: 'Alergeni', ar: 'مسببات الحساسية' },
  'allergens_ask_staff': { en: 'Please tell your waiter about any allergy before ordering.', bs: 'Molimo obavijestite konobara o alergijama prije narudžbe.', ar: 'يرجى إبلاغ النادل بأي حساسية قبل الطلب.' },

  // ---- Templates, plurals live below in `plurals`
  'table_n': { en: 'Table {n}', bs: 'Sto {n}', ar: 'الطاولة {n}' },
  'add_item_to_order': { en: 'Add {name} to order', bs: 'Dodaj {name} u narudžbu', ar: 'أضف {name} إلى الطلب' },
  'increase_item': { en: 'One more {name}', bs: 'Povećaj količinu: {name}', ar: 'زيادة كمية {name}' },
  'decrease_item': { en: 'One fewer {name}', bs: 'Smanji količinu: {name}', ar: 'إنقاص كمية {name}' },
  'remove_item': { en: 'Remove {name}', bs: 'Ukloni {name}', ar: 'إزالة {name}' },
  'undo_removed': { en: '{name} removed · Undo', bs: 'Uklonjeno: {name} · Vrati', ar: 'تمت إزالة {name} · تراجع' },
  'prep_about': { en: '~{n} min', bs: 'oko {n} min', ar: 'حوالي {n} دقيقة' },
  'search_in_category': { en: 'Search {category}…', bs: 'Pretraži: {category}…', ar: 'ابحث في {category}…' },
  'view_mode': { en: 'Layout', bs: 'Prikaz', ar: 'طريقة العرض' },
  'quoted': { en: '“{text}”', bs: '„{text}“', ar: '«{text}»' },
  'hours_minutes': { en: '{h} h {m} min', bs: '{h} h {m} min', ar: '{h} ساعة و{m} دقيقة' },
  'eta_range': { en: 'Ready in {low}–{high} min', bs: 'Gotovo za {low}–{high} min', ar: 'جاهز خلال {low} إلى {high} دقيقة' },
  'progress_step': { en: '{status}, step {n} of {total}', bs: '{status}, korak {n} od {total}', ar: '{status}، الخطوة {n} من {total}' },
  'rate_n_stars': { en: '{n} out of 5 stars', bs: '{n} od 5 zvjezdica', ar: '{n} من 5 نجوم' },
  'more_waiting_n': { en: '+{n} more waiting', bs: 'Na čekanju još: {n}', ar: '{n} آخرون بالانتظار' },
  'percent_n': { en: '{n}%', bs: '{n} %', ar: '{n}%' },
  'available_from_x': { en: 'Available from {time}', bs: 'Dostupno od {time}', ar: 'متاح من {time}' },
  'available_until_x': { en: 'Available until {time}', bs: 'Dostupno do {time}', ar: 'متاح حتى {time}' },
  'available_between': { en: 'Available {from}–{to}', bs: 'Dostupno {from}–{to}', ar: 'متاح من {from} إلى {to}' },
  'not_found_title': { en: 'Page not found', bs: 'Stranica nije pronađena', ar: 'الصفحة غير موجودة' },
  'not_found_body': { en: 'This link doesn’t lead anywhere. The menu is one tap away.', bs: 'Ovaj link ne vodi nigdje. Meni je na jedan dodir.', ar: 'هذا الرابط لا يؤدي إلى أي صفحة. القائمة على بُعد نقرة واحدة.' },
  'card_form_unavailable': { en: 'The card form couldn’t load. Try again or pay at the table.', bs: 'Obrazac za karticu se nije učitao. Pokušajte ponovo ili platite za stolom.', ar: 'تعذّر تحميل نموذج البطاقة. حاول مجددًا أو ادفع على الطاولة.' },
  'notifications': { en: 'Notifications', bs: 'Obavijesti', ar: 'الإشعارات' },
  'max_quantity_reached': { en: 'That’s the most we can take for one item — ask your waiter for more.', bs: 'To je najviše što možemo primiti za jednu stavku — za više se obratite konobaru.', ar: 'هذا أقصى عدد للصنف الواحد — اطلب المزيد من النادل.' },
  'allergen_gluten': { en: 'Gluten', bs: 'Gluten', ar: 'الغلوتين' },
  'allergen_dairy': { en: 'Milk & dairy', bs: 'Mlijeko i mliječni proizvodi', ar: 'الحليب ومشتقاته' },
  'allergen_eggs': { en: 'Eggs', bs: 'Jaja', ar: 'البيض' },
  'allergen_fish': { en: 'Fish', bs: 'Riba', ar: 'السمك' },
  'allergen_shellfish': { en: 'Shellfish', bs: 'Rakovi i školjke', ar: 'القشريات والمحار' },
  'allergen_nuts': { en: 'Tree nuts', bs: 'Orašasti plodovi', ar: 'المكسرات' },
  'allergen_peanuts': { en: 'Peanuts', bs: 'Kikiriki', ar: 'الفول السوداني' },
  'allergen_soy': { en: 'Soy', bs: 'Soja', ar: 'الصويا' },
  'allergen_sesame': { en: 'Sesame', bs: 'Susam', ar: 'السمسم' },
  'allergen_celery': { en: 'Celery', bs: 'Celer', ar: 'الكرفس' },
  'allergen_mustard': { en: 'Mustard', bs: 'Senf (gorušica)', ar: 'الخردل' },
  'allergen_sulphites': { en: 'Sulphites', bs: 'Sulfiti', ar: 'الكبريتيت' },
};

/** Read-only view of the table, for the completeness tests. */
export const translationTable: Readonly<typeof translations> = translations;

export type Vars = Record<string, string | number>;

/** Fills `{name}` placeholders. Unknown placeholders are left visible, not blanked. */
export const interpolate = (text: string, vars?: Vars) =>
  vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;

export function translate(key: string, locale: Locale, vars?: Vars): string {
  return interpolate(translations[key]?.[locale] || translations[key]?.en || key, vars);
}

/** Non-reactive lookup, for code outside React (toasts fired from stores). */
export function t(key: string, vars?: Vars): string {
  return translate(key, useLanguageStore.getState().locale, vars);
}

// Hook version for reactive updates
export function useT() {
  const locale = useLanguageStore((s) => s.locale);
  return useCallback((key: string, vars?: Vars): string => translate(key, locale, vars), [locale]);
}

/* ---- Plurals ------------------------------------------------------------
 * "5 narudžbe" and "11 طلبات" are wrong: Bosnian has one/few/other and Arabic
 * six forms. Forms are chosen by Intl.PluralRules, and `{n}` is the count.
 */
type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const plurals: Record<string, Record<Locale, PluralForms>> = {
  orders_count: {
    en: { one: '{n} order', other: '{n} orders' },
    bs: { one: '{n} narudžba', few: '{n} narudžbe', other: '{n} narudžbi' },
    ar: { zero: 'لا طلبات', one: 'طلب واحد', two: 'طلبان', few: '{n} طلبات', many: '{n} طلبًا', other: '{n} طلب' },
  },
  items_count: {
    en: { one: '{n} item', other: '{n} items' },
    bs: { one: '{n} stavka', few: '{n} stavke', other: '{n} stavki' },
    ar: { zero: 'لا أصناف', one: 'صنف واحد', two: 'صنفان', few: '{n} أصناف', many: '{n} صنفًا', other: '{n} صنف' },
  },
  people_count: {
    en: { one: '{n} person', other: '{n} people' },
    bs: { one: '{n} osoba', few: '{n} osobe', other: '{n} osoba' },
    ar: { zero: 'لا أحد', one: 'شخص واحد', two: 'شخصان', few: '{n} أشخاص', many: '{n} شخصًا', other: '{n} شخص' },
  },
  // The noun alone, for a count shown separately above it.
  people_word: {
    en: { one: 'person', other: 'people' },
    bs: { one: 'osoba', few: 'osobe', other: 'osoba' },
    ar: { zero: 'أشخاص', one: 'شخص', two: 'شخصان', few: 'أشخاص', many: 'شخصًا', other: 'شخص' },
  },
  minutes_count: {
    en: { one: '{n} min', other: '{n} min' },
    bs: { one: '{n} min', other: '{n} min' },
    ar: { zero: '0 دقيقة', one: 'دقيقة واحدة', two: 'دقيقتان', few: '{n} دقائق', many: '{n} دقيقة', other: '{n} دقيقة' },
  },
};

export const pluralTable: Readonly<typeof plurals> = plurals;

/**
 * The CLDR plural rules for whole numbers, written out: browsers with trimmed
 * locale data (Chrome) cannot be trusted to know Bosnian.
 */
export function pluralCategory(n: number, locale: Locale): Intl.LDMLPluralRule {
  const i = Math.abs(Math.trunc(n));
  if (locale === 'bs') {
    if (i % 10 === 1 && i % 100 !== 11) return 'one';
    if (i % 10 >= 2 && i % 10 <= 4 && (i % 100 < 12 || i % 100 > 14)) return 'few';
    return 'other';
  }
  if (locale === 'ar') {
    if (i === 0) return 'zero';
    if (i === 1) return 'one';
    if (i === 2) return 'two';
    if (i % 100 >= 3 && i % 100 <= 10) return 'few';
    if (i % 100 >= 11) return 'many';
    return 'other';
  }
  return i === 1 ? 'one' : 'other';
}

export function plural(key: string, n: number, locale: Locale): string {
  const forms = plurals[key]?.[locale] ?? plurals[key]?.en;
  if (!forms) return `${n} ${key}`;
  return interpolate(forms[pluralCategory(n, locale)] ?? forms.other, { n });
}

/* ---- Numbers, money and lists ------------------------------------------
 * Done by hand rather than with Intl: Chrome ships without Bosnian number
 * and list data, so Intl silently formatted Bosnian prices the English way
 * ("18.00") on the very phones most guests use.
 */

const NBSP = String.fromCharCode(0xa0);

/**
 * A price as the guest reads it: "12.50 KM", "12,50 KM". Latin digits in
 * every language — the menu, the bill and the card terminal all print them.
 * The space is a no-break space, so the amount and KM never wrap apart.
 */
export function formatPrice(amount: number | string, locale: Locale): string {
  const fixed = (Number(amount) || 0).toFixed(2);
  return `${locale === 'bs' ? fixed.replace('.', ',') : fixed}${NBSP}KM`;
}

/** "Amina, Haris and Lejla" / "Amina, Haris i Lejla" / "Amina، Haris، Lejla". */
export function formatList(items: string[], locale: Locale): string {
  if (locale === 'ar') return items.join('، ');
  if (items.length < 2) return items.join('');
  const and = locale === 'bs' ? ' i ' : ' and ';
  return `${items.slice(0, -1).join(', ')}${and}${items[items.length - 1]}`;
}

/** Everything a guest screen needs to speak the guest's language, reactively. */
export function useI18n() {
  const locale = useLanguageStore((s) => s.locale);
  const tr = useT();
  return useMemo(() => ({
    locale,
    t: tr,
    plural: (key: string, n: number) => plural(key, n, locale),
    price: (amount: number | string) => formatPrice(amount, locale),
    list: (items: string[]) => formatList(items, locale),
  }), [locale, tr]);
}

// Get localized menu item name
export function getLocalizedName(item: { name: string; name_bs?: string | null; name_ar?: string | null }, locale: Locale): string {
  if (locale === 'bs' && item.name_bs) return item.name_bs;
  if (locale === 'ar' && item.name_ar) return item.name_ar;
  return item.name;
}

// Get localized menu item description
export function getLocalizedDescription(item: { description?: string | null; description_bs?: string | null; description_ar?: string | null }, locale: Locale): string | null {
  if (locale === 'bs' && item.description_bs) return item.description_bs;
  if (locale === 'ar' && item.description_ar) return item.description_ar;
  return item.description || null;
}

export const localeLabels: Record<Locale, string> = {
  en: 'English',
  bs: 'Bosanski',
  ar: 'العربية',
};

export const localeFlags: Record<Locale, string> = {
  en: '🇬🇧',
  bs: '🇧🇦',
  ar: '🇸🇦',
};
