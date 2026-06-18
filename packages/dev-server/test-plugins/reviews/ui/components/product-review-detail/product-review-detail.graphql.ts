import gql from 'graphql-tag';

import { PRODUCT_REVIEW_FRAGMENT } from '../../common/fragments.graphql';

export const UPDATE_REVIEW = gql`
    mutation UpdateReview($input: UpdateProductReviewInput!) {
        updateProductReview(input: $input) {
            ...ProductReview
        }
    }
    ${PRODUCT_REVIEW_FRAGMENT}
`;

export const APPROVE_REVIEW = gql`
    mutation ApproveReview($id: ID!) {
        approveProductReview(id: $id) {
            id
            state
            product {
                id
                customFields {
                    reviewCount
                    reviewRating
                }
            }
        }
    }
`;

export const REJECT_REVIEW = gql`
    mutation RejectReview($id: ID!) {
        rejectProductReview(id: $id) {
            id
            state
        }
    }
`;
