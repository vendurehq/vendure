import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkAction,
    createBulkAssignToChannelAction,
    createBulkDeleteAction,
    createBulkRemoveFromChannelAction,
    DataService,
    DuplicateEntityDialogComponent,
    GetCollectionListQuery,
    ItemOf,
    ModalService,
    MoveCollectionInput,
    NotificationService,
    Permission,
} from '@vendure/admin-ui/core';
import { EMPTY } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { CollectionPartial } from '../collection-tree/collection-tree.types';
import { MoveCollectionsDialogComponent } from '../move-collections-dialog/move-collections-dialog.component';

import { CollectionListComponent } from './collection-list.component';

export const deleteCollectionsBulkAction = createBulkDeleteAction<
    ItemOf<GetCollectionListQuery, 'collections'>
>({
    location: 'collection-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteCollection) ||
        userPermissions.includes(Permission.DeleteCatalog),
    getItemName: item => item.name,
    bulkDelete: (dataService, ids) =>
        dataService.collection.deleteCollections(ids).pipe(map(res => res.deleteCollections)),
});

export const moveCollectionsBulkAction: BulkAction<CollectionPartial, CollectionListComponent> = {
    location: 'collection-list',
    label: _('catalog.move-collections'),
    icon: 'drag-handle',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateCollection),
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        const dataService = injector.get(DataService);
        const notificationService = injector.get(NotificationService);
        modalService
            .fromComponent(MoveCollectionsDialogComponent, {
                size: 'xl',
                closable: true,
            })
            .pipe(
                switchMap(result => {
                    if (result) {
                        const inputs: MoveCollectionInput[] = selection.map(c => ({
                            collectionId: c.id,
                            parentId: result.id,
                            index: 0,
                        }));
                        return dataService.collection.moveCollection(inputs);
                    } else {
                        return EMPTY;
                    }
                }),
            )
            .subscribe(result => {
                notificationService.success(_('catalog.move-collections-success'), {
                    count: selection.length,
                });
                clearSelection();
                hostComponent.refresh();
            });
    },
};

export const assignCollectionsToChannelBulkAction = createBulkAssignToChannelAction<
    ItemOf<GetCollectionListQuery, 'collections'>
>({
    location: 'collection-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateCollection),
    getItemName: item => item.name,
    bulkAssignToChannel: (dataService, collectionIds, channelIds) =>
        channelIds.map(channelId =>
            dataService.collection
                .assignCollectionsToChannel({
                    collectionIds,
                    channelId,
                })
                .pipe(map(res => res.assignCollectionsToChannel)),
        ),
});

export const removeCollectionsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetCollectionListQuery, 'collections'>
>({
    location: 'collection-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteCatalog) ||
        userPermissions.includes(Permission.DeleteCollection),
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, collectionIds, channelId) =>
        dataService.collection
            .removeCollectionsFromChannel({
                channelId: channelId,
                collectionIds,
            })
            .pipe(map(res => res.removeCollectionsFromChannel)),
});

export const duplicateCollectionsBulkAction: BulkAction<
    ItemOf<GetCollectionListQuery, 'collections'>,
    CollectionListComponent
> = {
    location: 'collection-list',
    label: _('common.duplicate'),
    icon: 'copy',
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        modalService
            .fromComponent(DuplicateEntityDialogComponent<ItemOf<GetCollectionListQuery, 'collections'>>, {
                locals: {
                    entities: selection,
                    entityName: 'Collection',
                    title: _('catalog.duplicate-collections'),
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
