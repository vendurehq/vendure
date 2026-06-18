import { gql } from 'apollo-angular';

export const GET_SELLER_ORDERS = gql`
    query GetSellerOrders($orderId: ID!) {
        order(id: $orderId) {
            id
            sellerOrders {
                id
                code
                state
                orderPlacedAt
                currencyCode
                totalWithTax
                channels {
                    id
                    code
                    seller {
                        id
                        name
                    }
                }
            }
        }
    }
`;
