import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'install-dismissed';

/** Storage can be unavailable (Safari private mode); never let that throw. */
const readDismissed = (): boolean => {
  try { return localStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
};

/**
 * Subtle "Install app" affordance. Only appears on browsers that fire
 * `beforeinstallprompt` (Android/desktop Chrome). On iOS, guests install via
 * Share → Add to Home Screen, which needs no code.
 */
const InstallPrompt = () => {
  const t = useT();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  // Read through a guarded helper: this runs during render, and an unguarded
  // localStorage access in Safari private mode throws and takes the whole
  // GuestMenu page down with it.
  const [hidden, setHidden] = useState(readDismissed);

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    const installed = () => { setEvt(null); setHidden(true); };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  if (!evt || hidden) return null;

  const install = async () => {
    try {
      await evt.prompt();
      const { outcome } = await evt.userChoice;
      // Only burn the prompt if they actually installed. Cancelling the native
      // sheet used to permanently remove the button until a full reload.
      if (outcome === 'accepted') setEvt(null);
    } catch {
      setEvt(null);
    }
  };

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch { /* storage blocked */ }
    setHidden(true);
  };

  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <button
        onClick={install}
        className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-primary px-3 py-2 rounded-full bg-primary/10 hover:bg-primary/15 transition-colors tap-sm min-h-[44px]"
      >
        <Download className="w-3.5 h-3.5" aria-hidden /> {t('install_app')}
      </button>
      <button
        onClick={dismiss}
        aria-label={t('dismiss')}
        className="text-muted-foreground/60 hover:text-muted-foreground grid place-items-center w-11 h-11 rounded-full"
      >
        <X className="w-3.5 h-3.5" aria-hidden />
      </button>
    </div>
  );
};

export default InstallPrompt;
