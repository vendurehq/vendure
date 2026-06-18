import { pick } from '@vendure/common/lib/pick';

import * as Codegen from '../../common/generated-types';
import { SortOrder } from '../../common/generated-types';
import {
    ADD_OPTION_GROUP_TO_PRODUCT,
    ADD_OPTION_TO_GROUP,
    ASSIGN_PRODUCTS_TO_CHANNEL,
    ASSIGN_VARIANTS_TO_CHANNEL,
    CREATE_ASSETS,
    CREATE_PRODUCT,
    CREATE_PRODUCT_OPTION_GROUP,
    CREATE_PRODUCT_VARIANTS,
    CREATE_TAG,
    DELETE_ASSETS,
    DELETE_PRODUCT,
    DELETE_PRODUCT_OPTION,
    DELETE_PRODUCT_VARIANT,
    DELETE_PRODUCT_VARIANTS,
    DELETE_PRODUCTS,
    DELETE_TAG,
    GET_ASSET,
    GET_ASSET_LIST,
    GET_PRODUCT_LIST,
    GET_PRODUCT_OPTION_GROUP,
    GET_PRODUCT_OPTION_GROUPS,
    GET_PRODUCT_SIMPLE,
    GET_PRODUCT_VARIANT,
    GET_PRODUCT_VARIANT_LIST,
    GET_PRODUCT_VARIANT_LIST_FOR_PRODUCT,
    GET_PRODUCT_VARIANT_LIST_SIMPLE,
    GET_PRODUCT_VARIANT_OPTIONS,
    GET_PRODUCT_WITH_VARIANTS,
    GET_TAG,
    GET_TAG_LIST,
    PRODUCT_SELECTOR_SEARCH,
    REMOVE_OPTION_GROUP_FROM_PRODUCT,
    REMOVE_PRODUCTS_FROM_CHANNEL,
    REMOVE_VARIANTS_FROM_CHANNEL,
    SEARCH_PRODUCTS,
    UPDATE_ASSET,
    UPDATE_PRODUCT,
    UPDATE_PRODUCT_OPTION,
    UPDATE_PRODUCT_OPTION_GROUP,
    UPDATE_PRODUCT_VARIANTS,
    UPDATE_TAG,
} from '../definitions/product-definitions';
import {
    GET_PENDING_SEARCH_INDEX_UPDATES,
    REINDEX,
    RUN_PENDING_SEARCH_INDEX_UPDATES,
} from '../definitions/settings-definitions';

import { BaseDataService } from './base-data.service';

export class ProductDataService {
    constructor(private baseDataService: BaseDataService) {}

    searchProducts(term: string, take = 10, skip = 0) {
        return this.baseDataService.query<Codegen.SearchProductsQuery, Codegen.SearchProductsQueryVariables>(
            SEARCH_PRODUCTS,
            {
                input: {
                    term,
                    take,
                    skip,
                    groupByProduct: true,
                },
            },
        );
    }

    productSelectorSearch(term: string, take: number) {
        return this.baseDataService.query<
            Codegen.ProductSelectorSearchQuery,
            Codegen.ProductSelectorSearchQueryVariables
        >(PRODUCT_SELECTOR_SEARCH, {
            take,
            term,
        });
    }

    reindex() {
        return this.baseDataService.mutate<Codegen.ReindexMutation>(REINDEX);
    }

    getPendingSearchIndexUpdates() {
        return this.baseDataService.query<Codegen.GetPendingSearchIndexUpdatesQuery>(
            GET_PENDING_SEARCH_INDEX_UPDATES,
        );
    }

    runPendingSearchIndexUpdates() {
        return this.baseDataService.mutate<Codegen.RunPendingSearchIndexUpdatesMutation>(
            RUN_PENDING_SEARCH_INDEX_UPDATES,
        );
    }

    getProducts(options: Codegen.ProductListOptions) {
        return this.baseDataService.query<Codegen.GetProductListQuery, Codegen.GetProductListQueryVariables>(
            GET_PRODUCT_LIST,
            {
                options,
            },
        );
    }

    getProduct(id: string, variantListOptions?: Codegen.ProductVariantListOptions) {
        return this.baseDataService.query<
            Codegen.GetProductWithVariantsQuery,
            Codegen.GetProductWithVariantsQueryVariables
        >(GET_PRODUCT_WITH_VARIANTS, {
            id,
            variantListOptions,
        });
    }

    getProductSimple(id: string) {
        return this.baseDataService.query<
            Codegen.GetProductSimpleQuery,
            Codegen.GetProductSimpleQueryVariables
        >(GET_PRODUCT_SIMPLE, {
            id,
        });
    }

    getProductVariantsSimple(options: Codegen.ProductVariantListOptions, productId?: string) {
        return this.baseDataService.query<
            Codegen.GetProductVariantListSimpleQuery,
            Codegen.GetProductVariantListSimpleQueryVariables
        >(GET_PRODUCT_VARIANT_LIST_SIMPLE, { options, productId });
    }

    getProductVariants(options: Codegen.ProductVariantListOptions) {
        return this.baseDataService.query<
            Codegen.GetProductVariantListQuery,
            Codegen.GetProductVariantListQueryVariables
        >(GET_PRODUCT_VARIANT_LIST, { options });
    }

    getProductVariantsForProduct(options: Codegen.ProductVariantListOptions, productId: string) {
        return this.baseDataService.query<
            Codegen.GetProductVariantListForProductQuery,
            Codegen.GetProductVariantListForProductQueryVariables
        >(GET_PRODUCT_VARIANT_LIST_FOR_PRODUCT, { options, productId });
    }

    getProductVariant(id: string) {
        return this.baseDataService.query<
            Codegen.GetProductVariantQuery,
            Codegen.GetProductVariantQueryVariables
        >(GET_PRODUCT_VARIANT, { id });
    }

    getProductVariantsOptions(id: string) {
        return this.baseDataService.query<
            Codegen.GetProductVariantOptionsQuery,
            Codegen.GetProductVariantOptionsQueryVariables
        >(GET_PRODUCT_VARIANT_OPTIONS, {
            id,
        });
    }

    getProductOptionGroup(id: string) {
        return this.baseDataService.query<
            Codegen.GetProductOptionGroupQuery,
            Codegen.GetProductOptionGroupQueryVariables
        >(GET_PRODUCT_OPTION_GROUP, {
            id,
        });
    }

    createProduct(product: Codegen.CreateProductInput) {
        const input: Codegen.CreateProductMutationVariables = {
            input: pick(product, [
                'enabled',
                'translations',
                'customFields',
                'assetIds',
                'featuredAssetId',
                'facetValueIds',
            ]),
        };
        return this.baseDataService.mutate<
            Codegen.CreateProductMutation,
            Codegen.CreateProductMutationVariables
        >(CREATE_PRODUCT, input);
    }

    updateProduct(product: Codegen.UpdateProductInput) {
        const input: Codegen.UpdateProductMutationVariables = {
            input: pick(product, [
                'id',
                'enabled',
                'translations',
                'customFields',
                'assetIds',
                'featuredAssetId',
                'facetValueIds',
            ]),
        };
        return this.baseDataService.mutate<
            Codegen.UpdateProductMutation,
            Codegen.UpdateProductMutationVariables
        >(UPDATE_PRODUCT, input);
    }

    deleteProduct(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteProductMutation,
            Codegen.DeleteProductMutationVariables
        >(DELETE_PRODUCT, {
            id,
        });
    }

    deleteProducts(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteProductsMutation,
            Codegen.DeleteProductsMutationVariables
        >(DELETE_PRODUCTS, {
            ids,
        });
    }

    createProductVariants(input: Codegen.CreateProductVariantInput[]) {
        return this.baseDataService.mutate<
            Codegen.CreateProductVariantsMutation,
            Codegen.CreateProductVariantsMutationVariables
        >(CREATE_PRODUCT_VARIANTS, {
            input,
        });
    }

    updateProductVariants(variants: Codegen.UpdateProductVariantInput[]) {
        const input: Codegen.UpdateProductVariantsMutationVariables = {
            input: variants.map(
                pick([
                    'id',
                    'enabled',
                    'translations',
                    'sku',
                    'price',
                    'taxCategoryId',
                    'facetValueIds',
                    'featuredAssetId',
                    'assetIds',
                    'optionIds',
                    'trackInventory',
                    'outOfStockThreshold',
                    'useGlobalOutOfStockThreshold',
                    'stockOnHand',
                    'customFields',
                ]),
            ),
        };
        return this.baseDataService.mutate<
            Codegen.UpdateProductVariantsMutation,
            Codegen.UpdateProductVariantsMutationVariables
        >(UPDATE_PRODUCT_VARIANTS, input);
    }

    deleteProductVariant(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteProductVariantMutation,
            Codegen.DeleteProductVariantMutationVariables
        >(DELETE_PRODUCT_VARIANT, {
            id,
        });
    }

    deleteProductVariants(ids: string[]) {
        return this.baseDataService.mutate<
            Codegen.DeleteProductVariantsMutation,
            Codegen.DeleteProductVariantsMutationVariables
        >(DELETE_PRODUCT_VARIANTS, {
            ids,
        });
    }

    createProductOptionGroups(productOptionGroup: Codegen.CreateProductOptionGroupInput) {
        const input: Codegen.CreateProductOptionGroupMutationVariables = {
            input: productOptionGroup,
        };
        return this.baseDataService.mutate<
            Codegen.CreateProductOptionGroupMutation,
            Codegen.CreateProductOptionGroupMutationVariables
        >(CREATE_PRODUCT_OPTION_GROUP, input);
    }

    addOptionGroupToProduct(variables: Codegen.AddOptionGroupToProductMutationVariables) {
        return this.baseDataService.mutate<
            Codegen.AddOptionGroupToProductMutation,
            Codegen.AddOptionGroupToProductMutationVariables
        >(ADD_OPTION_GROUP_TO_PRODUCT, variables);
    }

    addOptionToGroup(input: Codegen.CreateProductOptionInput) {
        return this.baseDataService.mutate<
            Codegen.AddOptionToGroupMutation,
            Codegen.AddOptionToGroupMutationVariables
        >(ADD_OPTION_TO_GROUP, { input });
    }

    deleteProductOption(id: string) {
        return this.baseDataService.mutate<
            Codegen.DeleteProductOptionMutation,
            Codegen.DeleteProductOptionMutationVariables
        >(DELETE_PRODUCT_OPTION, { id });
    }

    removeOptionGroupFromProduct(variables: Codegen.RemoveOptionGroupFromProductMutationVariables) {
        return this.baseDataService.mutate<
            Codegen.RemoveOptionGroupFromProductMutation,
            Codegen.RemoveOptionGroupFromProductMutationVariables
        >(REMOVE_OPTION_GROUP_FROM_PRODUCT, variables);
    }

    updateProductOption(input: Codegen.UpdateProductOptionInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateProductOptionMutation,
            Codegen.UpdateProductOptionMutationVariables
        >(UPDATE_PRODUCT_OPTION, {
            input: pick(input, ['id', 'code', 'translations', 'customFields']),
        });
    }

    updateProductOptionGroup(input: Codegen.UpdateProductOptionGroupInput) {
        return this.baseDataService.mutate<
            Codegen.UpdateProductOptionGroupMutation,
            Codegen.UpdateProductOptionGroupMutationVariables
        >(UPDATE_PRODUCT_OPTION_GROUP, {
            input: pick(input, ['id', 'code', 'translations', 'customFields']),
        });
    }

    getProductOptionGroups(filterTerm?: string) {
        return this.baseDataService.query<
            Codegen.GetProductOptionGroupsQuery,
            Codegen.GetProductOptionGroupsQueryVariables
        >(GET_PRODUCT_OPTION_GROUPS, {
            options: filterTerm ? { filter: { name: { contains: filterTerm } } } : undefined,
        });
    }

    getAssetList(take = 10, skip = 0) {
        return this.baseDataService.query<Codegen.GetAssetListQuery, Codegen.GetAssetListQueryVariables>(
            GET_ASSET_LIST,
            {
                options: {
                    skip,
                    take,
                    sort: {
                        createdAt: SortOrder.DESC,
                    },
                },
            },
            undefined,
            // By default do not load custom fields in the list view
            { includeCustomFields: [] },
        );
    }

    getAsset(id: string) {
        return this.baseDataService.query<Codegen.GetAssetQuery, Codegen.GetAssetQueryVariables>(GET_ASSET, {
            id,
        });
    }

    createAssets(files: File[]) {
        return this.baseDataService.mutate<
            Codegen.CreateAssetsMutation,
            Codegen.CreateAssetsMutationVariables
        >(CREATE_ASSETS, {
            input: files.map(file => ({ file })),
        });
    }

    updateAsset(input: Codegen.UpdateAssetInput) {
        return this.baseDataService.mutate<Codegen.UpdateAssetMutation, Codegen.UpdateAssetMutationVariables>(
            UPDATE_ASSET,
            {
                input,
            },
        );
    }

    deleteAssets(ids: string[], force: boolean) {
        return this.baseDataService.mutate<
            Codegen.DeleteAssetsMutation,
            Codegen.DeleteAssetsMutationVariables
        >(DELETE_ASSETS, {
            input: {
                assetIds: ids,
                force,
            },
        });
    }

    assignProductsToChannel(input: Codegen.AssignProductsToChannelInput) {
        return this.baseDataService.mutate<
            Codegen.AssignProductsToChannelMutation,
            Codegen.AssignProductsToChannelMutationVariables
        >(ASSIGN_PRODUCTS_TO_CHANNEL, {
            input,
        });
    }

    removeProductsFromChannel(input: Codegen.RemoveProductsFromChannelInput) {
        return this.baseDataService.mutate<
            Codegen.RemoveProductsFromChannelMutation,
            Codegen.RemoveProductsFromChannelMutationVariables
        >(REMOVE_PRODUCTS_FROM_CHANNEL, {
            input,
        });
    }

    assignVariantsToChannel(input: Codegen.AssignProductVariantsToChannelInput) {
        return this.baseDataService.mutate<
            Codegen.AssignVariantsToChannelMutation,
            Codegen.AssignVariantsToChannelMutationVariables
        >(ASSIGN_VARIANTS_TO_CHANNEL, {
            input,
        });
    }

    removeVariantsFromChannel(input: Codegen.RemoveProductVariantsFromChannelInput) {
        return this.baseDataService.mutate<
            Codegen.RemoveVariantsFromChannelMutation,
            Codegen.RemoveVariantsFromChannelMutationVariables
        >(REMOVE_VARIANTS_FROM_CHANNEL, {
            input,
        });
    }

    getTag(id: string) {
        return this.baseDataService.query<Codegen.GetTagQuery, Codegen.GetTagQueryVariables>(GET_TAG, { id });
    }

    getTagList(options?: Codegen.TagListOptions) {
        return this.baseDataService.query<Codegen.GetTagListQuery, Codegen.GetTagListQueryVariables>(
            GET_TAG_LIST,
            {
                options,
            },
        );
    }

    createTag(input: Codegen.CreateTagInput) {
        return this.baseDataService.mutate<Codegen.CreateTagMutation, Codegen.CreateTagMutationVariables>(
            CREATE_TAG,
            {
                input,
            },
        );
    }

    updateTag(input: Codegen.UpdateTagInput) {
        return this.baseDataService.mutate<Codegen.UpdateTagMutation, Codegen.UpdateTagMutationVariables>(
            UPDATE_TAG,
            {
                input,
            },
        );
    }

    deleteTag(id: string) {
        return this.baseDataService.mutate<Codegen.DeleteTagMutation, Codegen.DeleteTagMutationVariables>(
            DELETE_TAG,
            {
                id,
            },
        );
    }
}
