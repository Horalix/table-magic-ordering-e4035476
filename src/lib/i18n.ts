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
  'drinks_desc': { en: 'Cocktails, wine, coffee & more', bs: 'Kokteli, vino, kafa i više', ar: 'كوكتيلات، نبيذ، قهوة والمزيد' },
  'food_desc': { en: 'Starters, mains, burgers & pizza', bs: 'Predjela, glavna jela, burgeri i pizza', ar: 'مقبلات، أطباق رئيسية، برغر وبيتزا' },
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
  'phone': { en: '+387 33 844 334', bs: '+387 33 844 334', ar: '+387 33 844 334' },
  'address': { en: 'Maršala Tita 7, Sarajevo', bs: 'Maršala Tita 7, Sarajevo', ar: 'مارشالا تيتا 7، سراييفو' },

  // No items
  'no_items_category': { en: 'No items available in this category yet.', bs: 'Još nema stavki u ovoj kategoriji.', ar: 'لا توجد عناصر متاحة في هذه الفئة بعد.' },

  // Just now / time
  'just_now': { en: 'Just now', bs: 'Upravo', ar: 'الآن' },
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
