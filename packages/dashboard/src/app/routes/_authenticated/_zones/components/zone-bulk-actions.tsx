import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteZonesDocument, removeCountryFromZoneMutation } from '../zones.graphql.js';
import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { TrashIcon } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/vdb/graphql/api.js';
import { toast } from 'sonner';
import { plural } from '@lingui/core/macro';
import { Plural, Trans, useLingui } from '@lingui/react/macro';

export const DeleteZonesBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteZonesDocument}
            entityName="zones"
            requiredPermissions={['DeleteZone']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};

export function removeCountryFromZoneBulkAction(zoneId: string): BulkActionComponent<any> {
    const RemoveCountryFromZoneBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
        const { t } = useLingui();
        const queryClient = useQueryClient();

        const { mutate } = useMutation({
            mutationFn: api.mutate(removeCountryFromZoneMutation),
            onSuccess: () => {
                toast.success(
                    plural(selectedRowIds.length, {
                        one: 'Removed # country from zone',
                        other: 'Removed # countries from zone',
                    }),
                );
                queryClient.invalidateQueries({ queryKey: ['zone', zoneId] });
                table.resetRowSelection();
            },
            onError: () => {
                toast.error(t`Failed to remove countries from zone`);
            },
        });

        return (
            <DataTableBulkActionItem
                requiresPermission={['UpdateZone']}
                onClick={() => {
                    mutate({
                        zoneId,
                        memberIds: selectedRowIds,
                    });
                }}
                label={<Trans>Remove from zone</Trans>}
                confirmationTitle={
                    <Plural
                        value={selectedRowIds.length}
                        one="Remove # country from this zone?"
                        other="Remove # countries from this zone?"
                    />
                }
                confirmationText={<Trans>The countries stay available in other zones.</Trans>}
                confirmLabel={<Trans>Remove from zone</Trans>}
                variant="destructive"
                icon={TrashIcon}
            />
        );
    };

    return RemoveCountryFromZoneBulkAction;
}

