import React, { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Command } from 'cmdk';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, CornerDownLeft, History, KeyRound, LogOut, Search, type LucideIcon } from 'lucide-react';
import { AREAS, LAUNCHERS, areaOf, pagesIn, searchScore, type NavPage } from './admin-nav';
import { recentPages } from './nav-memory';
import { OpensElsewhere } from './NavParts';
import type { AdminShell } from './shell';

/**
 * Search, or jump: ⌘K / Ctrl K, or the search field.
 *
 * Type a page's name, or what you want to do in the manager's own words
 * ("PIN", "sold out", "wifi printer", "close the day"): it matches the names
 * and the keywords in admin-nav.ts. With nothing typed, the last three pages
 * you visited come first. A few plain actions sit at the end; each only goes
 * somewhere or does what a button in the layout already does. Nothing is
 * fetched here.
 *
 * Arrow keys move, Enter opens, Escape closes; on a phone it sits at the top
 * of the screen so the keyboard does not cover the results.
 */

const itemClass = 'group flex min-h-[48px] cursor-pointer select-none items-center gap-3 rounded-lg px-3 font-sans text-[15px] text-foreground outline-none data-[selected=true]:bg-muted';
const groupClass = 'px-2 pb-1 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-sans [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:text-muted-foreground';

const Row = ({ icon: Icon, label, about, trailing }: { icon: LucideIcon; label: string; about?: string; trailing?: React.ReactNode }) => (
  <>
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground/75 group-data-[selected=true]:bg-background">
      <Icon className="h-4 w-4" aria-hidden />
    </span>
    <span className="min-w-0 flex-1">
      <span className="block truncate leading-snug">{label}</span>
      {about && <span className="block truncate text-[13px] leading-snug text-muted-foreground">{about}</span>}
    </span>
    {trailing}
    <CornerDownLeft className="hidden h-3.5 w-3.5 shrink-0 text-muted-foreground group-data-[selected=true]:sm:block" aria-hidden />
  </>
);

const AdminCommandPalette = ({ shell, open, onOpenChange }: { shell: AdminShell; open: boolean; onOpenChange: (open: boolean) => void }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  // A new search each time it opens.
  useEffect(() => { if (!open) setQuery(''); }, [open]);

  const recent = useMemo(
    () => (open ? recentPages(shell.pathname, shell.audience) : []),
    [open, shell.pathname, shell.audience],
  );

  const run = (action: () => void) => {
    onOpenChange(false);
    action();
  };
  const go = (page: NavPage) => run(() => navigate(page.path));
  const others = shell.choices.filter((v) => v.slug !== shell.venueSlug);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-charcoal/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed left-1/2 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 w-[calc(100vw-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none duration-150 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-[0.98] data-[state=closed]:zoom-out-[0.98] sm:top-[14vh]"
        >
          <Dialog.Title className="sr-only">Search the admin</Dialog.Title>
          <Command label="Search the admin" loop filter={(value, search, keywords) => searchScore(value, keywords ?? [], search)} className="flex max-h-[min(34rem,calc(100dvh-env(safe-area-inset-top)-1.5rem))] flex-col sm:max-h-[min(34rem,70vh)]">
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-[18px] w-[18px] shrink-0 text-muted-foreground" aria-hidden />
              <Command.Input
                value={query}
                onValueChange={setQuery}
                placeholder="Search or jump to…"
                // 16px: iPhone zooms the page into anything smaller.
                className="h-14 w-full bg-transparent font-sans text-base text-foreground outline-none placeholder:text-muted-foreground"
              />
              <Dialog.Close aria-label="Close search" className="shrink-0 rounded-md border border-border px-2 py-1 font-sans text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:grid max-sm:h-11 max-sm:min-w-[52px] max-sm:place-items-center max-sm:border-0 max-sm:text-sm max-sm:text-foreground">
                <span className="sm:hidden" aria-hidden>Close</span>
                <span className="hidden sm:inline" aria-hidden>Esc</span>
              </Dialog.Close>
            </div>

            <Command.List className="flex-1 overflow-y-auto overscroll-contain pb-2">
              <Command.Empty className="px-6 py-10 text-center font-sans text-sm text-muted-foreground">
                Nothing in the admin matches “{query}”. Try the page’s name, or what you want to do.
              </Command.Empty>

              {!query && recent.length > 0 && (
                <Command.Group heading="Recent" className={groupClass}>
                  {recent.map((page) => (
                    <Command.Item key={page.path} value={`recent ${page.label}`} onSelect={() => go(page)} className={itemClass}>
                      <Row icon={History} label={page.label} trailing={<span className="shrink-0 text-xs text-muted-foreground">{areaOf(page.area).label}</span>} />
                    </Command.Item>
                  ))}
                </Command.Group>
              )}

              {AREAS.map((area) => {
                const pages = pagesIn(area.id, shell.audience);
                if (!pages.length) return null;
                return (
                  <Command.Group key={area.id} heading={area.label} className={groupClass}>
                    {pages.map((page) => (
                      <Command.Item
                        key={page.path}
                        value={page.label}
                        keywords={[...page.keywords, page.about]}
                        onSelect={() => go(page)}
                        className={itemClass}
                      >
                        <Row icon={page.icon} label={page.label} about={page.about} />
                      </Command.Item>
                    ))}
                  </Command.Group>
                );
              })}

              <Command.Group heading="Other screens" className={groupClass}>
                {LAUNCHERS.map((launcher) => (
                  <Command.Item
                    key={launcher.path}
                    value={`Open ${launcher.label}`}
                    keywords={launcher.keywords}
                    onSelect={() => run(() => shell.launch(launcher))}
                    className={itemClass}
                  >
                    <Row icon={launcher.icon} label={`Open ${launcher.label}`} about={launcher.about} trailing={shell.standalone ? undefined : <OpensElsewhere className="text-muted-foreground" />} />
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Group heading="Actions" className={groupClass}>
                {others.map((venue) => (
                  <Command.Item
                    key={venue.slug}
                    value={`Switch to ${venue.name}`}
                    keywords={['restaurant', 'switch', 'change restaurant', 'other restaurant']}
                    onSelect={() => run(() => shell.switchVenue(venue.slug))}
                    className={itemClass}
                  >
                    <Row icon={ArrowLeftRight} label={`Switch to ${venue.name}`} />
                  </Command.Item>
                ))}
                <Command.Item
                  value="Change password"
                  keywords={['password', 'my password', 'new password', 'account', 'security']}
                  onSelect={() => run(shell.changePassword)}
                  className={itemClass}
                >
                  <Row icon={KeyRound} label="Change password" about={shell.email ?? undefined} />
                </Command.Item>
                <Command.Item
                  value="Sign out"
                  keywords={['log out', 'logout', 'sign off', 'leave', 'exit']}
                  onSelect={() => run(shell.signOut)}
                  className={itemClass}
                >
                  <Row icon={LogOut} label="Sign out" />
                </Command.Item>
              </Command.Group>
            </Command.List>

            <div className="hidden items-center gap-4 border-t border-border px-4 py-2 font-sans text-[11px] text-muted-foreground sm:flex" aria-hidden>
              <span><kbd className="font-sans font-semibold">↑↓</kbd> move</span>
              <span><kbd className="font-sans font-semibold">Enter</kbd> open</span>
              <span><kbd className="font-sans font-semibold">Esc</kbd> close</span>
            </div>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

export default AdminCommandPalette;
