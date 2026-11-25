import { LanguageCode, SortOrder } from '@vendure/common/lib/generated-types';
import { Logger, mergeConfig, MoneyStrategy, VendurePlugin } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { ColumnOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { FragmentOf } from './graphql/graphql-shop';
import { createPromotionDocument, getProductVariantListDocument } from './graphql/shared-definitions';
import {
    applyCouponCodeDocument,
    localAddItemToOrderDocument,
    localUpdatedOrderFragment,
} from './graphql/shop-definitions';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

type UpdatedOrder = FragmentOf<typeof localUpdatedOrderFragment>;
const orderGuard: ErrorResultGuard<UpdatedOrder> = createErrorResultGuard(input => !!input.total);

class CustomMoneyStrategy implements MoneyStrategy {
    readonly precision = 4;
    static transformerFromSpy = vi.fn();
    readonly moneyColumnOptions: ColumnOptions = {
        type: 'bigint',
        transformer: {
            to: (entityValue: number) => {
                return entityValue;
            },
            from: (databaseValue: string): number => {
                CustomMoneyStrategy.transformerFromSpy(databaseValue);
                if (databaseValue == null) {
                    return databaseValue;
                }
                const intVal = Number.parseInt(databaseValue, 10);
                if (!Number.isSafeInteger(intVal)) {
                    Logger.warn(`Monetary value ${databaseValue} is not a safe integer!`);
                }
                if (Number.isNaN(intVal)) {
                    Logger.warn(`Monetary value ${databaseValue} is not a number!`);
                }
                return intVal;
            },
        },
    };

    round(value: number, quantity = 1): number {
        return Math.round(value * quantity);
    }
}

@VendurePlugin({
    configuration: config => {
        config.entityOptions.moneyStrategy = new CustomMoneyStrategy();
        return config;
    },
})
class MyPlugin {}

describe('Custom MoneyStrategy', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [MyPlugin],
        }),
    );

    let cheapVariantId: string;
    let expensiveVariantId: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-money-handling.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('check initial prices', async () => {
        expect(CustomMoneyStrategy.transformerFromSpy).toHaveBeenCalledTimes(0);

        const { productVariants } = await adminClient.query(getProductVariantListDocument, {
            options: {
                sort: {
                    price: SortOrder.ASC,
                },
            },
        });
        expect(productVariants.items[0].price).toBe(31);
        expect(productVariants.items[0].priceWithTax).toBe(37);
        const expensiveVariant = productVariants.items.find(variant => variant.sku === 'EW0001')!;
        expect(expensiveVariant.price).toBe(99_999_990_000);
        expect(expensiveVariant.priceWithTax).toBe(119_999_988_000);

        cheapVariantId = productVariants.items[0].id;
        expensiveVariantId = expensiveVariant.id;

        expect(productVariants.items.length).toBe(4);
        expect(CustomMoneyStrategy.transformerFromSpy).toHaveBeenCalledTimes(4);
    });

    // https://github.com/vendurehq/vendure/issues/838
    it('can handle totals over 21 million', async () => {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(localAddItemToOrderDocument, {
            productVariantId: expensiveVariantId,
            quantity: 2,
        });
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].linePrice).toBe(199_999_980_000);
        expect(addItemToOrder.lines[0].linePriceWithTax).toBe(239_999_976_000);
    });

    // https://github.com/vendurehq/vendure/issues/1835
    // 31 * 1.2 = 37.2
    // Math.round(37.2 * 10) =372
    it('tax calculation rounds at the unit level', async () => {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(localAddItemToOrderDocument, {
            productVariantId: cheapVariantId,
            quantity: 10,
        });
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].linePrice).toBe(310);
        expect(addItemToOrder.lines[0].linePriceWithTax).toBe(372);
    });

    it.each([
        ['ERP1235', 247_000],
        ['ERP9595', 191_900],
    ] as const)('preserves the imported unit price of %s across an order line', async (sku, total) => {
        const { productVariants } = await adminClient.query(getProductVariantListDocument, {
            options: { filter: { sku: { eq: sku } } },
        });
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(localAddItemToOrderDocument, {
            productVariantId: productVariants.items[0].id,
            quantity: 20,
        });
        orderGuard.assertSuccess(addItemToOrder);
        expect(addItemToOrder.lines[0].linePrice).toBe(total);
        expect(addItemToOrder.total).toBe(total);
    });

    // At precision 4, 3 units at 0.9595 cost 2.8785, and 5% off is 0.143925, which rounds to 0.1439.
    // At precision 2 the unit price would be 0.96 and the total 2.74.
    it('applies a percentage promotion at the configured precision', async () => {
        const { productVariants } = await adminClient.query(getProductVariantListDocument, {
            options: { filter: { sku: { eq: 'ERP9595' } } },
        });
        const variantId = productVariants.items[0].id;
        await adminClient.query(createPromotionDocument, {
            input: {
                enabled: true,
                couponCode: 'FIVE',
                translations: [{ languageCode: LanguageCode.en, name: '5% off' }],
                conditions: [],
                actions: [
                    {
                        code: 'products_percentage_discount',
                        arguments: [
                            { name: 'discount', value: '5' },
                            { name: 'productVariantIds', value: JSON.stringify([variantId]) },
                        ],
                    },
                ],
            },
        });
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(localAddItemToOrderDocument, {
            productVariantId: variantId,
            quantity: 3,
        });
        orderGuard.assertSuccess(addItemToOrder);
        expect(addItemToOrder.lines[0].linePrice).toBe(28_785);
        const { applyCouponCode } = await shopClient.query(applyCouponCodeDocument, { couponCode: 'FIVE' });
        expect(applyCouponCode).toMatchObject({ subTotal: 27_346, total: 27_346 });
    });
});
