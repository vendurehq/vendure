import { registerToolbarItem } from '../../toolbar/toolbar-extensions.js';
import { DashboardToolbarItemDefinition } from '../types/toolbar.js';

export function registerToolbarExtensions(toolbarItems?: DashboardToolbarItemDefinition[]) {
    if (toolbarItems) {
        for (const item of toolbarItems) {
            registerToolbarItem(item);
        }
    }
}
