import { DataTableBulkActions } from '@/vdb/components/data-table/data-table-bulk-actions.js';
import type {
    BulkAction,
    BulkActionComponent,
    BulkActionsInput,
} from '@/vdb/framework/extension-api/types/data-table.js';
import { Table } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { Asset } from './asset-gallery.js';

export type AssetBulkActionComponent = BulkActionComponent<Asset>;
export type AssetBulkAction = BulkAction;

interface AssetBulkActionsProps {
    selection: Asset[];
    bulkActions?: BulkActionsInput;
    clearSelection: () => void;
}

export function AssetBulkActions({ selection, bulkActions = [], clearSelection }: Readonly<AssetBulkActionsProps>) {
    const table = useMemo(() => {
        const selectedById = new Map(selection.map(asset => [asset.id, asset]));
        return {
            getState: () => ({
                rowSelection: Object.fromEntries(selection.map(asset => [asset.id, true])),
            }),
            getRow: (id: string) => {
                const original = selectedById.get(id);
                if (!original) {
                    throw new Error(`Selected asset ${id} is not available`);
                }
                return { original };
            },
            resetRowSelection: clearSelection,
        } as unknown as Table<Asset>;
    }, [clearSelection, selection]);

    if (selection.length === 0) {
        return null;
    }

    return (
        <div className="rounded-lg border bg-card px-3 py-2">
            <DataTableBulkActions table={table} bulkActions={bulkActions} />
        </div>
    );
}

export type { BulkAction, BulkActionsInput };
