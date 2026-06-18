import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateTaxRateInput,
    CustomerGroup,
    DataService,
    getCustomFieldsDefaults,
    GetTaxRateDetailDocument,
    LanguageCode,
    NotificationService,
    Permission,
    TAX_RATE_FRAGMENT,
    TaxCategoryFragment,
    TaxRateFragment,
    TypedBaseDetailComponent,
    UpdateTaxRateInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';
import { mergeMap, take } from 'rxjs/operators';

export const GET_TAX_RATE_DETAIL = gql`
    query GetTaxRateDetail($id: ID!) {
        taxRate(id: $id) {
            ...TaxRate
        }
    }
    ${TAX_RATE_FRAGMENT}
`;

@Component({
    selector: 'vdr-tax-rate-detail',
    templateUrl: './tax-rate-detail.component.html',
    styleUrls: ['./tax-rate-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class TaxRateDetailComponent
    extends TypedBaseDetailComponent<typeof GetTaxRateDetailDocument, 'taxRate'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('TaxRate');
    detailForm = this.formBuilder.group({
        name: ['', Validators.required],
        enabled: [true],
        value: [0, Validators.required],
        taxCategoryId: ['', Validators.required],
        zoneId: ['', Validators.required],
        customerGroupId: [''],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    taxCategories$: Observable<TaxCategoryFragment[]>;
    groups$: Observable<CustomerGroup[]>;
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdateTaxRate];

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
        this.taxCategories$ = this.dataService.settings
            .getTaxCategories({ take: 100 })
            .mapSingle(data => data.taxCategories.items);
    }

    ngOnDestroy() {
        this.destroy();
    }

    saveButtonEnabled(): boolean {
        return this.detailForm.dirty && this.detailForm.valid;
    }

    create() {
        if (!this.detailForm.dirty) {
            return;
        }
        const { name, enabled, value, taxCategoryId, zoneId, customFields, customerGroupId } =
            this.detailForm.value;
        if (!name || enabled == null || value == null || !taxCategoryId || !zoneId) {
            return;
        }
        const input = {
            name,
            enabled,
            value,
            categoryId: taxCategoryId,
            zoneId,
            customerGroupId,
            customFields,
        } satisfies CreateTaxRateInput;
        this.dataService.settings.createTaxRate(input).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'TaxRate',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createTaxRate.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'TaxRate',
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
                        enabled: formValue.enabled,
                        value: formValue.value,
                        categoryId: formValue.taxCategoryId,
                        zoneId: formValue.zoneId,
                        customerGroupId: formValue.customerGroupId,
                        customFields: formValue.customFields,
                    } satisfies UpdateTaxRateInput;
                    return this.dataService.settings.updateTaxRate(input);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'TaxRate',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'TaxRate',
                    });
                },
            );
    }

    /**
     * Update the form values when the entity changes.
     */
    protected setFormValues(entity: TaxRateFragment, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            name: entity.name,
            enabled: entity.enabled,
            value: entity.value,
            taxCategoryId: entity.category ? entity.category.id : '',
            zoneId: entity.zone ? entity.zone.id : '',
            customerGroupId: entity.customerGroup ? entity.customerGroup.id : '',
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get('customFields'), entity);
        }
    }
}
