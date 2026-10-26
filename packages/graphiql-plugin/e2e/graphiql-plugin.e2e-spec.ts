/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { ConfigService, LanguageCode, mergeConfig } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { GraphiQLService } from '../src/graphiql.service';
import { GraphiqlPlugin } from '../src/plugin';

describe('GraphiQLPlugin', () => {
    let serviceInstance: GraphiQLService;
    let configService: ConfigService;

    const config = mergeConfig(testConfig(), {
        apiOptions: {
            adminApiPlayground: true,
            shopApiPlayground: true,
        },
        plugins: [GraphiqlPlugin.init()],
    });
    const { server, adminClient } = createTestEnvironment(config);

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

    // The asset route must not reveal whether files outside the assets dir exist
    describe('assets server', () => {
        const assetsDir = path.join(__dirname, '../dist/graphiql/assets');
        let assetName: string;

        beforeAll(() => {
            if (!fs.existsSync(assetsDir)) {
                throw new Error(`${assetsDir} not found. Run "npm run build:app" before these tests.`);
            }
            const jsAsset = fs.readdirSync(assetsDir).find(f => f.endsWith('.js'));
            if (!jsAsset) {
                throw new Error(`No .js asset found in ${assetsDir}`);
            }
            assetName = jsAsset;
        });

        // Sends the path as-is, so neither the client nor URL parsing normalizes "../" segments.
        function getRaw(rawPath: string) {
            return new Promise<{ status: number; body: string }>((resolve, reject) => {
                http.get({ host: 'localhost', port: config.apiOptions.port, path: rawPath }, res => {
                    let body = '';
                    res.setEncoding('utf8');
                    res.on('data', chunk => (body += chunk));
                    res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
                }).on('error', reject);
            });
        }

        it('serves a real asset', async () => {
            const result = await getRaw(`/graphiql/assets/${assetName}`);

            expect(result.status).toBe(200);
            expect(result.body).toBe(fs.readFileSync(path.join(assetsDir, assetName), 'utf8'));
        });

        it('returns 404 for a missing asset', async () => {
            const result = await getRaw('/graphiql/assets/does-not-exist.js');

            expect(result).toEqual({ status: 404, body: 'Asset not found' });
        });

        const existingAbs = path.join(assetsDir, '../index.html');
        const missingAbs = path.join(assetsDir, '../does-not-exist.html');

        // Each row is [description, path to a file that exists, path to a file that doesn't].
        // The two responses must be indistinguishable.
        it.each([
            ['encoded slash', '..%2Findex.html', '..%2Fdoes-not-exist.html'],
            [
                'encoded slash, multiple levels',
                '..%2F..%2F..%2Fpackage.json',
                '..%2F..%2F..%2Fdoes-not-exist.json',
            ],
            ['encoded dots and slash', '%2e%2e%2findex.html', '%2e%2e%2fdoes-not-exist.html'],
            ['encoded dots, literal slash', '%2e%2e/index.html', '%2e%2e/does-not-exist.html'],
            ['plain dot segments', '../index.html', '../does-not-exist.html'],
            ['double encoding', '%252e%252e%252findex.html', '%252e%252e%252fdoes-not-exist.html'],
            ['backslash', '..%5Cindex.html', '..%5Cdoes-not-exist.html'],
            ['absolute path', encodeURIComponent(existingAbs), encodeURIComponent(missingAbs)],
            ['a directory outside the assets dir', '..%2F', '..%2Fdoes-not-exist%2F'],
            ['the assets dir itself', '%2e', 'does-not-exist%2F'],
        ])('%s: existing and missing files get the same 404', async (_, existing, missing) => {
            const existingResult = await getRaw(`/graphiql/assets/${existing}`);
            const missingResult = await getRaw(`/graphiql/assets/${missing}`);

            expect(existingResult).toEqual({ status: 404, body: 'Asset not found' });
            expect(missingResult).toEqual(existingResult);
        });

        it('returns 404 for a path below a real asset file', async () => {
            const result = await getRaw(`/graphiql/assets/${assetName}%2Fx`);

            expect(result).toEqual({ status: 404, body: 'Asset not found' });
        });

        it('returns 404 for an over-long file name', async () => {
            const result = await getRaw(`/graphiql/assets/${'a'.repeat(300)}.js`);

            expect(result).toEqual({ status: 404, body: 'Asset not found' });
        });

        it('returns 404 for a null byte after a real asset name', async () => {
            const result = await getRaw(`/graphiql/assets/${assetName}%00`);

            expect(result).toEqual({ status: 404, body: 'Asset not found' });
        });
    });
});
