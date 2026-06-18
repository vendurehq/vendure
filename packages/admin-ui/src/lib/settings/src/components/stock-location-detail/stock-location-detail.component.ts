import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateStockLocationDocument,
    CreateStockLocationInput,
    DataService,
    getCustomFieldsDefaults,
    GetStockLocationDetailDocument,
    NotificationService,
    StockLocationDetailFragment,
    TypedBaseDetailComponent,
    UpdateStockLocationDocument,
    UpdateStockLocationInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { mergeMap, take } from 'rxjs/operators';

const STOCK_LOCATION_DETAIL_FRAGMENT = gql`
    fragment StockLocationDetail on StockLocation {
        id
        createdAt
        updatedAt
        name
        description
    }
`;

export const GET_STOCK_LOCATION_DETAIL = gql`
    query GetStockLocationDetail($id: ID!) {
        stockLocation(id: $id) {
            ...StockLocationDetail
        }
    }
    ${STOCK_LOCATION_DETAIL_FRAGMENT}
`;

export const CREATE_STOCK_LOCATION = gql`
    mutation CreateStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            ...StockLocationDetail
        }
    }
    ${STOCK_LOCATION_DETAIL_FRAGMENT}
`;

export const UPDATE_STOCK_LOCATION = gql`
    mutation UpdateStockLocation($input: UpdateStockLocationInput!) {
        updateStockLocation(input: $input) {
            ...StockLocationDetail
        }
    }
    ${STOCK_LOCATION_DETAIL_FRAGMENT}
`;

@Component({
    selector: 'vdr-stock-location-detail',
    templateUrl: './stock-location-detail.component.html',
    styleUrls: ['./stock-location-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class StockLocationDetailComponent
    extends TypedBaseDetailComponent<typeof GetStockLocationDetailDocument, 'stockLocation'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('StockLocation');
    detailForm = this.formBuilder.group({
        name: ['', Validators.required],
        description: [''],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });

    constructor(
        private changeDetector: ChangeDetectorRef,
        protected dataService: DataService,
        private formBuilder: FormBuilder,
        private notificationService: NotificationService,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
    }

    ngOnDestroy() {
        this.destroy();
    }

    create() {
        if (!this.detailForm.dirty) {
            return;
        }
        const { name, description, customFields } = this.detailForm.value;
        if (!name) {
            return;
        }
        const input = {
            name,
            description,
            customFields,
        } satisfies CreateStockLocationInput;
        this.dataService.mutate(CreateStockLocationDocument, { input }).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'StockLocation',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createStockLocation.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'StockLocation',
                });
            },
        );
    }

    save() {
        if (!this.detailForm.dirty) {
            return;
        }
        const formValue = this.detailForm.value;
        this.entity$
            .pipe(
                take(1),
                mergeMap(taxRate => {
                    const input = {
                        id: taxRate.id,
                        name: formValue.name,
                        description: formValue.description,
                        customFields: formValue.customFields,
                    } satisfies UpdateStockLocationInput;
                    return this.dataService.mutate(UpdateStockLocationDocument, { input });
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'StockLocation',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'StockLocation',
                    });
                },
            );
    }

    /**
     * Update the form values when the entity changes.
     */
    protected setFormValues(entity: StockLocationDetailFragment): void {
        this.detailForm.patchValue({
            name: entity.name,
            description: entity.description,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get('customFields'), entity);
        }
    }
}
