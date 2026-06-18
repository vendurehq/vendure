import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkAction,
    createBulkAssignToChannelAction,
    createBulkDeleteAction,
    createBulkRemoveFromChannelAction,
    currentChannelIsNotDefault,
    DataService,
    DuplicateEntityDialogComponent,
    getChannelCodeFromUserStatus,
    GetFacetListQuery,
    ItemOf,
    ModalService,
    NotificationService,
    Permission,
    RemoveFacetsFromChannelMutation,
} from '@vendure/admin-ui/core';
import { unique } from '@vendure/common/lib/unique';
import { EMPTY, of } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { FacetListComponent } from './facet-list.component';

export const deleteFacetsBulkAction = createBulkDeleteAction<ItemOf<GetFacetListQuery, 'facets'>>({
    location: 'facet-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteFacet) ||
        userPermissions.includes(Permission.DeleteCatalog),
    getItemName: item => item.name,
    shouldRetryItem: (response, item) => !!response.message,
    bulkDelete: (dataService, ids, retrying) =>
        dataService.facet.deleteFacets(ids, retrying).pipe(map(res => res.deleteFacets)),
});

export const assignFacetsToChannelBulkAction = createBulkAssignToChannelAction<
    ItemOf<GetFacetListQuery, 'facets'>
>({
    location: 'facet-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateCatalog) ||
        userPermissions.includes(Permission.UpdateFacet),
    getItemName: item => item.name,
    bulkAssignToChannel: (dataService, facetIds, channelIds) =>
        channelIds.map(channelId =>
            dataService.facet
                .assignFacetsToChannel({
                    facetIds,
                    channelId,
                })
                .pipe(map(res => res.assignFacetsToChannel)),
        ),
});

export const removeFacetsFromChannelBulkAction = createBulkRemoveFromChannelAction<
    ItemOf<GetFacetListQuery, 'facets'>,
    RemoveFacetsFromChannelMutation['removeFacetsFromChannel'][number]
>({
    location: 'facet-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.DeleteCatalog) ||
        userPermissions.includes(Permission.DeleteFacet),
    getItemName: item => item.name,
    bulkRemoveFromChannel: (dataService, facetIds, channelId, retrying) =>
        dataService.facet
            .removeFacetsFromChannel({
                channelId: channelId,
                facetIds,
                force: retrying,
            })
            .pipe(map(res => res.removeFacetsFromChannel)),
    isErrorResult: result => (result.__typename === 'FacetInUseError' ? result.message : undefined),
});

export const removeFacetsFromChannelBulkAction2: BulkAction<
    ItemOf<GetFacetListQuery, 'facets'>,
    FacetListComponent
> = {
    location: 'facet-list',
    label: _('catalog.remove-from-channel'),
    getTranslationVars: ({ injector }) => getChannelCodeFromUserStatus(injector.get(DataService)),
    icon: 'layers',
    iconClass: 'is-warning',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.UpdateFacet) ||
        userPermissions.includes(Permission.UpdateCatalog),
    isVisible: ({ injector }) => currentChannelIsNotDefault(injector.get(DataService)),
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        const dataService = injector.get(DataService);
        const notificationService = injector.get(NotificationService);

        const activeChannelId$ = dataService.client
            .userStatus()
            .mapSingle(({ userStatus }) => userStatus.activeChannelId);

        function showModalAndDelete(facetIds: string[], message?: string) {
            return modalService
                .dialog({
                    title: _('catalog.remove-from-channel'),
                    translationVars: {
                        count: selection.length,
                    },
                    size: message ? 'lg' : 'md',
                    body: message,
                    buttons: [
                        { type: 'secondary', label: _('common.cancel') },
                        {
                            type: 'danger',
                            label: message ? _('common.force-remove') : _('common.remove'),
                            returnValue: true,
                        },
                    ],
                })
                .pipe(
                    switchMap(res =>
                        res
                            ? activeChannelId$.pipe(
                                  switchMap(activeChannelId =>
                                      activeChannelId
                                          ? dataService.facet.removeFacetsFromChannel({
                                                channelId: activeChannelId,
                                                facetIds,
                                                force: !!message,
                                            })
                                          : EMPTY,
                                  ),
                                  map(res2 => res2.removeFacetsFromChannel),
                              )
                            : EMPTY,
                    ),
                );
        }

        showModalAndDelete(unique(selection.map(f => f.id)))
            .pipe(
                switchMap(result => {
                    let removedCount = selection.length;
                    const errors: string[] = [];
                    const errorIds: string[] = [];
                    let i = 0;
                    for (const item of result) {
                        if (item.__typename === 'FacetInUseError') {
                            errors.push(item.message);
                            errorIds.push(selection[i]?.id);
                            removedCount--;
                        }
                        i++;
                    }
                    if (0 < errorIds.length) {
                        return showModalAndDelete(errorIds, errors.join('\n')).pipe(
                            map(result2 => {
                                const notRemovedCount = result2.filter(
                                    r => r.__typename === 'FacetInUseError',
                                ).length;
                                return selection.length - notRemovedCount;
                            }),
                        );
                    } else {
                        return of(removedCount);
                    }
                }),
                switchMap(removedCount =>
                    removedCount
                        ? getChannelCodeFromUserStatus(dataService).then(({ channelCode }) => ({
                              channelCode,
                              removedCount,
                          }))
                        : EMPTY,
                ),
            )
            .subscribe(({ removedCount, channelCode }) => {
                if (removedCount) {
                    hostComponent.refresh();
                    clearSelection();
                    notificationService.success(_('catalog.notify-remove-facets-from-channel-success'), {
                        count: removedCount,
                        channelCode,
                    });
                }
            });
    },
};

export const duplicateFacetsBulkAction: BulkAction<
    ItemOf<GetFacetListQuery, 'facets'>,
    FacetListComponent
> = {
    location: 'facet-list',
    label: _('common.duplicate'),
    icon: 'copy',
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        modalService
            .fromComponent(DuplicateEntityDialogComponent<ItemOf<GetFacetListQuery, 'facets'>>, {
                locals: {
                    entities: selection,
                    entityName: 'Facet',
                    title: _('catalog.duplicate-facets'),
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
