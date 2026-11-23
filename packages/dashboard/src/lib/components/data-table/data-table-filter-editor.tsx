import { Dialog } from '@/vdb/components/ui/dialog.js';
import { Column } from '@tanstack/react-table';
import { DataTableFilterDialog } from './data-table-filter-dialog.js';

/**
 * @description
 * The editor of an applied column filter: the filter dialog, opened from the
 * filter's chip.
 *
 * @docsCategory list-views
 * @since 3.8.0
 */
export function DataTableFilterEditor({
    column,
    open,
    onOpenChange,
}: Readonly<{
    column: Column<any> | undefined;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}>) {
    if (!column) return null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DataTableFilterDialog column={column} onEnter={() => onOpenChange(false)} />
        </Dialog>
    );
}
