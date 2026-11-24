import type { LucideIcon } from 'lucide-react';

/**
 * @description
 * What the `onSelect` function of a {@link DashboardCommandPaletteItemDefinition} receives.
 * The palette has closed by the time it runs.
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @since 4.0.0
 */
export interface CommandPaletteSelectContext {
    /**
     * @description
     * Opens a Dashboard page, as a `url` entry does. Takes a path such as `'/products'`.
     */
    navigate: (url: string) => void;
}

/**
 * @description
 * An entry of the ⌘K command palette, added by a Dashboard extension. The palette lists it
 * next to the pages of the nav menu, and finds it by its title and keywords.
 *
 * An entry either opens a page (`url`) or runs an action (`onSelect`). Set exactly one of them.
 *
 * @example
 * ```ts
 * import { defineDashboardExtension } from '\@vendure/dashboard';
 * import { Star } from 'lucide-react';
 *
 * defineDashboardExtension({
 *     commandPaletteItems: [
 *         {
 *             id: 'pending-reviews',
 *             title: 'Pending reviews',
 *             icon: Star,
 *             keywords: ['moderation', 'ratings'],
 *             group: 'catalog',
 *             url: '/reviews?status=pending',
 *             requiresPermission: 'ReadCatalog',
 *         },
 *     ],
 * });
 * ```
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @docsWeight 0
 * @since 4.0.0
 */
export interface DashboardCommandPaletteItemDefinition {
    /**
     * @description
     * A unique id for the entry. An entry registered later with the same id replaces it.
     */
    id: string;
    /**
     * @description
     * The text of the entry. Like a nav menu item title, it is passed through the
     * Dashboard's translations, so a message id of your extension's catalog works.
     */
    title: string;
    /**
     * @description
     * An optional icon, imported from `lucide-react`.
     */
    icon?: LucideIcon;
    /**
     * @description
     * More words the search matches, besides the title and the group heading.
     */
    keywords?: string[];
    /**
     * @description
     * The group of the palette to list the entry in. The palette has one group per nav menu
     * section: use the id of a section (such as `'catalog'`, see `BUILT_IN_NAV_SECTION_IDS`,
     * or the id of one of your `navSections`) to list the entry with the pages of that
     * section. Any other value starts a group of its own, with the value as its heading.
     *
     * Without a group, the entry is listed with the top-level pages.
     */
    group?: string;
    /**
     * @description
     * The position of the entry among the extension entries of its group. A lower number
     * comes first. Entries without an order come last, sorted by title. Extension entries
     * always follow the pages of the nav menu.
     */
    order?: number;
    /**
     * @description
     * The page the entry opens, such as `'/products/new'` or `'/orders?state=PaymentSettled'`.
     */
    url?: string;
    /**
     * @description
     * The action the entry runs. The palette closes first. An error it throws, or a promise
     * it rejects, is logged to the console.
     */
    onSelect?: (context: CommandPaletteSelectContext) => void | Promise<void>;
    /**
     * @description
     * Restricts the entry to administrators with the given permission or permissions. The
     * administrator needs ANY of them on the active channel, as for a nav menu item.
     */
    requiresPermission?: string | string[];
}
