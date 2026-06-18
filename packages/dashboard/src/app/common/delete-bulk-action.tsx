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
    /** The selected items to delete */
    selection: any[];
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
 * export const DeleteProductsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
 *     return (
 *         <DeleteBulkAction
 *             mutationDocument={deleteProductsDocument}
 *             entityName="products"
 *             requiredPermissions={['DeleteCatalog', 'DeleteProduct']}
 *             selection={selection}
 *             table={table}
 *         />
 *     );
 * };
 *
 * // With additional cleanup
 * export const DeleteCollectionsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
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
    table,
}: Readonly<DeleteBulkActionProps>) {
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
            toast.error(`Failed to delete ${selection.length} ${entityName}`);
        },
    });

    return (
        <DataTableBulkActionItem
            requiresPermission={requiredPermissions}
            onClick={() => mutate({ ids: selection.map(s => s.id) })}
            label={<Trans>Delete</Trans>}
            confirmationText={
                <Trans>
                    Are you sure you want to delete {selection.length} {entityName}?
                </Trans>
            }
            icon={TrashIcon}
        />
    );
}
