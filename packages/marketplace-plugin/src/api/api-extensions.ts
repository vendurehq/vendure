export const shopApiExtensions = `
    extend type Mutation {
        registerMarketplaceSeller(input: RegisterMarketplaceSellerInput!): RegisterMarketplaceSellerResult!
        submitForMarketplace(productId: ID!): Boolean!
        marketplaceApprove(productId: ID!): Boolean!
        marketplaceReject(productId: ID!, reason: String!): Boolean!
    }

    extend type Query {
        marketplaceProducts(take: Int, skip: Int): [MarketplaceProduct!]!
        marketplaceProductPage(take: Int, skip: Int): MarketplaceProductPage!
        myMerchantProducts: [MyProduct!]!
        marketplacePendingProducts: [MyProduct!]!
    }

    type MarketplaceProductPage {
        items: [MarketplaceProduct!]!
        totalItems: Int!
    }

    type MyProduct {
        id: ID!
        name: String!
        slug: String!
        barcode: String
        internalCode: String
        marketplaceStatus: String!
        rejectReason: String
        listedInMarketplace: Boolean!
    }

    type MarketplaceProduct {
        id: ID!
        name: String!
        slug: String!
        barcode: String
        internalCode: String
        merchantChannel: MarketplaceMerchantChannel
    }

    type MarketplaceMerchantChannel {
        id: ID!
        code: String!
        name: String!
    }

    input RegisterMarketplaceSellerInput {
        shopName: String!
        seller: CreateSellerInput!
    }

    input CreateSellerInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
        password: String!
    }

    type RegisterMarketplaceSellerSuccess {
        id: ID!
        code: String!
        token: String!
    }

    type RegisterMarketplaceSellerError {
        errorCode: String!
        message: String!
    }

    union RegisterMarketplaceSellerResult = RegisterMarketplaceSellerSuccess | RegisterMarketplaceSellerError
`;