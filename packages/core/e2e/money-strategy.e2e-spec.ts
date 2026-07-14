import { SortOrder } from '@vendure/common/lib/generated-types';
import { Logger, mergeConfig, MoneyStrategy, VendurePlugin } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { ColumnOptions } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { FragmentOf } from './graphql/graphql-shop';
import { getProductVariantListDocument } from './graphql/shared-definitions';
import { localAddItemToOrderDocument, localUpdatedOrderFragment } from './graphql/shop-definitions';

/* eslint-disable @typescript-eslint/no-non-null-assertion */

type UpdatedOrder = FragmentOf<typeof localUpdatedOrderFragment>;
const orderGuard: ErrorResultGuard<UpdatedOrder> = createErrorResultGuard(input => !!input.total);

class CustomMoneyStrategy implements MoneyStrategy {
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
        expect(productVariants.items[1].price).toBe(9_999_999_00);
        expect(productVariants.items[1].priceWithTax).toBe(11_999_998_80);

        cheapVariantId = productVariants.items[0].id;
        expensiveVariantId = productVariants.items[1].id;

        expect(CustomMoneyStrategy.transformerFromSpy).toHaveBeenCalledTimes(2);
    });

    // https://github.com/vendurehq/vendure/issues/838
    it('can handle totals over 21 million', async () => {
        await shopClient.asAnonymousUser();
        const { addItemToOrder } = await shopClient.query(localAddItemToOrderDocument, {
            productVariantId: expensiveVariantId,
            quantity: 2,
        });
        orderGuard.assertSuccess(addItemToOrder);

        expect(addItemToOrder.lines[0].linePrice).toBe(1_999_999_800);
        expect(addItemToOrder.lines[0].linePriceWithTax).toBe(2_399_999_760);
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
});
