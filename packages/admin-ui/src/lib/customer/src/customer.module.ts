import { NgModule } from '@angular/core';
import { RouterModule, ROUTES } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BulkActionRegistryService,
    CustomerDetailQueryDocument,
    detailComponentWithResolver,
    GetCustomerGroupDetailDocument,
    PageService,
    SharedModule,
    SortOrder,
} from '@vendure/admin-ui/core';

import { AddCustomerToGroupDialogComponent } from './components/add-customer-to-group-dialog/add-customer-to-group-dialog.component';
import { AddressCardComponent } from './components/address-card/address-card.component';
import { AddressDetailDialogComponent } from './components/address-detail-dialog/address-detail-dialog.component';
import { CustomerDetailComponent } from './components/customer-detail/customer-detail.component';
import { CustomerGroupDetailDialogComponent } from './components/customer-group-detail-dialog/customer-group-detail-dialog.component';
import { deleteCustomerGroupsBulkAction } from './components/customer-group-list/customer-group-list-bulk-actions';
import { CustomerGroupListComponent } from './components/customer-group-list/customer-group-list.component';
import { removeCustomerGroupMembersBulkAction } from './components/customer-group-member-list/customer-group-member-list-bulk-actions';
import { CustomerGroupMemberListComponent } from './components/customer-group-member-list/customer-group-member-list.component';
import { CustomerHistoryEntryHostComponent } from './components/customer-history/customer-history-entry-host.component';
import { CustomerHistoryComponent } from './components/customer-history/customer-history.component';
import { deleteCustomersBulkAction } from './components/customer-list/customer-list-bulk-actions';
import { CustomerListComponent } from './components/customer-list/customer-list.component';
import { CustomerStatusLabelComponent } from './components/customer-status-label/customer-status-label.component';
import { SelectCustomerGroupDialogComponent } from './components/select-customer-group-dialog/select-customer-group-dialog.component';
import { createRoutes } from './customer.routes';
import { CustomerGroupDetailComponent } from './components/customer-group-detail/customer-group-detail.component';

@NgModule({
    imports: [SharedModule, RouterModule.forChild([])],
    providers: [
        {
            provide: ROUTES,
            useFactory: (pageService: PageService) => createRoutes(pageService),
            multi: true,
            deps: [PageService],
        },
    ],
    declarations: [
        CustomerListComponent,
        CustomerDetailComponent,
        CustomerStatusLabelComponent,
        AddressCardComponent,
        CustomerGroupListComponent,
        CustomerGroupDetailDialogComponent,
        AddCustomerToGroupDialogComponent,
        CustomerGroupMemberListComponent,
        SelectCustomerGroupDialogComponent,
        CustomerHistoryComponent,
        AddressDetailDialogComponent,
        CustomerHistoryEntryHostComponent,
        CustomerGroupDetailComponent,
    ],
    exports: [AddressCardComponent],
})
export class CustomerModule {
    private static hasRegisteredTabsAndBulkActions = false;

    constructor(bulkActionRegistryService: BulkActionRegistryService, pageService: PageService) {
        if (CustomerModule.hasRegisteredTabsAndBulkActions) {
            return;
        }
        bulkActionRegistryService.registerBulkAction(deleteCustomersBulkAction);
        bulkActionRegistryService.registerBulkAction(deleteCustomerGroupsBulkAction);
        bulkActionRegistryService.registerBulkAction(removeCustomerGroupMembersBulkAction);

        pageService.registerPageTab({
            priority: 0,
            location: 'customer-list',
            tab: _('customer.customers'),
            route: '',
            component: CustomerListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'customer-detail',
            tab: _('customer.customer'),
            route: '',
            component: detailComponentWithResolver({
                component: CustomerDetailComponent,
                query: CustomerDetailQueryDocument,
                entityKey: 'customer',
                variables: {
                    orderListOptions: {
                        sort: {
                            orderPlacedAt: SortOrder.DESC,
                        },
                    },
                },
                getBreadcrumbs: entity => [
                    {
                        label: entity
                            ? `${entity?.firstName} ${entity?.lastName}`
                            : _('customer.create-new-customer'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'customer-group-list',
            tab: _('customer.customer-groups'),
            route: '',
            component: CustomerGroupListComponent,
        });
        pageService.registerPageTab({
            priority: 0,
            location: 'customer-group-detail',
            tab: _('customer.customer-group'),
            route: '',
            component: detailComponentWithResolver({
                component: CustomerGroupDetailComponent,
                query: GetCustomerGroupDetailDocument,
                entityKey: 'customerGroup',
                getBreadcrumbs: entity => [
                    {
                        label: entity ? entity.name : _('customer.create-new-customer-group'),
                        link: [entity?.id],
                    },
                ],
            }),
        });
        CustomerModule.hasRegisteredTabsAndBulkActions = true;
    }
}
