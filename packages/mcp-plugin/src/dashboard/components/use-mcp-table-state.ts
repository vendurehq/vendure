import { type ColumnFiltersState, type SortingState, useUserSettings } from '@vendure/dashboard';
import { useState } from 'react';

type ColumnVisibility = Record<string, boolean>;

export function useMcpTableState<V extends ColumnVisibility>({
    settingsKey,
    defaultSorting,
    defaultVisibility,
}: {
    settingsKey: string;
    defaultSorting: SortingState;
    defaultVisibility: V;
}) {
    const [page, setPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [sorting, setSorting] = useState<SortingState>(defaultSorting);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const { settings, setTableSettings } = useUserSettings();

    return {
        page,
        itemsPerPage,
        sorting,
        columnFilters,
        onPageChange: (_table: unknown, newPage: number, newItemsPerPage: number) => {
            setPage(newPage);
            setItemsPerPage(newItemsPerPage);
        },
        onSortChange: (_table: unknown, newSorting: SortingState) => setSorting(newSorting),
        onFilterChange: (_table: unknown, newFilters: ColumnFiltersState) => setColumnFilters(newFilters),
        onColumnVisibilityChange: (_table: unknown, newVisibility: ColumnVisibility) =>
            setTableSettings(settingsKey, 'columnVisibility', newVisibility),
        defaultVisibility: (settings.tableSettings?.[settingsKey]?.columnVisibility ??
            defaultVisibility) as V,
    };
}
