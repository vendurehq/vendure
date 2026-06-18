import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { DefaultFormComponentConfig, DefaultFormComponentId } from '@vendure/common/lib/shared-types';
import { Observable } from 'rxjs';
import { startWith } from 'rxjs/operators';

import { ItemOf } from '../../../common/base-list.component';
import { FormInputComponent } from '../../../common/component-registry-types';
import { GetCustomerGroupsQuery } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';

/**
 * @description
 * Allows the selection of a Customer via an autocomplete select input.
 * Should be used with `ID` type fields which represent Customer IDs.
 *
 * @docsCategory custom-input-components
 * @docsPage default-inputs
 */
@Component({
    selector: 'vdr-customer-group-form-input',
    templateUrl: './customer-group-form-input.component.html',
    styleUrls: ['./customer-group-form-input.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerGroupFormInputComponent implements FormInputComponent, OnInit {
    static readonly id: DefaultFormComponentId = 'customer-group-form-input';
    @Input() readonly: boolean;
    formControl: FormControl<string | { id: string }>;
    customerGroups$: Observable<GetCustomerGroupsQuery['customerGroups']['items']>;
    config: DefaultFormComponentConfig<'customer-group-form-input'>;

    constructor(private dataService: DataService) {}

    ngOnInit() {
        this.customerGroups$ = this.dataService.customer
            .getCustomerGroupList({
                take: 1000,
            })
            .mapSingle(res => res.customerGroups.items)
            .pipe(startWith([]));
    }

    selectGroup(group: ItemOf<GetCustomerGroupsQuery, 'customerGroups'>) {
        this.formControl.setValue(group?.id ?? undefined);
    }

    compareWith<T extends ItemOf<GetCustomerGroupsQuery, 'customerGroups'> | string>(o1: T, o2: T) {
        const id1 = typeof o1 === 'string' ? o1 : o1.id;
        const id2 = typeof o2 === 'string' ? o2 : o2.id;
        return id1 === id2;
    }
}
