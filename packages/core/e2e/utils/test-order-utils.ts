/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ID } from '@vendure/common/lib/shared-types';
import { PaymentMethodHandler } from '@vendure/core';
import { SimpleGraphQLClient } from '@vendure/testing';

import { ResultOf } from '../graphql/graphql-shop';
import {
    addPaymentDocument,
    getEligibleShippingMethodsDocument,
    setShippingAddressDocument,
    setShippingMethodDocument,
    transitionToStateDocument,
} from '../graphql/shop-definitions';

export async function proceedToArrangingPayment(
    shopClient: SimpleGraphQLClient,
    shippingMethodIdx = 1,
): Promise<ID> {
    await shopClient.query(setShippingAddressDocument, {
        input: {
            fullName: 'name',
            streetLine1: '12 the street',
            city: 'foo',
            postalCode: '123456',
            countryCode: 'US',
        },
    });

    const { eligibleShippingMethods } = await shopClient.query(getEligibleShippingMethodsDocument);

    await shopClient.query(setShippingMethodDocument, {
        id: [eligibleShippingMethods[shippingMethodIdx].id],
    });

    const { transitionOrderToState } = await shopClient.query(transitionToStateDocument, {
        state: 'ArrangingPayment',
    });

    return (transitionOrderToState as Extract<typeof transitionOrderToState, { id: string }>).id;
}

export async function addPaymentToOrder(
    shopClient: SimpleGraphQLClient,
    handler: PaymentMethodHandler,
): Promise<
    Extract<NonNullable<ResultOf<typeof addPaymentDocument>['addPaymentToOrder']>, { __typename?: 'Order' }>
> {
    const result = await shopClient.query(addPaymentDocument, {
        input: {
            method: handler.code,
            metadata: {
                baz: 'quux',
            },
        },
    });
    return result.addPaymentToOrder as any;
}

/**
 * Sorts an array of entities by the id key. Useful for compensating for the fact that different DBs
 * return arrays in different orders.
 */
export function sortById<T extends { id: string | number }>(a: T, b: T): 1 | -1 {
    return a.id < b.id ? -1 : 1;
}
