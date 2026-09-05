import { Injectable, OnModuleInit } from '@nestjs/common';
import {
    AutoIncrementIdStrategy,
    Injector,
    PluginCommonModule,
    ProductService,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

let strategyInitialized = false;
let strategyResolvedDependency = false;
let consumerSawStrategyInitialized = false;

class OrderingTestStrategy extends AutoIncrementIdStrategy {
    async init(injector: Injector) {
        // Locks down the other half of the contract: by the time a strategy's
        // init() runs, its own dependencies must already be resolvable via the
        // Injector.
        const productService = injector.get(ProductService);
        strategyResolvedDependency = productService.constructor.name === 'ProductService';
        // The delay is not for synchronisation — it is purely to amplify the
        // failure signal of a regression. If ConfigModule reverts to running
        // strategy init at onApplicationBootstrap, this 50ms gap makes sure the
        // consumer's onModuleInit observes strategyInitialized as still false.
        await new Promise(resolve => setTimeout(resolve, 50));
        strategyInitialized = true;
    }
}

@Injectable()
class StrategyConsumerService implements OnModuleInit {
    onModuleInit() {
        consumerSawStrategyInitialized = strategyInitialized;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    providers: [StrategyConsumerService],
})
class StrategyConsumerPlugin {
    // The constructor injection is required so that Nest instantiates the
    // service (and thus runs its onModuleInit). Without a reference, an
    // unused provider in an otherwise-empty plugin module is not exercised.
    constructor(_consumer: StrategyConsumerService) {
        // intentionally empty
    }
}

/**
 * Regression test for the contract that an InjectableStrategy's `init()` is
 * always invoked before any other module's `onModuleInit` runs, so that
 * strategies can be safely consumed via the `Injector` during module
 * initialization. This is implemented by having `ConfigModule` perform its
 * strategy initialization in `onModuleInit` rather than `onApplicationBootstrap`.
 *
 * NOTE: this test lives in its own file because the AppModule statically reads
 * `getConfig().plugins` once via `PluginModule.forRoot()`, so plugins added by
 * later test envs in the same file are not picked up.
 */
describe('strategy init order', () => {
    const { server } = createTestEnvironment({
        ...testConfig(),
        entityOptions: { entityIdStrategy: new OrderingTestStrategy() },
        plugins: [StrategyConsumerPlugin],
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-empty.csv'),
            customerCount: 1,
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('resolves dependencies in strategy init() and runs it before plugin onModuleInit', () => {
        expect(strategyInitialized).toBe(true);
        expect(strategyResolvedDependency).toBe(true);
        expect(consumerSawStrategyInitialized).toBe(true);
    });
});
