import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router-dom';
import { ChevronRight, KeyRound, LogOut, Smartphone, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LAUNCHERS, pageAt, pagesIn } from './admin-nav';
import { LauncherLink, OpensElsewhere, RestaurantSwitch, SearchField } from './NavParts';
import type { AdminShell } from './shell';

/**
 * "More", on a phone: everything that is not one of the four areas in the
 * bottom bar. The search first, then Setup's pages, the two other screens,
 * the restaurant switch (the owner's) and the account.
 *
 * A full-height sheet rather than a drawer: it fills the screen between the
 * notch and the home indicator, scrolls inside, and closes with its own
 * button, a tap on any row, or Escape.
 */

const row = 'flex min-h-[56px] w-full items-center gap-3.5 px-4 text-left font-sans transition-colors hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none active:bg-muted';

const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-6">
    <h3 className="mb-2 px-1 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
    <div className="divide-y divide-border/70 overflow-hidden rounded-2xl border border-border/80 bg-card">{children}</div>
  </section>
);

const IconTile = ({ children, active = false }: { children: React.ReactNode; active?: boolean }) => (
  <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-xl', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground/80')}>
    {children}
  </span>
);

const MoreSheet = ({ shell, open, onOpenChange }: { shell: AdminShell; open: boolean; onOpenChange: (open: boolean) => void }) => {
  const close = () => onOpenChange(false);
  const current = pageAt(shell.pathname)?.path ?? null;
  const setup = pagesIn('setup', shell.audience);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background outline-none duration-300 data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8 data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 lg:hidden"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/70 pb-2 pl-[calc(env(safe-area-inset-left)+1.25rem)] pr-[calc(env(safe-area-inset-right)+0.5rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]">
            <div className="min-w-0">
              <Dialog.Title className="font-serif text-xl font-semibold leading-tight text-foreground">More</Dialog.Title>
              {shell.venueName && <p className="truncate font-sans text-xs text-muted-foreground">{shell.venueName}</p>}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-foreground/80 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden />
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)+2rem)] pl-[calc(env(safe-area-inset-left)+1rem)] pr-[calc(env(safe-area-inset-right)+1rem)] pt-4">
            <div className="mx-auto max-w-xl">
              <SearchField tone="page" onOpen={() => { close(); shell.openSearch(); }} />

              <Group title="Setup">
                {setup.map((page) => {
                  const active = page.path === current;
                  return (
                    <Link key={page.path} to={page.path} onClick={close} aria-current={active ? 'page' : undefined} className={row}>
                      <IconTile active={active}><page.icon className="h-[18px] w-[18px]" aria-hidden /></IconTile>
                      <span className="min-w-0 flex-1">
                        <span className={cn('block text-[15px] leading-snug text-foreground', active && 'font-semibold')}>{page.label}</span>
                        <span className="block truncate text-[13px] leading-snug text-muted-foreground">{page.about}</span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                    </Link>
                  );
                })}
              </Group>

              <Group title="Other screens">
                {LAUNCHERS.map((launcher) => (
                  <LauncherLink key={launcher.path} launcher={launcher} shell={shell} onOpened={close} className={row}>
                    <IconTile><launcher.icon className="h-[18px] w-[18px]" aria-hidden /></IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug text-foreground">{launcher.label}</span>
                      <span className="block truncate text-[13px] leading-snug text-muted-foreground">{launcher.about}</span>
                    </span>
                    {shell.standalone
                      ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                      : <OpensElsewhere className="h-4 w-4 text-muted-foreground" />}
                  </LauncherLink>
                ))}
              </Group>

              {shell.choices.length > 1 && (
                <section className="mt-6">
                  <h3 className="mb-2 px-1 font-sans text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Restaurant</h3>
                  <RestaurantSwitch shell={shell} tone="page" />
                </section>
              )}

              <Group title="Account">
                {shell.email && (
                  <p className="truncate px-4 py-3 font-sans text-sm text-muted-foreground">
                    Signed in as <span className="font-medium text-foreground">{shell.email}</span>
                  </p>
                )}
                <button type="button" onClick={() => { close(); shell.changePassword(); }} className={row}>
                  <IconTile><KeyRound className="h-[18px] w-[18px]" aria-hidden /></IconTile>
                  <span className="flex-1 text-[15px] text-foreground">Change password</span>
                </button>
                {/* A page of its own, outside the app: how to put Manager on the Home Screen. Not offered inside the app itself. */}
                {!shell.standalone && !shell.audience.demo && (
                  <a href="/manager-app/" className={row}>
                    <IconTile><Smartphone className="h-[18px] w-[18px]" aria-hidden /></IconTile>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] leading-snug text-foreground">Manager app</span>
                      <span className="block truncate text-[13px] leading-snug text-muted-foreground">Add it to this phone’s Home Screen</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden />
                  </a>
                )}
                <button type="button" onClick={() => { close(); shell.signOut(); }} className={row}>
                  <IconTile><LogOut className="h-[18px] w-[18px]" aria-hidden /></IconTile>
                  <span className="flex-1 text-[15px] text-foreground">Sign out</span>
                </button>
              </Group>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default MoreSheet;
