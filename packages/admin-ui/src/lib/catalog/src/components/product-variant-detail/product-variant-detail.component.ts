import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormControl, FormGroup, UntypedFormGroup } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    Asset,
    CreateProductVariantInput,
    createUpdatedTranslatable,
    CurrencyCode,
    DataService,
    findTranslation,
    getCustomFieldsDefaults,
    GetProductVariantDetailDocument,
    GetProductVariantDetailQuery,
    GlobalFlag,
    ItemOf,
    LanguageCode,
    ModalService,
    NotificationService,
    Permission,
    ProductOptionFragment,
    ProductVariantUpdateMutationDocument,
    TypedBaseDetailComponent,
    UpdateProductVariantInput,
} from '@vendure/admin-ui/core';
import { pick } from '@vendure/common/lib/pick';
import { unique } from '@vendure/common/lib/unique';
import { combineLatest, concat, Observable } from 'rxjs';
import {
    distinctUntilChanged,
    map,
    mergeMap,
    shareReplay,
    skip,
    switchMap,
    switchMapTo,
    take,
    tap,
} from 'rxjs/operators';
import { ProductDetailService } from '../../providers/product-detail/product-detail.service';
import { ApplyFacetDialogComponent } from '../apply-facet-dialog/apply-facet-dialog.component';

interface SelectedAssets {
    assets?: Asset[];
    featuredAsset?: Asset;
}

interface VariantFormValue {
    id: string;
    enabled: boolean;
    sku: string;
    name: string;
    taxCategoryId: string;
    stockOnHand: number;
    useGlobalOutOfStockThreshold: boolean;
    outOfStockThreshold: number;
    trackInventory: GlobalFlag;
    facetValueIds: string[][];
    customFields?: any;
}
type T = NonNullable<GetProductVariantDetailQuery['productVariant']>;
type T1 = T['stockLevels'];
@Component({
    selector: 'vdr-product-variant-detail',
    templateUrl: './product-variant-detail.component.html',
    styleUrls: ['./product-variant-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ProductVariantDetailComponent
    extends TypedBaseDetailComponent<typeof GetProductVariantDetailDocument, 'productVariant'>
    implements OnInit, OnDestroy
{
    public readonly updatePermissions = [Permission.UpdateCatalog, Permission.UpdateProduct];
    readonly customFields = this.getCustomFieldConfig('ProductVariant');
    readonly customPriceFields = this.getCustomFieldConfig('ProductVariantPrice');
    readonly customOptionFields = this.getCustomFieldConfig('ProductOption');
    stockLevels$: Observable<NonNullable<GetProductVariantDetailQuery['productVariant']>['stockLevels']>;
    detailForm = this.formBuilder.group<VariantFormValue>({
        id: '',
        enabled: false,
        sku: '',
        name: '',
        taxCategoryId: '',
        stockOnHand: 0,
        useGlobalOutOfStockThreshold: true,
        outOfStockThreshold: 0,
        trackInventory: GlobalFlag.TRUE,
        facetValueIds: [],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    stockLevelsForm = this.formBuilder.array<
        FormGroup<{
            stockLocationId: FormControl<string | null>;
            stockLocationName: FormControl<string | null>;
            stockOnHand: FormControl<number | null>;
            stockAllocated: FormControl<number | null>;
        }>
    >([]);
    pricesForm = this.formBuilder.array<
        FormGroup<{
            price: FormControl<number | null>;
            currencyCode: FormControl<CurrencyCode | null>;
            delete: FormControl<boolean | null>;
            customFields: FormGroup<any>; //TODO: Add type
        }>
    >([]);
    assetChanges: SelectedAssets = {};
    taxCategories$: Observable<Array<ItemOf<GetProductVariantDetailQuery, 'taxCategories'>>>;
    unusedStockLocation$: Observable<Array<ItemOf<GetProductVariantDetailQuery, 'stockLocations'>>>;
    unusedCurrencyCodes$: Observable<string[]>;
    channelPriceIncludesTax$: Observable<boolean>;
    readonly GlobalFlag = GlobalFlag;
    globalTrackInventory: boolean;
    globalOutOfStockThreshold: number;
    facetValues$: Observable<NonNullable<GetProductVariantDetailQuery['productVariant']>['facetValues']>;
    channelDefaultCurrencyCode: CurrencyCode;

    constructor(
        private productDetailService: ProductDetailService,
        private formBuilder: FormBuilder,
        private modalService: ModalService,
        private notificationService: NotificationService,
        protected dataService: DataService,
        private changeDetector: ChangeDetectorRef,
    ) {
        super();
    }

    ngOnInit() {
        this.init();
        this.dataService.settings.getGlobalSettings('cache-first').single$.subscribe(({ globalSettings }) => {
            this.globalTrackInventory = globalSettings.trackInventory;
            this.globalOutOfStockThreshold = globalSettings.outOfStockThreshold;
            this.changeDetector.markForCheck();
        });
        this.taxCategories$ = this.result$.pipe(map(data => data.taxCategories.items));
        const availableCurrencyCodes$ = this.result$.pipe(
            tap(data => (this.channelDefaultCurrencyCode = data.activeChannel.defaultCurrencyCode)),
            map(data => data.activeChannel.availableCurrencyCodes),
        );
        this.unusedCurrencyCodes$ = combineLatest(this.pricesForm.valueChanges, availableCurrencyCodes$).pipe(
            map(([prices, currencyCodes]) =>
                currencyCodes.filter(code => !prices.map(p => p.currencyCode).includes(code)),
            ),
        );
        const stockLocations$ = this.result$.pipe(map(data => data.stockLocations.items));
        this.unusedStockLocation$ = combineLatest(this.entity$, stockLocations$).pipe(
            map(([entity, stockLocations]) => {
                const usedIds = entity.stockLevels.map(l => l.stockLocation.id);
                return stockLocations.filter(l => !usedIds.includes(l.id));
            }),
        );
        this.channelPriceIncludesTax$ = this.dataService.settings
            .getActiveChannel('cache-first')
            .refetchOnChannelChange()
            .mapStream(data => data.activeChannel.pricesIncludeTax)
            .pipe(shareReplay(1));
        this.stockLevels$ = this.entity$.pipe(map(entity => entity?.stockLevels ?? []));
        const facetValues$ = this.entity$.pipe(map(variant => variant.facetValues ?? []));
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const formFacetValueIdChanges$ = this.detailForm.get('facetValueIds')!.valueChanges.pipe(
            skip(1),
            distinctUntilChanged(),
            switchMap(ids =>
                this.dataService.facet
                    .getFacetValues({ filter: { id: { in: ids } } })
                    .mapSingle(({ facetValues }) => facetValues.items),
            ),
            shareReplay(1),
        );
        this.facetValues$ = concat(
            facetValues$.pipe(take(1)),
            facetValues$.pipe(switchMapTo(formFacetValueIdChanges$)),
        );
    }

    ngOnDestroy() {
        this.destroy();
    }

    addPriceInCurrency(currencyCode: CurrencyCode) {
        this.pricesForm.push(
            this.formBuilder.group({
                currencyCode,
                price: 0,
                delete: false as boolean,
                customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customPriceFields)),
            }),
        );
    }

    toggleDeletePrice(deleteFormControl: FormControl) {
        deleteFormControl.setValue(!deleteFormControl.value);
        deleteFormControl.markAsDirty();
    }

    addStockLocation(stockLocation: ItemOf<GetProductVariantDetailQuery, 'stockLocations'>) {
        this.stockLevelsForm.push(
            this.formBuilder.group({
                stockLocationId: stockLocation.id,
                stockLocationName: stockLocation.name,
                stockOnHand: 0,
                stockAllocated: 0,
            }),
        );
    }

    save() {
        combineLatest(this.entity$, this.languageCode$)
            .pipe(
                take(1),
                mergeMap(([variant, languageCode]) => {
                    const input = pick(
                        this.getUpdatedVariant(
                            variant,
                            this.detailForm,
                            languageCode,
                        ) as UpdateProductVariantInput,
                        [
                            'id',
                            'enabled',
                            'translations',
                            'sku',
                            'taxCategoryId',
                            'facetValueIds',
                            'featuredAssetId',
                            'assetIds',
                            'trackInventory',
                            'outOfStockThreshold',
                            'useGlobalOutOfStockThreshold',
                            'customFields',
                        ],
                    ) as UpdateProductVariantInput;
                    if (this.stockLevelsForm.dirty) {
                        input.stockLevels = this.stockLevelsForm.controls
                            .filter(control => control.dirty)
                            .map(control => ({
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                stockLocationId: control.value.stockLocationId!,
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                stockOnHand: control.value.stockOnHand!,
                            }));
                    }
                    if (this.pricesForm.dirty) {
                        input.prices = this.pricesForm.controls
                            .filter(control => control.dirty)
                            .map(control => ({
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                price: control.value.price!,
                                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                                currencyCode: control.value.currencyCode!,
                                delete: control.value.delete === true,
                                customFields: control.get('customFields')?.value,
                            }));
                    }
                    return this.dataService.mutate(ProductVariantUpdateMutationDocument, {
                        input: [input],
                    });
                }),
            )
            .subscribe(
                result => {
                    this.detailForm.markAsPristine();
                    this.stockLevelsForm.markAsPristine();
                    this.pricesForm.markAsPristine();
                    this.assetChanges = {};
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'ProductVariant',
                    });
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'ProductVariant',
                    });
                },
            );
    }

    assetsChanged(): boolean {
        return !!Object.values(this.assetChanges).length;
    }

    inventoryIsNotTracked(formGroup: UntypedFormGroup): boolean {
        const trackInventory = formGroup.get('trackInventory')?.value;
        return (
            trackInventory === GlobalFlag.FALSE ||
            (trackInventory === GlobalFlag.INHERIT && this.globalTrackInventory === false)
        );
    }

    optionGroupCode(optionGroupId: string): string | undefined {
        const group = this.entity?.product.optionGroups.find(g => g.id === optionGroupId);
        return group?.code;
    }

    optionName(option: ProductOptionFragment) {
        const translation =
            option.translations.find(t => t.languageCode === this.languageCode) ?? option.translations[0];
        return translation.name;
    }

    removeFacetValue(facetValueId: string) {
        const facetValueIdsControl = this.detailForm.controls.facetValueIds;
        const currentFacetValueIds = facetValueIdsControl.value ?? [];
        facetValueIdsControl.setValue(currentFacetValueIds.filter(id => id !== facetValueId));
        facetValueIdsControl.markAsDirty();
    }

    selectFacetValue() {
        this.displayFacetValueModal().subscribe(facetValueIds => {
            if (facetValueIds) {
                const facetValueIdsControl = this.detailForm.controls.facetValueIds;
                const currentFacetValueIds = facetValueIdsControl.value ?? [];
                facetValueIdsControl.setValue(unique([...currentFacetValueIds, ...facetValueIds]));
                facetValueIdsControl.markAsDirty();
            }
        });
    }

    private displayFacetValueModal(): Observable<string[] | undefined> {
        return this.modalService
            .fromComponent(ApplyFacetDialogComponent, {
                size: 'md',
                closable: true,
            })
            .pipe(map(facetValues => facetValues && facetValues.map(v => v.id)));
    }

    protected setFormValues(
        variant: NonNullable<GetProductVariantDetailQuery['productVariant']>,
        languageCode: LanguageCode,
    ): void {
        const variantTranslation = findTranslation(variant, languageCode);
        const facetValueIds = variant.facetValues.map(fv => fv.id);
        this.detailForm.patchValue({
            id: variant.id,
            enabled: variant.enabled,
            sku: variant.sku,
            name: variantTranslation ? variantTranslation.name : '',
            taxCategoryId: variant.taxCategory.id,
            stockOnHand: variant.stockLevels[0]?.stockOnHand ?? 0,
            useGlobalOutOfStockThreshold: variant.useGlobalOutOfStockThreshold,
            outOfStockThreshold: variant.outOfStockThreshold,
            trackInventory: variant.trackInventory,
            facetValueIds,
        });
        this.stockLevelsForm.clear();
        for (const stockLevel of variant.stockLevels) {
            this.stockLevelsForm.push(
                this.formBuilder.group({
                    stockLocationId: stockLevel.stockLocation.id,
                    stockLocationName: stockLevel.stockLocation.name,
                    stockOnHand: stockLevel.stockOnHand,
                    stockAllocated: stockLevel.stockAllocated,
                }),
            );
        }
        this.pricesForm.clear();
        for (const price of variant.prices) {
            const priceForm = this.formBuilder.group({
                price: price.price,
                currencyCode: price.currencyCode,
                delete: false as boolean,
                customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customPriceFields)),
            });
            if (this.customPriceFields.length) {
                this.setCustomFieldFormValues(this.customPriceFields, priceForm.get(['customFields']), price);
            }
            this.pricesForm.push(priceForm);
        }
        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get('customFields'),
                variant,
                variantTranslation,
            );
        }
    }

    /**
     * Given a product and the value of the detailForm, this method creates an updated copy of the product which
     * can then be persisted to the API.
     */
    private getUpdatedVariant(
        variant: NonNullable<GetProductVariantDetailQuery['productVariant']>,
        variantFormGroup: typeof this.detailForm,
        languageCode: LanguageCode,
    ): UpdateProductVariantInput | CreateProductVariantInput {
        const updatedProduct = createUpdatedTranslatable({
            translatable: variant,
            updatedFields: variantFormGroup.value,
            customFieldConfig: this.customFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: variant.name || '',
            },
        });
        return {
            ...updatedProduct,
            assetIds: this.assetChanges.assets?.map(a => a.id),
            featuredAssetId: this.assetChanges.featuredAsset?.id,
            facetValueIds: variantFormGroup.controls.facetValueIds.dirty
                ? variantFormGroup.value.facetValueIds
                : undefined,
            taxCategoryId: variantFormGroup.controls.taxCategoryId.dirty
                ? variantFormGroup.value.taxCategoryId
                : undefined,
        } as UpdateProductVariantInput | CreateProductVariantInput;
    }
}
