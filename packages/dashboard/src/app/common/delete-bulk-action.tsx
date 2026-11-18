import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrashIcon } from 'lucide-react';
import { toast } from 'sonner';

import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { getMutationName } from '@/vdb/framework/document-introspection/get-document-structure.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';

interface DeleteBulkActionProps {
    /** The GraphQL mutation document to execute */
    mutationDocument: any;
    /** The entity name for localization (e.g., "products", "administrators") */
    entityName: string;
    /** The required permissions for this action */
    requiredPermissions: string[];
    /** Optional callback for additional cleanup after successful deletion */
    onSuccess?: () => void;
    /** Optional query keys to invalidate after successful deletion */
    invalidateQueries?: string[];
    /** The selected items the table has loaded, used to name a single item */
    selection: any[];
    /**
     * The id of every selected item, also items on other pages. The action deletes
     * these. Defaults to the ids of `selection`.
     */
    selectedRowIds?: string[];
    /** The table instance */
    table: any;
}

/**
 * A reusable delete bulk action component that can be used across all bulk action files.
 *
 * This component handles the common pattern of deleting multiple entities:
 * - Executes the provided GraphQL mutation
 * - Shows success/error toasts with localized messages
 * - Refetches the paginated list
 * - Resets table selection
 * - Optionally invalidates additional queries
 * - Optionally calls additional success callbacks
 *
 * @example
 * ```tsx
 * // Basic usage
 * export const DeleteProductsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
 *     return (
 *         <DeleteBulkAction
 *             mutationDocument={deleteProductsDocument}
 *             entityName="products"
 *             requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
 *             selection={selection}
 *             selectedRowIds={selectedRowIds}
 *             table={table}
 *         />
 *     );
 * };
 *
 * // With additional cleanup
 * export const DeleteCollectionsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
 *     return (
 *         <DeleteBulkAction
 *             mutationDocument={deleteCollectionsDocument}
 *             entityName="collections"
 *             requiredPermissions={['DeleteCatalog', 'DeleteCollection']}
 *             invalidateQueries={['childCollections']}
 *             onSuccess={() => {
 *                 // Additional cleanup logic
 *             }}
 *             selection={selection}
 *             selectedRowIds={selectedRowIds}
 *             table={table}
 *         />
 *     );
 * };
 * ```
 */
export function DeleteBulkAction({
    mutationDocument,
    entityName,
    requiredPermissions,
    onSuccess,
    invalidateQueries = [],
    selection,
    selectedRowIds,
    table,
}: Readonly<DeleteBulkActionProps>) {
    const ids: string[] = selectedRowIds ?? selection.map(s => s.id);
    const count = ids.length;
    // A single item is named in the confirm, when the table has it loaded.
    const singleName: string | undefined =
        count === 1 ? selection.find(s => s.id === ids[0])?.name : undefined;
    const { refetchPaginatedList } = usePaginatedList();
    const { t } = useLingui();
    const queryClient = useQueryClient();

    const { mutate } = useMutation({
        mutationFn: api.mutate(mutationDocument),
        onSuccess: (result: any) => {
            let deleted = 0;
            let failed = 0;
            const errors: string[] = [];

            // Get the mutation result field name from the document
            const mutationResultFieldName = getMutationName(mutationDocument);
            const deleteResults = result[mutationResultFieldName];

            for (const item of deleteResults) {
                if (item.result === 'DELETED') {
                    deleted++;
                } else {
                    failed++;
                    if (item.message) {
                        errors.push(item.message);
                    }
                }
            }

            if (0 < deleted) {
                toast.success(t`Deleted ${deleted} ${entityName}`);
            }
            if (0 < failed) {
                const allErrors = errors.join(', ');
                const errorMessage =
                    errors.length > 0
                        ? t`Failed to delete ${failed} ${entityName}: ${allErrors}`
                        : t`Failed to delete ${failed} ${entityName}`;
                toast.error(errorMessage);
            }

            refetchPaginatedList();
            table.resetRowSelection();

            // Invalidate additional queries if specified
            invalidateQueries.forEach(queryKey => {
                queryClient.invalidateQueries({ queryKey: [queryKey] });
            });

            // Call additional success callback if provided
            onSuccess?.();
        },
        onError: () => {
            toast.error(t`Failed to delete ${count} ${entityName}`);
        },
    });

    return (
        <DataTableBulkActionItem
            requiresPermission={requiredPermissions}
            onClick={() => mutate({ ids })}
            label={<Trans>Delete</Trans>}
            variant="destructive"
            confirmationTitle={
                singleName ? <Trans>Delete "{singleName}"?</Trans> : <Trans>Delete {count} {entityName}?</Trans>
            }
            confirmationText={<Trans>This cannot be undone.</Trans>}
            confirmLabel={<Trans>Delete</Trans>}
            icon={TrashIcon}
        />
    );
}
