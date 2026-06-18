import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkAction,
    DataService,
    ModalService,
    NotificationService,
    Permission,
} from '@vendure/admin-ui/core';
import {
    CustomerGroupMember,
    CustomerGroupMemberListComponent,
} from './customer-group-member-list.component';

export const removeCustomerGroupMembersBulkAction: BulkAction<
    CustomerGroupMember,
    CustomerGroupMemberListComponent
> = {
    location: 'customer-group-members-list',
    label: _('customer.remove-from-group'),
    icon: 'trash',
    iconClass: 'is-danger',
    requiresPermission: Permission.UpdateCustomerGroup,
    onClick: ({ injector, selection, hostComponent, clearSelection }) => {
        const modalService = injector.get(ModalService);
        const dataService = injector.get(DataService);
        const notificationService = injector.get(NotificationService);

        const group = hostComponent.activeGroup;
        const customerIds = selection.map(s => s.id);

        dataService.customer.removeCustomersFromGroup(group.id, customerIds).subscribe({
            complete: () => {
                notificationService.success(_(`customer.remove-customers-from-group-success`), {
                    customerCount: customerIds.length,
                    groupName: group.name,
                });
                clearSelection();
                hostComponent.refresh();
            },
        });
    },
};
