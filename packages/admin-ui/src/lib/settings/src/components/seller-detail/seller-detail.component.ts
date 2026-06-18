import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CreateSellerInput,
    DataService,
    getCustomFieldsDefaults,
    GetSellerDetailDocument,
    LanguageCode,
    NotificationService,
    Permission,
    SellerFragment,
    TypedBaseDetailComponent,
    UpdateSellerInput,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { mergeMap, take } from 'rxjs/operators';

export const GET_SELLER_DETAIL = gql`
    query GetSellerDetail($id: ID!) {
        seller(id: $id) {
            ...SellerDetail
        }
    }
    fragment SellerDetail on Seller {
        id
        createdAt
        updatedAt
        name
    }
`;

@Component({
    selector: 'vdr-seller-detail',
    templateUrl: './seller-detail.component.html',
    styleUrls: ['./seller-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SellerDetailComponent
    extends TypedBaseDetailComponent<typeof GetSellerDetailDocument, 'seller'>
    implements OnInit, OnDestroy
{
    customFields = this.getCustomFieldConfig('Seller');
    detailForm = this.formBuilder.group({
        name: ['', Validators.required],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    readonly updatePermission = [Permission.SuperAdmin, Permission.UpdateSeller, Permission.CreateSeller];

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
        if (!formValue.name) {
            return;
        }
        const input: CreateSellerInput = {
            name: formValue.name,
            customFields: formValue.customFields,
        };
        this.dataService.settings.createSeller(input).subscribe(data => {
            switch (data.createSeller.__typename) {
                case 'Seller':
                    this.notificationService.success(_('common.notify-create-success'), {
                        entity: 'Seller',
                    });
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                    this.router.navigate(['../', data.createSeller.id], { relativeTo: this.route });
                    break;
            }
        });
    }

    save() {
        if (!this.detailForm.dirty) {
            return;
        }
        const formValue = this.detailForm.value;
        this.entity$
            .pipe(
                take(1),
                mergeMap(seller => {
                    const input = {
                        id: seller.id,
                        name: formValue.name,
                        customFields: formValue.customFields,
                    } as UpdateSellerInput;
                    return this.dataService.settings.updateSeller(input);
                }),
            )
            .subscribe(({ updateSeller }) => {
                switch (updateSeller.__typename) {
                    case 'Seller':
                        this.notificationService.success(_('common.notify-update-success'), {
                            entity: 'Seller',
                        });
                        this.detailForm.markAsPristine();
                        this.changeDetector.markForCheck();
                        break;
                    // case 'LanguageNotAvailableError':
                    //     this.notificationService.error(updateSeller.message);
                }
            });
    }

    /**
     * Update the form values when the entity changes.
     */
    protected setFormValues(entity: SellerFragment, languageCode: LanguageCode): void {
        this.detailForm.patchValue({
            name: entity.name,
        });
        if (this.customFields.length) {
            this.setCustomFieldFormValues(this.customFields, this.detailForm.get(['customFields']), entity);
        }
    }
}
