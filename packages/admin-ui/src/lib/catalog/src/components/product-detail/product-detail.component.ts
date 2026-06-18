import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, UntypedFormGroup, Validators } from '@angular/forms';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    Asset,
    CreateProductInput,
    createUpdatedTranslatable,
    DataService,
    findTranslation,
    getChannelCodeFromUserStatus,
    getCustomFieldsDefaults,
    GetProductDetailDocument,
    GetProductDetailQuery,
    GetProductWithVariantsQuery,
    LanguageCode,
    ModalService,
    NotificationService,
    Permission,
    PRODUCT_DETAIL_FRAGMENT,
    ProductDetailFragment,
    ProductVariantFragment,
    TypedBaseDetailComponent,
    unicodePatternValidator,
    UpdateProductInput,
    UpdateProductMutation,
    UpdateProductVariantInput,
    UpdateProductVariantsMutation,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { unique } from '@vendure/common/lib/unique';
import { gql } from 'apollo-angular';
import { combineLatest, concat, EMPTY, from, Observable, of } from 'rxjs';
import { distinctUntilChanged, map, mergeMap, shareReplay, switchMap, take } from 'rxjs/operators';

import { ProductDetailService } from '../../providers/product-detail/product-detail.service';
import { ApplyFacetDialogComponent } from '../apply-facet-dialog/apply-facet-dialog.component';
import { AssignProductsToChannelDialogComponent } from '../assign-products-to-channel-dialog/assign-products-to-channel-dialog.component';
import { CreateProductVariantsConfig } from '../generate-product-variants/generate-product-variants.component';

interface SelectedAssets {
    assets?: Asset[];
    featuredAsset?: Asset;
}

export const GET_PRODUCT_DETAIL = gql`
    query GetProductDetail($id: ID!) {
        product(id: $id) {
            ...ProductDetail
        }
    }
    ${PRODUCT_DETAIL_FRAGMENT}
`;

@Component({
    selector: 'vdr-product-detail2',
    templateUrl: './product-detail.component.html',
    styleUrls: ['./product-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ProductDetailComponent
    extends TypedBaseDetailComponent<typeof GetProductDetailDocument, 'product'>
    implements OnInit, OnDestroy
{
    readonly customFields = this.getCustomFieldConfig('Product');
    detailForm = this.formBuilder.group({
        enabled: true,
        name: ['', Validators.required],
        autoUpdateVariantNames: true,
        slug: ['', unicodePatternValidator(/^[\p{Letter}0-9._-]+$/u)],
        description: '',
        facetValueIds: [[] as string[]],
        customFields: this.formBuilder.group(getCustomFieldsDefaults(this.customFields)),
    });
    assetChanges: SelectedAssets = {};
    productChannels$: Observable<ProductDetailFragment['channels']>;
    facetValues$: Observable<ProductDetailFragment['facetValues']>;
    createVariantsConfig: CreateProductVariantsConfig = { groups: [], variants: [], stockLocationId: '' };
    public readonly updatePermissions = [Permission.UpdateCatalog, Permission.UpdateProduct];

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

        const productFacetValues$ = this.isNew$.pipe(
            switchMap(isNew => {
                return isNew ? of([]) : this.entity$.pipe(map(product => product.facetValues));
            }),
        );
        const productGroup = this.detailForm;
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const formFacetValueIdChanges$ = productGroup.get('facetValueIds')!.valueChanges.pipe(
            distinctUntilChanged(),
            switchMap(ids =>
                this.dataService.facet
                    .getFacetValues({ filter: { id: { in: ids } } })
                    .mapSingle(({ facetValues }) => facetValues.items),
            ),
            shareReplay(1),
        );
        this.facetValues$ = concat(
            productFacetValues$.pipe(take(1)),
            productFacetValues$.pipe(switchMap(() => formFacetValueIdChanges$)),
        );
        this.productChannels$ = this.entity$.pipe(map(p => p.channels));
    }

    ngOnDestroy() {
        this.destroy();
    }

    isDefaultChannel(channelCode: string): boolean {
        return channelCode === DEFAULT_CHANNEL_CODE;
    }

    assignToChannel() {
        this.productChannels$
            .pipe(
                take(1),
                switchMap(channels =>
                    this.modalService.fromComponent(AssignProductsToChannelDialogComponent, {
                        size: 'lg',
                        locals: {
                            productIds: [this.id],
                            currentChannelIds: channels.map(c => c.id),
                        },
                    }),
                ),
            )
            .subscribe();
    }

    removeFromChannel(channelId: string) {
        from(getChannelCodeFromUserStatus(this.dataService, channelId))
            .pipe(
                switchMap(({ channelCode }) =>
                    this.modalService.dialog({
                        title: _('catalog.remove-product-from-channel'),
                        buttons: [
                            { type: 'secondary', label: _('common.cancel') },
                            {
                                type: 'danger',
                                label: _('catalog.remove-from-channel'),
                                translationVars: { channelCode },
                                returnValue: true,
                            },
                        ],
                    }),
                ),
                switchMap(response =>
                    response
                        ? this.dataService.product.removeProductsFromChannel({
                              channelId,
                              productIds: [this.id],
                          })
                        : EMPTY,
                ),
            )
            .subscribe(
                () => {
                    this.notificationService.success(_('catalog.notify-remove-product-from-channel-success'));
                },
                err => {
                    this.notificationService.error(_('catalog.notify-remove-product-from-channel-error'));
                },
            );
    }

    assignVariantToChannel(variant: ProductVariantFragment) {
        return this.modalService
            .fromComponent(AssignProductsToChannelDialogComponent, {
                size: 'lg',
                locals: {
                    productIds: [this.id],
                    productVariantIds: [variant.id],
                    currentChannelIds: variant.channels.map(c => c.id),
                },
            })
            .subscribe();
    }

    removeVariantFromChannel({ channelId, variant }: { channelId: string; variant: ProductVariantFragment }) {
        from(getChannelCodeFromUserStatus(this.dataService, channelId))
            .pipe(
                switchMap(({ channelCode }) =>
                    this.modalService.dialog({
                        title: _('catalog.remove-product-variant-from-channel'),
                        buttons: [
                            { type: 'secondary', label: _('common.cancel') },
                            {
                                type: 'danger',
                                label: _('catalog.remove-from-channel'),
                                translationVars: { channelCode },
                                returnValue: true,
                            },
                        ],
                    }),
                ),
                switchMap(response =>
                    response
                        ? this.dataService.product.removeVariantsFromChannel({
                              channelId,
                              productVariantIds: [variant.id],
                          })
                        : EMPTY,
                ),
            )
            .subscribe(
                () => {
                    this.notificationService.success(_('catalog.notify-remove-variant-from-channel-success'));
                },
                err => {
                    this.notificationService.error(_('catalog.notify-remove-variant-from-channel-error'));
                },
            );
    }

    assetsChanged(): boolean {
        return !!Object.values(this.assetChanges).length;
    }

    /**
     * If creating a new product, automatically generate the slug based on the product name.
     */
    updateSlug(nameValue: string) {
        const slugControl = this.detailForm.get('slug');
        const currentTranslation = this.entity ? findTranslation(this.entity, this.languageCode) : undefined;
        const currentSlugIsEmpty = !currentTranslation || !currentTranslation.slug;
        if (slugControl && slugControl.pristine && currentSlugIsEmpty) {
            slugControl.setValue(normalizeString(`${nameValue}`, '-'));
        }
    }

    selectProductFacetValue() {
        this.displayFacetValueModal().subscribe(facetValueIds => {
            if (facetValueIds) {
                const facetValueIdsControl = this.detailForm.controls.facetValueIds;
                const currentFacetValueIds = facetValueIdsControl.value ?? [];
                facetValueIdsControl.setValue(unique([...currentFacetValueIds, ...facetValueIds]));
                facetValueIdsControl.markAsDirty();
            }
        });
    }

    removeProductFacetValue(facetValueId: string) {
        const facetValueIdsControl = this.detailForm.controls.facetValueIds;
        const currentFacetValueIds = facetValueIdsControl.value ?? [];
        facetValueIdsControl.setValue(currentFacetValueIds.filter(id => id !== facetValueId));
        facetValueIdsControl.markAsDirty();
    }

    private displayFacetValueModal(): Observable<string[] | undefined> {
        return this.modalService
            .fromComponent(ApplyFacetDialogComponent, {
                size: 'md',
                closable: true,
            })
            .pipe(map(facetValues => facetValues && facetValues.map(v => v.id)));
    }

    create() {
        const productGroup = this.detailForm;
        if (!productGroup.dirty) {
            return;
        }

        const newProduct = this.getUpdatedProduct(
            {
                id: '',
                createdAt: '',
                updatedAt: '',
                enabled: true,
                languageCode: this.languageCode,
                name: '',
                slug: '',
                featuredAsset: null,
                assets: [],
                description: '',
                translations: [],
                optionGroups: [],
                facetValues: [],
                channels: [],
            },
            productGroup as UntypedFormGroup,
            this.languageCode,
        ) as CreateProductInput;
        this.productDetailService
            .createProductWithVariants(newProduct, this.createVariantsConfig, this.languageCode)
            .subscribe(
                ({ createProductVariants, productId }) => {
                    this.notificationService.success(_('common.notify-create-success'), {
                        entity: 'Product',
                    });
                    this.assetChanges = {};
                    this.detailForm.markAsPristine();
                    this.router.navigate(['../', productId], { relativeTo: this.route });
                },
                err => {
                    // eslint-disable-next-line no-console
                    console.error(err);
                    this.notificationService.error(_('common.notify-create-error'), {
                        entity: 'Product',
                    });
                },
            );
    }

    save() {
        combineLatest(this.entity$, this.languageCode$)
            .pipe(
                take(1),
                mergeMap(([product, languageCode]) => {
                    const productGroup = this.detailForm;
                    let productInput: UpdateProductInput | undefined;
                    let variantsInput: UpdateProductVariantInput[] | undefined;

                    if (productGroup.dirty || this.assetsChanged()) {
                        productInput = this.getUpdatedProduct(
                            product,
                            productGroup as UntypedFormGroup,
                            languageCode,
                        ) as UpdateProductInput;
                    }

                    return this.productDetailService.updateProduct({
                        product,
                        languageCode,
                        autoUpdate: this.detailForm.get(['autoUpdateVariantNames'])?.value ?? false,
                        productInput,
                        variantsInput,
                    });
                }),
            )
            .subscribe(
                result => {
                    this.updateSlugAfterSave(result);
                    this.detailForm.markAsPristine();
                    this.assetChanges = {};
                    this.notificationService.success(_('common.notify-update-success'), {
                        entity: 'Product',
                    });
                    this.changeDetector.markForCheck();
                },
                err => {
                    this.notificationService.error(_('common.notify-update-error'), {
                        entity: 'Product',
                    });
                },
            );
    }

    canDeactivate(): boolean {
        return super.canDeactivate() && !this.assetChanges.assets && !this.assetChanges.featuredAsset;
    }

    /**
     * Sets the values of the form on changes to the product or current language.
     */
    protected setFormValues(
        product: NonNullable<GetProductWithVariantsQuery['product']>,
        languageCode: LanguageCode,
    ) {
        const currentTranslation = findTranslation(product, languageCode);
        this.detailForm.patchValue({
            enabled: product.enabled,
            name: currentTranslation ? currentTranslation.name : '',
            slug: currentTranslation ? currentTranslation.slug : '',
            description: currentTranslation ? currentTranslation.description : '',
            facetValueIds: product.facetValues.map(fv => fv.id),
        });

        if (this.customFields.length) {
            this.setCustomFieldFormValues(
                this.customFields,
                this.detailForm.get(['customFields']),
                product,
                currentTranslation,
            );
        }
    }

    /**
     * Given a product and the value of the detailForm, this method creates an updated copy of the product which
     * can then be persisted to the API.
     */
    private getUpdatedProduct(
        product: NonNullable<GetProductDetailQuery['product']>,
        productFormGroup: UntypedFormGroup,
        languageCode: LanguageCode,
    ): UpdateProductInput | CreateProductInput {
        const updatedProduct = createUpdatedTranslatable({
            translatable: product,
            updatedFields: productFormGroup.value,
            customFieldConfig: this.customFields,
            languageCode,
            defaultTranslation: {
                languageCode,
                name: product.name || '',
                slug: product.slug || '',
                description: product.description || '',
            },
        });
        return {
            ...updatedProduct,
            assetIds: this.assetChanges.assets?.map(a => a.id),
            featuredAssetId: this.assetChanges.featuredAsset?.id,
            facetValueIds: productFormGroup.controls.facetValueIds.dirty
                ? productFormGroup.value.facetValueIds
                : undefined,
        } as UpdateProductInput | CreateProductInput;
    }

    /**
     * The server may alter the slug value in order to normalize and ensure uniqueness upon saving.
     */
    private updateSlugAfterSave(results: Array<UpdateProductMutation | UpdateProductVariantsMutation>) {
        const firstResult = results[0];
        const slugControl = this.detailForm.get(['product', 'slug']);

        function isUpdateMutation(input: any): input is UpdateProductMutation {
            return input.hasOwnProperty('updateProduct');
        }

        if (slugControl && isUpdateMutation(firstResult)) {
            slugControl.setValue(firstResult.updateProduct.slug, { emitEvent: false });
        }
    }
}
