import { LockedTierLabel } from '@/vdb/components/platform-promotion/platform-promo.js';
import {
    Command,
    CommandDialog,
    CommandEmpty,
    CommandFooter,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandItemDetail,
    CommandItemLabel,
    CommandList,
    CommandShortcut,
} from '@/vdb/components/ui/command.js';
import { Kbd } from '@/vdb/components/ui/kbd.js';
import { SearchTrigger } from '@/vdb/components/ui/search-trigger.js';
import { useDashboardExtensions } from '@/vdb/framework/extension-api/use-dashboard-extensions.js';
import { getNavMenuConfig } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { getLockedCapability } from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import { getLockedNavItemCapability } from '@/vdb/framework/platform-promotion/register-locked-navigation.js';
import { usePlatformPromotion } from '@/vdb/hooks/use-platform-promotion.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useNavigate } from '@tanstack/react-router';
import * as React from 'react';
import { buildCommandPaletteGroups, CommandPaletteItem } from './command-palette-items.js';
import { useResolvedNavMenu } from './use-resolved-nav-menu.js';

/** Mod+K, with no other modifier, opens and closes the palette on every page. */
function isPaletteShortcut(event: KeyboardEvent) {
    return (
        (event.metaKey || event.ctrlKey) &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'k'
    );
}

const CommandPaletteContext = React.createContext<(() => void) | null>(null);

/**
 * Holds the command palette of the Dashboard: the dialog and the Mod+K shortcut. The shortcut
 * lives here, not in the top bar trigger, so it keeps working when an extension replaces the
 * `search` toolbar item.
 */
export function CommandPaletteProvider({ children }: Readonly<{ children: React.ReactNode }>) {
    const { t } = useLingui();
    const [open, setOpen] = React.useState(false);
    // The open state as of the last change, so a shortcut right after a close reopens it.
    const openRef = React.useRef(false);
    // Each open starts a new search.
    const [session, setSession] = React.useState(0);

    const change = React.useCallback((next: boolean) => {
        if (next && !openRef.current) {
            setSession(current => current + 1);
        }
        openRef.current = next;
        setOpen(next);
    }, []);

    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (!isPaletteShortcut(event)) {
                return;
            }
            // Some browsers focus their own search on Mod+K.
            event.preventDefault();
            if (!event.repeat) {
                change(!openRef.current);
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [change]);

    const openPalette = React.useCallback(() => change(true), [change]);

    return (
        <CommandPaletteContext.Provider value={openPalette}>
            {children}
            <CommandDialog
                title={t`Search the Dashboard`}
                description={t`Find pages and settings.`}
                open={open}
                onOpenChange={change}
            >
                <CommandPaletteBody key={session} onDone={() => change(false)} />
            </CommandDialog>
        </CommandPaletteContext.Provider>
    );
}

/** The search field in the top bar. It opens the command palette. */
export function CommandPaletteTrigger() {
    const openPalette = React.useContext(CommandPaletteContext);
    const { t } = useLingui();
    if (!openPalette) {
        return null;
    }
    return <SearchTrigger label={t`Search`} aria-label={t`Search (command palette)`} onClick={openPalette} />;
}

/**
 * The plan a locked Platform page needs, as the sidebar marks it. The row still opens the
 * page, which explains the plan, as a click in the sidebar does.
 */
function LockedDetail({ item }: Readonly<{ item: CommandPaletteItem }>) {
    const state = usePlatformPromotion();
    const capability = getLockedNavItemCapability(item.source);
    const promotion = capability ? getLockedCapability(state, capability) : undefined;
    return promotion ? (
        <CommandItemDetail>
            <LockedTierLabel promotion={promotion} />
        </CommandItemDetail>
    ) : null;
}

function CommandPaletteBody({ onDone }: Readonly<{ onDone: () => void }>) {
    const { t, i18n } = useLingui();
    const navigate = useNavigate();
    const { extensionsLoaded } = useDashboardExtensions();
    const resolved = useResolvedNavMenu(extensionsLoaded ? getNavMenuConfig().sections : []);
    const groups = React.useMemo(() => buildCommandPaletteGroups(resolved), [resolved]);
    const [search, setSearch] = React.useState('');
    const [value, setValue] = React.useState('');
    const rootRef = React.useRef<HTMLDivElement>(null);

    // After each search, select the first result and scroll to the top, so Enter always
    // opens the page at the top of the list.
    React.useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const root = rootRef.current;
            if (!root) {
                return;
            }
            const list = root.querySelector('[cmdk-list]');
            if (list) {
                list.scrollTop = 0;
            }
            const first = root.querySelector('[cmdk-item]:not([aria-disabled="true"])');
            setValue(first?.getAttribute('data-value') ?? '');
        });
        return () => cancelAnimationFrame(frame);
    }, [search, groups]);

    const open = (item: CommandPaletteItem) => {
        onDone();
        void navigate({ to: item.url });
    };

    return (
        <Command ref={rootRef} value={value} onValueChange={setValue}>
            <CommandInput
                // The palette opens to type in: the search takes the focus, not the dialog.
                autoFocus
                aria-label={t`Search`}
                placeholder={t`Search pages and settings…`}
                value={search}
                onValueChange={setSearch}
            />
            <CommandList>
                <CommandEmpty>
                    <Trans>No results for “{search}”.</Trans>
                </CommandEmpty>
                {groups.map(group => (
                    <CommandGroup key={group.id} heading={group.title ? i18n.t(group.title) : undefined}>
                        {group.items.map(item => (
                            <CommandItem
                                key={item.id}
                                value={item.id}
                                keywords={[
                                    i18n.t(item.title),
                                    ...(item.sectionTitle ? [i18n.t(item.sectionTitle)] : []),
                                ]}
                                onSelect={() => open(item)}
                            >
                                {item.icon ? <item.icon /> : null}
                                <CommandItemLabel>{i18n.t(item.title)}</CommandItemLabel>
                                <LockedDetail item={item} />
                                {item.shortcut ? (
                                    <CommandShortcut aria-hidden>
                                        G {item.shortcut.toUpperCase()}
                                    </CommandShortcut>
                                ) : null}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ))}
            </CommandList>
            <CommandFooter>
                <span>
                    <Kbd>↑</Kbd>
                    <Kbd>↓</Kbd>
                    <Trans>Navigate</Trans>
                </span>
                <span>
                    <Kbd>↵</Kbd>
                    <Trans>Open</Trans>
                </span>
                <span>
                    <Kbd>Esc</Kbd>
                    <Trans>Close</Trans>
                </span>
            </CommandFooter>
        </Command>
    );
}
