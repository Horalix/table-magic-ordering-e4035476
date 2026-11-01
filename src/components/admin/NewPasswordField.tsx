import React from 'react';
import { Eye, EyeOff, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { generatePassword, MIN_PASSWORD } from '@/lib/staff-accounts';

/**
 * A password the admin makes for someone else: typed, or generated and shown
 * so it can be read off the login card afterwards. Generate fills it in and
 * shows it; the eye shows or hides what was typed. The hint under it is the
 * rule (MIN_PASSWORD), or the reason it was refused.
 */
const NewPasswordField = React.forwardRef<HTMLInputElement, {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Why it was refused, said in place of the rule. */
  problem?: string | null;
  /** What the rule says before anything is typed. */
  hint?: string;
  className?: string;
}>(({ id, value, onChange, problem, hint, className }, ref) => {
  const [shown, setShown] = React.useState(false);
  const short = value.length > 0 && value.length < MIN_PASSWORD;

  return (
    <div className={className}>
      <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Input
            id={id}
            ref={ref}
            type={shown ? 'text' : 'password'}
            autoComplete="new-password"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            minLength={MIN_PASSWORD}
            aria-invalid={!!problem}
            aria-describedby={`${id}-help`}
            className="h-11 pr-11 font-mono"
          />
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? 'Hide password' : 'Show password'}
            className="absolute right-0 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => { onChange(generatePassword()); setShown(true); }}
          className="h-11 gap-1.5 shrink-0"
        >
          <Wand2 className="w-4 h-4" /> Generate
        </Button>
      </div>
      <p id={`${id}-help`} role={problem ? 'alert' : undefined} className={`text-xs font-sans mt-1 ${problem || short ? 'text-destructive' : 'text-muted-foreground'}`}>
        {problem ?? (short ? `${value.length} of at least ${MIN_PASSWORD} characters.` : hint ?? `At least ${MIN_PASSWORD} characters.`)}
      </p>
    </div>
  );
});
NewPasswordField.displayName = 'NewPasswordField';

export default NewPasswordField;
