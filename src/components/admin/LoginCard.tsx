import React from 'react';
import { Check, Copy, ExternalLink, Share2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { loginCardText, signInUrl, type LoginDetails } from '@/lib/staff-accounts';

/**
 * How a new account signs in, once (src/lib/staff-accounts.ts).
 *
 * Shown right after an account is made, given a new password, or given a
 * restaurant: the restaurant's own sign-in address, what to type, and the
 * password, which exists only here — in this card's memory until Done — and
 * nowhere else. Copy or Share it to the person (Share is the phone's own
 * sheet: WhatsApp, Viber, a message). A tap outside does not close it; Done
 * or the close button does, and the password is gone with it.
 */

const TITLES: Record<LoginDetails['event'], (d: LoginDetails) => string> = {
  created: (d) => (d.kind === 'admin' ? `${d.name} now runs ${d.venueName}` : d.kind === 'kitchen' ? `${d.venueName} kitchen tablet ready` : `${d.name} can sign in`),
  reset: (d) => `New password for ${d.name}`,
  appointed: (d) => `${d.name} now runs ${d.venueName}`,
};

const NEXT_STEP: Record<LoginDetails['kind'], string> = {
  admin: 'Open the address on their phone or laptop and sign in with their email.',
  waiter: 'Open the address on their phone, sign in, then add it to the home screen.',
  kitchen: 'Open the address on the kitchen tablet: after signing in it goes straight to the kitchen screen.',
};

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-0.5 py-2 items-baseline">
    <dt className="text-xs font-sans text-muted-foreground">{label}</dt>
    <dd className="text-sm font-sans text-foreground min-w-0 break-words">{children}</dd>
  </div>
);

const LoginCard = ({ details, onDone }: { details: LoginDetails | null; onDone: () => void }) => {
  const [copied, setCopied] = React.useState(false);
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  // A new card starts uncopied.
  React.useEffect(() => { setCopied(false); }, [details]);

  if (!details) return null;
  const url = signInUrl(details.kind, details.venueSlug, details.kind === 'admin' ? undefined : details.username);
  const text = loginCardText(details);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Copied. Paste it into WhatsApp or a message to them.');
    } catch {
      toast.error('Could not copy. Select the details and copy them by hand.');
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: `${details.venueName} sign-in`, text });
    } catch (error) {
      // Closing the share sheet is not a failure.
      if ((error as { name?: string }).name !== 'AbortError') toast.error('Could not open sharing. Use Copy instead.');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onDone(); }}>
      <DialogContent
        className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-2xl"
        // A stray tap must not throw away a password nobody can see again.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-serif pe-8">{TITLES[details.event](details)}</DialogTitle>
          <DialogDescription>
            {details.password
              ? 'Give them these now. The password is shown only this once and is not kept anywhere.'
              : 'They sign in with the password they already have.'}
          </DialogDescription>
        </DialogHeader>

        <dl aria-label="Sign-in details" className="divide-y divide-border rounded-xl border border-border px-3">
          <Row label="Restaurant">{details.venueName}</Row>
          <Row label="Sign in at">
            <a href={url} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2 break-all inline-flex items-start gap-1">
              {url} <ExternalLink className="w-3 h-3 mt-1 shrink-0" aria-hidden />
            </a>
          </Row>
          <Row label={details.kind === 'admin' ? 'Email' : 'Username'}>
            <span className="font-mono">{details.username}</span>
          </Row>
          <Row label="Password">
            {details.password
              ? <span className="font-mono text-base tracking-wide select-all" data-testid="login-card-password">{details.password}</span>
              : <span className="text-muted-foreground">Their own, unchanged</span>}
          </Row>
          {details.kind === 'waiter' && details.pin && (
            <Row label="Floor PIN">
              <span className="font-mono">{details.pin}</span>
              <span className="block text-xs text-muted-foreground">For the shared floor screen only.</span>
            </Row>
          )}
        </dl>

        <p className="text-xs font-sans text-muted-foreground">
          {NEXT_STEP[details.kind]}
          {details.kind === 'admin' && details.password && ' Ask them to change the password after signing in (admin menu → Change password).'}
        </p>

        <DialogFooter className="gap-2 sm:gap-2 flex-row flex-wrap sm:justify-between">
          <div className="flex gap-2 flex-1">
            <Button type="button" variant="outline" onClick={() => void copy()} className="gap-2 min-h-[44px] flex-1 sm:flex-none">
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />} {copied ? 'Copied' : 'Copy'}
            </Button>
            {canShare && (
              <Button type="button" variant="outline" onClick={() => void share()} className="gap-2 min-h-[44px] flex-1 sm:flex-none">
                <Share2 className="w-4 h-4" /> Share
              </Button>
            )}
          </div>
          <Button type="button" onClick={onDone} className="min-h-[44px] w-full sm:w-auto">Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default LoginCard;
