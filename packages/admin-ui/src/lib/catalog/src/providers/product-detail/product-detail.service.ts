import { Injectable } from '@angular/core';
import {
    CreateProductInput,
    CreateProductVariantInput,
    DataService,
    DeletionResult,
    FacetWithValuesFragment,
    findTranslation,
    GetProductDetailQuery,
    GetProductWithVariantsQuery,
    LanguageCode,
    UpdateProductInput,
    UpdateProductMutation,
    UpdateProductOptionInput,
    UpdateProductVariantInput,
    UpdateProductVariantsMutation,
} from '@vendure/admin-ui/core';
import { normalizeString } from '@vendure/common/lib/normalize-string';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { forkJoin, Observable, of, throwError } from 'rxjs';
import { map, mergeMap, shareReplay, switchMap } from 'rxjs/operators';

import { CreateProductVariantsConfig } from '../../components/generate-product-variants/generate-product-variants.component';

import { replaceLast } from './replace-last';

/**
 * Handles the logic for making the API calls to perform CRUD operations on a Product and its related
 * entities. This logic was extracted out of the component because it became too large and hard to follow.
 */
@Injectable({
    providedIn: 'root',
})
export class ProductDetailService {
    constructor(private dataService: DataService) {}

    getTaxCategories() {
        return this.dataService.settings
            .getTaxCategories()
            .mapSingle(data => data.taxCategories.items)
            .pipe(shareReplay(1));
    }

    createProductWithVariants(
        input: CreateProductInput,
        createVariantsConfig: CreateProductVariantsConfig,
        languageCode: LanguageCode,
    ) {
        const createProduct$ = this.dataService.product.createProduct(input);
        const nonEmptyOptionGroups = createVariantsConfig.groups.filter(g => 0 < g.values.length);
        const createOptionGroups$ = this.createProductOptionGroups(nonEmptyOptionGroups, languageCode);

        return forkJoin(createProduct$, createOptionGroups$).pipe(
            mergeMap(([{ createProduct }, optionGroups]) => {
                const addOptionsToProduct$ = optionGroups.length
                    ? forkJoin(
                          optionGroups.map(optionGroup =>
                              this.dataService.product.addOptionGroupToProduct({
                                  productId: createProduct.id,
                                  optionGroupId: optionGroup.id,
                              }),
                          ),
                      )
                    : of([]);
                return addOptionsToProduct$.pipe(map(() => ({ createProduct, optionGroups })));
            }),
            mergeMap(({ createProduct, optionGroups }) => {
                const variants = createVariantsConfig.variants.map(v => {
                    const optionIds = optionGroups.length
                        ? v.optionValues.map((optionName, index) => {
                              const option = optionGroups[index].options.find(o => o.name === optionName);
                              if (!option) {
                                  throw new Error(
                                      `Could not find a matching ProductOption "${optionName}" when creating variant`,
                                  );
                              }
                              return option.id;
                          })
                        : [];
                    return {
                        ...v,
                        optionIds,
                    };
                });
                const options = optionGroups.map(og => og.options).reduce((flat, o) => [...flat, ...o], []);
                return this.createProductVariants(
                    createProduct,
                    variants,
                    options,
                    languageCode,
                    createVariantsConfig.stockLocationId,
                );
            }),
        );
    }

    createProductOptionGroups(groups: Array<{ name: string; values: string[] }>, languageCode: LanguageCode) {
        return groups.length
            ? forkJoin(
                  groups.map(c =>
                      this.dataService.product
                          .createProductOptionGroups({
                              code: normalizeString(c.name, '-'),
                              translations: [{ languageCode, name: c.name }],
                              options: c.values.map(v => ({
                                  code: normalizeString(v, '-'),
                                  translations: [{ languageCode, name: v }],
                              })),
                          })
                          .pipe(map(data => data.createProductOptionGroup)),
                  ),
              )
            : of([]);
    }

    createProductVariants(
        product: { name: string; id: string },
        variantData: Array<{ price: number; sku: string; stock: number; optionIds: string[] }>,
        options: Array<{ id: string; name: string }>,
        languageCode: LanguageCode,
        stockLocationId: string,
    ) {
        const variants: CreateProductVariantInput[] = variantData.map(v => {
            const name = options.length
                ? `${product.name} ${v.optionIds
                      .map(id => options.find(o => o.id === id))
                      .filter(notNullOrUndefined)
                      .map(o => o.name)
                      .join(' ')}`
                : product.name;
            return {
                productId: product.id,
                price: v.price,
                sku: v.sku,
                translations: [
                    {
                        languageCode,
                        name,
                    },
                ],
                stockLevels: [
                    {
                        stockLocationId,
                        stockOnHand: v.stock,
                    },
                ],
                optionIds: v.optionIds,
            };
        });
        return this.dataService.product.createProductVariants(variants).pipe(
            map(({ createProductVariants }) => ({
                createProductVariants,
                productId: product.id,
            })),
        );
    }

    updateProduct(updateOptions: {
        product: NonNullable<GetProductDetailQuery['product']>;
        languageCode: LanguageCode;
        autoUpdate: boolean;
        productInput?: UpdateProductInput;
        variantsInput?: UpdateProductVariantInput[];
    }) {
        const { product, languageCode, autoUpdate, productInput, variantsInput } = updateOptions;
        const updateOperations: Array<Observable<UpdateProductMutation | UpdateProductVariantsMutation>> = [];
        const updateVariantsInput = variantsInput || [];

        const variants$ = autoUpdate
            ? this.dataService.product
                  .getProductVariantsForProduct({}, product.id)
                  .mapSingle(({ productVariants }) => productVariants.items)
            : of([]);

        return variants$.pipe(
            mergeMap(variants => {
                if (productInput) {
                    updateOperations.push(this.dataService.product.updateProduct(productInput));
                    const productOldName = findTranslation(product, languageCode)?.name ?? '';
                    const productNewName = findTranslation(productInput, languageCode)?.name;
                    if (productNewName && productOldName !== productNewName && autoUpdate) {
                        for (const variant of variants) {
                            const currentVariantName = findTranslation(variant, languageCode)?.name || '';
                            let variantInput: UpdateProductVariantInput;
                            const existingVariantInput = updateVariantsInput.find(i => i.id === variant.id);
                            if (existingVariantInput) {
                                variantInput = existingVariantInput;
                            } else {
                                variantInput = {
                                    id: variant.id,
                                    translations: [{ languageCode, name: currentVariantName }],
                                };
                                updateVariantsInput.push(variantInput);
                            }
                            const variantTranslation = findTranslation(variantInput, languageCode);
                            if (variantTranslation) {
                                if (variantTranslation.name) {
                                    variantTranslation.name = replaceLast(
                                        variantTranslation.name,
                                        productOldName,
                                        productNewName,
                                    );
                                } else {
                                    // The variant translation was falsy, which occurs
                                    // when defining the product name for a new translation
                                    // language that had not yet been defined.
                                    variantTranslation.name = [
                                        productNewName,
                                        ...variant.options.map(o => o.name),
                                    ].join(' ');
                                }
                            }
                        }
                    }
                }
                if (updateVariantsInput.length) {
                    updateOperations.push(
                        this.dataService.product.updateProductVariants(updateVariantsInput),
                    );
                }
                return forkJoin(updateOperations);
            }),
        );
    }

    updateProductOptions(
        inputs: UpdateProductOptionInput[],
        autoUpdateProductNames: boolean,
        product: NonNullable<GetProductDetailQuery['product']>,
        languageCode: LanguageCode,
    ) {
        const variants$ = autoUpdateProductNames
            ? this.dataService.product
                  .getProductVariantsForProduct({}, product.id)
                  .mapSingle(({ productVariants }) => productVariants.items)
            : of([]);

        return variants$.pipe(
            mergeMap(variants => {
                let updateProductVariantNames$: Observable<any> = of([]);
                if (autoUpdateProductNames) {
                    const replacementMap = new Map<string, string>();

                    for (const input of inputs) {
                        const newOptionName = findTranslation(input, languageCode)?.name;
                        let oldOptionName: string | undefined;
                        for (const variant of variants) {
                            if (oldOptionName) {
                                continue;
                            }
                            if (variant.options.map(o => o.id).includes(input.id)) {
                                if (!oldOptionName) {
                                    oldOptionName = findTranslation(
                                        variant.options.find(o => o.id === input.id),
                                        languageCode,
                                    )?.name;
                                }
                            }
                        }
                        if (oldOptionName && newOptionName) {
                            replacementMap.set(oldOptionName, newOptionName);
                        }
                    }

                    const variantsToUpdate: UpdateProductVariantInput[] = [];
                    if (replacementMap.size) {
                        const oldOptionNames = Array.from(replacementMap.keys());
                        for (const variant of variants) {
                            const variantName = findTranslation(variant, languageCode)?.name;
                            if (!variantName) {
                                continue;
                            }
                            if (!oldOptionNames.some(oldOptionName => variantName.includes(oldOptionName))) {
                                continue;
                            }
                            const updatedVariantName = oldOptionNames.reduce(
                                (name, oldOptionName) =>
                                    replaceLast(name, oldOptionName, replacementMap.get(oldOptionName)!),
                                variantName,
                            );
                            variantsToUpdate.push({
                                id: variant.id,
                                translations: [
                                    {
                                        languageCode,
                                        name: updatedVariantName,
                                    },
                                ],
                            });
                        }
                    }
                    if (variantsToUpdate.length) {
                        updateProductVariantNames$ =
                            this.dataService.product.updateProductVariants(variantsToUpdate);
                    } else {
                        updateProductVariantNames$ = of([]);
                    }
                }
                return forkJoin(
                    inputs.map(input => this.dataService.product.updateProductOption(input)),
                ).pipe(mergeMap(() => updateProductVariantNames$));
            }),
        );
    }

    deleteProductVariant(id: string, productId: string) {
        return this.dataService.product.deleteProductVariant(id).pipe(
            switchMap(result => {
                if (result.deleteProductVariant.result === DeletionResult.DELETED) {
                    return this.dataService.product.getProduct(productId).single$;
                } else {
                    return throwError(result.deleteProductVariant.message);
                }
            }),
        );
    }
}
