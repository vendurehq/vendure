import { ColumnFiltersState } from '@tanstack/react-table';

import { SavedView } from '../types/saved-views.js';

/**
 * Checks if the current filters and search term match any of the provided saved views
 * @param currentFilters - The current column filters
 * @param currentSearchTerm - The current search term
 * @param views - Array of saved views to check against
 * @returns The matching saved view if found, undefined otherwise
 */
export function findMatchingSavedView(
    currentFilters: ColumnFiltersState,
    currentSearchTerm: string,
    views: SavedView[],
): SavedView | undefined {
    return views.find(view => {
        const filtersMatch = JSON.stringify(view.filters) === JSON.stringify(currentFilters);
        const searchMatch = (view.searchTerm || '') === currentSearchTerm;
        return filtersMatch && searchMatch;
    });
}

/**
 * Checks if the current filters match any saved view (user or global)
 * @param currentFilters - The current column filters
 * @param currentSearchTerm - The current search term
 * @param userViews - Array of user saved views
 * @param globalViews - Array of global saved views
 * @returns true if a matching view is found, false otherwise
 */
export function isMatchingSavedView(
    currentFilters: ColumnFiltersState,
    currentSearchTerm: string,
    userViews: SavedView[],
    globalViews: SavedView[],
): boolean {
    const allViews = [...userViews, ...globalViews];
    return findMatchingSavedView(currentFilters, currentSearchTerm, allViews) !== undefined;
}
