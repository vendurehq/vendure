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
import { getCommandPaletteItems } from '@/vdb/framework/command-palette/command-palette-extensions.js';
import { useDashboardExtensions } from '@/vdb/framework/extension-api/use-dashboard-extensions.js';
import {
    getNavMenuConfig,
    NavMenuItem,
    NavMenuSection,
} from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import { getLockedCapability } from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import { getLockedNavItemCapability } from '@/vdb/framework/platform-promotion/register-locked-navigation.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
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

// A stable empty list, so the memos below do not rerun on every render before extensions load.
const NO_SECTIONS: Array<NavMenuSection | NavMenuItem> = [];

const CommandPaletteContext = React.createContext<(() => void) | null>(null);

/**
 * @description
 * Holds the ⌘K command palette of the Dashboard: the dialog and the Mod+K shortcut. The
 * Dashboard's app layout renders it, so an extension does not need to. The shortcut lives
 * here, not in the top bar trigger, so it keeps working when an extension replaces the
 * `search` toolbar item.
 *
 * The palette lists the pages of the nav menu and the entries of
 * `commandPaletteItems` in `defineDashboardExtension`.
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @since 4.0.0
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

/**
 * @description
 * Returns a function that opens the ⌘K command palette, or `null` outside a
 * {@link CommandPaletteProvider}. Use it to open the palette from your own component, such
 * as a toolbar item that replaces the built-in `search` item.
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @since 4.0.0
 */
export function useOpenCommandPalette() {
    return React.useContext(CommandPaletteContext);
}

/**
 * @description
 * The search field of the top bar, which opens the ⌘K command palette. It renders nothing
 * outside a {@link CommandPaletteProvider}.
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @since 4.0.0
 */
export function CommandPaletteTrigger() {
    const openPalette = useOpenCommandPalette();
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
    const capability = item.source ? getLockedNavItemCapability(item.source) : undefined;
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
    const sections = extensionsLoaded ? getNavMenuConfig().sections : NO_SECTIONS;
    const resolved = useResolvedNavMenu(sections);
    const { hasPermissions } = usePermissions();
    const groups = React.useMemo(
        () =>
            buildCommandPaletteGroups(resolved, {
                extensionItems: extensionsLoaded ? getCommandPaletteItems() : [],
                hasPermissions,
                sectionTitles: new Map(sections.map(section => [section.id, section.title])),
            }),
        [resolved, extensionsLoaded, hasPermissions, sections],
    );
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
        if (item.onSelect) {
            const { onSelect } = item;
            // An extension's action must not break the palette: log what it throws.
            Promise.resolve()
                .then(() => onSelect({ navigate: url => void navigate({ to: url }) }))
                .catch((error: unknown) => {
                    console.error(`[Dashboard] The command palette entry "${item.id}" failed.`, error);
                });
        } else if (item.url) {
            void navigate({ to: item.url });
        }
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
                                    ...(item.keywords ?? []).map(keyword => i18n.t(keyword)),
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
