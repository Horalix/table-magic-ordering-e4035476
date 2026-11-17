import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { acceptInstallOffer, installOffer, onInstallOffer } from './install-prompt';
import { isIosBrowserTab } from './manager-app';

/**
 * "Put Manager on your Home Screen", once, in the admin.
 *
 * On an iPhone in Safari: two short steps, and why (it is the only way an
 * iPhone rings when a guest asks for a table; Apple allows web alerts only
 * from a Home Screen app). On Android and in Chrome on a computer: the
 * browser's own install, behind one button, when the browser offers it.
 *
 * Put away with the ✕, it stays away on this device. It is never shown
 * inside the installed app, and not in the offline demo, which has no app.
 */

const DISMISSED_KEY = 'admin:install-hint-dismissed';

const dismissedBefore = (): boolean => {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
};

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <li className="flex items-start gap-2.5">
    <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full bg-foreground text-[11px] font-semibold text-background" aria-hidden>{n}</span>
    <span className="min-w-0 leading-snug">{children}</span>
  </li>
);

const InstallHint = ({ standalone, demo, className }: { standalone: boolean; demo: boolean; className?: string }) => {
  const [dismissed, setDismissed] = useState(dismissedBefore);
  const [offered, setOffered] = useState(() => !!installOffer());
  const [ios] = useState(() => isIosBrowserTab());

  useEffect(() => onInstallOffer(() => setOffered(!!installOffer())), []);

  if (standalone || demo || dismissed || (!ios && !offered)) return null;

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, '1'); } catch { /* storage off: gone until the next visit */ }
    setDismissed(true);
  };

  return (
    <section
      aria-label="Add Manager to the Home Screen"
      data-testid="install-hint"
      className={cn('relative rounded-2xl border border-border bg-card py-3.5 pl-4 pr-12 font-sans text-sm text-foreground shadow-sm', className)}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
      {ios ? (
        <>
          <p className="font-semibold">Put Manager on your Home Screen</p>
          <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">It is what lets this iPhone ring when a guest asks for a table.</p>
          <ol className="mt-2.5 space-y-1.5">
            <Step n={1}>
              Tap <Share className="mx-0.5 inline h-4 w-4 align-[-3px]" aria-hidden /><span className="font-semibold">Share</span> in Safari’s toolbar.
            </Step>
            <Step n={2}>
              Tap <SquarePlus className="mx-0.5 inline h-4 w-4 align-[-3px]" aria-hidden /><span className="font-semibold">Add to Home Screen</span>, then <span className="font-semibold">Add</span>.
            </Step>
          </ol>
          <a href="/manager-app/" className="mt-2 inline-flex min-h-[44px] items-center text-[13px] font-medium text-primary underline underline-offset-4">Every step, with what to do next</a>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
          <div className="min-w-0 flex-1 basis-56">
            <p className="font-semibold">Install the Manager app</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">The admin, opening from its own icon. It rings when a guest asks for a table.</p>
          </div>
          <Button
            type="button"
            onClick={() => void acceptInstallOffer().then((installed) => { if (installed) setDismissed(true); })}
            className="min-h-[44px] gap-2"
          >
            <Download className="h-4 w-4" aria-hidden /> Install app
          </Button>
        </div>
      )}
    </section>
  );
};

export default InstallHint;
