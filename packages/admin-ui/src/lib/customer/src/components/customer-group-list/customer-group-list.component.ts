import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CUSTOMER_GROUP_FRAGMENT,
    DataService,
    GetCustomerGroupListDocument,
    GetCustomerGroupsQuery,
    GetCustomerGroupWithCustomersQuery,
    ItemOf,
    ModalService,
    NotificationService,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { BehaviorSubject, combineLatest, EMPTY, Observable, of } from 'rxjs';
import { distinctUntilChanged, map, mapTo, switchMap } from 'rxjs/operators';

import { AddCustomerToGroupDialogComponent } from '../add-customer-to-group-dialog/add-customer-to-group-dialog.component';
import { CustomerGroupMemberFetchParams } from '../customer-group-member-list/customer-group-member-list.component';

export const GET_CUSTOMER_GROUP_LIST = gql`
    query GetCustomerGroupList($options: CustomerGroupListOptions) {
        customerGroups(options: $options) {
            items {
                ...CustomerGroup
            }
            totalItems
        }
    }
    ${CUSTOMER_GROUP_FRAGMENT}
`;

@Component({
    selector: 'vdr-customer-group-list',
    templateUrl: './customer-group-list.component.html',
    styleUrls: ['./customer-group-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerGroupListComponent
    extends TypedBaseListComponent<typeof GetCustomerGroupListDocument, 'customerGroups'>
    implements OnInit
{
    dataTableListId = 'customer-group-list';
    readonly customFields = this.getCustomFieldConfig('CustomerGroup');
    activeGroup$: Observable<ItemOf<GetCustomerGroupsQuery, 'customerGroups'> | undefined>;
    activeIndex$: Observable<number>;
    listIsEmpty$: Observable<boolean>;
    members$: Observable<
        NonNullable<GetCustomerGroupWithCustomersQuery['customerGroup']>['customers']['items']
    >;
    membersTotal$: Observable<number>;
    fetchGroupMembers$ = new BehaviorSubject<CustomerGroupMemberFetchParams>({
        skip: 0,
        take: 0,
        filterTerm: '',
    });
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'name',
            type: { kind: 'text' },
            label: _('common.name'),
            filterField: 'name',
        })
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'name' })
        .connectToRoute(this.route);
    private refreshActiveGroupMembers$ = new BehaviorSubject<void>(undefined);

    constructor(
        protected dataService: DataService,
        private notificationService: NotificationService,
        private modalService: ModalService,
        public route: ActivatedRoute,
        protected router: Router,
    ) {
        super();
        super.configure({
            document: GetCustomerGroupListDocument,
            getItems: data => data.customerGroups,
            setVariables: (skip, take) => ({
                options: {
                    skip,
                    take,
                    filter: {
                        name: { contains: this.searchTermControl.value },
                        ...this.filters.createFilterInput(),
                    },
                    sort: this.sorts.createSortInput(),
                },
            }),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    ngOnInit(): void {
        super.ngOnInit();
        const activeGroupId$ = this.route.paramMap.pipe(
            map(pm => pm.get('contents')),
            distinctUntilChanged(),
        );
        this.listIsEmpty$ = this.items$.pipe(map(groups => groups.length === 0));
        this.activeGroup$ = combineLatest(this.items$, activeGroupId$).pipe(
            map(([groups, activeGroupId]) => {
                if (activeGroupId) {
                    return groups.find(g => g.id === activeGroupId);
                }
            }),
        );
        this.activeIndex$ = combineLatest(this.items$, activeGroupId$).pipe(
            map(([groups, activeGroupId]) => {
                if (activeGroupId) {
                    return groups.findIndex(g => g.id === activeGroupId);
                } else {
                    return -1;
                }
            }),
        );
        const membersResult$ = combineLatest(
            this.activeGroup$,
            this.fetchGroupMembers$,
            this.refreshActiveGroupMembers$,
        ).pipe(
            switchMap(([activeGroup, { skip, take, filterTerm }]) => {
                if (activeGroup) {
                    return this.dataService.customer
                        .getCustomerGroupWithCustomers(activeGroup.id, {
                            skip,
                            take,
                            filter: {
                                emailAddress: {
                                    contains: filterTerm,
                                },
                            },
                        })
                        .mapStream(res => res.customerGroup?.customers);
                } else {
                    return of(undefined);
                }
            }),
        );

        this.members$ = membersResult$.pipe(map(res => res?.items ?? []));
        this.membersTotal$ = membersResult$.pipe(map(res => res?.totalItems ?? 0));
    }

    closeMembers() {
        const params = { ...this.route.snapshot.params };
        delete params.contents;
        this.router.navigate(['./', params], { relativeTo: this.route, queryParamsHandling: 'preserve' });
    }

    addToGroup(group: NonNullable<GetCustomerGroupWithCustomersQuery['customerGroup']>) {
        this.modalService
            .fromComponent(AddCustomerToGroupDialogComponent, {
                locals: {
                    group,
                    route: this.route,
                },
                size: 'md',
                verticalAlign: 'top',
            })
            .pipe(
                switchMap(customerIds =>
                    customerIds
                        ? this.dataService.customer
                              .addCustomersToGroup(group.id, customerIds)
                              .pipe(mapTo(customerIds))
                        : EMPTY,
                ),
            )
            .subscribe({
                next: result => {
                    this.notificationService.success(_(`customer.add-customers-to-group-success`), {
                        customerCount: result.length,
                        groupName: group.name,
                    });
                    this.refreshActiveGroupMembers$.next();
                },
            });
    }
}
