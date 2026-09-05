import type { ColumnFiltersState } from '@tanstack/react-table';

/**
 * Compares two column filter states by value. The DataTable keeps its filters in React
 * state, so a re-render can produce a new array with identical contents; only a change
 * in content means the user actually edited the filters.
 *
 * Consumers persist the filters they are told about, so reporting a no-op change would
 * write an empty filter state on mount and make "never configured filters on this page"
 * indistinguishable from "cleared every filter" — see `ListPage`'s `defaultColumnFilters`.
 *
 * Deliberately not exported from the package barrel: this is an internal detail of the
 * DataTable, not public API.
 */
export function columnFiltersEqual(a: ColumnFiltersState, b: ColumnFiltersState): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}
