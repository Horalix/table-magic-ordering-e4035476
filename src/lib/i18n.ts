import { create } from 'zustand';

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

// Initialize dir on load
const savedLocale = (localStorage.getItem('lasoul-lang') as Locale) || 'en';
if (savedLocale === 'ar') {
  document.documentElement.dir = 'rtl';
  document.documentElement.lang = 'ar';
}

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
};

export function t(key: string): string {
  const locale = useLanguageStore.getState().locale;
  return translations[key]?.[locale] || translations[key]?.en || key;
}

// Hook version for reactive updates
export function useT() {
  const locale = useLanguageStore((s) => s.locale);
  return (key: string): string => {
    return translations[key]?.[locale] || translations[key]?.en || key;
  };
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
