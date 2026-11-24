import { registerCommandPaletteItem } from '../../command-palette/command-palette-extensions.js';
import { DashboardCommandPaletteItemDefinition } from '../types/command-palette.js';

export function registerCommandPaletteExtensions(items?: DashboardCommandPaletteItemDefinition[]) {
    if (items) {
        for (const item of items) {
            registerCommandPaletteItem(item);
        }
    }
}
