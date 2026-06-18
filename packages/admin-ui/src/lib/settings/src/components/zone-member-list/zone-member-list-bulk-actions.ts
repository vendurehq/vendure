import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { BulkAction, DataService, NotificationService, Permission } from '@vendure/admin-ui/core';
import { ZoneMember, ZoneMemberListComponent } from './zone-member-list.component';

export const removeZoneMembersBulkAction: BulkAction<ZoneMember, ZoneMemberListComponent> = {
    location: 'zone-members-list',
    label: _('settings.remove-from-zone'),
    icon: 'trash',
    iconClass: 'is-danger',
    requiresPermission: Permission.UpdateCustomerGroup,
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const dataService = injector.get(DataService);
        const notificationService = injector.get(NotificationService);

        const zone = hostComponent.activeZone;
        const memberIds = selection.map(s => s.id);

        dataService.settings.removeMembersFromZone(zone.id, memberIds).subscribe({
            complete: () => {
                notificationService.success(_(`settings.remove-countries-from-zone-success`), {
                    countryCount: memberIds.length,
                    zoneName: zone.name,
                });
                hostComponent.refresh();
                clearSelection();
            },
        });
    },
};
