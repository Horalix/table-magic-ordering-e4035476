import React from 'react';
import { Globe } from 'lucide-react';
import { useLanguageStore, Locale, localeLabels, localeFlags } from '@/lib/i18n';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface Props {
  variant?: 'default' | 'hero';
}

const LanguageSelector = ({ variant = 'default' }: Props) => {
  const { locale, setLocale } = useLanguageStore();
  const isHero = variant === 'hero';

  const locales: Locale[] = ['en', 'bs', 'ar'];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={`Change language, current language ${localeLabels[locale]}`}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full font-sans text-sm font-medium transition-all duration-300 min-h-[44px] ${
            isHero
              ? 'bg-white/10 text-white border border-white/20 hover:bg-white/20'
              : 'bg-muted text-foreground border border-border hover:bg-muted/80'
          }`}
        >
          <Globe className="w-4 h-4" />
          <span className="text-xs">{localeFlags[locale]}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[140px]">
        {locales.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => setLocale(l)}
            className={`font-sans text-sm cursor-pointer ${locale === l ? 'bg-primary/10 text-primary' : ''}`}
          >
            <span className="mr-2">{localeFlags[l]}</span>
            {localeLabels[l]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export default LanguageSelector;
