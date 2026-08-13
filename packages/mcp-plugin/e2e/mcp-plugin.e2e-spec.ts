import { DiscoveryService } from '@nestjs/core';
import { mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpPlugin } from '../src/plugin';

import { initTestServer } from './utils/test-server';

describe('McpPlugin bootstrap', () => {
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [McpPlugin.init({})],
        }),
    );

    beforeAll(async () => {
        await initTestServer(server);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('boots a Vendure app with McpPlugin registered', () => {
        expect(server.app).toBeDefined();
        expect(McpPlugin.options.toolExposure).toBe('direct');
    });

    it('DiscoveryService is injectable from the running app', () => {
        const discoveryService = server.app.get(DiscoveryService);
        expect(discoveryService).toBeDefined();
        expect(typeof discoveryService.getProviders).toBe('function');
    });
});
