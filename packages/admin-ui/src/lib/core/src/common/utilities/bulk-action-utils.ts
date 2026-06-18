import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { unique } from '@vendure/common/lib/unique';
import { EMPTY, from, lastValueFrom, Observable, of, switchMap } from 'rxjs';
import { map, mapTo } from 'rxjs/operators';

import { DataService } from '../../data/providers/data.service';
import { BulkAction } from '../../providers/bulk-action-registry/bulk-action-types';
import { ModalService } from '../../providers/modal/modal.service';
import { NotificationService } from '../../providers/notification/notification.service';
import { AssignToChannelDialogComponent } from '../../shared/components/assign-to-channel-dialog/assign-to-channel-dialog.component';
import { BaseListComponent } from '../base-list.component';
import { DeletionResponse, DeletionResult } from '../generated-types';

/**
 * @description
 * Resolves to an object containing the Channel code of the given channelId, or if no channelId
 * is supplied, the code of the activeChannel.
 */
export function getChannelCodeFromUserStatus(dataService: DataService, channelId?: string) {
    return lastValueFrom(
        dataService.client.userStatus().mapSingle(({ userStatus }) => {
            const channelCode =
                userStatus.channels.find(c => c.id === (channelId ?? userStatus.activeChannelId))?.code ??
                'undefined';
            return { channelCode };
        }),
    );
}

/**
 * @description
 * Resolves to `true` if multiple Channels are set up.
 */
export function isMultiChannel(dataService: DataService) {
    return lastValueFrom(
        dataService.client.userStatus().mapSingle(({ userStatus }) => 1 < userStatus.channels.length),
    );
}

/**
 * @description
 * Resolves to `true` if the current active Channel is not the default Channel.
 */
export function currentChannelIsNotDefault(dataService: DataService) {
    return lastValueFrom(
        dataService.client.userStatus().mapSingle(({ userStatus }) => {
            if (userStatus.channels.length === 1) {
                return false;
            }
            const defaultChannelId = userStatus.channels.find(c => c.code === DEFAULT_CHANNEL_CODE)?.id;
            return userStatus.activeChannelId !== defaultChannelId;
        }),
    );
}

export type CreateBulkDeleteActionConfig<ItemType> = Pick<BulkAction, 'location' | 'requiresPermission'> & {
    getItemName: (item: ItemType) => string;
    shouldRetryItem?: (response: DeletionResponse, item: ItemType) => boolean;
    bulkDelete: (
        dataService: DataService,
        ids: string[],
        retrying: boolean,
    ) => Observable<DeletionResponse[]>;
};

/**
 * @description
 * Creates a BulkAction which can be used to delete multiple items.
 */
export function createBulkDeleteAction<ItemType>(config: CreateBulkDeleteActionConfig<ItemType>) {
    const bulkDeleteAction: BulkAction<any, BaseListComponent<any, any>> = {
        location: config.location,
        label: _('common.delete'),
        icon: 'trash',
        iconClass: 'is-danger',
        requiresPermission: config.requiresPermission,
        onClick: ({ injector, selection, hostComponent, clearSelection }) => {
            const modalService = injector.get(ModalService);
            const dataService = injector.get(DataService);
            const notificationService = injector.get(NotificationService);

            function showModalAndDelete(items: ItemType[], message?: string) {
                const itemNames = items
                    .slice(0, 5)
                    .map(c => config.getItemName(c))
                    .join(', ');
                const nMore = items.length > 5 ? items.length - 5 : 0;
                return modalService
                    .dialog({
                        title: _('common.confirm-bulk-delete'),
                        body: message ? message : nMore ? _('common.list-items-and-n-more') : itemNames,
                        translationVars: { items: itemNames, nMore },
                        buttons: [
                            { type: 'secondary', label: _('common.cancel') },
                            {
                                type: 'danger',
                                label: message ? _('common.force-delete') : _('common.delete'),
                                returnValue: true,
                            },
                        ],
                    })
                    .pipe(
                        switchMap(res =>
                            res
                                ? config.bulkDelete(
                                      dataService,
                                      selection.map(c => c.id),
                                      message != null,
                                  )
                                : of([]),
                        ),
                    );
            }

            showModalAndDelete(selection)
                .pipe(
                    switchMap(result => {
                        let deletedCount = 0;
                        const errors: Array<{ item: ItemType; message: string }> = [];
                        let i = 0;
                        for (const item of result) {
                            if (item.result === DeletionResult.DELETED) {
                                deletedCount++;
                            } else if (config.shouldRetryItem?.(result[i], selection[i])) {
                                errors.push({ item: selection[i], message: item.message ?? '' });
                            }
                            i++;
                        }
                        if (0 < errors.length) {
                            return showModalAndDelete(
                                errors.map(e => e.item),
                                errors.map(e => e.message).join('\n'),
                            ).pipe(
                                map(result2 => {
                                    const deletedCount2 = result2.filter(
                                        r => r.result === DeletionResult.DELETED,
                                    ).length;
                                    return deletedCount + deletedCount2;
                                }),
                            );
                        } else {
                            return of(deletedCount);
                        }
                    }),
                )
                .subscribe({
                    next: deletedCount => {
                        if (deletedCount) {
                            hostComponent.refresh();
                            clearSelection();
                            notificationService.success(_('common.notify-delete-success-with-count'), {
                                count: deletedCount,
                            });
                        }
                        const notDeletedCount = selection.length - deletedCount;
                        if (0 < notDeletedCount && notDeletedCount < selection.length) {
                            notificationService.error(_('common.notify-delete-error-with-count'), {
                                count: notDeletedCount,
                            });
                        }
                        hostComponent.refresh();
                        clearSelection();
                    },
                    error: err => {
                        notificationService.error(_('common.notify-delete-error'));
                    },
                });
        },
    };
    return bulkDeleteAction;
}

export type CreateBulkAssignToChannelActionConfig<ItemType> = Pick<
    BulkAction,
    'location' | 'requiresPermission'
> & {
    getItemName: (item: ItemType) => string;
    bulkAssignToChannel: (
        dataService: DataService,
        ids: string[],
        channelIds: string[],
    ) => Array<Observable<Array<Partial<ItemType>>>>;
};

export function createBulkAssignToChannelAction<ItemType>(
    config: CreateBulkAssignToChannelActionConfig<ItemType>,
) {
    const bulkAssignToChannelAction: BulkAction<any, BaseListComponent<any, any>> = {
        location: config.location,
        label: _('common.assign-to-channel'),
        icon: 'layers',
        requiresPermission: config.requiresPermission,
        onClick: ({ injector, selection, hostComponent, clearSelection }) => {
            const modalService = injector.get(ModalService);
            const dataService = injector.get(DataService);
            const notificationService = injector.get(NotificationService);
            const itemNames = selection
                .slice(0, 5)
                .map(c => config.getItemName(c))
                .join(', ');
            const nMore = selection.length > 5 ? selection.length - 5 : 0;
            modalService
                .fromComponent(AssignToChannelDialogComponent, {
                    size: 'md',
                    locals: {
                        itemNames,
                        nMore,
                    },
                })
                .pipe(
                    switchMap(result => {
                        if (result) {
                            const observables = config.bulkAssignToChannel(
                                dataService,
                                selection.map(c => c.id),
                                result.map(c => c.id),
                            );

                            return from(observables).pipe(
                                switchMap(res => res),
                                mapTo(result),
                            );
                        } else {
                            return EMPTY;
                        }
                    }),
                )
                .subscribe(result => {
                    notificationService.success(_('common.notify-assign-to-channel-success-with-count'), {
                        count: selection.length,
                        channelCode: result.map(c => c.code).join(', '),
                    });
                    clearSelection();
                });
        },
    };
    return bulkAssignToChannelAction;
}

export type CreateBulkRemoveFromChannelActionConfig<ItemType, RemoveResult = Partial<ItemType>> = Pick<
    BulkAction,
    'location' | 'requiresPermission'
> & {
    getItemName: (item: ItemType) => string;
    bulkRemoveFromChannel: (
        dataService: DataService,
        ids: string[],
        channelId: string,
        retrying: boolean,
    ) => Observable<RemoveResult[]>;
    /**
     * An optional test of whether the removal succeeded for the given item. If this
     * function returns a string, that is taken to be an error message which will be
     * displayed to the user.
     */
    isErrorResult?: (result: RemoveResult) => string | undefined;
};

export function createBulkRemoveFromChannelAction<ItemType, ResultType = Partial<ItemType>>(
    config: CreateBulkRemoveFromChannelActionConfig<ItemType, ResultType>,
) {
    const bulkRemoveFromChannelAction: BulkAction<any, BaseListComponent<any, any>> = {
        location: config.location,
        label: _('common.remove-from-channel'),
        icon: 'layers',
        iconClass: 'is-warning',
        requiresPermission: config.requiresPermission,
        onClick: ({ injector, selection, hostComponent, clearSelection }) => {
            const modalService = injector.get(ModalService);
            const dataService = injector.get(DataService);
            const notificationService = injector.get(NotificationService);
            const activeChannelId$ = dataService.client
                .userStatus()
                .mapSingle(({ userStatus }) => userStatus.activeChannelId);

            function showModalAndDelete(items: ItemType[], message?: string) {
                const itemNames = items
                    .slice(0, 5)
                    .map(c => config.getItemName(c))
                    .join(', ');
                const nMore = items.length > 5 ? items.length - 5 : 0;
                return modalService
                    .dialog({
                        title: _('common.confirm-bulk-remove-from-channel'),
                        body: message ? message : nMore ? _('common.list-items-and-n-more') : itemNames,
                        translationVars: {
                            count: selection.length,
                            items: itemNames,
                            nMore,
                        },
                        size: message ? 'lg' : 'md',
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
                                              ? config.bulkRemoveFromChannel(
                                                    dataService,
                                                    selection.map(c => c.id),
                                                    activeChannelId,
                                                    message != null,
                                                )
                                              : EMPTY,
                                      ),
                                  )
                                : EMPTY,
                        ),
                    );
            }

            showModalAndDelete(selection)
                .pipe(
                    switchMap(result => {
                        let removedCount = selection.length;
                        const errors: string[] = [];
                        const errorIds: string[] = [];
                        let i = 0;
                        for (const item of result) {
                            const errorMessage = config.isErrorResult
                                ? config.isErrorResult(item)
                                : undefined;
                            if (errorMessage) {
                                errors.push(errorMessage);
                                errorIds.push(selection[i]?.id);
                                removedCount--;
                            }
                            i++;
                        }
                        if (0 < errorIds.length) {
                            const errorSelection = selection.filter(s => errorIds.includes(s.id));
                            return showModalAndDelete(errorSelection, errors.join('\n')).pipe(
                                map(result2 => {
                                    const notRemovedCount = result2.filter(r => {
                                        const secondTryErrorMessage = config.isErrorResult
                                            ? config.isErrorResult(r)
                                            : undefined;
                                        return typeof secondTryErrorMessage === 'string';
                                    }).length;
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
                        notificationService.success(
                            _('common.notify-remove-from-channel-success-with-count'),
                            {
                                count: removedCount,
                                channelCode,
                            },
                        );
                    }
                });
        },
    };
    return bulkRemoveFromChannelAction;
}
