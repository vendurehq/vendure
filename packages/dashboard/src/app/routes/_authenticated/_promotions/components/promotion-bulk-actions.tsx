import { AssignToChannelBulkAction } from '@/vdb/components/shared/assign-to-channel-bulk-action.js';
import { RemoveFromChannelBulkAction } from '@/vdb/components/shared/remove-from-channel-bulk-action.js';
import { BulkActionComponent } from '@/vdb/framework/extension-api/types/data-table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { DeleteBulkAction } from '../../../../common/delete-bulk-action.js';
import { DuplicateBulkAction } from '../../../../common/duplicate-bulk-action.js';

import {
    assignPromotionsToChannelDocument,
    deletePromotionsDocument,
    removePromotionsFromChannelDocument,
} from '../promotions.graphql.js';

export const DeletePromotionsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DeleteBulkAction
            mutationDocument={deletePromotionsDocument}
            entityName="promotions"
            requiredPermissions={['DeletePromotion']}
            selection={selection}
            table={table}
        />
    );
};

export const AssignPromotionsToChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <AssignToChannelBulkAction
            selection={selection}
            table={table}
            entityType="promotions"
            mutationFn={api.mutate(assignPromotionsToChannelDocument)}
            requiredPermissions={['UpdatePromotion']}
            buildInput={(channelId: string) => ({
                promotionIds: selection.map(s => s.id),
                channelId,
            })}
        />
    );
};

export const RemovePromotionsFromChannelBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    const { activeChannel } = useChannel();

    return (
        <RemoveFromChannelBulkAction
            selection={selection}
            table={table}
            entityType="promotions"
            mutationFn={api.mutate(removePromotionsFromChannelDocument)}
            requiredPermissions={['UpdatePromotion']}
            buildInput={() => ({
                promotionIds: selection.map(s => s.id),
                channelId: activeChannel?.id,
            })}
        />
    );
};

export const DuplicatePromotionsBulkAction: BulkActionComponent<any> = ({ selection, table }) => {
    return (
        <DuplicateBulkAction
            entityType="Promotion"
            duplicatorCode="promotion-duplicator"
            requiredPermissions={['CreatePromotion']}
            entityName="Promotion"
            selection={selection}
            table={table}
        />
    );
};
