import { BulkActionComponent } from '@/vdb/framework/extension-api/types/index.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { deleteZonesDocument, removeCountryFromZoneMutation } from '../zones.graphql.js';
import { DataTableBulkActionItem } from '@/vdb/components/data-table/data-table-bulk-action-item.js';
import { TrashIcon } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/vdb/graphql/api.js';
import { toast } from 'sonner';
import { Trans, useLingui } from '@lingui/react/macro';

export const DeleteZonesBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteZonesDocument}
            entityName="zones"
            requiredPermissions={['DeleteZone']}
            selection={selection}
            table={table}
        />
    );
};

export function removeCountryFromZoneBulkAction(zoneId: string): BulkActionComponent<any> {
    const RemoveCountryFromZoneBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
        const { t } = useLingui();
        const queryClient = useQueryClient();

        const { mutate } = useMutation({
            mutationFn: api.mutate(removeCountryFromZoneMutation),
            onSuccess: () => {
                toast.success(t`Removed ${selection.length} ${selection.length === 1 ? 'country' : 'countries'} from zone`);
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
                        memberIds: selection.map(s => s.id),
                    });
                }}
                label={<Trans>Remove from zone</Trans>}
                confirmationText={
                    <Trans>
                        Are you sure you want to remove {selection.length} {selection.length === 1 ? 'country' : 'countries'} from this zone?
                    </Trans>
                }
                icon={TrashIcon}
            />
        );
    };

    return RemoveCountryFromZoneBulkAction;
}

