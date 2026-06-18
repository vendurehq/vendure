import gql from 'graphql-tag';

const productBundleAdminApiExtensions = gql`
    type ProductBundle implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String!
        description: String!
    }

    type ProductBundleItem {
        productVariant: ProductVariant!
        price: Money!
        quantity: Int!
    }

    type ProductBundleList implements PaginatedList {
        items: [ProductBundle!]!
        totalItems: Int!
    }

    # Generated at run-time by Vendure
    input ProductBundleListOptions

    extend type Query {
        productBundle(id: ID!): ProductBundle
        productBundles(options: ProductBundleListOptions): ProductBundleList!
    }

    input CreateProductBundleInput {
        name: String!
        description: String!
    }

    input UpdateProductBundleInput {
        id: ID!
        name: String
        description: String
    }

    input CreateProductBundleItemInput {
        bundleId: ID!
        productVariantId: ID!
        price: Money!
        quantity: Int!
    }

    input UpdateProductBundleItemInput {
        id: ID!
        price: Money
        quantity: Int
    }

    extend type Mutation {
        createProductBundle(input: CreateProductBundleInput!): ProductBundle!
        updateProductBundle(input: UpdateProductBundleInput!): ProductBundle!
        deleteProductBundle(id: ID!): DeletionResponse!
        createProductBundleItem(input: CreateProductBundleItemInput!): ProductBundleItem!
        updateProductBundleItem(input: UpdateProductBundleItemInput!): ProductBundleItem!
        deleteProductBundleItem(id: ID!): DeletionResponse!
    }
`;
export const adminApiExtensions = gql`
    ${productBundleAdminApiExtensions}
`;

export const shopApiExtensions = gql`
    extend type Mutation {
        addProductBundleToOrder(bundleId: ID!): UpdateOrderItemsResult!
        removeProductBundleFromOrder(bundleId: ID!): RemoveOrderItemsResult!
    }
`;
