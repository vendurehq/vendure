import { gql } from 'graphql-tag';

export const commonApiExtensions = gql`
    type ProductReviewTranslation {
        id: ID!
        languageCode: LanguageCode!
        text: String!
    }

    type ProductReview implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        product: Product!
        productVariant: ProductVariant
        summary: String!
        body: String
        rating: Float!
        authorName: String!
        authorLocation: String
        upvotes: Int!
        downvotes: Int!
        state: String!
        response: String
        responseCreatedAt: DateTime
        translations: [ProductReviewTranslation!]!
    }

    type ProductReviewList implements PaginatedList {
        items: [ProductReview!]!
        totalItems: Int!
    }

    type ProductReviewHistogramItem {
        bin: Int!
        frequency: Int!
    }

    extend type Product {
        reviews(options: ProductReviewListOptions): ProductReviewList!
        reviewsHistogram: [ProductReviewHistogramItem!]!
    }

    # Auto-generated at runtime
    input ProductReviewListOptions
`;

export const adminApiExtensions = gql`
    ${commonApiExtensions}

    input ProductReviewTranslationInput {
        languageCode: LanguageCode!
        text: String!
    }

    input UpdateProductReviewInput {
        id: ID!
        summary: String
        body: String
        response: String
        state: String
        translations: [ProductReviewTranslationInput!]!
    }

    extend type ProductReview {
        author: Customer
    }

    extend type Query {
        productReviews(options: ProductReviewListOptions): ProductReviewList!
        productReview(id: ID!): ProductReview
    }

    extend type Mutation {
        updateProductReview(input: UpdateProductReviewInput!): ProductReview!
        approveProductReview(id: ID!): ProductReview
        rejectProductReview(id: ID!): ProductReview
    }
`;

export const shopApiExtensions = gql`
    ${commonApiExtensions}

    input SubmitProductReviewInput {
        productId: ID!
        variantId: ID
        customerId: ID
        summary: String!
        body: String!
        rating: Float!
        authorName: String!
        authorLocation: String
    }

    extend type Mutation {
        submitProductReview(input: SubmitProductReviewInput!): ProductReview!
        voteOnReview(id: ID!, vote: Boolean!): ProductReview!
    }
`;
