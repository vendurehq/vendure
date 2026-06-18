import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateTaxCategoryInput,
    DataService,
    getCustomFieldsDefaults,
    GetTaxCategoryDetailDocument,
    LanguageCode,
    NotificationService,
    Permission,
    TAX_CATEGORY_FRAGMENT,
    TaxCategoryFragment,
    TypedBaseDetailComponent,
    UpdateTaxCategoryInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { mergeMap, take } from 'rxjs/operators';

export const GET_TAX_CATEGORY_DETAIL = gql`
    query GetTaxCategoryDetail($id: ID!) {
        taxCategory(id: $id) {
            ...TaxCategory
        }
    }
    ${TAX_CATEGORY_FRAGMENT}
`;

@Component({
    selector: 'vdr-tax-detail',
    templateUrl: './tax-category-detail.component.html',
    styleUrls: ['./tax-category-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class TaxCategoryDetailComponent
    extends TypedBaseDetailComponent<typeof GetTaxCategoryDetailDocument, 'taxCategory'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('TaxCategory');
    detailForm = this.formBuilder.group({
        name: ['', Validators.required],
        isDefault: false,
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    readonly updatePermission = [Permission.UpdateSettings, Permission.UpdateTaxCategory];

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

    saveButtonEnabled(): boolean {
        return this.detailForm.dirty && this.detailForm.valid;
    }

    create() {
        if (!this.detailForm.dirty) {
            return;
        }
        const formValue = this.detailForm.value;
        const input = {
            name: formValue.name,
            isDefault: formValue.isDefault,
            customFields: formValue.customFields,
        } as CreateTaxCategoryInput;
        this.dataService.settings.createTaxCategory(input).subscribe(
            data => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'TaxCategory',
                });
                this.detailForm.markAsPristine();
                this.changeDetector.markForCheck();
                this.router.navigate(['../', data.createTaxCategory.id], { relativeTo: this.route });
            },
            err => {
                this.notificationService.error(_('common.notify-create-error'), {
                    entity: 'TaxCategory',
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
                mergeMap(taxCategory => {
                    const input = {
                        id: taxCategory.id,
                        name: formValue.name,
                        isDefault: formValue.isDefault,
                        customFields: formValue.customFields,
                    } as UpdateTaxCategoryInput;
                    return this.dataService.settings.updateTaxCategory(input);
                }),
            )
            .subscribe(
                data => {
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'TaxCategory',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'TaxCategory',
                    });
                },
            );
    }

    /**
     * Update the form values when the entity changes.
     */
    protected setFormValues(entity: TaxCategoryFragment, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            name: entity.name,
            isDefault: entity.isDefault,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get('customFields'), entity);
        }
    }
}
