import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    CurrencyCode,
    DataService,
    DeactivateAware,
    DeletionResult,
    getDefaultUiLanguage,
    GetProductVariantOptionsQuery,
    LanguageCode,
    ModalService,
    NotificationService,
    SelectionManager,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { unique } from '@vendure/common/lib/unique';
import { EMPTY, Observable, Subject } from 'rxjs';
import { map, startWith, switchMap } from 'rxjs/operators';

import { ProductDetailService } from '../../providers/product-detail/product-detail.service';
import { CreateProductOptionGroupDialogComponent } from '../create-product-option-group-dialog/create-product-option-group-dialog.component';
import { CreateProductVariantDialogComponent } from '../create-product-variant-dialog/create-product-variant-dialog.component';

export class GeneratedVariant {
    isDefault: boolean;
    options: Array<{ name: string; id?: string }>;
    productVariantId?: string;
    enabled: boolean;
    existing: boolean;
    sku: string;
    price: number;
    stock: number;

    constructor(config: Partial<GeneratedVariant>) {
        for (const key of Object.keys(config)) {
            this[key] = config[key];
        }
    }
}

interface OptionGroupUiModel {
    id?: string;
    isNew: boolean;
    name: string;
    locked: boolean;
    values: Array<{
        id: string;
        name: string;
        locked: boolean;
    }>;
}

@Component({
    selector: 'vdr-product-variants-editor',
    templateUrl: './product-variants-editor.component.html',
    styleUrls: ['./product-variants-editor.component.scss'],
    changeDetection: ChangeDetectionStrategy.Default,
    standalone: false
})
export class ProductVariantsEditorComponent implements OnInit, DeactivateAware {
    formValueChanged = false;
    optionsChanged = false;
    optionGroups: OptionGroupUiModel[];
    product: NonNullable<GetProductVariantOptionsQuery['product']>;
    variants$: Observable<NonNullable<GetProductVariantOptionsQuery['product']>['variants']>;
    optionGroups$: Observable<NonNullable<GetProductVariantOptionsQuery['product']>['optionGroups']>;
    totalItems$: Observable<number>;
    currencyCode: CurrencyCode;
    itemsPerPage = 100;
    currentPage = 1;
    searchTermControl = new FormControl('');
    selectionManager = new SelectionManager<any>({
        multiSelect: true,
        itemsAreEqual: (a, b) => a.id === b.id,
        additiveMode: true,
    });
    optionsToAddToVariant: {
        [variantId: string]: { [groupId: string]: string };
    } = {};
    private refresh$ = new Subject<void>();
    private languageCode: LanguageCode;

    constructor(
        private route: ActivatedRoute,
        private dataService: DataService,
        private productDetailService: ProductDetailService,
        private notificationService: NotificationService,
        private modalService: ModalService,
        private changeDetector: ChangeDetectorRef,
    ) {}

    ngOnInit() {
        this.languageCode =
            (this.route.snapshot.paramMap.get('lang') as LanguageCode) || getDefaultUiLanguage();
        this.dataService.settings.getActiveChannel().single$.subscribe(data => {
            this.currencyCode = data.activeChannel.defaultCurrencyCode;
        });

        const product$ = this.refresh$.pipe(
            switchMap(() =>
                this.dataService.product
                    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                    .getProductVariantsOptions(this.route.parent?.snapshot.paramMap.get('id')!)
                    .mapSingle(data => data.product),
            ),
            startWith(this.route.snapshot.data.product),
        );

        this.variants$ = product$.pipe(
            switchMap(product =>
                this.searchTermControl.valueChanges.pipe(
                    startWith(''),
                    map(term =>
                        term
                            ? product.variants.filter(v => v.name.toLowerCase().includes(term.toLowerCase()))
                            : product.variants,
                    ),
                ),
            ),
        );
        this.optionGroups$ = product$.pipe(map(product => product.optionGroups));
        this.totalItems$ = this.variants$.pipe(map(variants => variants.length));

        product$.subscribe(p => {
            this.product = p;
            const allUsedOptionIds = p.variants.map(v => v.options.map(option => option.id)).flat();
            const allUsedOptionGroupIds = p.variants.map(v => v.options.map(option => option.groupId)).flat();
            this.optionGroups = p.optionGroups.map(og => ({
                id: og.id,
                isNew: false,
                name: og.name,
                locked: allUsedOptionGroupIds.includes(og.id),
                values: og.options.map(o => ({
                    id: o.id,
                    name: o.name,
                    locked: allUsedOptionIds.includes(o.id),
                })),
            }));
        });
    }

    setItemsPerPage(itemsPerPage: number) {
        this.itemsPerPage = itemsPerPage;
        this.currentPage = 1;
    }

    setPageNumber(page: number) {
        this.currentPage = page;
    }

    onFormChanged(variantInfo: GeneratedVariant) {
        this.formValueChanged = true;
        variantInfo.enabled = true;
    }

    canDeactivate(): boolean {
        return !this.formValueChanged;
    }

    addOptionGroup() {
        this.modalService
            .fromComponent(CreateProductOptionGroupDialogComponent, {
                locals: {
                    languageCode: this.languageCode,
                },
            })
            .pipe(
                switchMap(result => {
                    if (result) {
                        return this.dataService.product.createProductOptionGroups(result).pipe(
                            switchMap(({ createProductOptionGroup }) =>
                                this.dataService.product.addOptionGroupToProduct({
                                    optionGroupId: createProductOptionGroup.id,
                                    productId: this.product.id,
                                }),
                            ),
                        );
                    } else {
                        return EMPTY;
                    }
                }),
            )
            .subscribe(result => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'ProductOptionGroup',
                });
                this.refresh$.next();
                this.changeDetector.markForCheck();
            });
    }

    removeOptionGroup(
        optionGroup: NonNullable<GetProductVariantOptionsQuery['product']>['optionGroups'][number],
    ) {
        const id = optionGroup.id;
        const usedByVariantsCount = this.product.variants.filter(v =>
            v.options.map(o => o.groupId).includes(id),
        ).length;
        this.modalService
            .dialog({
                title: _('catalog.confirm-delete-product-option-group'),
                body: usedByVariantsCount ? _('catalog.confirm-delete-product-option-group-body') : '',
                translationVars: { name: optionGroup.name, count: usedByVariantsCount },
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(val => {
                    if (val) {
                        return this.dataService.product.removeOptionGroupFromProduct({
                            optionGroupId: id,
                            productId: this.product.id,
                            force: true,
                        });
                    } else {
                        return EMPTY;
                    }
                }),
            )
            .subscribe(({ removeOptionGroupFromProduct }) => {
                if (removeOptionGroupFromProduct.__typename === 'Product') {
                    this.notificationService.success(_('common.notify-delete-success'), {
                        entity: 'ProductOptionGroup',
                    });
                    this.refresh$.next();
                } else if (removeOptionGroupFromProduct.__typename === 'ProductOptionInUseError') {
                    this.notificationService.error(removeOptionGroupFromProduct.message ?? '');
                }
            });
    }

    addOption(index: number, optionName: string) {
        const group = this.optionGroups[index];
        if (group && group.id) {
            this.dataService.product
                .addOptionToGroup({
                    productOptionGroupId: group.id,
                    code: normalizeString(optionName, '-'),
                    translations: [{ name: optionName, languageCode: this.languageCode }],
                })
                .subscribe(({ createProductOption }) => {
                    this.notificationService.success(_('common.notify-create-success'), {
                        entity: 'ProductOption',
                    });
                    this.refresh$.next();
                });
        }
    }

    removeOption(index: number, { id, name }: { id: string; name: string }) {
        const optionGroup = this.optionGroups[index];
        if (optionGroup) {
            this.modalService
                .dialog({
                    title: _('catalog.confirm-delete-product-option'),
                    translationVars: { name },
                    buttons: [
                        { type: 'secondary', label: _('common.cancel') },
                        { type: 'danger', label: _('common.delete'), returnValue: true },
                    ],
                })
                .pipe(
                    switchMap(val => {
                        if (val) {
                            return this.dataService.product.deleteProductOption(id);
                        } else {
                            return EMPTY;
                        }
                    }),
                )
                .subscribe(({ deleteProductOption }) => {
                    if (deleteProductOption.result === DeletionResult.DELETED) {
                        this.notificationService.success(_('common.notify-delete-success'), {
                            entity: 'ProductOption',
                        });
                        optionGroup.values = optionGroup.values.filter(v => v.id !== id);
                        this.refresh$.next();
                    } else {
                        this.notificationService.error(deleteProductOption.message ?? '');
                    }
                });
        }
    }

    setOptionToAddToVariant(variantId: string, optionGroupId: string, optionId?: string) {
        if (!this.optionsToAddToVariant[variantId]) {
            this.optionsToAddToVariant[variantId] = {};
        }
        if (optionId) {
            this.optionsToAddToVariant[variantId][optionGroupId] = optionId;
        } else {
            delete this.optionsToAddToVariant[variantId][optionGroupId];
        }
    }

    addOptionToVariant(variant: NonNullable<GetProductVariantOptionsQuery['product']>['variants'][number]) {
        const optionIds = [
            ...variant.options.map(o => o.id),
            ...Object.values(this.optionsToAddToVariant[variant.id]),
        ];
        this.dataService.product
            .updateProductVariants([
                {
                    id: variant.id,
                    optionIds: unique(optionIds),
                },
            ])
            .subscribe(({ updateProductVariants }) => {
                this.refresh$.next();
            });
    }

    deleteVariant(variant: NonNullable<GetProductVariantOptionsQuery['product']>['variants'][number]) {
        this.modalService
            .dialog({
                title: _('catalog.confirm-delete-product-variant'),
                translationVars: { name: variant.name },
                buttons: [
                    { type: 'secondary', label: _('common.cancel') },
                    { type: 'danger', label: _('common.delete'), returnValue: true },
                ],
            })
            .pipe(
                switchMap(response =>
                    response
                        ? this.productDetailService.deleteProductVariant(variant.id, this.product.id)
                        : EMPTY,
                ),
            )
            .subscribe(
                () => {
                    this.notificationService.success(_('common.notify-delete-success'), {
                        entity: 'ProductVariant',
                    });
                    this.refresh$.next();
                },
                err => {
                    this.notificationService.error(_('common.notify-delete-error'), {
                        entity: 'ProductVariant',
                    });
                },
            );
    }

    createNewVariant() {
        this.modalService
            .fromComponent(CreateProductVariantDialogComponent, {
                locals: {
                    product: this.product,
                },
            })
            .pipe(
                switchMap(result => {
                    if (result) {
                        return this.dataService.product.createProductVariants([result]);
                    } else {
                        return EMPTY;
                    }
                }),
            )
            .subscribe(result => {
                this.notificationService.success(_('common.notify-create-success'), {
                    entity: 'ProductVariant',
                });
                this.refresh$.next();
            });
    }

    getOption(
        variant: NonNullable<GetProductVariantOptionsQuery['product']>['variants'][number],
        groupId: string,
    ) {
        return variant.options.find(o => o.groupId === groupId);
    }
}
