import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    AssignPromotionsToChannelDocument,
    BulkAction,
    createBulkAssignToChannelAction,
    createBulkDeleteAction,
    createBulkRemoveFromChannelAction,
    DuplicateEntityDialogComponent,
    GetPromotionListQuery,
    ItemOf,
    ModalService,
    Permission,
    RemovePromotionsFromChannelDocument,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { map } from 'rxjs/operators';
import { PromotionListComponent } from './promotion-list.component';

const ASSIGN_PROMOTIONS_TO_CHANNEL = gql`
    mutation AssignPromotionsToChannel($input: AssignPromotionsToChannelInput!) {
        assignPromotionsToChannel(input: $input) {
            id
            name
        }
    }
`;

const REMOVE_PROMOTIONS_FROM_CHANNEL = gql`
    mutation RemovePromotionsFromChannel($input: RemovePromotionsFromChannelInput!) {
        removePromotionsFromChannel(input: $input) {
            id
            name
        }
    }
`;

export const deletePromotionsBulkAction = createBulkDeleteAction<ItemOf<GetPromotionListQuery, 'promotions'>>(
    {
        location: 'promotion-list',
        requiresPermission: Permission.DeletePromotion,
        getItemName: item => item.name,
        bulkDelete: (dataService, ids) =>
            dataService.promotion.deletePromotions(ids).pipe(map(res => res.deletePromotions)),
    },
);

export const assignPromotionsToChannelBulkAction = createBulkAssignToChannelAction<
    ItemOf<GetPromotionListQuery, 'promotions'>
>({
    location: 'promotion-list',
    requiresPermission: Permission.UpdatePromotion,
    getItemName: item => item.name,
    bulkAssignToChannel: (dataService, promotionIds, channelIds) => {
        return channelIds.map(channelId =>
            dataService
                .mutate(AssignPromotionsToChannelDocument, {
                    input: {
                        channelId,
                        promotionIds,
                    },
                })
                .pipe(map(res => res.assignPromotionsToChannel)),
        );
    },
});

export const removePromotionsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetPromotionListQuery, 'promotions'>
>({
    location: 'promotion-list',
    requiresPermission: Permission.DeleteCatalog,
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, promotionIds, channelId) =>
        dataService
            .mutate(RemovePromotionsFromChannelDocument, {
                input: {
                    channelId,
                    promotionIds,
                },
            })
            .pipe(map(res => res.removePromotionsFromChannel)),
});

export const duplicatePromotionsBulkAction: BulkAction<
    ItemOf<GetPromotionListQuery, 'promotions'>,
    PromotionListComponent
> = {
    location: 'promotion-list',
    label: _('common.duplicate'),
    icon: 'copy',
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        modalService
            .fromComponent(DuplicateEntityDialogComponent<ItemOf<GetPromotionListQuery, 'promotions'>>, {
                locals: {
                    entities: selection,
                    entityName: 'Promotion',
                    title: _('marketing.duplicate-promotions'),
                    getEntityName: entity => entity.name,
                },
            })
            .subscribe(result => {
                if (result) {
                    clearSelection();
                    hostComponent.refresh();
                }
            });
    },
};
