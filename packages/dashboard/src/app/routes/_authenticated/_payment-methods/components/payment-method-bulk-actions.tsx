import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';

import {
    assignPaymentMethodsToChannelDocument,
    deletePaymentMethodsDocument,
    removePaymentMethodsFromChannelDocument,
} from '../payment-methods.graphql.js';

export const DeletePaymentMethodsBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deletePaymentMethodsDocument}
            entityName="payment methods"
            requiredPermissions={['DeletePaymentMethod']}
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
        />
    );
};

export const AssignPaymentMethodsToChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="payment methods"
            mutationFn={api.mutate(assignPaymentMethodsToChannelDocument)}
            requiredPermissions={['UpdatePaymentMethod']}
            buildInput={(channelId: string) => ({
                paymentMethodIds: selectedRowIds,
                channelId,
            })}
        />
    );
};

export const RemovePaymentMethodsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, selectedRowIds, table }) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            selectedRowIds={selectedRowIds}
            table={table}
            entityType="payment methods"
            mutationFn={api.mutate(removePaymentMethodsFromChannelDocument)}
            requiredPermissions={['UpdatePaymentMethod']}
            buildInput={() => ({
                paymentMethodIds: selectedRowIds,
                channelId: activeChannel?.id,
            })}
        />
    );
};
