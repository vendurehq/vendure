import { Button } from '@/vdb/components/ui/button.js';
import {
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Trans } from '@lingui/react/macro';
import { Column } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { DataTableBooleanFilter } from './filters/data-table-boolean-filter.js';
import { DataTableDateTimeFilter } from './filters/data-table-datetime-filter.js';
import { DataTableIdFilter } from './filters/data-table-id-filter.js';
import { DataTableNumberFilter } from './filters/data-table-number-filter.js';
import { DataTableStringFilter } from './filters/data-table-string-filter.js';
import { ColumnDataType } from './types.js';

export interface DataTableFilterDialogProps {
    column: Column<any>;
    onEnter?: () => void;
}

export function DataTableFilterDialog({ column, onEnter }: Readonly<DataTableFilterDialogProps>) {
    const columnFilter = column.getFilterValue() as Record<string, string> | undefined;
    const [filter, setFilter] = useState(columnFilter);

    useEffect(() => {
        setFilter(columnFilter);
    }, [columnFilter]);

    const columnDataType = (column.columnDef.meta as any)?.fieldInfo?.type as ColumnDataType;
    const columnId = column.id;
    const isEmpty = !filter || Object.keys(filter).length === 0;
    const setFilterOnColumn = () => {
        column.setFilterValue(filter);
        setFilter(undefined);
    };
    const handleEnter = (e: React.KeyboardEvent<any>) => {
        if (e.key === 'Enter') {
            if (!isEmpty) {
                setFilterOnColumn();
                onEnter?.();
            }
        }
    };
    return (
        <DialogContent onKeyDown={handleEnter}>
            <DialogHeader>
                <DialogTitle>
                    <Trans>Filter by {columnId}</Trans>
                </DialogTitle>
                <DialogDescription className="sr-only">
                    <Trans>Set filter criteria for the {columnId} column</Trans>
                </DialogDescription>
            </DialogHeader>
            {columnDataType === 'String' ? (
                <DataTableStringFilter value={filter} onChange={e => setFilter(e)} />
            ) : columnDataType === 'Int' || columnDataType === 'Float' ? (
                <DataTableNumberFilter value={filter} onChange={e => setFilter(e)} mode="number" />
            ) : columnDataType === 'DateTime' ? (
                <DataTableDateTimeFilter value={filter} onChange={e => setFilter(e)} />
            ) : columnDataType === 'Boolean' ? (
                <DataTableBooleanFilter value={filter} onChange={e => setFilter(e)} />
            ) : columnDataType === 'ID' ? (
                <DataTableIdFilter value={filter} onChange={e => setFilter(e)} />
            ) : columnDataType === 'Money' ? (
                <DataTableNumberFilter value={filter} onChange={e => setFilter(e)} mode="money" />
            ) : null}
            <DialogFooter className="sm:justify-end">
                {columnFilter && (
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={() => column.setFilterValue(undefined)}
                    >
                        <Trans>Clear filter</Trans>
                    </Button>
                )}
                <DialogClose render={<Button
                        type="button"
                        variant="secondary"
                        disabled={isEmpty}
                        onClick={() => {
                            setFilterOnColumn();
                        }}
                    />}>
                        <Trans>Apply filter</Trans>
                </DialogClose>
            </DialogFooter>
        </DialogContent>
    );
}
