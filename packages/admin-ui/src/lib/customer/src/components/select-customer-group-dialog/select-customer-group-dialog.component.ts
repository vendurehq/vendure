import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { DataService, Dialog, GetCustomerGroupsQuery, ItemOf } from '@vendure/admin-ui/core';
import { Observable } from 'rxjs';

@Component({
    selector: 'vdr-select-customer-group-dialog',
    templateUrl: './select-customer-group-dialog.component.html',
    styleUrls: ['./select-customer-group-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class SelectCustomerGroupDialogComponent implements Dialog<string[]>, OnInit {
    resolveWith: (result?: string[]) => void;
    groups$: Observable<Array<ItemOf<GetCustomerGroupsQuery, 'customerGroups'>>>;
    selectedGroupIds: string[] = [];

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.groups$ = this.dataService.customer
            .getCustomerGroupList()
            .mapStream(res => res.customerGroups.items);
    }

    cancel() {
        this.resolveWith();
    }

    add() {
        this.resolveWith(this.selectedGroupIds);
    }
}
