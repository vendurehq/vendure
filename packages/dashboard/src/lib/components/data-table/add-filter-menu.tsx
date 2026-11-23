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
import React, { useState } from 'react';
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
    /**
     * @description
     * The menu's button. A faceted filter picked from the menu has no chip
     * until it has a value, so its popup lines up with this button.
     *
     * @since 4.0.0
     */
    triggerRef?: React.Ref<HTMLButtonElement>;
}

export function AddFilterMenu({
    columns,
    facetedFilters,
    onSelectFacetedFilter,
    triggerRef,
}: Readonly<AddFilterMenuProps>) {
    const [selectedColumn, setSelectedColumn] = useState<ColumnDef<any> | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    // A faceted filter opens its own popup, which takes focus. It opens once the menu has
    // finished closing, and the menu does not hand focus back to its trigger: either would
    // take focus from the popup, and the faceted filter closes when it loses focus.
    const [pendingFacetedKey, setPendingFacetedKey] = useState<string | null>(null);
    const { getTranslatedFieldName } = useDynamicTranslations();
    const filterableColumns = columns.filter(column => column.getCanFilter());
    const facetedEntries = Object.entries(facetedFilters ?? {}).filter(([, filter]) => !!filter);

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DropdownMenu
                onOpenChangeComplete={open => {
                    if (!open && pendingFacetedKey) {
                        onSelectFacetedFilter?.(pendingFacetedKey);
                        setPendingFacetedKey(null);
                    }
                }}
            >
                <DropdownMenuTrigger
                    ref={triggerRef}
                    render={<Button variant="outline" data-testid="dt-add-filter-trigger" />}
                >
                    <PlusIcon />
                    <Trans>Filter</Trans>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-[200px]" finalFocus={!pendingFacetedKey}>
                    {facetedEntries.map(([key, filter]) => (
                        <DropdownMenuItem key={key} onClick={() => setPendingFacetedKey(key)}>
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
