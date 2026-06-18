import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    type WishlistItem implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        productVariant: ProductVariant!
        productVariantId: ID!
    }

    extend type Query {
        activeCustomerWishlist: [WishlistItem!]!
    }

    extend type Mutation {
        addToWishlist(productVariantId: ID!): [WishlistItem!]!
        removeFromWishlist(itemId: ID!): [WishlistItem!]!
    }
`;
