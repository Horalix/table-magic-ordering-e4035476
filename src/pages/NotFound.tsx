import { Link } from 'react-router-dom';
import { useT } from '@/lib/i18n';

/** Any mistyped or stale link. Guests land here too, so it speaks their language. */
const NotFound = () => {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="text-center max-w-xs">
        <img src="/brand/emblem-dark.webp" alt="La Soul" width={480} height={480} className="w-20 h-20 mx-auto mb-6" />
        <h1 className="font-serif text-2xl font-bold text-foreground">{t('not_found_title')}</h1>
        <p className="mt-2 text-sm font-sans text-muted-foreground">{t('not_found_body')}</p>
        <Link
          to="/menu"
          className="mt-6 inline-flex items-center justify-center min-h-[48px] px-6 rounded-full bg-primary text-primary-foreground font-sans font-semibold"
        >
          {t('back_to_menu')}
        </Link>
      </div>
    </div>
  );
};

export default NotFound;
