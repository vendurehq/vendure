import { gql } from 'apollo-angular';

import { ERROR_RESULT_FRAGMENT } from './shared-definitions';

export const ASSET_FRAGMENT = gql`
    fragment Asset on Asset {
        id
        createdAt
        updatedAt
        name
        fileSize
        mimeType
        type
        preview
        source
        width
        height
        focalPoint {
            x
            y
        }
    }
`;

export const TAG_FRAGMENT = gql`
    fragment Tag on Tag {
        id
        value
    }
`;

export const PRODUCT_OPTION_GROUP_FRAGMENT = gql`
    fragment ProductOptionGroup on ProductOptionGroup {
        id
        createdAt
        updatedAt
        code
        languageCode
        name
        translations {
            id
            languageCode
            name
        }
    }
`;

export const PRODUCT_OPTION_FRAGMENT = gql`
    fragment ProductOption on ProductOption {
        id
        createdAt
        updatedAt
        code
        languageCode
        name
        groupId
        translations {
            id
            languageCode
            name
        }
    }
`;

export const PRODUCT_VARIANT_PRICE_FRAGMENT = gql`
    fragment ProductVariantPrice on ProductVariantPrice {
        price
        currencyCode
    }
`;

export const PRODUCT_VARIANT_FRAGMENT = gql`
    fragment ProductVariant on ProductVariant {
        id
        createdAt
        updatedAt
        enabled
        languageCode
        name
        price
        currencyCode
        priceWithTax
        stockOnHand
        stockAllocated
        trackInventory
        outOfStockThreshold
        useGlobalOutOfStockThreshold
        taxRateApplied {
            id
            name
            value
        }
        taxCategory {
            id
            name
        }
        sku
        options {
            ...ProductOption
        }
        facetValues {
            id
            code
            name
            facet {
                id
                name
            }
        }
        featuredAsset {
            ...Asset
        }
        assets {
            ...Asset
        }
        translations {
            id
            languageCode
            name
        }
        channels {
            id
            code
        }
    }
    ${PRODUCT_OPTION_FRAGMENT}
    ${ASSET_FRAGMENT}
`;

export const PRODUCT_DETAIL_FRAGMENT = gql`
    fragment ProductDetail on Product {
        id
        createdAt
        updatedAt
        enabled
        languageCode
        name
        slug
        description
        featuredAsset {
            ...Asset
        }
        assets {
            ...Asset
        }
        translations {
            id
            languageCode
            name
            slug
            description
        }
        optionGroups {
            ...ProductOptionGroup
        }
        facetValues {
            id
            code
            name
            facet {
                id
                name
            }
        }
        channels {
            id
            code
        }
    }
    ${PRODUCT_OPTION_GROUP_FRAGMENT}
    ${ASSET_FRAGMENT}
`;

export const PRODUCT_OPTION_GROUP_WITH_OPTIONS_FRAGMENT = gql`
    fragment ProductOptionGroupWithOptions on ProductOptionGroup {
        id
        createdAt
        updatedAt
        languageCode
        code
        name
        translations {
            id
            name
        }
        options {
            id
            languageCode
            name
            code
            translations {
                name
            }
        }
    }
`;

export const UPDATE_PRODUCT = gql`
    mutation UpdateProduct($input: UpdateProductInput!, $variantListOptions: ProductVariantListOptions) {
        updateProduct(input: $input) {
            ...ProductDetail
            variantList(options: $variantListOptions) {
                items {
                    ...ProductVariant
                }
                totalItems
            }
        }
    }
    ${PRODUCT_DETAIL_FRAGMENT}
    ${PRODUCT_VARIANT_FRAGMENT}
`;

export const CREATE_PRODUCT = gql`
    mutation CreateProduct($input: CreateProductInput!, $variantListOptions: ProductVariantListOptions) {
        createProduct(input: $input) {
            ...ProductDetail
            variantList(options: $variantListOptions) {
                items {
                    ...ProductVariant
                }
                totalItems
            }
        }
    }
    ${PRODUCT_DETAIL_FRAGMENT}
    ${PRODUCT_VARIANT_FRAGMENT}
`;

export const DELETE_PRODUCT = gql`
    mutation DeleteProduct($id: ID!) {
        deleteProduct(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_PRODUCTS = gql`
    mutation DeleteProducts($ids: [ID!]!) {
        deleteProducts(ids: $ids) {
            result
            message
        }
    }
`;

export const CREATE_PRODUCT_VARIANTS = gql`
    mutation CreateProductVariants($input: [CreateProductVariantInput!]!) {
        createProductVariants(input: $input) {
            ...ProductVariant
        }
    }
    ${PRODUCT_VARIANT_FRAGMENT}
`;

export const UPDATE_PRODUCT_VARIANTS = gql`
    mutation UpdateProductVariants($input: [UpdateProductVariantInput!]!) {
        updateProductVariants(input: $input) {
            ...ProductVariant
        }
    }
    ${PRODUCT_VARIANT_FRAGMENT}
`;

export const CREATE_PRODUCT_OPTION_GROUP = gql`
    mutation CreateProductOptionGroup($input: CreateProductOptionGroupInput!) {
        createProductOptionGroup(input: $input) {
            ...ProductOptionGroupWithOptions
        }
    }
    ${PRODUCT_OPTION_GROUP_WITH_OPTIONS_FRAGMENT}
`;

export const GET_PRODUCT_OPTION_GROUP = gql`
    query GetProductOptionGroup($id: ID!) {
        productOptionGroup(id: $id) {
            ...ProductOptionGroupWithOptions
        }
    }
    ${PRODUCT_OPTION_GROUP_WITH_OPTIONS_FRAGMENT}
`;

export const ADD_OPTION_TO_GROUP = gql`
    mutation AddOptionToGroup($input: CreateProductOptionInput!) {
        createProductOption(input: $input) {
            id
            createdAt
            updatedAt
            name
            code
            groupId
        }
    }
`;

export const ADD_OPTION_GROUP_TO_PRODUCT = gql`
    mutation AddOptionGroupToProduct($productId: ID!, $optionGroupId: ID!) {
        addOptionGroupToProduct(productId: $productId, optionGroupId: $optionGroupId) {
            id
            createdAt
            updatedAt
            optionGroups {
                id
                createdAt
                updatedAt
                code
                options {
                    id
                    createdAt
                    updatedAt
                    code
                }
            }
        }
    }
`;

export const REMOVE_OPTION_GROUP_FROM_PRODUCT = gql`
    mutation RemoveOptionGroupFromProduct($productId: ID!, $optionGroupId: ID!, $force: Boolean) {
        removeOptionGroupFromProduct(productId: $productId, optionGroupId: $optionGroupId, force: $force) {
            ... on Product {
                id
                createdAt
                updatedAt
                optionGroups {
                    id
                    createdAt
                    updatedAt
                    code
                    options {
                        id
                        createdAt
                        updatedAt
                        code
                    }
                }
            }
            ...ErrorResult
        }
    }
    ${ERROR_RESULT_FRAGMENT}
`;

export const GET_PRODUCT_WITH_VARIANTS = gql`
    query GetProductWithVariants($id: ID!, $variantListOptions: ProductVariantListOptions) {
        product(id: $id) {
            ...ProductDetail
            variantList(options: $variantListOptions) {
                items {
                    ...ProductVariant
                }
                totalItems
            }
        }
    }
    ${PRODUCT_DETAIL_FRAGMENT}
    ${PRODUCT_VARIANT_FRAGMENT}
`;

export const GET_PRODUCT_SIMPLE = gql`
    query GetProductSimple($id: ID!) {
        product(id: $id) {
            id
            name
            featuredAsset {
                ...Asset
            }
        }
    }
    ${ASSET_FRAGMENT}
`;

export const PRODUCT_FOR_LIST_FRAGMENT = gql`
    fragment ProductForList on Product {
        id
        createdAt
        updatedAt
        enabled
        languageCode
        name
        slug
        featuredAsset {
            id
            createdAt
            updatedAt
            preview
            focalPoint {
                x
                y
            }
        }
        variantList {
            totalItems
        }
    }
`;

export const GET_PRODUCT_LIST = gql`
    query GetProductList($options: ProductListOptions) {
        products(options: $options) {
            items {
                ...ProductForList
            }
            totalItems
        }
    }
    ${PRODUCT_FOR_LIST_FRAGMENT}
`;

export const GET_PRODUCT_OPTION_GROUPS = gql`
    query GetProductOptionGroups($options: ProductOptionGroupListOptions) {
        productOptionGroups(options: $options) {
            items {
                id
                createdAt
                updatedAt
                languageCode
                code
                name
                options {
                    id
                    createdAt
                    updatedAt
                    languageCode
                    code
                    name
                }
            }
            totalItems
        }
    }
`;

export const GET_ASSET_LIST = gql`
    query GetAssetList($options: AssetListOptions) {
        assets(options: $options) {
            items {
                ...Asset
                tags {
                    ...Tag
                }
            }
            totalItems
        }
    }
    ${ASSET_FRAGMENT}
    ${TAG_FRAGMENT}
`;

export const GET_ASSET = gql`
    query GetAsset($id: ID!) {
        asset(id: $id) {
            ...Asset
            tags {
                ...Tag
            }
        }
    }
    ${ASSET_FRAGMENT}
    ${TAG_FRAGMENT}
`;

export const CREATE_ASSETS = gql`
    mutation CreateAssets($input: [CreateAssetInput!]!) {
        createAssets(input: $input) {
            ...Asset
            ... on Asset {
                tags {
                    ...Tag
                }
            }
            ... on ErrorResult {
                message
            }
        }
    }
    ${ASSET_FRAGMENT}
    ${TAG_FRAGMENT}
`;

export const UPDATE_ASSET = gql`
    mutation UpdateAsset($input: UpdateAssetInput!) {
        updateAsset(input: $input) {
            ...Asset
            tags {
                ...Tag
            }
        }
    }
    ${ASSET_FRAGMENT}
    ${TAG_FRAGMENT}
`;

export const DELETE_ASSETS = gql`
    mutation DeleteAssets($input: DeleteAssetsInput!) {
        deleteAssets(input: $input) {
            result
            message
        }
    }
`;

export const SEARCH_PRODUCTS = gql`
    query SearchProducts($input: SearchInput!) {
        search(input: $input) {
            totalItems
            items {
                enabled
                productId
                productName
                slug
                priceWithTax {
                    ... on PriceRange {
                        min
                        max
                    }
                    ... on SinglePrice {
                        value
                    }
                }
                productAsset {
                    id
                    preview
                    focalPoint {
                        x
                        y
                    }
                }
                currencyCode
                productVariantId
                productVariantName
                productVariantAsset {
                    id
                    preview
                    focalPoint {
                        x
                        y
                    }
                }
                sku
                channelIds
            }
            facetValues {
                count
                facetValue {
                    id
                    createdAt
                    updatedAt
                    name
                    facet {
                        id
                        createdAt
                        updatedAt
                        name
                    }
                }
            }
        }
    }
`;

export const PRODUCT_SELECTOR_SEARCH = gql`
    query ProductSelectorSearch($term: String!, $take: Int!) {
        search(input: { groupByProduct: false, term: $term, take: $take }) {
            items {
                productVariantId
                productVariantName
                productAsset {
                    id
                    preview
                    focalPoint {
                        x
                        y
                    }
                }
                price {
                    ... on SinglePrice {
                        value
                    }
                }
                priceWithTax {
                    ... on SinglePrice {
                        value
                    }
                }
                sku
            }
        }
    }
`;

export const UPDATE_PRODUCT_OPTION_GROUP = gql`
    mutation UpdateProductOptionGroup($input: UpdateProductOptionGroupInput!) {
        updateProductOptionGroup(input: $input) {
            ...ProductOptionGroup
        }
    }
    ${PRODUCT_OPTION_GROUP_FRAGMENT}
`;

export const UPDATE_PRODUCT_OPTION = gql`
    mutation UpdateProductOption($input: UpdateProductOptionInput!) {
        updateProductOption(input: $input) {
            ...ProductOption
        }
    }
    ${PRODUCT_OPTION_FRAGMENT}
`;

export const DELETE_PRODUCT_OPTION = gql`
    mutation DeleteProductOption($id: ID!) {
        deleteProductOption(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_PRODUCT_VARIANT = gql`
    mutation DeleteProductVariant($id: ID!) {
        deleteProductVariant(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_PRODUCT_VARIANTS = gql`
    mutation DeleteProductVariants($ids: [ID!]!) {
        deleteProductVariants(ids: $ids) {
            result
            message
        }
    }
`;

export const GET_PRODUCT_VARIANT_OPTIONS = gql`
    query GetProductVariantOptions($id: ID!) {
        product(id: $id) {
            id
            createdAt
            updatedAt
            name
            languageCode
            optionGroups {
                ...ProductOptionGroup
                options {
                    ...ProductOption
                }
            }
            variants {
                id
                createdAt
                updatedAt
                enabled
                name
                sku
                price
                priceWithTax
                currencyCode
                stockOnHand
                enabled
                options {
                    id
                    createdAt
                    updatedAt
                    name
                    code
                    groupId
                }
            }
        }
    }
    ${PRODUCT_OPTION_GROUP_FRAGMENT}
    ${PRODUCT_OPTION_FRAGMENT}
`;

export const ASSIGN_PRODUCTS_TO_CHANNEL = gql`
    mutation AssignProductsToChannel($input: AssignProductsToChannelInput!) {
        assignProductsToChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`;

export const ASSIGN_VARIANTS_TO_CHANNEL = gql`
    mutation AssignVariantsToChannel($input: AssignProductVariantsToChannelInput!) {
        assignProductVariantsToChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`;

export const REMOVE_PRODUCTS_FROM_CHANNEL = gql`
    mutation RemoveProductsFromChannel($input: RemoveProductsFromChannelInput!) {
        removeProductsFromChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`;

export const REMOVE_VARIANTS_FROM_CHANNEL = gql`
    mutation RemoveVariantsFromChannel($input: RemoveProductVariantsFromChannelInput!) {
        removeProductVariantsFromChannel(input: $input) {
            id
            channels {
                id
                code
            }
        }
    }
`;

export const GET_PRODUCT_VARIANT = gql`
    query GetProductVariant($id: ID!) {
        productVariant(id: $id) {
            id
            name
            sku
            stockOnHand
            stockAllocated
            stockLevel
            useGlobalOutOfStockThreshold
            featuredAsset {
                id
                preview
                focalPoint {
                    x
                    y
                }
            }
            price
            priceWithTax
            product {
                id
                featuredAsset {
                    id
                    preview
                    focalPoint {
                        x
                        y
                    }
                }
            }
        }
    }
`;

export const GET_PRODUCT_VARIANT_LIST_SIMPLE = gql`
    query GetProductVariantListSimple($options: ProductVariantListOptions!, $productId: ID) {
        productVariants(options: $options, productId: $productId) {
            items {
                id
                name
                sku
                featuredAsset {
                    id
                    preview
                    focalPoint {
                        x
                        y
                    }
                }
                product {
                    id
                    featuredAsset {
                        id
                        preview
                        focalPoint {
                            x
                            y
                        }
                    }
                }
            }
            totalItems
        }
    }
`;

export const GET_PRODUCT_VARIANT_LIST_FOR_PRODUCT = gql`
    query GetProductVariantListForProduct($options: ProductVariantListOptions!, $productId: ID) {
        productVariants(options: $options, productId: $productId) {
            items {
                ...ProductVariant
            }
            totalItems
        }
    }
    ${PRODUCT_VARIANT_FRAGMENT}
`;

export const GET_PRODUCT_VARIANT_LIST = gql`
    query GetProductVariantList($options: ProductVariantListOptions!) {
        productVariants(options: $options) {
            items {
                id
                createdAt
                updatedAt
                enabled
                languageCode
                name
                price
                currencyCode
                priceWithTax
                trackInventory
                outOfStockThreshold
                stockLevels {
                    id
                    createdAt
                    updatedAt
                    stockLocationId
                    stockOnHand
                    stockAllocated
                    stockLocation {
                        id
                        createdAt
                        updatedAt
                        name
                    }
                }
                useGlobalOutOfStockThreshold
                sku
                featuredAsset {
                    ...Asset
                }
            }
            totalItems
        }
    }
    ${ASSET_FRAGMENT}
`;

export const GET_TAG_LIST = gql`
    query GetTagList($options: TagListOptions) {
        tags(options: $options) {
            items {
                ...Tag
            }
            totalItems
        }
    }
    ${TAG_FRAGMENT}
`;

export const GET_TAG = gql`
    query GetTag($id: ID!) {
        tag(id: $id) {
            ...Tag
        }
    }
    ${TAG_FRAGMENT}
`;

export const CREATE_TAG = gql`
    mutation CreateTag($input: CreateTagInput!) {
        createTag(input: $input) {
            ...Tag
        }
    }
    ${TAG_FRAGMENT}
`;

export const UPDATE_TAG = gql`
    mutation UpdateTag($input: UpdateTagInput!) {
        updateTag(input: $input) {
            ...Tag
        }
    }
    ${TAG_FRAGMENT}
`;

export const DELETE_TAG = gql`
    mutation DeleteTag($id: ID!) {
        deleteTag(id: $id) {
            message
            result
        }
    }
`;
