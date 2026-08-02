import { create } from 'zustand';
import { useCallback } from 'react';

export type Locale = 'en' | 'bs' | 'ar';

interface LanguageStore {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLanguageStore = create<LanguageStore>((set) => ({
  locale: (localStorage.getItem('lasoul-lang') as Locale) || 'en',
  setLocale: (locale) => {
    localStorage.setItem('lasoul-lang', locale);
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

// Initialise direction AND language on load.
//
// `lang` matters for every locale, not just Arabic: screen readers pick the
// pronunciation from it, and Bosnian read aloud in an English voice is close
// to unintelligible. Previously it was only set for 'ar', so a Bosnian guest
// got `lang="en"` on a fully Bosnian page.
const savedLocale = (localStorage.getItem('lasoul-lang') as Locale) || 'en';
document.documentElement.lang = savedLocale;
document.documentElement.dir = savedLocale === 'ar' ? 'rtl' : 'ltr';

const translations: Record<string, Record<Locale, string>> = {
  // Navigation & General
  'menu': { en: 'Menu', bs: 'Meni', ar: 'القائمة' },
  'your_order': { en: 'Your Order', bs: 'Vaša narudžba', ar: 'طلبك' },
  'your_tab': { en: 'Your Tab', bs: 'Vaš račun', ar: 'فاتورتك' },
  'table': { en: 'Table', bs: 'Stol', ar: 'طاولة' },
  'back_to_menu': { en: 'Back to Menu', bs: 'Nazad na meni', ar: 'العودة إلى القائمة' },
  'browse_menu': { en: 'Browse Menu Without Ordering', bs: 'Pregledaj meni bez narudžbe', ar: 'تصفح القائمة بدون طلب' },

  // Categories
  'drinks': { en: 'Drinks', bs: 'Pića', ar: 'المشروبات' },
  'food': { en: 'Food', bs: 'Hrana', ar: 'الطعام' },
  'desserts': { en: 'Desserts', bs: 'Deserti', ar: 'الحلويات' },
  'drinks_desc': { en: 'Cocktails, coffee, juices & more', bs: 'Kokteli, kafa, sokovi i više', ar: 'كوكتيلات، قهوة، عصائر والمزيد' },
  'food_desc': { en: 'Starters, mains, burgers & more', bs: 'Predjela, glavna jela, burgeri i više', ar: 'مقبلات، أطباق رئيسية، برغر والمزيد' },
  'desserts_desc': { en: 'Sweet endings', bs: 'Slatki završeci', ar: 'نهايات حلوة' },

  // Cart
  'place_order': { en: 'Place Order', bs: 'Naruči', ar: 'تقديم الطلب' },
  'placing_order': { en: 'Placing Order...', bs: 'Naručujem...', ar: 'جارٍ تقديم الطلب...' },
  'order_empty': { en: 'Your order is empty', bs: 'Vaša narudžba je prazna', ar: 'طلبك فارغ' },
  'browse_menu_to_add': { en: 'Browse the menu to add items', bs: 'Pregledaj meni da dodaš stavke', ar: 'تصفح القائمة لإضافة عناصر' },
  'total': { en: 'Total', bs: 'Ukupno', ar: 'المجموع' },
  'view_order': { en: 'View Order', bs: 'Pogledaj narudžbu', ar: 'عرض الطلب' },
  'view_your_tab': { en: 'View Your Tab', bs: 'Pogledaj račun', ar: 'عرض فاتورتك' },
  'add_to_order': { en: 'Add to order', bs: 'Dodaj u narudžbu', ar: 'أضف إلى الطلب' },
  'special_requests': { en: 'Special requests', bs: 'Posebni zahtjevi', ar: 'طلبات خاصة' },
  'special_requests_placeholder': { en: 'E.g. no onions, extra sauce...', bs: 'Npr. bez luka, ekstra sos...', ar: 'مثال: بدون بصل، صوص إضافي...' },

  // No-refund confirmation
  'confirm_order': { en: 'Confirm Your Order', bs: 'Potvrdite narudžbu', ar: 'تأكيد طلبك' },
  'no_refund_message': { en: 'Once placed, this order cannot be cancelled or refunded. Please review your items carefully.', bs: 'Nakon narudžbe, nije moguće otkazati ili vratiti novac. Molimo pažljivo pregledajte stavke.', ar: 'بمجرد تقديم الطلب، لا يمكن إلغاؤه أو استرداد المبلغ. يرجى مراجعة العناصر بعناية.' },
  'go_back': { en: 'Go Back', bs: 'Nazad', ar: 'رجوع' },
  'confirm_and_order': { en: 'Confirm Order', bs: 'Potvrdi narudžbu', ar: 'تأكيد الطلب' },

  // Order Success
  'order_confirmed': { en: 'Order Confirmed!', bs: 'Narudžba potvrđena!', ar: 'تم تأكيد الطلب!' },
  'order_sent_kitchen': { en: 'Your order has been sent to the kitchen.', bs: 'Vaša narudžba je poslana u kuhinju.', ar: 'تم إرسال طلبك إلى المطبخ.' },
  'order_more': { en: 'Order More', bs: 'Naruči više', ar: 'اطلب المزيد' },

  // Browse / status / dietary (added features)
  'order_again': { en: 'Order again', bs: 'Naruči ponovo', ar: 'اطلب مرة أخرى' },
  'swipe_hint': { en: 'Swipe to switch categories', bs: 'Prevucite za promjenu', ar: 'اسحب لتغيير الفئة' },
  'got_it': { en: 'Got it', bs: 'U redu', ar: 'حسناً' },
  'order_progress': { en: 'Order progress', bs: 'Status narudžbe', ar: 'حالة الطلب' },
  'status_received': { en: 'Received', bs: 'Primljeno', ar: 'تم الاستلام' },
  'list_view': { en: 'List view', bs: 'Prikaz liste', ar: 'عرض القائمة' },
  'grid_view': { en: 'Grid view', bs: 'Prikaz mreže', ar: 'عرض الشبكة' },
  'filters': { en: 'Filters', bs: 'Filteri', ar: 'الفلاتر' },
  'clear_filters': { en: 'Clear', bs: 'Očisti', ar: 'مسح' },
  'diet_vegetarian': { en: 'Vegetarian', bs: 'Vegetarijansko', ar: 'نباتي' },
  'diet_vegan': { en: 'Vegan', bs: 'Vegansko', ar: 'نباتي صرف' },
  'diet_spicy': { en: 'Spicy', bs: 'Ljuto', ar: 'حار' },
  'diet_gluten_free': { en: 'Gluten-free', bs: 'Bez glutena', ar: 'خالٍ من الغلوتين' },
  'diet_dairy_free': { en: 'Dairy-free', bs: 'Bez laktoze', ar: 'خالٍ من الألبان' },
  'diet_contains_nuts': { en: 'Contains nuts', bs: 'Sadrži orašaste', ar: 'يحتوي على مكسرات' },
  'diet_halal': { en: 'Halal', bs: 'Halal', ar: 'حلال' },
  'sold_out': { en: 'Sold out', bs: 'Rasprodano', ar: 'نفد' },

  // Single-QR table entry
  'which_table': { en: 'Which table are you at?', bs: 'Za kojim ste stolom?', ar: 'على أي طاولة أنت؟' },
  'which_table_sub': { en: 'Enter your table number to start ordering.', bs: 'Unesite broj stola da započnete narudžbu.', ar: 'أدخل رقم طاولتك لبدء الطلب.' },
  'table_number_placeholder': { en: 'Table number', bs: 'Broj stola', ar: 'رقم الطاولة' },

  // Running Tab
  'running_total': { en: 'Running Total', bs: 'Ukupni račun', ar: 'المجموع الجاري' },
  'no_active_session': { en: 'No active session', bs: 'Nema aktivne sesije', ar: 'لا توجد جلسة نشطة' },
  'scan_qr_tab': { en: 'Scan the QR code at your table to see your tab.', bs: 'Skeniraj QR kod na stolu da vidiš račun.', ar: 'امسح رمز QR على طاولتك لمشاهدة فاتورتك.' },
  'no_orders_yet': { en: 'No orders yet', bs: 'Još nema narudžbi', ar: 'لا توجد طلبات بعد' },
  'browse_menu_start': { en: 'Browse the menu to get started.', bs: 'Pregledaj meni da počneš.', ar: 'تصفح القائمة للبدء.' },
  'request_bill': { en: 'Request Bill', bs: 'Zatraži račun', ar: 'اطلب الفاتورة' },
  'requesting': { en: 'Requesting...', bs: 'Zahtijevam...', ar: 'جارٍ الطلب...' },
  'bill_requested': { en: 'Bill requested', bs: 'Račun zatražen', ar: 'تم طلب الفاتورة' },
  'server_notified': { en: 'Your server has been notified.', bs: 'Vaš konobar je obaviješten.', ar: 'تم إخطار النادل.' },

  // Call Waiter
  'call_waiter': { en: 'Call Waiter', bs: 'Pozovi konobara', ar: 'استدعاء النادل' },
  'calling': { en: 'Calling...', bs: 'Pozivam...', ar: 'جارٍ الاستدعاء...' },
  'waiter_notified': { en: 'Waiter notified', bs: 'Konobar obaviješten', ar: 'تم إخطار النادل' },

  // QR Scan prompts
  'scan_qr_order': { en: 'Scan the QR code at your table to place an order', bs: 'Skeniraj QR kod na stolu da naručiš', ar: 'امسح رمز QR على طاولتك لتقديم طلب' },
  'scan_qr_to_order': { en: 'Scan the QR code at your table to order', bs: 'Skeniraj QR kod na stolu da naručiš', ar: 'امسح رمز QR على طاولتك للطلب' },
  'scan_qr_again': { en: 'Please scan the QR code at your table to place an order', bs: 'Skeniraj QR kod na stolu da naručiš', ar: 'يرجى مسح رمز QR على طاولتك لتقديم طلب' },

  // Statuses
  'status_pending': { en: 'Pending', bs: 'Na čekanju', ar: 'قيد الانتظار' },
  'status_confirmed': { en: 'Confirmed', bs: 'Potvrđeno', ar: 'مؤكد' },
  'status_preparing': { en: 'Preparing', bs: 'Priprema', ar: 'قيد التحضير' },
  'status_ready': { en: 'Ready', bs: 'Spremno', ar: 'جاهز' },
  'status_served': { en: 'Served', bs: 'Servirano', ar: 'تم التقديم' },
  'status_cancelled': { en: 'Cancelled', bs: 'Otkazano', ar: 'ملغى' },

  // Table Entry
  'setting_up_table': { en: 'Setting up your table...', bs: 'Postavljam vaš stol...', ar: 'جارٍ إعداد طاولتك...' },
  'invalid_qr': { en: 'Invalid QR code. Please ask your waiter for assistance.', bs: 'Nevažeći QR kod. Molimo pitajte konobara za pomoć.', ar: 'رمز QR غير صالح. يرجى طلب المساعدة من النادل.' },
  'qr_expired': { en: 'This QR code is invalid or expired. Please ask your waiter to help you scan.', bs: 'Ovaj QR kod je nevažeći ili istekao. Molimo pitajte konobara za pomoć.', ar: 'رمز QR هذا غير صالح أو منتهي الصلاحية. اطلب من النادل المساعدة.' },
  'session_failed': { en: 'Could not start your session. Please try again.', bs: 'Sesija nije mogla biti pokrenuta. Pokušajte ponovo.', ar: 'تعذر بدء الجلسة. يرجى المحاولة مرة أخرى.' },
  'something_wrong': { en: 'Something went wrong. Please try scanning again.', bs: 'Nešto je pošlo naopako. Pokušajte ponovo skenirati.', ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.' },

  // Guest name
  'welcome': { en: 'Welcome!', bs: 'Dobrodošli!', ar: 'مرحباً!' },
  'enter_your_name': { en: 'Enter your name', bs: 'Unesite vaše ime', ar: 'أدخل اسمك' },
  'name_placeholder': { en: 'Your name', bs: 'Vaše ime', ar: 'اسمك' },
  'continue': { en: 'Continue', bs: 'Nastavi', ar: 'متابعة' },
  'name_required': { en: 'Please enter your name', bs: 'Molimo unesite ime', ar: 'يرجى إدخال اسمك' },

  // Session expired
  'session_expired': { en: 'Your session has expired. Please scan the QR code again.', bs: 'Vaša sesija je istekla. Skenirajte QR kod ponovo.', ar: 'انتهت جلستك. يرجى مسح رمز QR مرة أخرى.' },

  // Contact
  'phone': { en: '033 877-779', bs: '033 877-779', ar: '033 877-779' },
  'address': { en: 'Butmirska cesta, Sarajevo 71000', bs: 'Butmirska cesta, Sarajevo 71000', ar: 'بوتميرسكا جيستا، سراييفو 71000' },

  // No items
  'no_items_category': { en: 'No items available in this category yet.', bs: 'Još nema stavki u ovoj kategoriji.', ar: 'لا توجد عناصر متاحة في هذه الفئة بعد.' },
  'search_placeholder': { en: 'Search dishes, drinks, desserts…', bs: 'Pretraži jela, pića, deserte…', ar: 'ابحث عن الأطباق والمشروبات والحلويات…' },
  'no_results_title': { en: 'No dishes found', bs: 'Nema rezultata', ar: 'لم يتم العثور على أطباق' },
  'no_results_hint': { en: 'Try another search or browse categories.', bs: 'Pokušaj drugu pretragu ili pregledaj kategorije.', ar: 'جرب بحثًا آخر أو تصفح الفئات.' },
  'added_to_order': { en: 'Added to order', bs: 'Dodano u narudžbu', ar: 'تمت الإضافة إلى الطلب' },
  'items_count_one': { en: 'item', bs: 'stavka', ar: 'عنصر' },
  'items_count_other': { en: 'items', bs: 'stavki', ar: 'عناصر' },
  'clear_search': { en: 'Clear search', bs: 'Očisti pretragu', ar: 'مسح البحث' },

  // Just now / time
  'just_now': { en: 'Just now', bs: 'Upravo', ar: 'الآن' },

  // Review / Rating
  'how_was_experience': { en: 'How was your experience?', bs: 'Kako je bilo vaše iskustvo?', ar: 'كيف كانت تجربتك؟' },
  'rate_your_visit': { en: 'Tap a star to rate your visit', bs: 'Dodirnite zvjezdicu da ocijenite posjetu', ar: 'انقر على نجمة لتقييم زيارتك' },
  'thank_you_feedback': { en: 'Thank you for your feedback!', bs: 'Hvala na povratnoj informaciji!', ar: 'شكراً لملاحظاتك!' },
  'help_discover_lasoul': { en: 'Help others discover La Soul', bs: 'Pomozite drugima da otkriju La Soul', ar: 'ساعد الآخرين في اكتشاف La Soul' },
  'leave_google_review': { en: 'Leave a Google Review', bs: 'Ostavite Google recenziju', ar: 'اترك تقييماً على Google' },
  'close': { en: 'Close', bs: 'Zatvori', ar: 'إغلاق' },

  // Anti-spam
  'order_cooldown': { en: 'Please wait before placing another order.', bs: 'Molimo pričekajte prije sljedeće narudžbe.', ar: 'يرجى الانتظار قبل تقديم طلب آخر.' },
  'too_many_items': { en: 'Maximum 20 items per order.', bs: 'Maksimalno 20 stavki po narudžbi.', ar: 'الحد الأقصى 20 عنصرًا لكل طلب.' },
  'max_quantity': { en: 'Maximum quantity is 10 per item.', bs: 'Maksimalna količina je 10 po stavci.', ar: 'الحد الأقصى للكمية هو 10 لكل عنصر.' },
  'large_order_suggestion': { en: 'For large orders, feel free to call a server for assistance.', bs: 'Za veće narudžbe, slobodno pozovite konobara za pomoć.', ar: 'للطلبات الكبيرة، لا تتردد في استدعاء النادل للمساعدة.' },

  // Server rating
  'rate_your_server': { en: 'How was your server?', bs: 'Kako je bio vaš konobar?', ar: 'كيف كان النادل الخاص بك؟' },
  'served_by': { en: 'Served by', bs: 'Posluženo od', ar: 'قُدم بواسطة' },
  'optional_comment': { en: 'Add a comment (optional)', bs: 'Dodaj komentar (opcionalno)', ar: 'أضف تعليقًا (اختياري)' },
  'submit': { en: 'Submit', bs: 'Pošalji', ar: 'إرسال' },
  'skip': { en: 'Skip', bs: 'Preskoči', ar: 'تخطي' },
  'next': { en: 'Next', bs: 'Dalje', ar: 'التالي' },

  // Sections / waiter / admin
  'section': { en: 'Section', bs: 'Sekcija', ar: 'القسم' },
  'sections': { en: 'Sections', bs: 'Sekcije', ar: 'الأقسام' },
  'waiter': { en: 'Waiter', bs: 'Konobar', ar: 'النادل' },
  'waiters': { en: 'Waiters', bs: 'Konobari', ar: 'النوادل' },
  'unassigned': { en: 'Unassigned', bs: 'Nedodijeljeno', ar: 'غير معيّن' },
  'occupied_for': { en: 'Occupied for', bs: 'Zauzet', ar: 'مشغولة منذ' },
  'waiting': { en: 'Waiting', bs: 'Čeka', ar: 'في الانتظار' },
  'performance': { en: 'Performance', bs: 'Performanse', ar: 'الأداء' },

  // Shared table — join + approval
  'waiting_to_join': { en: 'Waiting for the table to let you in…', bs: 'Čekanje da vas sto prihvati…', ar: 'بانتظار أن تسمح لك الطاولة بالدخول…' },
  'waiting_to_join_sub': { en: 'Someone at the table just needs to accept you. This happens automatically in a moment.', bs: 'Neko za stolom vas treba prihvatiti. Ovo se dešava automatski za trenutak.', ar: 'يحتاج شخص ما على الطاولة إلى قبولك. سيحدث هذا تلقائيًا بعد لحظة.' },
  'wants_to_join': { en: 'wants to join your table', bs: 'želi se pridružiti vašem stolu', ar: 'يريد الانضمام إلى طاولتك' },
  'someone_wants_to_join': { en: 'Someone wants to join your table', bs: 'Neko se želi pridružiti vašem stolu', ar: 'شخص ما يريد الانضمام إلى طاولتك' },
  'accept': { en: 'Accept', bs: 'Prihvati', ar: 'قبول' },
  'decline': { en: 'Decline', bs: 'Odbij', ar: 'رفض' },
  'join_approved': { en: "You're in — welcome to the table!", bs: 'Ušli ste — dobrodošli za sto!', ar: 'تم قبولك — أهلاً بك على الطاولة!' },
  'join_declined': { en: "The table didn't accept your request.", bs: 'Sto nije prihvatio vaš zahtjev.', ar: 'لم تقبل الطاولة طلبك.' },
  'joining_table': { en: 'Joining the table…', bs: 'Pridruživanje stolu…', ar: 'جارٍ الانضمام إلى الطاولة…' },
  'at_this_table': { en: 'At this table', bs: 'Za ovim stolom', ar: 'على هذه الطاولة' },
  'table_not_active': { en: 'This table is no longer active. Please scan the QR code again.', bs: 'Ovaj sto više nije aktivan. Skenirajte QR kod ponovo.', ar: 'هذه الطاولة لم تعد نشطة. يرجى مسح رمز QR مرة أخرى.' },
  'new_guest': { en: 'New guest', bs: 'Novi gost', ar: 'ضيف جديد' },
  'try_again': { en: 'Try again', bs: 'Pokušaj ponovo', ar: 'حاول مرة أخرى' },

  // Checkout & payment
  'checkout': { en: 'Checkout', bs: 'Plaćanje', ar: 'الدفع' },
  'choose_how_to_pay': { en: 'How would you like to pay?', bs: 'Kako želite platiti?', ar: 'كيف تريد الدفع؟' },
  'pay_now_card': { en: 'Pay now by card', bs: 'Plati odmah karticom', ar: 'ادفع الآن بالبطاقة' },
  'pay_now_card_sub': { en: 'Instant — no waiting', bs: 'Trenutno — bez čekanja', ar: 'فوري — بدون انتظار' },
  'call_waiter_to_pay': { en: 'Call a waiter', bs: 'Pozovi konobara', ar: 'استدعِ النادل' },
  'call_waiter_to_pay_sub': { en: 'Pay at the table — cash or card', bs: 'Plati za stolom — gotovina ili kartica', ar: 'ادفع على الطاولة — نقداً أو بالبطاقة' },
  'no_refund_short': { en: 'Orders can’t be cancelled or refunded once placed.', bs: 'Narudžbe se ne mogu otkazati ni vratiti nakon slanja.', ar: 'لا يمكن إلغاء الطلبات أو استردادها بعد تقديمها.' },
  'card_coming_soon_title': { en: 'Card payment is coming soon', bs: 'Plaćanje karticom uskoro', ar: 'الدفع بالبطاقة قريباً' },
  'card_coming_soon_body': { en: 'Online card payment isn’t available just yet. A waiter can bring the card terminal or take cash.', bs: 'Online plaćanje karticom još nije dostupno. Konobar može donijeti terminal ili uzeti gotovinu.', ar: 'الدفع الإلكتروني بالبطاقة غير متاح بعد. يمكن للنادل إحضار جهاز البطاقة أو أخذ النقود.' },
  'order_in_kitchen': { en: 'Your order has been sent to the kitchen', bs: 'Vaša narudžba je poslana u kuhinju', ar: 'تم إرسال طلبك إلى المطبخ' },
  'waiter_on_the_way': { en: 'A waiter is on the way', bs: 'Konobar je na putu', ar: 'النادل في الطريق' },
  'sending': { en: 'Sending…', bs: 'Šaljem…', ar: 'جارٍ الإرسال…' },
  'popular': { en: 'Popular', bs: 'Popularno', ar: 'شائع' },
  'popular_picks': { en: 'Popular picks', bs: 'Popularni izbori', ar: 'الأكثر طلباً' },

  // Card payment (Monri)
  'pay_by_card': { en: 'Pay by card', bs: 'Plati karticom', ar: 'الدفع بالبطاقة' },
  'paying': { en: 'Processing…', bs: 'Obrada…', ar: 'جارٍ المعالجة…' },
  'payment_received': { en: 'Payment received — thank you!', bs: 'Plaćanje primljeno — hvala!', ar: 'تم استلام الدفعة — شكراً!' },
  'payment_failed': { en: 'Payment could not be processed. Please try again.', bs: 'Plaćanje nije uspjelo. Pokušajte ponovo.', ar: 'تعذّر إتمام الدفع. يرجى المحاولة مرة أخرى.' },
  'payment_declined': { en: 'Card declined. Try another card or call a waiter.', bs: 'Kartica odbijena. Probajte drugu karticu ili pozovite konobara.', ar: 'تم رفض البطاقة. جرّب بطاقة أخرى أو استدعِ النادل.' },
  'secure_payment_monri': { en: 'Secure payment processed by Monri', bs: 'Sigurno plaćanje putem Monri', ar: 'دفع آمن عبر Monri' },
  'paid': { en: 'Paid', bs: 'Plaćeno', ar: 'مدفوع' },
  'card_pending': { en: 'Card · pending', bs: 'Kartica · na čekanju', ar: 'بطاقة · معلّق' },
  'privacy_security': { en: 'Privacy & security', bs: 'Privatnost i sigurnost', ar: 'الخصوصية والأمان' },
  'add_a_tip': { en: 'Add a tip?', bs: 'Dodati napojnicu?', ar: 'إضافة بقشيش؟' },
  'no_tip': { en: 'No tip', bs: 'Bez napojnice', ar: 'بدون بقشيش' },
  'custom': { en: 'Custom', bs: 'Drugo', ar: 'مخصص' },
  'tip': { en: 'Tip', bs: 'Napojnica', ar: 'بقشيش' },

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
  'pay_cash': { en: 'Cash', bs: 'Gotovina', ar: 'نقداً' },
  'pay_cash_sub': { en: 'Your waiter will bring the bill.', bs: 'Konobar će donijeti račun.', ar: 'سيحضر النادل الفاتورة.' },
  'pay_pos': { en: 'Card at the table', bs: 'Kartica za stolom', ar: 'بطاقة على الطاولة' },
  'pay_pos_sub': { en: 'Your waiter will bring the card terminal.', bs: 'Konobar će donijeti POS terminal.', ar: 'سيحضر النادل جهاز البطاقات.' },
  'pay_online_sub': { en: 'Secure card payment, before your order is sent.', bs: 'Sigurno plaćanje karticom, prije slanja narudžbe.', ar: 'دفع آمن بالبطاقة قبل إرسال طلبك.' },
  'order_number': { en: 'Order', bs: 'Narudžba', ar: 'الطلب' },
  'payment_confirming_title': { en: 'Confirming your payment', bs: 'Potvrđujemo vaše plaćanje', ar: 'جارٍ تأكيد الدفع' },
  'payment_confirming_body': { en: 'This usually takes a few seconds. Please keep this screen open.', bs: 'Ovo obično traje nekoliko sekundi. Ostanite na ovom ekranu.', ar: 'يستغرق هذا عادةً بضع ثوانٍ. يرجى إبقاء هذه الشاشة مفتوحة.' },
  'payment_delayed_title': { en: 'Still confirming', bs: 'Još potvrđujemo', ar: 'ما زلنا نؤكد' },
  'payment_delayed_body': { en: 'Your payment is still being confirmed. Please do not pay again. Show this order number to our staff if you need help.', bs: 'Vaše plaćanje se još potvrđuje. Molimo ne plaćajte ponovo. Pokažite ovaj broj narudžbe osoblju ako trebate pomoć.', ar: 'ما زال يتم تأكيد دفعتك. يرجى عدم الدفع مرة أخرى. أظهر رقم الطلب لموظفينا إذا احتجت المساعدة.' },
  'payment_received_title': { en: 'Payment received', bs: 'Plaćanje primljeno', ar: 'تم استلام الدفعة' },
  'payment_declined_title': { en: 'Payment was not completed', bs: 'Plaćanje nije završeno', ar: 'لم يكتمل الدفع' },
  'payment_declined_body': { en: 'Your card was not charged. You can try again or pay at the table.', bs: 'Vaša kartica nije terećena. Pokušajte ponovo ili platite za stolom.', ar: 'لم يتم خصم أي مبلغ من بطاقتك. يمكنك المحاولة مرة أخرى أو الدفع على الطاولة.' },
  'try_card_again': { en: 'Try card again', bs: 'Pokušaj karticom ponovo', ar: 'حاول بالبطاقة مرة أخرى' },
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
  'connection_lost_body': { en: 'Your order was not sent. Nothing was charged. Please try again when you are back online.', bs: 'Vaša narudžba nije poslana. Ništa nije naplaćeno. Pokušajte ponovo kada se vratite online.', ar: 'لم يتم إرسال طلبك ولم يتم خصم أي مبلغ. يرجى المحاولة عند عودة الاتصال.' },

  // ---- Discovery
  'search': { en: 'Search', bs: 'Pretraga', ar: 'بحث' },
  'search_no_results': { en: 'Nothing matched', bs: 'Nema rezultata', ar: 'لا توجد نتائج' },
  'search_no_results_sub': { en: 'Try a shorter word, or browse the categories.', bs: 'Pokušajte kraću riječ ili pregledajte kategorije.', ar: 'جرب كلمة أقصر أو تصفح الفئات.' },
  'badge_popular': { en: 'Popular', bs: 'Popularno', ar: 'الأكثر طلباً' },
  'badge_signature': { en: 'Signature', bs: 'Naše posebno', ar: 'طبقنا المميز' },
  'badge_new': { en: 'New', bs: 'Novo', ar: 'جديد' },
  'badge_staff_favourite': { en: 'Staff favourite', bs: 'Izbor osoblja', ar: 'اختيار الطاقم' },
  'badge_fast': { en: 'Ready quickly', bs: 'Brzo gotovo', ar: 'جاهز بسرعة' },

  // ---- Recommendations (one at a time, always skippable)
  'goes_well_with': { en: 'Goes well with', bs: 'Odlično uz', ar: 'يتناسب مع' },
  'complete_your_order': { en: 'Complete your order', bs: 'Upotpunite narudžbu', ar: 'أكمل طلبك' },
  'anything_else': { en: 'Anything else?', bs: 'Još nešto?', ar: 'أي شيء آخر؟' },
  // Social proof. Deliberately "ordered with", never "add" — the affinity data
  // says these appear in the same visit, not that the suggestion caused it.
  'your_usual': { en: 'Your usual', bs: 'Vaše uobičajeno', ar: 'طلبك المعتاد' },
  'usual_add': { en: 'Add it again', bs: 'Dodaj ponovo', ar: 'أضفه مرة أخرى' },
  'forget_device': { en: 'Forget what this phone has ordered', bs: 'Zaboravi šta je ovaj telefon naručio', ar: 'انسَ ما طلبه هذا الهاتف' },
  'forget_device_done': { en: 'Forgotten. This phone starts fresh.', bs: 'Zaboravljeno. Ovaj telefon počinje ispočetka.', ar: 'تم النسيان. يبدأ هذا الهاتف من جديد.' },
  'often_ordered_with': { en: 'Often ordered with this', bs: 'Često se naruči uz ovo', ar: 'كثيرًا ما يُطلب مع هذا' },
  'ordered_by_share': { en: '{pct}% of tables order this too', bs: '{pct}% stolova naruči i ovo', ar: '{pct}٪ من الطاولات تطلب هذا أيضًا' },
  'no_thanks': { en: 'No thanks', bs: 'Ne, hvala', ar: 'لا، شكراً' },
  'add': { en: 'Add', bs: 'Dodaj', ar: 'أضف' },

  // ---- Cart controls (screen-reader labels)
  'remove': { en: 'Remove', bs: 'Ukloni', ar: 'إزالة' },
  'increase': { en: 'One more', bs: 'Još jedan', ar: 'واحد إضافي' },
  'decrease': { en: 'One fewer', bs: 'Jedan manje', ar: 'واحد أقل' },
  'undo_remove': { en: 'Undo', bs: 'Vrati', ar: 'تراجع' },
  'dismiss': { en: 'Dismiss', bs: 'Zatvori', ar: 'إغلاق' },
  'feedback_failed': { en: 'We could not save your feedback. Please tell a member of staff.', bs: 'Nismo mogli sačuvati vašu ocjenu. Molimo recite osoblju.', ar: 'تعذّر حفظ ملاحظاتك. يرجى إبلاغ أحد الموظفين.' },

  // ---- Table entry (one venue QR, table typed each visit)
  'table_number_range': { en: 'Please enter a table number between 1 and {max}.', bs: 'Unesite broj stola između 1 i {max}.', ar: 'يرجى إدخال رقم طاولة بين 1 و {max}.' },
  'change_table': { en: 'Change table', bs: 'Promijeni stol', ar: 'تغيير الطاولة' },
  'not_your_table': { en: 'Not at this table?', bs: 'Niste za ovim stolom?', ar: 'لست على هذه الطاولة؟' },

  // ---- Allergens (a safety field, never abbreviated)
  'allergens': { en: 'Allergens', bs: 'Alergeni', ar: 'مسببات الحساسية' },
  'allergens_ask_staff': { en: 'Please tell your waiter about any allergy before ordering.', bs: 'Molimo obavijestite konobara o alergijama prije narudžbe.', ar: 'يرجى إبلاغ النادل بأي حساسية قبل الطلب.' },
};

export function t(key: string): string {
  const locale = useLanguageStore.getState().locale;
  return translations[key]?.[locale] || translations[key]?.en || key;
}

// Hook version for reactive updates
export function useT() {
  const locale = useLanguageStore((s) => s.locale);
  return useCallback((key: string): string => {
    return translations[key]?.[locale] || translations[key]?.en || key;
  }, [locale]);
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
