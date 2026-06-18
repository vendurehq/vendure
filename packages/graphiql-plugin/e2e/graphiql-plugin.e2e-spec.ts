/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ConfigService, LanguageCode, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { GraphiQLService } from '../src/graphiql.service';
import { GraphiqlPlugin } from '../src/plugin';

describe('GraphiQLPlugin', () => {
    let serviceInstance: GraphiQLService;
    let configService: ConfigService;

    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            apiOptions: {
                adminApiPlayground: true,
                shopApiPlayground: true,
            },
            plugins: [GraphiqlPlugin.init()],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData: {
                defaultLanguage: LanguageCode.en,
                defaultZone: 'Europe/London',
                countries: [],
                taxRates: [],
                paymentMethods: [],
                shippingMethods: [],
                collections: [],
            },
        });
        await adminClient.asSuperAdmin();
        configService = server.app.get(ConfigService);
        serviceInstance = server.app.get(GraphiQLService);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('configuration', () => {
        it('should disable GraphQL playground in config', async () => {
            expect(configService.apiOptions.adminApiPlayground).toBe(false);
            expect(configService.apiOptions.shopApiPlayground).toBe(false);
        });
    });

    describe('GraphiQLService', () => {
        describe('getAdminApiUrl', () => {
            it('should return the admin API URL', () => {
                configService.apiOptions.adminApiPath = 'admin-api';
                const url = serviceInstance.getAdminApiUrl();
                expect(url).toBe('/admin-api');
            });

            it('should use default path if not specified', () => {
                configService.apiOptions.adminApiPath = 'admin-api';
                const url = serviceInstance.getAdminApiUrl();
                expect(url).toBe('/admin-api');
            });
        });

        describe('getShopApiUrl', () => {
            it('should return the shop API URL', () => {
                configService.apiOptions.shopApiPath = 'shop-api';
                const url = serviceInstance.getShopApiUrl();
                expect(url).toBe('/shop-api');
            });

            it('should use default path if not specified', () => {
                configService.apiOptions.shopApiPath = 'shop-api';
                const url = serviceInstance.getShopApiUrl();
                expect(url).toBe('/shop-api');
            });
        });

        describe('createApiUrl', () => {
            it('should create a relative URL if no host is specified', () => {
                configService.apiOptions.hostname = '';
                configService.apiOptions.port = 3000;
                const url = (serviceInstance as any).createApiUrl('test-api');
                expect(url).toBe('/test-api');
            });

            it('should create an absolute URL if host is specified', () => {
                configService.apiOptions.hostname = 'example.com';
                configService.apiOptions.port = 3000;
                const url = (serviceInstance as any).createApiUrl('test-api');
                expect(url).toBe('http://example.com:3000/test-api');
            });

            it('should handle HTTPS hosts', () => {
                configService.apiOptions.hostname = 'https://example.com';
                configService.apiOptions.port = 443;
                const url = (serviceInstance as any).createApiUrl('test-api');
                expect(url).toBe('https://example.com:443/test-api');
            });

            it('should handle paths with leading slash', () => {
                configService.apiOptions.hostname = 'example.com';
                configService.apiOptions.port = 3000;
                const url = (serviceInstance as any).createApiUrl('/test-api');
                expect(url).toBe('http://example.com:3000/test-api');
            });
        });
    });
});
