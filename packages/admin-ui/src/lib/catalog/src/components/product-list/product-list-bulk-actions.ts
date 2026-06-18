import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkAction,
    createBulkRemoveFromChannelAction,
    DataService,
    DeletionResult,
    DuplicateEntityDialogComponent,
    GetProductListQuery,
    isMultiChannel,
    ItemOf,
    ModalService,
    NotificationService,
    Permission,
} from '@vendure/admin-ui/core';
import { unique } from '@vendure/common/lib/unique';
import { EMPTY } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { AssignProductsToChannelDialogComponent } from '../assign-products-to-channel-dialog/assign-products-to-channel-dialog.component';
import { BulkAddFacetValuesDialogComponent } from '../bulk-add-facet-values-dialog/bulk-add-facet-values-dialog.component';

import { ProductListComponent } from './product-list.component';

export const deleteProductsBulkAction: BulkAction<
    ItemOf<GetProductListQuery, 'products'>,
    ProductListComponent
> = {
    location: 'product-list',
    label: _('common.delete'),
    icon: 'trash',
    iconClass: 'is-danger',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteProduct) ||
        userPermissions.includes(Permission.DeleteCatalog),
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        const dataService = injector.get(DataService);
        const notificationService = injector.get(NotificationService);
        modalService
            .dialog({
                title: _('catalog.confirm-bulk-delete-products'),
                translationVars: {
                    count: selection.length,
                },
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(response =>
                    response ? dataService.product.deleteProducts(unique(selection.map(p => p.id))) : EMPTY,
                ),
            )
            .subscribe(result => {
                let deleted = 0;
                const errors: string[] = [];
                for (const item of result.deleteProducts) {
                    if (item.result === DeletionResult.DELETED) {
                        deleted++;
                    } else if (item.message) {
                        errors.push(item.message);
                    }
                }
                if (0 < deleted) {
                    notificationService.success(_('catalog.notify-bulk-delete-products-success'), {
                        count: deleted,
                    });
                }
                if (0 < errors.length) {
                    notificationService.error(errors.join('\n'));
                }
                hostComponent.refresh();
                clearSelection();
            });
    },
};

export const assignProductsToChannelBulkAction: BulkAction<
    ItemOf<GetProductListQuery, 'products'>,
    ProductListComponent
> = {
    location: 'product-list',
    label: _('common.assign-to-channel'),
    icon: 'layers',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateProduct),
    isVisible: ({ injector }) => isMultiChannel(injector.get(DataService)),
    onClick: ({ injector, selection, clearSelection }) => {
        const modalService = injector.get(ModalService);
        modalService
            .fromComponent(AssignProductsToChannelDialogComponent, {
                size: 'lg',
                locals: {
                    productIds: unique(selection.map(p => p.id)),
                    currentChannelIds: [],
                },
            })
            .subscribe(result => {
                if (result) {
                    clearSelection();
                }
            });
    },
};

export const removeProductsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetProductListQuery, 'products'>
>({
    location: 'product-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateProduct),
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, productIds, channelId) =>
        dataService.product
            .removeProductsFromChannel({
                channelId: channelId,
                productIds,
            })
            .pipe(map(res => res.removeProductsFromChannel)),
});

export const assignFacetValuesToProductsBulkAction: BulkAction<
    ItemOf<GetProductListQuery, 'products'>,
    ProductListComponent
> = {
    location: 'product-list',
    label: _('catalog.edit-facet-values'),
    icon: 'tag',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateProduct),
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        const notificationService = injector.get(NotificationService);
        const mode = 'product';
        const ids = unique(selection.map(p => p.id));
        return modalService
            .fromComponent(BulkAddFacetValuesDialogComponent, {
                size: 'xl',
                locals: {
                    mode,
                    ids,
                },
            })
            .subscribe(result => {
                if (result) {
                    notificationService.success(_('common.notify-bulk-update-success'), {
                        count: selection.length,
                        entity: mode === 'product' ? 'Products' : 'ProductVariants',
                    });
                    clearSelection();
                }
            });
    },
};

export const duplicateProductsBulkAction: BulkAction<
    ItemOf<GetProductListQuery, 'products'>,
    ProductListComponent
> = {
    location: 'product-list',
    label: _('common.duplicate'),
    icon: 'copy',
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        modalService
            .fromComponent(DuplicateEntityDialogComponent<ItemOf<GetProductListQuery, 'products'>>, {
                locals: {
                    entities: selection,
                    entityName: 'Product',
                    title: _('catalog.duplicate-products'),
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
