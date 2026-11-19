import { CountBadge } from '@/vdb/components/ui/count-badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { Trans } from '@lingui/react/macro';
import { ColumnFiltersState, Table } from '@tanstack/react-table';
import { Filter } from 'lucide-react';
import { DataTableFilterBadgeEditable } from './data-table-filter-badge-editable.js';

interface ActiveFiltersPopoverProps {
    filters: ColumnFiltersState;
    table: Table<any>;
    currencyCode: string;
    onRemoveFilter: (id: string) => void;
    onClearAll: () => void;
}

export function ActiveFiltersPopover({
    filters,
    table,
    currencyCode,
    onRemoveFilter,
    onClearAll,
}: Readonly<ActiveFiltersPopoverProps>) {
    return (
        <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" className="border-dashed" />}>
                <Filter className="h-4 w-4" />
                <Trans>Active filters</Trans>
                <CountBadge count={filters.length} />
            </PopoverTrigger>
            <PopoverContent align="start" className="flex flex-col items-start gap-2 w-auto max-w-sm">
                {filters.map(f => {
                    const column = table.getColumn(f.id);
                    return (
                        <DataTableFilterBadgeEditable
                            key={f.id}
                            filter={f}
                            column={column}
                            currencyCode={currencyCode}
                            dataType={
                                (column?.columnDef.meta as any)?.fieldInfo?.type ?? 'String'
                            }
                            onRemove={() => onRemoveFilter(f.id)}
                        />
                    );
                })}
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onClearAll}
                    className="text-xs opacity-60 hover:opacity-100"
                >
                    <Trans>Clear all</Trans>
                </Button>
            </PopoverContent>
        </Popover>
    );
}
