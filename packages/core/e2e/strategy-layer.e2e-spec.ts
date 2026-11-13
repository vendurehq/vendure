import { mergeConfig, removeLayer, setLayerPriority } from '@vendure/core';
import { createErrorResultGuard, createTestEnvironment, ErrorResultGuard } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    DigitFourLayer,
    DigitFourPlugin,
    DigitOneLayer,
    DigitOnePlugin,
    DigitThreePlugin,
    DigitTwoPlugin,
    strategyLayerEvents,
    ZeroPriceStrategy,
} from './fixtures/test-plugins/with-strategy-layers';
import { FragmentOf } from './graphql/graphql-shop';
import { addItemToOrderDocument, updatedOrderFragment } from './graphql/shop-definitions';

describe('Strategy layers', () => {
    // The project config removes DigitFourLayer and moves DigitOneLayer from priority 100 to 350,
    // before the plugins add these layers. The order of the plugins array is not the priority order.
    const { server, shopClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DigitFourPlugin, DigitThreePlugin, DigitOnePlugin, DigitTwoPlugin],
            orderOptions: {
                orderItemPriceCalculationStrategy: removeLayer(
                    setLayerPriority(new ZeroPriceStrategy(), DigitOneLayer, 350),
                    DigitFourLayer,
                ),
            },
        }),
    );

    type UpdatedOrder = FragmentOf<typeof updatedOrderFragment>;
    const orderGuard: ErrorResultGuard<UpdatedOrder> = createErrorResultGuard(input => !!input.lines);

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // On the first run, the test environment also starts a server to populate the database.
    // Thus only the calls of the last server start are compared.
    it('initialises the base and then each layer from the inside out, and waits for each', () => {
        expect(strategyLayerEvents.init.slice(-4)).toEqual([
            'ZeroPriceStrategy',
            'DigitOneLayer',
            'DigitThreeLayer',
            'DigitTwoLayer',
        ]);
    });

    it('calls the layers in priority order and does not call the removed layer', async () => {
        strategyLayerEvents.calls = [];
        const { addItemToOrder } = await shopClient.query(addItemToOrderDocument, {
            productVariantId: 'T_1',
            quantity: 1,
        });
        orderGuard.assertSuccess(addItemToOrder);

        // Each layer gives `inner price * 10 + digit`: 0 -> 1 -> 13 -> 132.
        expect(addItemToOrder.lines[0].unitPrice).toBe(132);
        expect(strategyLayerEvents.calls.slice(0, 4)).toEqual([
            'DigitTwoLayer',
            'DigitThreeLayer',
            'DigitOneLayer',
            'ZeroPriceStrategy',
        ]);
        expect(strategyLayerEvents.calls).not.toContain('DigitFourLayer');
    });

    it('destroys the layers from the outside in, and then the base', async () => {
        strategyLayerEvents.destroy = [];
        await server.destroy();
        expect(strategyLayerEvents.destroy).toEqual([
            'DigitTwoLayer',
            'DigitThreeLayer',
            'DigitOneLayer',
            'ZeroPriceStrategy',
        ]);
    });
});
