import React from 'react';
import { Check, Globe } from 'lucide-react';
import { useLanguageStore, useT, Locale, localeLabels, localeFlags } from '@/lib/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  /**
   * `hero` sits on the sage band of the menu; `site` on the public website's
   * cream header, where a language code reads better than a flag (Arabic is
   * not one country, and Windows shows flags as two letters anyway).
   */
  variant?: 'default' | 'hero' | 'site';
}

const SHORT: Record<Locale, string> = { en: 'EN', bs: 'BS', ar: 'عربي' };

const LanguageSelector = ({ variant = 'default' }: Props) => {
  const t = useT();
  const { locale, setLocale } = useLanguageStore();
  const isHero = variant === 'hero';
  const isSite = variant === 'site';

  const locales: Locale[] = ['en', 'bs', 'ar'];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`${t('change_language')}: ${localeLabels[locale]}`}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full font-sans text-sm font-medium transition-all duration-300 min-h-[44px] ${
            isSite
              ? 'bg-transparent text-ls-forest border border-ls-forest/15 hover:bg-ls-forest/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ls-sage-deep focus-visible:ring-offset-2 focus-visible:ring-offset-ls-cream'
              : isHero
                ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
                : 'bg-muted text-foreground border border-border hover:bg-muted/80'
          }`}
        >
          <Globe className="w-4 h-4" aria-hidden />
          {isSite
            ? <span className="text-xs font-semibold tracking-wide rtl:tracking-normal">{SHORT[locale]}</span>
            : <span className="text-xs">{localeFlags[locale]}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            lang={l}
            onClick={() => setLocale(l)}
            className={`font-sans text-sm cursor-pointer ${locale === l ? 'bg-primary/10 text-primary' : ''}`}
          >
            {isSite
              ? <Check className={`me-2 h-4 w-4 ${locale === l ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
              : <span className="me-2">{localeFlags[l]}</span>}
            {localeLabels[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSelector;
