import { DataTableBulkActions } from '@/vdb/components/data-table/data-table-bulk-actions.js';
import type {
    BulkAction,
    BulkActionComponent,
    BulkActionContext,
    BulkActionGroup,
    BulkActionsInput,
} from '@/vdb/framework/extension-api/types/data-table.js';
import { Table } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { Asset } from './asset-gallery.js';

/**
 * @description
 * The context supplied to asset-gallery bulk actions.
 *
 * `refetch` is retained for backwards compatibility. New bulk actions can also
 * use the standard data-table `table` object to reset the current selection.
 */
export type AssetBulkActionContext = BulkActionContext<Asset> & {
    refetch: () => void;
};

export type AssetBulkActionComponent = React.FunctionComponent<AssetBulkActionContext>;
export type AssetBulkAction = Omit<BulkAction, 'component'> & {
    component: AssetBulkActionComponent;
};
export type AssetBulkActionGroup = Omit<BulkActionGroup, 'actions'> & {
    actions: AssetBulkAction[];
};
export type AssetBulkActionsInput =
    | AssetBulkAction[]
    | Array<AssetBulkAction[] | AssetBulkActionGroup>;

function adaptAssetBulkAction(action: AssetBulkAction, refetch: () => void): BulkAction {
    const AssetAction = action.component;
    const component: BulkActionComponent<Asset> = props => <AssetAction {...props} refetch={refetch} />;
    return { ...action, component };
}

/** @internal */
export function adaptAssetBulkActions(
    bulkActions: AssetBulkActionsInput | undefined,
    refetch: () => void,
): BulkActionsInput {
    if (!bulkActions || bulkActions.length === 0) {
        return [];
    }

    const first = bulkActions[0];
    if (first != null && 'component' in first) {
        return (bulkActions as AssetBulkAction[]).map(action => adaptAssetBulkAction(action, refetch));
    }

    return (bulkActions as Array<AssetBulkAction[] | AssetBulkActionGroup>).map(group => {
        if (Array.isArray(group)) {
            return group.map(action => adaptAssetBulkAction(action, refetch));
        }
        return {
            ...group,
            actions: group.actions.map(action => adaptAssetBulkAction(action, refetch)),
        };
    });
}

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
