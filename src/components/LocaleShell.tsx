import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { DirectionProvider } from '@radix-ui/react-direction';
import { applyDocumentLocale, isStaffPath, useLanguageStore } from '@/lib/i18n';

/**
 * Keeps the page's language and direction right on every navigation.
 *
 * Guest screens follow the guest's language (Arabic is right-to-left); staff
 * screens are English-only and always left-to-right, even on a phone that
 * last showed the guest menu in Arabic. Radix menus and dialogs read the
 * direction from here for keyboard order and alignment.
 */
const LocaleShell = ({ children }: { children: ReactNode }) => {
  const { pathname } = useLocation();
  const locale = useLanguageStore((s) => s.locale);
  const rtl = locale === 'ar' && !isStaffPath(pathname);

  useEffect(() => { applyDocumentLocale(locale, pathname); }, [locale, pathname]);

  return <DirectionProvider dir={rtl ? 'rtl' : 'ltr'}>{children}</DirectionProvider>;
};

export default LocaleShell;
