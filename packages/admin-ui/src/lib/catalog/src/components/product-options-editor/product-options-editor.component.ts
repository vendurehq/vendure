import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { UntypedFormArray, UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    BaseDetailComponent,
    createUpdatedTranslatable,
    CustomFieldConfig,
    DataService,
    findTranslation,
    GetProductVariantOptionsQuery,
    LanguageCode,
    NotificationService,
    Permission,
    PermissionsService,
    ProductOptionFragment,
    ProductOptionGroupFragment,
    ServerConfigService,
    TranslationOf,
    UpdateProductOptionGroupInput,
    UpdateProductOptionInput,
} from '@vendure/admin-ui/core';
import { combineLatest, forkJoin, Observable } from 'rxjs';
import { map, mergeMap, take, tap } from 'rxjs/operators';

import { ProductDetailService } from '../../providers/product-detail/product-detail.service';

type ProductWithOptions = NonNullable<GetProductVariantOptionsQuery['product']>;

@Component({
    selector: 'vdr-product-options-editor',
    templateUrl: './product-options-editor.component.html',
    styleUrls: ['./product-options-editor.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProductOptionsEditorComponent extends BaseDetailComponent<ProductWithOptions> implements OnInit {
    detailForm: UntypedFormGroup;
    optionGroups$: Observable<ProductWithOptions['optionGroups']>;
    languageCode$: Observable<LanguageCode>;
    availableLanguages$: Observable<LanguageCode[]>;
    optionGroupCustomFields: CustomFieldConfig[];
    optionCustomFields: CustomFieldConfig[];
    autoUpdateVariantNames = true;
    paginationSettings: { [groupId: string]: { currentPage: number; itemsPerPage: number } } = {};
    readonly updatePermission = [Permission.UpdateCatalog, Permission.UpdateProduct];

    constructor(
        protected route: ActivatedRoute,
        protected router: Router,
        protected serverConfigService: ServerConfigService,
        protected dataService: DataService,
        protected permissionsService: PermissionsService,
        private productDetailService: ProductDetailService,
        private formBuilder: UntypedFormBuilder,
        private changeDetector: ChangeDetectorRef,
        private notificationService: NotificationService,
    ) {
        super(route, router, serverConfigService, dataService, permissionsService);
        this.optionGroupCustomFields = this.getCustomFieldConfig('ProductOptionGroup');
        this.optionCustomFields = this.getCustomFieldConfig('ProductOption');
    }

    ngOnInit(): void {
        this.optionGroups$ = this.route.snapshot.data.entity.pipe(
            map((product: ProductWithOptions) => product.optionGroups),
            tap((optionGroups: ProductWithOptions['optionGroups']) => {
                for (const group of optionGroups) {
                    this.paginationSettings[group.id] = {
                        currentPage: 1,
                        itemsPerPage: 10,
                    };
                }
            }),
        );
        this.detailForm = new UntypedFormGroup({
            optionGroups: new UntypedFormArray([]),
        });
        super.init();
    }

    getOptionGroups(): UntypedFormGroup[] {
        const optionGroups = this.detailForm.get('optionGroups');
        return (optionGroups as UntypedFormArray).controls as UntypedFormGroup[];
    }

    getOptions(optionGroup: UntypedFormGroup): UntypedFormGroup[] {
        const options = optionGroup.get('options');
        return (options as UntypedFormArray).controls as UntypedFormGroup[];
    }

    save() {
        if (this.detailForm.invalid || this.detailForm.pristine) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const $product = this.dataService.product.getProduct(this.id).mapSingle(data => data.product!);
        combineLatest(this.entity$, this.languageCode$, $product)
            .pipe(
                take(1),
                mergeMap(([{ optionGroups }, languageCode, product]) => {
                    const updateOperations: Array<Observable<any>> = [];
                    const updatedProductOptionInputs: UpdateProductOptionInput[] = [];
                    for (const optionGroupForm of this.getOptionGroups()) {
                        if (optionGroupForm.dirty) {
                            const optionGroupEntity = optionGroups.find(
                                og => og.id === optionGroupForm.value.id,
                            );
                            if (optionGroupEntity) {
                                const input = this.getUpdatedOptionGroup(
                                    optionGroupEntity,
                                    optionGroupForm,
                                    languageCode,
                                );
                                updateOperations.push(
                                    this.dataService.product.updateProductOptionGroup(input),
                                );
                            }
                        }

                        for (const optionForm of this.getOptions(optionGroupForm)) {
                            if (optionForm.dirty) {
                                const optionGroup = optionGroups
                                    .find(og => og.id === optionGroupForm.value.id)
                                    ?.options.find(o => o.id === optionForm.value.id);
                                if (optionGroup) {
                                    const input = this.getUpdatedOption(
                                        optionGroup,
                                        optionForm,
                                        languageCode,
                                    );
                                    updatedProductOptionInputs.push(input);
                                }
                            }
                        }
                    }
                    if (updatedProductOptionInputs.length) {
                        updateOperations.push(
                            this.productDetailService.updateProductOptions(
                                updatedProductOptionInputs,
                                this.autoUpdateVariantNames,
                                product,
                                languageCode,
                            ),
                        );
                    }
                    return forkJoin(updateOperations);
                }),
            )
            .subscribe(
                () => {
                    this.detailForm.markAsPristine();
                    this.changeDetector.markForCheck();
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'ProductOptionGroup',
                    });
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'ProductOptionGroup',
                    });
                },
            );
    }

    private getUpdatedOptionGroup(
        optionGroup: ProductOptionGroupFragment,
        optionGroupFormGroup: UntypedFormGroup,
        languageCode: LanguageCode,
    ): UpdateProductOptionGroupInput {
        const input = createUpdatedTranslatable({
            translatable: optionGroup,
            updatedFields: optionGroupFormGroup.value,
            customFieldConfig: this.optionGroupCustomFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: optionGroup.name || '',
            },
        });
        return input;
    }

    private getUpdatedOption(
        option: ProductOptionFragment,
        optionFormGroup: UntypedFormGroup,
        languageCode: LanguageCode,
    ): UpdateProductOptionInput {
        const input = createUpdatedTranslatable({
            translatable: option,
            updatedFields: optionFormGroup.value,
            customFieldConfig: this.optionCustomFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: option.name || '',
            },
        });
        return input;
    }

    protected setFormValues(entity: ProductWithOptions, languageCode: LanguageCode): void {
        const groupsForm = this.detailForm.get('optionGroups') as UntypedFormArray;
        for (const optionGroup of entity.optionGroups) {
            const groupTranslation = findTranslation(optionGroup, languageCode);

            const groupForm = this.setOptionGroupForm(optionGroup, groupsForm, groupTranslation);
            this.setCustomFieldsForm(this.optionGroupCustomFields, groupForm, optionGroup, groupTranslation);

            let optionsForm = groupForm.get('options') as UntypedFormArray;
            if (!optionsForm) {
                optionsForm = this.formBuilder.array([]);
                groupForm.addControl('options', optionsForm);
            }
            for (const option of optionGroup.options) {
                const optionTranslation = findTranslation(option, languageCode);
                const optionForm = this.setOptionForm(option, optionsForm, optionTranslation);

                this.setCustomFieldsForm(this.optionCustomFields, optionForm, option, optionTranslation);
            }
        }
    }

    protected setCustomFieldsForm<
        T extends ProductWithOptions['optionGroups'][0] | ProductWithOptions['optionGroups'][0]['options'][0],
    >(
        customFields: CustomFieldConfig[],
        formGroup: UntypedFormGroup,
        entity: T,
        currentTranslation?: TranslationOf<T>,
    ) {
        if (customFields.length) {
            let customValueFieldsGroup = formGroup.get(['customFields']);
            if (!customValueFieldsGroup) {
                customValueFieldsGroup = this.formBuilder.group(
                    customFields.reduce((hash, field) => ({ ...hash, [field.name]: '' }), {}),
                );
                formGroup.addControl('customFields', customValueFieldsGroup);
            }
            this.setCustomFieldFormValues(customFields, customValueFieldsGroup, entity, currentTranslation);
        }
    }

    protected setOptionGroupForm(
        entity: ProductWithOptions['optionGroups'][0],
        groupsForm: UntypedFormArray,
        currentTranslation?: TranslationOf<ProductWithOptions['optionGroups'][0]>,
    ) {
        const group = {
            id: entity.id,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            code: entity.code,
            name: currentTranslation?.name ?? '',
        };
        let groupForm = groupsForm.controls.find(control => control.value.id === entity.id) as
            | UntypedFormGroup
            | undefined;
        if (groupForm) {
            groupForm.get('id')?.setValue(group.id);
            groupForm.get('code')?.setValue(group.code);
            groupForm.get('name')?.setValue(group.name);
            groupForm.get('createdAt')?.setValue(group.createdAt);
            groupForm.get('updatedAt')?.setValue(group.updatedAt);
        } else {
            groupForm = this.formBuilder.group(group);
            groupsForm.push(groupForm);
        }
        return groupForm;
    }

    protected setOptionForm(
        entity: ProductWithOptions['optionGroups'][0]['options'][0],
        optionsForm: UntypedFormArray,
        currentTranslation?: TranslationOf<ProductWithOptions['optionGroups'][0]['options'][0]>,
    ) {
        const group = {
            id: entity.id,
            createdAt: entity.createdAt,
            updatedAt: entity.updatedAt,
            code: entity.code,
            name: currentTranslation?.name ?? '',
        };
        let optionForm = optionsForm.controls.find(control => control.value.id === entity.id) as
            | UntypedFormGroup
            | undefined;
        if (optionForm) {
            optionForm.get('id')?.setValue(group.id);
            optionForm.get('code')?.setValue(group.code);
            optionForm.get('name')?.setValue(group.name);
            optionForm.get('createdAt')?.setValue(group.createdAt);
            optionForm.get('updatedAt')?.setValue(group.updatedAt);
        } else {
            optionForm = this.formBuilder.group(group);
            optionsForm.push(optionForm);
        }
        return optionForm;
    }
}
