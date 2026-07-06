import { describe, expect, it } from 'vitest';

import { runProductionCheck } from './production-check';

/**
 * Creates a minimal RuntimeVendureConfig-like object for testing.
 * Only includes the properties that the production check inspects.
 */
function createTestConfig(overrides: Record<string, any> = {}): any {
    return {
        authOptions: {
            disableAuth: false,
            superadminCredentials: {
                identifier: 'custom-admin',
                password: 'custom-password',
            },
            tokenMethod: 'bearer',
            cookieOptions: {
                secret: 'a-real-secret',
            },
            ...overrides.authOptions,
        },
        apiOptions: {
            introspection: false,
            adminApiPlayground: false,
            shopApiPlayground: false,
            adminApiDebug: false,
            shopApiDebug: false,
            cors: {
                origin: 'https://example.com',
                credentials: true,
            },
            ...overrides.apiOptions,
        },
        jobQueueOptions: {
            jobQueueStrategy: { constructor: { name: 'BullMQJobQueueStrategy' } },
            ...overrides.jobQueueOptions,
        },
        systemOptions: {
            cacheStrategy: { constructor: { name: 'RedisCacheStrategy' } },
            ...overrides.systemOptions,
        },
        assetOptions: {
            assetStorageStrategy: { constructor: { name: 'S3AssetStorageStrategy' } },
            assetPreviewStrategy: { constructor: { name: 'SharpAssetPreviewStrategy' } },
            ...overrides.assetOptions,
        },
        dbConnectionOptions: {
            synchronize: false,
            ...overrides.dbConnectionOptions,
        },
    };
}

describe('production-check', () => {
    it('returns pass when all settings are production-safe', async () => {
        const config = createTestConfig();

        const result = await runProductionCheck(config);

        expect(result.status).toBe('pass');
        expect(result.details).toContain('All production checks passed');
    });

    it('detects disableAuth enabled', async () => {
        const config = createTestConfig({
            authOptions: { disableAuth: true },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('fail');
        expect(result.details?.some(d => d.includes('disableAuth'))).toBe(true);
    });

    it('detects default superadmin identifier', async () => {
        const config = createTestConfig({
            authOptions: {
                superadminCredentials: {
                    identifier: 'superadmin',
                    password: 'custom-password',
                },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('superadmin identifier'))).toBe(true);
    });

    it('detects default superadmin password', async () => {
        const config = createTestConfig({
            authOptions: {
                superadminCredentials: {
                    identifier: 'custom-admin',
                    password: 'superadmin',
                },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('superadmin password'))).toBe(true);
    });

    it('detects cookie auth without secret', async () => {
        const config = createTestConfig({
            authOptions: {
                tokenMethod: 'cookie',
                cookieOptions: {},
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('cookie secret'))).toBe(true);
    });

    it('detects cookie auth in array token method', async () => {
        const config = createTestConfig({
            authOptions: {
                tokenMethod: ['bearer', 'cookie'],
                cookieOptions: {},
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('cookie secret'))).toBe(true);
    });

    it('detects introspection enabled', async () => {
        const config = createTestConfig({
            apiOptions: { introspection: true },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('introspection'))).toBe(true);
    });

    it('detects playground enabled', async () => {
        const config = createTestConfig({
            apiOptions: { adminApiPlayground: true },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('playground'))).toBe(true);
    });

    it('detects debug mode enabled', async () => {
        const config = createTestConfig({
            apiOptions: { shopApiDebug: true },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('debug'))).toBe(true);
    });

    it('detects broad CORS with credentials', async () => {
        const config = createTestConfig({
            apiOptions: {
                cors: { origin: true, credentials: true },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('CORS'))).toBe(true);
    });

    it('detects wildcard CORS string with credentials', async () => {
        const config = createTestConfig({
            apiOptions: {
                cors: { origin: '*', credentials: true },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('CORS'))).toBe(true);
    });

    it('detects wildcard in CORS array with credentials', async () => {
        const config = createTestConfig({
            apiOptions: {
                cors: { origin: ['https://example.com', '*'], credentials: true },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('CORS'))).toBe(true);
    });

    it('detects InMemoryJobQueueStrategy', async () => {
        const config = createTestConfig({
            jobQueueOptions: {
                jobQueueStrategy: { constructor: { name: 'InMemoryJobQueueStrategy' } },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('InMemoryJobQueueStrategy'))).toBe(true);
    });

    it('detects InMemoryCacheStrategy', async () => {
        const config = createTestConfig({
            systemOptions: {
                cacheStrategy: { constructor: { name: 'InMemoryCacheStrategy' } },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('InMemoryCacheStrategy'))).toBe(true);
    });

    it('detects DefaultSessionCacheStrategy', async () => {
        const config = createTestConfig({
            authOptions: {
                sessionCacheStrategy: { constructor: { name: 'DefaultSessionCacheStrategy' } },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('DefaultSessionCacheStrategy'))).toBe(true);
    });

    it('detects NoAssetStorageStrategy', async () => {
        const config = createTestConfig({
            assetOptions: {
                assetStorageStrategy: { constructor: { name: 'NoAssetStorageStrategy' } },
                assetPreviewStrategy: { constructor: { name: 'SharpAssetPreviewStrategy' } },
            },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('warn');
        expect(result.details?.some(d => d.includes('No asset storage'))).toBe(true);
    });

    it('detects synchronize enabled', async () => {
        const config = createTestConfig({
            dbConnectionOptions: { synchronize: true },
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('fail');
        expect(result.details?.some(d => d.includes('synchronize'))).toBe(true);
    });

    it('fail status overrides warn status', async () => {
        const config = createTestConfig({
            authOptions: { disableAuth: true }, // fail
            apiOptions: { introspection: true }, // warn
        });

        const result = await runProductionCheck(config);

        expect(result.status).toBe('fail');
    });
});
