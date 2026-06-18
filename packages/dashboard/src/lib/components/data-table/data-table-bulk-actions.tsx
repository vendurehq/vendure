import { useAllBulkActions } from '@/vdb/components/data-table/use-all-bulk-actions.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import { Trans } from '@lingui/react/macro';
import { Table } from '@tanstack/react-table';
import { ChevronDown, X } from 'lucide-react';
import { useRef } from 'react';

interface DataTableBulkActionsProps<TData> {
    table: Table<TData>;
    bulkActions: BulkActionsInput;
}

export function DataTableBulkActions<TData>({
    table,
    bulkActions,
}: Readonly<DataTableBulkActionsProps<TData>>) {
    const allBulkActionGroups = useAllBulkActions(bulkActions);

    // Cache to store selected items across page changes.
    // This component is always mounted (not conditionally rendered)
    // so the cache survives page navigation.
    const selectedItemsCache = useRef<Map<string, TData>>(new Map());
    const selectedRowIds = Object.keys(table.getState().rowSelection);
    const hasSelection = selectedRowIds.length > 0;

    // Get selection from cache instead of trying to get from table
    const selection = selectedRowIds
        .map(key => {
            try {
                const row = table.getRow(key);
                if (row) {
                    selectedItemsCache.current.set(key, row.original);
                    return row.original;
                }
            } catch (error) {
                // ignore the error, it just means the row is not on the
                // current page.
            }
            if (selectedItemsCache.current.has(key)) {
                return selectedItemsCache.current.get(key);
            }
            return undefined;
        })
        .filter((item): item is TData => item !== undefined);

    if (!hasSelection) {
        return null;
    }

    const hasActions = allBulkActionGroups.some(g => g.actions.length > 0);
    const allSelected = table.getIsAllPageRowsSelected();
    const someSelected = table.getIsSomePageRowsSelected();

    return (
        <div
            role="toolbar"
            aria-label="Bulk actions"
            className="absolute inset-0 z-10 flex items-center bg-background px-2 animate-in fade-in slide-in-from-top-1 duration-200"
        >
            <div className="flex items-center gap-2">
                <Checkbox
                    checked={allSelected || someSelected}
                    indeterminate={someSelected && !allSelected}
                    onCheckedChange={value => table.toggleAllPageRowsSelected(!!value)}
                />
                <span className="text-sm font-medium">
                    <Trans>{selection.length} selected</Trans>
                </span>
                <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="outline" size="sm" className="h-8 shadow-none" />}>
                        <Trans>Actions</Trans>
                        <ChevronDown className="ml-1 h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="min-w-56">
                        {hasActions ? (
                            allBulkActionGroups.map((group, groupIndex) => {
                                if (group.actions.length === 0) return null;
                                return (
                                    <div key={`group-${groupIndex}`}>
                                        {groupIndex > 0 && <DropdownMenuSeparator />}
                                        <DropdownMenuGroup>
                                            {group.label && <DropdownMenuLabel>{group.label}</DropdownMenuLabel>}
                                            {group.actions.map((action, index) => (
                                                <action.component
                                                    key={`bulk-action-${groupIndex}-${index}`}
                                                    selection={selection}
                                                    table={table}
                                                />
                                            ))}
                                        </DropdownMenuGroup>
                                    </div>
                                );
                            })
                        ) : (
                            <DropdownMenuItem className="text-muted-foreground" disabled>
                                <Trans>No actions available</Trans>
                            </DropdownMenuItem>
                        )}
                    </DropdownMenuContent>
                </DropdownMenu>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={() => table.resetRowSelection()}
                >
                    <X className="h-4 w-4" />
                    <Trans>Reset selection</Trans>
                </Button>
            </div>
        </div>
    );
}
