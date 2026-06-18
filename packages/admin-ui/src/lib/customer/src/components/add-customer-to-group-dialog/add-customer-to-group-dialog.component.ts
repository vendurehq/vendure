import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import {
    DataService,
    Dialog,
    GetCustomerGroupsQuery,
    GetCustomerListQuery,
    ItemOf,
} from '@vendure/admin-ui/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';

import { CustomerGroupMemberFetchParams } from '../customer-group-member-list/customer-group-member-list.component';

@Component({
    selector: 'vdr-add-customer-to-group-dialog',
    templateUrl: './add-customer-to-group-dialog.component.html',
    styleUrls: ['./add-customer-to-group-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AddCustomerToGroupDialogComponent implements Dialog<string[]>, OnInit {
    resolveWith: (result?: string[]) => void;
    group: ItemOf<GetCustomerGroupsQuery, 'customerGroups'>;
    route: ActivatedRoute;
    selectedCustomerIds: string[] = [];
    customers$: Observable<GetCustomerListQuery['customers']['items']>;
    customersTotal$: Observable<number>;
    fetchGroupMembers$ = new BehaviorSubject<CustomerGroupMemberFetchParams>({
        skip: 0,
        take: 10,
        filterTerm: '',
    });

    constructor(private dataService: DataService) {}

    ngOnInit() {
        const customerResult$ = this.fetchGroupMembers$.pipe(
            switchMap(({ skip, take, filterTerm }) =>
                this.dataService.customer
                    .getCustomerList(take, skip, filterTerm)
                    .mapStream(res => res.customers),
            ),
        );

        this.customers$ = customerResult$.pipe(map(res => res.items));
        this.customersTotal$ = customerResult$.pipe(map(res => res.totalItems));
    }

    cancel() {
        this.resolveWith();
    }

    add() {
        this.resolveWith(this.selectedCustomerIds);
    }
}
