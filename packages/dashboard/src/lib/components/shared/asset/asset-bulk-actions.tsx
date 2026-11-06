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

// Adapted components are cached per (action component, refetch) pair so that
// re-running the adaptation (e.g. when a caller passes an inline `bulkActions`
// array) yields the same component identity. A fresh identity each time would
// make React unmount and remount the rendered action components, discarding
// their state (e.g. an in-flight useMutation).
const adaptedComponentCache = new WeakMap<
    AssetBulkActionComponent,
    WeakMap<() => void, BulkActionComponent<Asset>>
>();

function adaptAssetBulkAction(action: AssetBulkAction, refetch: () => void): BulkAction {
    const AssetAction = action.component;
    let byRefetch = adaptedComponentCache.get(AssetAction);
    if (!byRefetch) {
        byRefetch = new WeakMap();
        adaptedComponentCache.set(AssetAction, byRefetch);
    }
    let component = byRefetch.get(refetch);
    if (!component) {
        component = props => <AssetAction {...props} refetch={refetch} />;
        byRefetch.set(refetch, component);
    }
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
    /**
     * `'card'` (default) renders the toolbar on its own bordered row; `'plain'`
     * renders just the toolbar, for embedding in an existing header row.
     */
    frame?: 'card' | 'plain';
}

export function AssetBulkActions({
    selection,
    bulkActions = [],
    clearSelection,
    frame = 'card',
}: Readonly<AssetBulkActionsProps>) {
    const table = useMemo(() => {
        const selectedById = new Map(selection.map(asset => [asset.id, asset]));
        const supported = {
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
        };
        // Bulk actions are typed as receiving a full TanStack `Table`, but the
        // gallery grid has no table instance. Unimplemented members raise a
        // descriptive error rather than a cryptic "x is not a function" inside
        // the action component — but only when *called*: property access must
        // never throw, because infrastructure probes arbitrary props (e.g.
        // React's dev-mode render logging reads `$$typeof` on every prop, and
        // a throw there aborts React's commit phase).
        return new Proxy(supported, {
            get(target, property, receiver) {
                if (property in target) {
                    return Reflect.get(target, property, receiver);
                }
                if (typeof property === 'symbol' || property === 'then' || property === 'toJSON') {
                    return undefined;
                }
                return () => {
                    throw new Error(
                        `The asset gallery selection table only supports ${Object.keys(supported).join(', ')} — "${property}" is not available.`,
                    );
                };
            },
        }) as unknown as Table<Asset>;
    }, [clearSelection, selection]);

    if (selection.length === 0) {
        return null;
    }

    const toolbar = <DataTableBulkActions table={table} bulkActions={bulkActions} />;

    if (frame === 'plain') {
        return toolbar;
    }

    return <div className="rounded-lg border bg-card px-3 py-2">{toolbar}</div>;
}

export type { BulkAction, BulkActionsInput };
