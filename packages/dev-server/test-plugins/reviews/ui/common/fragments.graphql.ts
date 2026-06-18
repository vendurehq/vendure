import gql from 'graphql-tag';

export const PRODUCT_REVIEW_FRAGMENT = gql`
    fragment ProductReview on ProductReview {
        id
        createdAt
        updatedAt
        authorName
        authorLocation
        summary
        body
        rating
        state
        upvotes
        downvotes
        response
        responseCreatedAt
    }
`;
