export const adminApiExtensions = `
    extend type Mutation {
        approveMarketplaceProduct(productId: ID!): Boolean!
        rejectMarketplaceProduct(productId: ID!, reason: String!): Boolean!
        submitForMarketplaceAdmin(productId: ID!): Boolean!
        setProductPlatformCategory(productId: ID!, collectionId: String): Boolean!
        issueMerchantApiToken(channelId: ID!, ttlSeconds: Int): MerchantApiToken!
    }
    type MerchantApiToken {
        token: String!
        expiresAt: String!
    }
    extend type Query {
        marketplacePendingProducts: [Product!]!
        approvedMarketplaceProducts: [Product!]!
        platformCollections: [PlatformCollectionNode!]!
        marketplaceMerchantChannel: Channel!
        merchantOrders(saleSource: String, options: OrderListOptions): OrderList!
    }
    type PlatformCollectionNode {
        id: ID!
        name: String!
        parentId: ID
    }
`;