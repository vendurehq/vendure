import { createBulkDeleteAction, GetChannelsQuery, ItemOf, Permission } from '@vendure/admin-ui/core';
import { map, mergeMap } from 'rxjs/operators';

export const deleteChannelsBulkAction = createBulkDeleteAction<ItemOf<GetChannelsQuery, 'channels'>>({
    location: 'channel-list',
    requiresPermission: userPermissions =>
        userPermissions.includes(Permission.SuperAdmin) || userPermissions.includes(Permission.DeleteChannel),
    getItemName: item => item.code,
    bulkDelete: (dataService, ids) => {
        return dataService.settings.deleteChannels(ids).pipe(
            mergeMap(({ deleteChannels }) =>
                dataService.auth.currentUser().single$.pipe(
                    map(({ me }) => ({
                        me,
                        deleteChannels,
                    })),
                ),
            ),
            mergeMap(({ me, deleteChannels }) =>
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                dataService.client.updateUserChannels(me!.channels).pipe(map(() => deleteChannels)),
            ),
        );
    },
});
