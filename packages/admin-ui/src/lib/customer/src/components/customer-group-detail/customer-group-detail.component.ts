import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { ResultOf } from '@graphql-typed-document-node/core';
import {
    DataService,
    GetCustomerGroupDetailDocument,
    getCustomFieldsDefaults,
    ModalService,
    NotificationService,
    TypedBaseDetailComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const CUSTOMER_GROUP_DETAIL_QUERY = gql`
    query GetCustomerGroupDetail($id: ID!) {
        customerGroup(id: $id) {
            ...CustomerGroupDetail
        }
    }
    fragment CustomerGroupDetail on CustomerGroup {
        id
        createdAt
        updatedAt
        name
    }
`;

@Component({
    selector: 'vdr-customer-group-detail',
    templateUrl: './customer-group-detail.component.html',
    styleUrls: ['./customer-group-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class CustomerGroupDetailComponent
    extends TypedBaseDetailComponent<typeof GetCustomerGroupDetailDocument, 'customerGroup'>
    implements OnInit
{
    customFields = this.getCustomFieldConfig('CustomerGroup');
    detailForm = this.formBuilder.group({
        name: '',
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });

    constructor(
        private formBuilder: FormBuilder,
        protected dataService: DataService,
        private modalService: ModalService,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit() {
        super.init();
    }

    create() {
        const formvalue = this.detailForm.value;
        if (formvalue.name) {
            this.dataService.customer
                .createCustomerGroup({
                    name: formvalue.name,
                    customFields: formvalue.customFields,
                    customerIds: [],
                })
                .subscribe(
                    ({ createCustomerGroup }) => {
                        this.notificationService.success(_('common.notify-create-success'), {
                            entity: 'CustomerGroup',
                        });
                        this.detailForm.markAsPristine();
                        this.router.navigate(['../', createCustomerGroup.id], { relativeTo: this.route });
                    },
                    err => {
                        this.notificationService.error(_('common.notify-create-error'), {
                            entity: 'CustomerGroup',
                        });
                    },
                );
        }
    }

    save() {
        const formValue = this.detailForm.value;
        this.dataService.customer.updateCustomerGroup({ id: this.id, ...formValue }).subscribe(
            () => {
                this.notificationService.success(_('common.notify-update-success'), {
                    entity: 'CustomerGroup',
                });
                this.detailForm.markAsPristine();
            },
            err => {
                this.notificationService.error(_('common.notify-update-error'), {
                    entity: 'CustomerGroup',
                });
            },
        );
    }

    protected setFormValues(
        entity: NonNullable<ResultOf<typeof GetCustomerGroupDetailDocument>['customerGroup']>,
    ) {
        this.detailForm.patchValue({
            name: entity.name,
        });

        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get('customFields'), entity);
        }
    }
}
