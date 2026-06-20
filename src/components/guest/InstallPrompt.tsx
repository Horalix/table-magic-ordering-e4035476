import React, { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

/**
 * Subtle "Install app" affordance. Only appears on browsers that fire
 * `beforeinstallprompt` (Android/desktop Chrome). On iOS, users install via the
 * native Share → Add to Home Screen — no code needed.
 */
const InstallPrompt = () => {
  const t = useT();
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(() => localStorage.getItem('install-dismissed') === '1');

  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); setEvt(e as BeforeInstallPromptEvent); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (!evt || hidden) return null;

  const install = async () => {
    try { await evt.prompt(); } catch { /* ignore */ }
    setEvt(null);
  };
  const dismiss = () => { localStorage.setItem('install-dismissed', '1'); setHidden(true); };

  return (
    <div className="flex items-center justify-center gap-2 pt-2">
      <button onClick={install} className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-primary px-3 py-1.5 rounded-full bg-primary/10 hover:bg-primary/15 transition-colors tap-sm">
        <Download className="w-3.5 h-3.5" /> {t('install_app')}
      </button>
      <button onClick={dismiss} aria-label="Dismiss" className="text-muted-foreground/60 hover:text-muted-foreground p-1">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default InstallPrompt;
