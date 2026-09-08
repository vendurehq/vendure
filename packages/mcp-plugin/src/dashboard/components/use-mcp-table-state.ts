import { type ColumnFiltersState, type SortingState, usePage, useUserSettings } from '@vendure/dashboard';
import { useState } from 'react';

type ColumnVisibility = Record<string, boolean>;

export function useMcpColumnVisibility<V extends ColumnVisibility>(defaultVisibility: V) {
    const { pageId } = usePage();
    const { settings, setTableSettings } = useUserSettings();
    const savedVisibility = pageId ? settings.tableSettings?.[pageId]?.columnVisibility : undefined;

    return {
        onColumnVisibilityChange: (_table: unknown, newVisibility: ColumnVisibility) => {
            if (pageId) {
                setTableSettings(pageId, 'columnVisibility', newVisibility);
            }
        },
        defaultVisibility: { ...defaultVisibility, ...savedVisibility } as V,
    };
}

export function useMcpTableState<V extends ColumnVisibility>({
    defaultSorting,
    defaultVisibility,
}: {
    defaultSorting: SortingState;
    defaultVisibility: V;
}) {
    const [page, setPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(10);
    const [sorting, setSorting] = useState<SortingState>(defaultSorting);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const columnVisibility = useMcpColumnVisibility(defaultVisibility);

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
        ...columnVisibility,
    };
}
