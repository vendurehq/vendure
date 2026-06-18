import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';

import {
    assignShippingMethodsToChannelDocument,
    deleteShippingMethodsDocument,
    removeShippingMethodsFromChannelDocument,
} from '../shipping-methods.graphql.js';

export const DeleteShippingMethodsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deleteShippingMethodsDocument}
            entityName="shipping methods"
            requiredPermissions={['DeleteShippingMethod']}
            selection={selection}
            table={table}
        />
    );
};

export const AssignShippingMethodsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="shipping methods"
            mutationFn={api.mutate(assignShippingMethodsToChannelDocument)}
            requiredPermissions={['UpdateShippingMethod']}
            buildInput={(channelId: string) => ({
                shippingMethodIds: selection.map(s => s.id),
                channelId,
            })}
        />
    );
};

export const RemoveShippingMethodsFromChannelBulkAction: BulkActionComponent<any> = ({
    selection,
    table,
}) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="shipping methods"
            mutationFn={api.mutate(removeShippingMethodsFromChannelDocument)}
            requiredPermissions={['UpdateShippingMethod']}
            buildInput={() => ({
                shippingMethodIds: selection.map(s => s.id),
                channelId: activeChannel?.id,
            })}
        />
    );
};
