import { DataTableFilterDialog } from '@/vdb/components/data-table/data-table-filter-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Dialog } from '@/vdb/components/ui/dialog.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { Trans } from '@lingui/react/macro';
import { Column, ColumnDef } from '@tanstack/react-table';
import { PlusIcon } from 'lucide-react';
import { useState } from 'react';
import type { FacetedFilter } from './data-table.js';

export interface AddFilterMenuProps {
    columns: Column<any, unknown>[];
    /**
     * Faceted filters registered on the table. They are listed at the top of
     * the menu, before the filterable columns, so the toolbar has a single
     * entry point for every kind of filter.
     */
    facetedFilters?: { [key: string]: FacetedFilter | undefined };
    onSelectFacetedFilter?: (key: string) => void;
}

export function AddFilterMenu({
    columns,
    facetedFilters,
    onSelectFacetedFilter,
}: Readonly<AddFilterMenuProps>) {
    const [selectedColumn, setSelectedColumn] = useState<ColumnDef<any> | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { getTranslatedFieldName } = useDynamicTranslations();
    const filterableColumns = columns.filter(column => column.getCanFilter());
    const facetedEntries = Object.entries(facetedFilters ?? {}).filter(([, filter]) => !!filter);

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DropdownMenu>
                <DropdownMenuTrigger
                    render={<Button variant="outline" size="sm" data-testid="dt-add-filter-trigger" />}
                >
                    <PlusIcon />
                    <Trans>Filter</Trans>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-[200px]">
                    {facetedEntries.map(([key, filter]) => (
                        <DropdownMenuItem key={key} onClick={() => onSelectFacetedFilter?.(key)}>
                            {filter?.title}
                        </DropdownMenuItem>
                    ))}
                    {facetedEntries.length > 0 && filterableColumns.length > 0 && <DropdownMenuSeparator />}
                    {filterableColumns.map(column => (
                        <DropdownMenuItem
                            key={column.id}
                            onClick={() => {
                                setSelectedColumn(column);
                                setIsDialogOpen(true);
                            }}
                        >
                            {getTranslatedFieldName(column.id)}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            {selectedColumn && (
                <DataTableFilterDialog
                    column={selectedColumn as any}
                    onEnter={() => setIsDialogOpen(false)}
                />
            )}
        </Dialog>
    );
}
