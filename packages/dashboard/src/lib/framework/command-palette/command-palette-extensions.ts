import { DashboardCommandPaletteItemDefinition } from '../extension-api/types/command-palette.js';
import { globalRegistry } from '../registry/global-registry.js';

globalRegistry.register(
    'commandPaletteItemRegistry',
    new Map<string, DashboardCommandPaletteItemDefinition>(),
);

/**
 * @description
 * Adds an entry to the ⌘K command palette. An entry with the id of an earlier one replaces it.
 * An entry that sets neither `url` nor `onSelect`, or sets both, is not added.
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @since 4.0.0
 */
export function registerCommandPaletteItem(item: DashboardCommandPaletteItemDefinition) {
    if (!item.url === !item.onSelect) {
        console.warn(
            `[Dashboard] The command palette entry "${item.id}" was not added: set exactly one ` +
                `of \`url\` and \`onSelect\`.`,
        );
        return;
    }
    globalRegistry.set('commandPaletteItemRegistry', map => {
        // The same object again is a re-run of the registration (React StrictMode), not a clash.
        const existing = map.get(item.id);
        if (existing && existing !== item && process.env.NODE_ENV !== 'production') {
            console.warn(
                `[Dashboard] A command palette entry with id "${item.id}" is already registered. ` +
                    `The later registration replaces it.`,
            );
        }
        map.set(item.id, item);
        return map;
    });
}

/**
 * @description
 * The command palette entries that extensions added, in registration order.
 *
 * @docsCategory extensions-api
 * @docsPage CommandPalette
 * @since 4.0.0
 */
export function getCommandPaletteItems(): DashboardCommandPaletteItemDefinition[] {
    return Array.from(globalRegistry.get('commandPaletteItemRegistry').values());
}
