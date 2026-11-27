import { NavMenuItem, NavMenuSection } from '@/vdb/framework/nav-menu/nav-menu-extensions.js';
import {
    readRememberedNavEntries,
    rememberNavEntries,
} from '@/vdb/framework/nav-menu/remembered-nav-menu.js';
import {
    navMenuEntryIds,
    rememberedNavMenu,
    resolveNavMenu,
} from '@/vdb/framework/nav-menu/resolve-nav-menu.js';
import { getLockedCapability } from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import { getLockedNavItemCapability } from '@/vdb/framework/platform-promotion/register-locked-navigation.js';
import { useDashboardUserContext } from '@/vdb/hooks/use-dashboard-user-context.js';
import { usePlatformPromotion } from '@/vdb/hooks/use-platform-promotion.js';
import * as React from 'react';

/**
 * The navigation entries the current administrator sees: permissions, `isVisible`
 * predicates and locked Platform items applied. The sidebar and the command palette
 * both read it, so they always list the same pages.
 */
export function useResolvedNavMenu(allItems: Array<NavMenuSection | NavMenuItem>) {
    const platformPromotion = usePlatformPromotion();
    // A locked Platform item goes away when its capability is granted, or when all locked
    // items are hidden. A section left with no items is then dropped by resolveNavMenu.
    const items = React.useMemo(
        () =>
            allItems.map(section => {
                if (!('items' in section)) {
                    return section;
                }
                return {
                    ...section,
                    items: section.items?.filter(item => {
                        const capability = getLockedNavItemCapability(item);
                        return !capability || !!getLockedCapability(platformPromotion, capability);
                    }),
                };
            }),
        [allItems, platformPromotion],
    );
    // With no isVisible predicate anywhere, the resolved output cannot depend on
    // administrator custom fields, so a vanilla install skips that request entirely.
    const hasUserDependentRules = React.useMemo(
        () =>
            items.some(
                entry =>
                    entry.isVisible !== undefined ||
                    ('items' in entry && (entry.items ?? []).some(i => i.isVisible !== undefined)),
            ),
        [items],
    );

    const { ctx, ready } = useDashboardUserContext({ includeCustomFields: hasUserDependentRules });

    const resolved = React.useMemo(
        () =>
            resolveNavMenu({ sections: items }, ctx, {
                // Withhold only the entries with a predicate until the context has
                // loaded: a rule reading customFields would otherwise briefly see them
                // absent. Everything else renders immediately.
                userContextPending: hasUserDependentRules && !ready,
            }),
        [items, ctx, ready, hasUserDependentRules],
    );

    // Until the permissions load, every entry that requires one would be hidden,
    // and appear a moment later: the sections below would move down. The entries
    // of the last visit stand in for them meanwhile. The menu is resolved from
    // `ctx`, whose permissions are known once it has the active channel.
    const settled = !!ctx.activeChannel && (!hasUserDependentRules || ready);
    const [remembered] = React.useState(readRememberedNavEntries);
    React.useEffect(() => {
        if (settled) rememberNavEntries(navMenuEntryIds(resolved));
    }, [settled, resolved]);

    return React.useMemo(
        () => (settled || !remembered ? resolved : rememberedNavMenu({ sections: items }, remembered)),
        [settled, remembered, resolved, items],
    );
}
