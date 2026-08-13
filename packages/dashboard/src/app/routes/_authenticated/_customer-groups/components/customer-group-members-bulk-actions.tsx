import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { usePaginatedList } from '@/vdb/hooks/use-paginated-list.js';
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { UserMinus } from 'lucide-react';
import { toast } from 'sonner';
import { removeCustomersFromGroupDocument } from '../customer-groups.graphql.js';

/**
 * The group id is only known by the parent table, so the bulk action is built as a factory rather
 * than a plain component. Callers must memoize the result: `DataTableBulkActions` renders the
 * component by identity, so a fresh one each render would remount it and discard the confirmation
 * dialog's open state mid-interaction.
 */
export function createRemoveFromGroupBulkAction(customerGroupId: string): BulkActionComponent<any> {
    return function RemoveFromGroupBulkAction({ selection, table }) {
        const { refetchPaginatedList } = usePaginatedList();
        const { t } = useLingui();
        const count = selection.length;

        const { mutate, isPending } = useMutation({
            mutationFn: api.mutate(removeCustomersFromGroupDocument),
            onSuccess: () => {
                // `plural` from @lingui/core/macro is used (not useLingui's `t`) because this is a
                // non-JSX message: it compiles to an i18n._() call against the same global instance
                // the I18nProvider activates. Do NOT nest t`...` inside the arms — that breaks extraction.
                toast.success(
                    plural(count, {
                        one: `Removed ${count} customer from group`,
                        other: `Removed ${count} customers from group`,
                    }),
                );
                refetchPaginatedList();
                table.resetRowSelection();
            },
            onError: error => {
                toast.error(t`Failed to remove customers from group`, {
                    description: error.message,
                });
            },
        });

        return (
            <DataTableBulkActionItem
                requiresPermission={['UpdateCustomerGroup']}
                onClick={() =>
                    mutate({
                        customerGroupId,
                        customerIds: selection.map(s => s.id),
                    })
                }
                disabled={isPending}
                label={<Trans>Remove from group</Trans>}
                confirmationText={
                    <Plural
                        value={count}
                        one={`Are you sure you want to remove ${count} customer from this group?`}
                        other={`Are you sure you want to remove ${count} customers from this group?`}
                    />
                }
                icon={UserMinus}
                className="text-destructive"
            />
        );
    };
}
