import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const MIN_PASSWORD = 10;

/**
 * Any admin changes their own password. An admin the owner appointed signs
 * in with the password the owner typed for them (Admin → Team), and changes
 * it here. The current password is asked for first, so a tablet left signed
 * in cannot be used to lock its admin out.
 */
const ChangePasswordDialog = ({ open, onOpenChange, email }: { open: boolean; onOpenChange: (open: boolean) => void; email: string | null }) => {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) return;
    setCurrent(''); setNext(''); setRepeat(''); setProblem(null);
  }, [open]);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD;
  const mismatch = repeat.length > 0 && repeat !== next;
  const ready = !!current && next.length >= MIN_PASSWORD && next === repeat && !saving;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !email) return;
    setSaving(true);
    setProblem(null);
    try {
      const { error: wrong } = await supabase.auth.signInWithPassword({ email, password: current });
      if (wrong) { setProblem('That is not your current password.'); return; }
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) {
        // Supabase may ask for a recent sign-in before a password change.
        setProblem(/reauth/i.test(error.message)
          ? 'For your safety, sign out, sign in again, and change it straight away.'
          : error.message);
        return;
      }
      toast.success('Password changed. Use the new one next time you sign in.');
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={save} className="space-y-4">
          <DialogHeader>
            <DialogTitle className="font-serif">Change password</DialogTitle>
            <DialogDescription>
              {email ? <>For <span className="font-medium text-foreground">{email}</span>. </> : null}
              At least {MIN_PASSWORD} characters.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="password-current" className="font-sans text-sm">Current password</Label>
            <Input id="password-current" type="password" autoComplete="current-password" value={current}
              onChange={(e) => setCurrent(e.target.value)} className="mt-1.5 h-11 md:text-base" required />
          </div>
          <div>
            <Label htmlFor="password-new" className="font-sans text-sm">New password</Label>
            <Input id="password-new" type="password" autoComplete="new-password" value={next}
              onChange={(e) => setNext(e.target.value)} className="mt-1.5 h-11 md:text-base" required minLength={MIN_PASSWORD}
              aria-invalid={tooShort} />
            {tooShort && <p className="text-xs font-sans text-destructive mt-1">At least {MIN_PASSWORD} characters.</p>}
          </div>
          <div>
            <Label htmlFor="password-repeat" className="font-sans text-sm">New password again</Label>
            <Input id="password-repeat" type="password" autoComplete="new-password" value={repeat}
              onChange={(e) => setRepeat(e.target.value)} className="mt-1.5 h-11 md:text-base" required aria-invalid={mismatch} />
            {mismatch && <p className="text-xs font-sans text-destructive mt-1">The two do not match.</p>}
          </div>
          {problem && <p role="alert" className="text-sm font-sans text-destructive">{problem}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!ready} className="gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />} Change password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ChangePasswordDialog;
