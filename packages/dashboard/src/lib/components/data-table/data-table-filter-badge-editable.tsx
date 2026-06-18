import { Dialog } from '@/vdb/components/ui/dialog.js';
import { Column } from '@tanstack/react-table';
import { useState } from 'react';
import { DataTableFilterBadge } from './data-table-filter-badge.js';
import { DataTableFilterDialog } from './data-table-filter-dialog.js';
import { ColumnDataType } from './types.js';

export function DataTableFilterBadgeEditable({
    filter,
    column,
    onRemove,
    dataType,
    currencyCode,
}: {
    filter: any;
    column: Column<any> | undefined;
    onRemove: (filter: any) => void;
    dataType: ColumnDataType;
    currencyCode: string;
}) {
    const [isDialogOpen, setIsDialogOpen] = useState(false);

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DataTableFilterBadge
                filter={filter}
                onRemove={onRemove}
                onClick={() => setIsDialogOpen(true)}
                dataType={dataType}
                currencyCode={currencyCode}
            />
            {column && <DataTableFilterDialog column={column} onEnter={() => setIsDialogOpen(false)} />}
        </Dialog>
    );
}
