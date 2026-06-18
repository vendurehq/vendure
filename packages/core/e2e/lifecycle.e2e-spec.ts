import {
    AutoIncrementIdStrategy,
    defaultShippingEligibilityChecker,
    Injector,
    ProductService,
    ShippingEligibilityChecker,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { vi } from 'vitest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { testConfig, TEST_SETUP_TIMEOUT_MS } from '../../../e2e-common/test-config';

const strategyInitSpy = vi.fn();
const strategyDestroySpy = vi.fn();
const codInitSpy = vi.fn();
const codDestroySpy = vi.fn();

class TestIdStrategy extends AutoIncrementIdStrategy {
    async init(injector: Injector) {
        const productService = injector.get(ProductService);
        const connection = injector.get(TransactionalConnection);
        await new Promise(resolve => setTimeout(resolve, 100));
        strategyInitSpy(productService.constructor.name, connection.rawConnection.name);
    }

    async destroy() {
        await new Promise(resolve => setTimeout(resolve, 100));
        strategyDestroySpy();
    }
}

const testShippingEligChecker = new ShippingEligibilityChecker({
    code: 'test',
    args: {},
    description: [],
    init: async injector => {
        const productService = injector.get(ProductService);
        const connection = injector.get(TransactionalConnection);
        await new Promise(resolve => setTimeout(resolve, 100));
        codInitSpy(productService.constructor.name, connection.rawConnection.name);
    },
    destroy: async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        codDestroySpy();
    },
    check: order => {
        return true;
    },
});

describe('lifecycle hooks for configurable objects', () => {
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        entityOptions: { entityIdStrategy: new TestIdStrategy() },
        shippingOptions: {
            shippingEligibilityCheckers: [defaultShippingEligibilityChecker, testShippingEligChecker],
        },
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-empty.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    describe('strategy', () => {
        it('runs init with Injector', () => {
            expect(strategyInitSpy).toHaveBeenCalled();
            expect(strategyInitSpy.mock.calls[0][0]).toEqual('ProductService');
            expect(strategyInitSpy.mock.calls[0][1]).toBe('default');
        });

        it('runs destroy', async () => {
            await server.destroy();
            expect(strategyDestroySpy).toHaveBeenCalled();
        });
    });

    describe('configurable operation', () => {
        beforeAll(async () => {
            await server.bootstrap();
        }, TEST_SETUP_TIMEOUT_MS);

        afterAll(async () => {
            await server.destroy();
        });

        it('runs init with Injector', () => {
            expect(codInitSpy).toHaveBeenCalled();
            expect(codInitSpy.mock.calls[0][0]).toEqual('ProductService');
            expect(codInitSpy.mock.calls[0][1]).toBe('default');
        });

        it('runs destroy', async () => {
            await server.destroy();
            expect(codDestroySpy).toHaveBeenCalled();
        });
    });
});
