import { LanguageCode } from '@vendure/common/lib/generated-types';
import { ConfigService } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { TestPluginWithAllLifecycleHooks } from './fixtures/test-plugins/with-all-lifecycle-hooks';
import { TestAPIExtensionPlugin } from './fixtures/test-plugins/with-api-extensions';
import { TestPluginWithConfig } from './fixtures/test-plugins/with-config';
import { PluginWithGlobalProviders } from './fixtures/test-plugins/with-global-providers';
import { TestLazyExtensionPlugin } from './fixtures/test-plugins/with-lazy-api-extensions';
import { WithNewConfigObjectReferencePlugin } from './fixtures/test-plugins/with-new-config-object-reference';
import { TestPluginWithProvider } from './fixtures/test-plugins/with-provider';
import { TestRestPlugin } from './fixtures/test-plugins/with-rest-controller';

describe('Plugins', () => {
    const onConstructorFn = vi.fn();
    const activeConfig = testConfig();
    const { server, adminClient, shopClient } = createTestEnvironment({
        ...activeConfig,
        plugins: [
            TestPluginWithAllLifecycleHooks.init(onConstructorFn),
            TestPluginWithConfig.setup(),
            TestAPIExtensionPlugin,
            TestPluginWithProvider,
            TestLazyExtensionPlugin,
            TestRestPlugin,
            PluginWithGlobalProviders,
            WithNewConfigObjectReferencePlugin,
        ],
    });

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-full.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('can modify the config in configure()', () => {
        const configService = server.app.get(ConfigService);
        expect(configService instanceof ConfigService).toBe(true);
        expect(configService.defaultLanguageCode).toBe(LanguageCode.zh);
    });

    // https://github.com/vendurehq/vendure/issues/2906
    it('handles plugins that return new config object references', async () => {
        const configService = server.app.get(ConfigService);
        expect(configService.customFields.Customer).toEqual([
            {
                name: 'testField',
                type: 'string',
            },
        ]);
    });

    it('extends the admin API', async () => {
        const result = await adminClient.query(gql`
            query {
                foo
            }
        `);
        expect(result.foo).toEqual(['bar']);
    });

    it('extends the shop API', async () => {
        const result = await shopClient.query(gql`
            query {
                baz
            }
        `);
        expect(result.baz).toEqual(['quux']);
    });

    it('custom scalar', async () => {
        const result = await adminClient.query(gql`
            query {
                barList(options: { skip: 0, take: 1 }) {
                    items {
                        id
                        pizzaType
                    }
                }
            }
        `);
        expect(result.barList).toEqual({
            items: [{ id: 'T_1', pizzaType: 'Cheese pizza!' }],
        });
    });

    it('allows lazy evaluation of API extension', async () => {
        const result = await shopClient.query(gql`
            query {
                lazy
            }
        `);
        expect(result.lazy).toEqual('sleeping');
    });

    it('generates ListQueryOptions for api extensions', async () => {
        const result = await adminClient.query(gql`
            query {
                barList(options: { skip: 0, take: 1 }) {
                    items {
                        id
                        name
                    }
                    totalItems
                }
            }
        `);
        expect(result.barList).toEqual({
            items: [{ id: 'T_1', name: 'Test' }],
            totalItems: 1,
        });
    });

    it('DI works with defined providers', async () => {
        const result = await shopClient.query(gql`
            query {
                names
            }
        `);
        expect(result.names).toEqual(['seon', 'linda', 'hong']);
    });

    describe('REST plugins', () => {
        const restControllerUrl = `http://localhost:${activeConfig.apiOptions.port}/test`;

        it('public route', async () => {
            const response = await shopClient.fetch(restControllerUrl + '/public');
            const body = await response.text();

            expect(body).toBe('success');
        });

        it('permission-restricted route forbidden', async () => {
            const response = await shopClient.fetch(restControllerUrl + '/restricted');
            expect(response.status).toBe(403);
            const result = await response.json();
            expect(result.message).toContain('FORBIDDEN');
        });

        it('permission-restricted route forbidden allowed', async () => {
            await shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
            const response = await shopClient.fetch(restControllerUrl + '/restricted');
            expect(response.status).toBe(200);
            const result = await response.text();
            expect(result).toBe('success');
        });

        it('handling I18nErrors', async () => {
            const response = await shopClient.fetch(restControllerUrl + '/bad');
            expect(response.status).toBe(500);
            const result = await response.json();
            expect(result.message).toContain('uh oh!');
        });
    });
});
