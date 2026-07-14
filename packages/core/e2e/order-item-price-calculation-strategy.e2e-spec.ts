import { DefaultSearchPlugin, mergeConfig } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { TestOrderItemPriceCalculationStrategy } from './fixtures/test-order-item-price-calculation-strategy';
import { FragmentOf, ResultOf } from './graphql/graphql-shop';
import {
    addItemToOrderCustomFieldsDocument,
    adjustOrderLineCustomFieldsDocument,
    orderWithLinesAndItemsFragment,
    searchProductsShopDocument,
} from './graphql/shop-definitions';

describe('custom OrderItemPriceCalculationStrategy', () => {
    let variants: ResultOf<typeof searchProductsShopDocument>['search']['items'];
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            customFields: {
                OrderLine: [{ name: 'giftWrap', type: 'boolean' }],
            },
            orderOptions: {
                orderItemPriceCalculationStrategy: new TestOrderItemPriceCalculationStrategy(),
            },
            plugins: [DefaultSearchPlugin],
        }),
    );

    type OrderWithLinesAndItems = FragmentOf<typeof orderWithLinesAndItemsFragment>;
    const orderGuard: ErrorResultGuard<OrderWithLinesAndItems> = createErrorResultGuard(
        input => !!input.lines,
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 3,
        });
        const { search } = await shopClient.query(searchProductsShopDocument, {
            input: { take: 3, groupByProduct: false },
        });
        variants = search.items;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    let secondOrderLineId: string;

    it('does not add surcharge', async () => {
        const variant0 = variants[0];
        const variantPrice = 'value' in variant0.price ? variant0.price.value : variant0.price.min;

        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variant0.productVariantId,
            quantity: 1,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].unitPrice).toEqual(variantPrice);
    });

    it('adds a surcharge', async () => {
        const variant0 = variants[0];
        const variantPrice = 'value' in variant0.price ? variant0.price.value : variant0.price.min;

        const { addItemToOrder } = await shopClient.query(addItemToOrderCustomFieldsDocument, {
            productVariantId: variant0.productVariantId,
            quantity: 1,
            customFields: {
                giftWrap: true,
            },
        } as any);
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].unitPrice).toEqual(variantPrice);
        expect(addItemToOrder.lines[1].unitPrice).toEqual(variantPrice + 500);
        expect(addItemToOrder.subTotal).toEqual(variantPrice + variantPrice + 500);
        secondOrderLineId = addItemToOrder.lines[1].id;
    });

    it('re-calculates when customFields changes', async () => {
        const variantPrice = 'value' in variants[0].price ? variants[0].price.value : variants[0].price.min;

        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: secondOrderLineId,
            quantity: 1,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);

        expect(adjustOrderLine.lines[0].unitPrice).toEqual(variantPrice);
        expect(adjustOrderLine.lines[1].unitPrice).toEqual(variantPrice);
        expect(adjustOrderLine.subTotal).toEqual(variantPrice + variantPrice);
    });

    it('applies discount for quantity greater than 3', async () => {
        const variantPrice = 'value' in variants[0].price ? variants[0].price.value : variants[0].price.min;

        const { adjustOrderLine } = await shopClient.query(adjustOrderLineCustomFieldsDocument, {
            orderLineId: secondOrderLineId,
            quantity: 4,
            customFields: {
                giftWrap: false,
            },
        } as any);
        orderGuard.assertSuccess(adjustOrderLine);

        expect(adjustOrderLine.lines[1].unitPrice).toEqual(variantPrice / 2);
        expect(adjustOrderLine.subTotal).toEqual(variantPrice + (variantPrice / 2) * 4);
    });
});
