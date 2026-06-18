import { gql } from 'apollo-angular';

import {
    CONFIGURABLE_OPERATION_DEF_FRAGMENT,
    CONFIGURABLE_OPERATION_FRAGMENT,
    ERROR_RESULT_FRAGMENT,
} from './shared-definitions';

export const PROMOTION_FRAGMENT = gql`
    fragment Promotion on Promotion {
        id
        createdAt
        updatedAt
        name
        description
        enabled
        couponCode
        perCustomerUsageLimit
        usageLimit
        startsAt
        endsAt
        conditions {
            ...ConfigurableOperation
        }
        actions {
            ...ConfigurableOperation
        }
        translations {
            id
            languageCode
            name
            description
        }
    }
    ${CONFIGURABLE_OPERATION_FRAGMENT}
`;

export const GET_ADJUSTMENT_OPERATIONS = gql`
    query GetAdjustmentOperations {
        promotionConditions {
            ...ConfigurableOperationDef
        }
        promotionActions {
            ...ConfigurableOperationDef
        }
    }
    ${CONFIGURABLE_OPERATION_DEF_FRAGMENT}
`;

export const CREATE_PROMOTION = gql`
    mutation CreatePromotion($input: CreatePromotionInput!) {
        createPromotion(input: $input) {
            ...Promotion
            ...ErrorResult
        }
    }
    ${PROMOTION_FRAGMENT}
    ${ERROR_RESULT_FRAGMENT}
`;

export const UPDATE_PROMOTION = gql`
    mutation UpdatePromotion($input: UpdatePromotionInput!) {
        updatePromotion(input: $input) {
            ...Promotion
        }
    }
    ${PROMOTION_FRAGMENT}
`;

export const DELETE_PROMOTION = gql`
    mutation DeletePromotion($id: ID!) {
        deletePromotion(id: $id) {
            result
            message
        }
    }
`;

export const DELETE_PROMOTIONS = gql`
    mutation DeletePromotions($ids: [ID!]!) {
        deletePromotions(ids: $ids) {
            result
            message
        }
    }
`;
