import {
    registerDashboardActionBarItem,
    registerDashboardPageBlock,
} from '../../layout-engine/layout-extensions.js';
import { DashboardActionBarItem, DashboardPageBlockDefinition } from '../types/layout.js';

export function registerLayoutExtensions(
    actionBarItems?: DashboardActionBarItem[],
    pageBlocks?: DashboardPageBlockDefinition[],
) {
    if (actionBarItems) {
        for (const item of actionBarItems) {
            registerDashboardActionBarItem(item);
        }
    }

    if (pageBlocks) {
        for (const block of pageBlocks) {
            registerDashboardPageBlock(block);
        }
    }
}
