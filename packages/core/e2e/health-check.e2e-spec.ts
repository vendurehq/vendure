import {
    HealthCheckRegistryService,
    HealthCheckStrategy,
    HealthIndicatorFunction,
    mergeConfig,
    PluginCommonModule,
    VendurePlugin,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

function throwingIndicator(): HealthIndicatorFunction {
    return () => {
        throw new Error('this indicator must never be invoked');
    };
}

/** Configured via `systemOptions.healthChecks`. */
class AlwaysFailingHealthCheckStrategy implements HealthCheckStrategy {
    getHealthIndicator(): HealthIndicatorFunction {
        throw new Error('this strategy must never be invoked');
    }
}

/** Registered via the older {@link HealthCheckRegistryService} route. */
@VendurePlugin({
    imports: [PluginCommonModule],
})
class RegistersFailingIndicatorPlugin {
    constructor(registry: HealthCheckRegistryService) {
        registry.registerIndicatorFunction(throwingIndicator());
    }
}

const config = mergeConfig(testConfig(), {
    systemOptions: {
        healthChecks: [new AlwaysFailingHealthCheckStrategy()],
    },
    plugins: [RegistersFailingIndicatorPlugin],
});

const HEALTH_URL = `http://localhost:${config.apiOptions.port}/health`;

describe('health check endpoint', () => {
    const { server } = createTestEnvironment(config);

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

    // `/health` is a liveness signal: it reports that this process is serving HTTP and deliberately
    // does not gate on any dependency. Both of the health check mechanisms deprecated in v3.6.0 are
    // registered above with indicators that throw, and neither may influence the response. Were they
    // still executed, a single degraded dependency would fail this check on every instance at once.
    it('responds 200 with an ok status despite failing health checks being registered', async () => {
        const res = await fetch(HEALTH_URL);

        expect(res.status).toBe(200);
        await expect(res.json()).resolves.toEqual({ status: 'ok' });
    });
});
