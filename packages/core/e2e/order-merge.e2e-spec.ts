/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
    EventBus,
    mergeConfig,
    MergedOrderLine,
    MergeOrdersStrategy,
    Order,
    OrderEvent,
    OrderMergeStrategy,
    Product,
    RequestContext,
    UseExistingStrategy,
    UseGuestIfExistingEmptyStrategy,
    UseGuestStrategy,
} from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { currentUserFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql, ResultOf, VariablesOf } from './graphql/graphql-shop';
import {
    attemptLoginDocument,
    getCustomerListDocument,
    updateProductDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderCustomFieldsDocument,
    addItemToOrderDocument,
    getNextStatesDocument,
} from './graphql/shop-definitions';
import { sortById } from './utils/test-order-utils';

/**
 * Allows us to change the active OrderMergeStrategy per-test and delegates to the current
 * activeStrategy.
 */
class DelegateMergeStrategy implements OrderMergeStrategy {
    static activeStrategy: OrderMergeStrategy = new MergeOrdersStrategy();
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] {
        return DelegateMergeStrategy.activeStrategy.merge(ctx, guestOrder, existingOrder);
    }
}

type AddItemToOrderWithCustomFields = VariablesOf<typeof addItemToOrderDocument> & {
    customFields?: { inscription?: string; relationFieldId?: string };
};

const getActiveOrderWithCustomFieldsDocument = graphql(`
    query GetActiveOrderWithCustomFields {
        activeOrder {
            id
            code
            state
            active
            subTotal
            subTotalWithTax
            shipping
            shippingWithTax
            total
            totalWithTax
            currencyCode
            couponCodes
            discounts {
                adjustmentSource
                amount
                amountWithTax
                description
                type
            }
            lines {
                id
                quantity
                linePrice
                linePriceWithTax
                unitPrice
                unitPriceWithTax
                unitPriceChangeSinceAdded
                unitPriceWithTaxChangeSinceAdded
                discountedUnitPriceWithTax
                proratedUnitPriceWithTax
                productVariant {
                    id
                }
                discounts {
                    adjustmentSource
                    amount
                    amountWithTax
                    description
                    type
                }
                customFields {
                    inscription
                    relationField {
                        id
                    }
                }
            }
            shippingLines {
                priceWithTax
                shippingMethod {
                    id
                    code
                    description
                }
            }
        }
    }
`);

describe('Order merging', () => {
    type LoginSuccessResult = FragmentOf<typeof currentUserFragment>;
    const loginResultGuard: ErrorResultGuard<LoginSuccessResult> = createErrorResultGuard(
        input => !!input && 'id' in input && !('errorCode' in input),
    );

    let customers: ResultOf<typeof getCustomerListDocument>['customers']['items'];

    const { server, shopClient, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            orderOptions: {
                mergeStrategy: new DelegateMergeStrategy(),
            },
            customFields: {
                OrderLine: [
                    { name: 'inscription', type: 'string' },
                    {
                        name: 'relationField',
                        type: 'relation',
                        entity: Product,
                        graphQLType: 'Product',
                    },
                ],
            },
        }),
    );
    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 14,
        });
        await adminClient.asSuperAdmin();
        const result = await adminClient.query(getCustomerListDocument);
        customers = result.customers.items;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function testMerge(options: {
        strategy: OrderMergeStrategy;
        customerEmailAddress: string;
        existingOrderLines: AddItemToOrderWithCustomFields[];
        guestOrderLines: AddItemToOrderWithCustomFields[];
    }): Promise<{ lines: any[] }> {
        const { strategy, customerEmailAddress, existingOrderLines, guestOrderLines } = options;
        DelegateMergeStrategy.activeStrategy = strategy;

        await shopClient.asUserWithCredentials(customerEmailAddress, 'test');
        for (const line of existingOrderLines) {
            await shopClient.query(
                addItemToOrderCustomFieldsDocument,
                line as VariablesOf<typeof addItemToOrderCustomFieldsDocument>,
            );
        }

        await shopClient.asAnonymousUser();
        for (const line of guestOrderLines) {
            await shopClient.query(
                addItemToOrderCustomFieldsDocument,
                line as VariablesOf<typeof addItemToOrderCustomFieldsDocument>,
            );
        }

        await shopClient.query(attemptLoginDocument, {
            username: customerEmailAddress,
            password: 'test',
        });
        const { activeOrder } = await shopClient.query(getActiveOrderWithCustomFieldsDocument);

        if (!activeOrder) {
            throw new Error('Active order not found');
        }

        return activeOrder;
    }

    it('MergeOrdersStrategy adds new line', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[0].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_1', quantity: 1 }],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 1 }],
        });

        expect(
            result.lines.map(line => ({ productVariantId: line.productVariant.id, quantity: line.quantity })),
        ).toEqual([
            { productVariantId: 'T_1', quantity: 1 },
            { productVariantId: 'T_2', quantity: 1 },
        ]);
    });

    it('MergeOrdersStrategy uses guest quantity', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[1].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_1', quantity: 1 }],
            guestOrderLines: [{ productVariantId: 'T_1', quantity: 3 }],
        });

        expect(
            result.lines.map(line => ({ productVariantId: line.productVariant.id, quantity: line.quantity })),
        ).toEqual([{ productVariantId: 'T_1', quantity: 3 }]);
    });

    it('MergeOrdersStrategy accounts for customFields', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[2].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_1', quantity: 1, customFields: { inscription: 'foo' } },
            ],
            guestOrderLines: [{ productVariantId: 'T_1', quantity: 3, customFields: { inscription: 'bar' } }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
                customFields: line.customFields,
            })),
        ).toEqual([
            {
                productVariantId: 'T_1',
                quantity: 1,
                customFields: { inscription: 'foo', relationField: null },
            },
            {
                productVariantId: 'T_1',
                quantity: 3,
                customFields: { inscription: 'bar', relationField: null },
            },
        ]);
    });

    it('UseGuestStrategy', async () => {
        const result = await testMerge({
            strategy: new UseGuestStrategy(),
            customerEmailAddress: customers[3].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_1', quantity: 1 },
                { productVariantId: 'T_3', quantity: 1 },
            ],
            guestOrderLines: [{ productVariantId: 'T_5', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_5', quantity: 3 }]);
    });

    it('UseGuestStrategy with conflicting lines', async () => {
        const result = await testMerge({
            strategy: new UseGuestStrategy(),
            customerEmailAddress: customers[8].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_7', quantity: 1 },
                { productVariantId: 'T_8', quantity: 1 },
            ],
            guestOrderLines: [{ productVariantId: 'T_8', quantity: 3 }],
        });

        expect(
            (result?.lines || []).sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_8', quantity: 3 }]);
    });

    it('UseGuestIfExistingEmptyStrategy with empty existing', async () => {
        const result = await testMerge({
            strategy: new UseGuestIfExistingEmptyStrategy(),
            customerEmailAddress: customers[4].emailAddress,
            existingOrderLines: [],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_2', quantity: 3 }]);
    });

    it('UseGuestIfExistingEmptyStrategy with non-empty existing', async () => {
        const result = await testMerge({
            strategy: new UseGuestIfExistingEmptyStrategy(),
            customerEmailAddress: customers[5].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_5', quantity: 5 }],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_5', quantity: 5 }]);
    });

    it('UseExistingStrategy', async () => {
        const result = await testMerge({
            strategy: new UseExistingStrategy(),
            customerEmailAddress: customers[6].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_8', quantity: 1 }],
            guestOrderLines: [{ productVariantId: 'T_2', quantity: 3 }],
        });

        expect(
            result.lines.sort(sortById).map(line => ({
                productVariantId: line.productVariant.id,
                quantity: line.quantity,
            })),
        ).toEqual([{ productVariantId: 'T_8', quantity: 1 }]);
    });

    // https://github.com/vendurehq/vendure/issues/1454
    it('does not throw FK error when merging with a cart with an existing session', async () => {
        await shopClient.asUserWithCredentials(customers[7].emailAddress, 'test');
        // Create an Order linked with the current session
        await shopClient.query(getNextStatesDocument);

        // unset last auth token to simulate a guest user in a different browser
        shopClient.setAuthToken('');
        await shopClient.query(addItemToOrderDocument, { productVariantId: '1', quantity: 2 });

        const { login } = await shopClient.query(attemptLoginDocument, {
            username: customers[7].emailAddress,
            password: 'test',
        });

        loginResultGuard.assertSuccess(login);
        expect(login.id).toBe(customers[7].user?.id);
    });

    // https://github.com/vendurehq/vendure/issues/4481
    // When the merge fails mid-operation (e.g. a guest cart item's product has been disabled),
    // the merge should fail gracefully: the login should succeed and the existing order
    // should be preserved unchanged.
    it('should preserve existing order and succeed login when merge fails mid-operation', async () => {
        DelegateMergeStrategy.activeStrategy = new UseGuestStrategy();

        // Step 1: Customer logs in and adds an item to their order
        await shopClient.asUserWithCredentials(customers[9].emailAddress, 'test');
        await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: 'T_1',
            quantity: 2,
        } as VariablesOf<typeof addItemToOrderCustomFieldsDocument>);

        // Step 2: Log out and create a guest order with a different product
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: 'T_5',
            quantity: 1,
        } as VariablesOf<typeof addItemToOrderCustomFieldsDocument>);

        // Step 3: Disable the product that owns variant T_5 (Curvy Monitor = product T_2).
        // This will cause addItemsToOrder to throw EntityNotFoundError when the merge
        // tries to insert the guest line into the existing order.
        await adminClient.query(updateProductDocument, {
            input: { id: 'T_2', enabled: false },
        });

        // Step 4: Attempt login — triggers mergeOrders with UseGuestStrategy.
        // UseGuestStrategy says "replace existing order contents with guest order contents",
        // so the merge flow is:
        //   1. deleteOrder(guestOrder) — DB mutation
        //   2. removeItemFromOrder(T_1) — DB mutation (removes existing line)
        //   3. addItemsToOrder([T_5]) — THROWS (product disabled)
        // Without the fix: the error propagates, login fails
        // With the fix: merge error is caught, rolled back, login succeeds
        const { login } = await shopClient.query(attemptLoginDocument, {
            username: customers[9].emailAddress,
            password: 'test',
        });
        loginResultGuard.assertSuccess(login);
        expect(login.id).toBeDefined();

        // Step 5: The existing order should be preserved with its original line
        const { activeOrder } = await shopClient.query(getActiveOrderWithCustomFieldsDocument);
        expect(activeOrder).not.toBeNull();
        expect(activeOrder!.lines.length).toBe(1);
        expect(activeOrder!.lines[0].productVariant.id).toBe('T_1');
        expect(activeOrder!.lines[0].quantity).toBe(2);

        // Cleanup: re-enable the product
        await adminClient.query(updateProductDocument, {
            input: { id: 'T_2', enabled: true },
        });
    });
    it('MergeOrdersStrategy preserves relation custom fields from guest order', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[10].emailAddress,
            existingOrderLines: [{ productVariantId: 'T_2', quantity: 2 }],
            guestOrderLines: [
                { productVariantId: 'T_3', quantity: 4, customFields: { relationFieldId: 'T_1' } },
            ],
        });
        const guestLine = result.lines.find(line => line.quantity === 4);
        expect(guestLine).toBeDefined();
        expect(guestLine?.customFields.relationField?.id).toBe('T_1');
    });
    it('MergeOrdersStrategy does not merge lines with different relation custom fields', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[12].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_1', quantity: 1, customFields: { relationFieldId: 'T_4' } },
            ],
            guestOrderLines: [
                { productVariantId: 'T_1', quantity: 3, customFields: { relationFieldId: 'T_1' } },
            ],
        });
        expect(result.lines).toHaveLength(2);
        const existingLine = result.lines.find(line => line.customFields.relationField?.id === 'T_4');
        const guestLine = result.lines.find(line => line.customFields.relationField?.id === 'T_1');
        expect(existingLine).toBeDefined();
        expect(existingLine?.quantity).toBe(1);
        expect(guestLine).toBeDefined();
        expect(guestLine?.quantity).toBe(3);
    });
    it('MergeOrdersStrategy merges lines with the same relation custom field', async () => {
        const result = await testMerge({
            strategy: new MergeOrdersStrategy(),
            customerEmailAddress: customers[13].emailAddress,
            existingOrderLines: [
                { productVariantId: 'T_1', quantity: 1, customFields: { relationFieldId: 'T_4' } },
            ],
            guestOrderLines: [
                { productVariantId: 'T_1', quantity: 3, customFields: { relationFieldId: 'T_4' } },
            ],
        });
        expect(result.lines).toHaveLength(1);
        expect(result.lines[0].productVariant.id).toBe('T_1');
        expect(result.lines[0].quantity).toBe(3);
        expect(result.lines[0].customFields.relationField?.id).toBe('T_4');
    });

    // #5189 — login with an existing active cart and no guest cart must not publish OrderEvent
    it('login with existing cart and no guest cart publishes zero OrderEvents', async () => {
        const eventBus = server.app.get(EventBus);
        const events: OrderEvent[] = [];
        const subscription = eventBus.ofType(OrderEvent).subscribe(event => events.push(event));

        // Log in as a customer who already has an active order, with no guest cart
        await shopClient.asUserWithCredentials(customers[0].emailAddress, 'test');

        // Allow any async event delivery to settle
        await new Promise(resolve => setTimeout(resolve, 100));

        expect(events).toHaveLength(0);
        subscription.unsubscribe();
    });
});
