import * as Dialog from '@radix-ui/react-dialog';
import { ChevronLeft } from 'lucide-react';
import type { NavLauncher } from './admin-nav';

/**
 * The kitchen display or the floor monitor, opened from the Manager app.
 *
 * A Home Screen app has no tabs, no address bar and no back button, and
 * neither of those screens has a way back to the admin of its own (the floor
 * monitor has none at all). So in the app they open here: the screen itself,
 * live, in a frame, under a bar that says what it is and goes back to the
 * admin in one tap. The admin underneath stays exactly where it was.
 *
 * In a browser the same launchers open a new tab instead (NavParts.tsx).
 */
const ScreenFrame = ({ screen, onClose }: { screen: NavLauncher | null; onClose: () => void }) => (
  <Dialog.Root open={!!screen} onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Content
        aria-describedby={undefined}
        data-testid="screen-frame"
        // The screen inside takes the keyboard; Escape there must not close it by surprise.
        onEscapeKeyDown={(event) => event.preventDefault()}
        className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-sidebar pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
      >
        <div className="flex shrink-0 items-center gap-1 px-1 pb-1 pt-[calc(env(safe-area-inset-top)+0.25rem)] text-sidebar-foreground">
          <Dialog.Close className="flex h-11 items-center gap-0.5 rounded-full pl-1.5 pr-3.5 font-sans text-[15px] font-medium hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
            <ChevronLeft className="h-5 w-5" aria-hidden /> Admin
          </Dialog.Close>
          <Dialog.Title className="min-w-0 flex-1 truncate pr-3 text-right font-sans text-sm font-normal text-sidebar-foreground/70">
            {screen?.label}
          </Dialog.Title>
        </div>
        {screen && (
          <iframe
            src={screen.path}
            title={screen.label}
            allow="autoplay; fullscreen; screen-wake-lock"
            className="w-full flex-1 border-0 bg-background"
          />
        )}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

export default ScreenFrame;
