import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { DEFAULT_APIKEY_HEADER_KEY } from '@vendure/common/lib/shared-constants';
import {
    DefaultCachePlugin,
    InMemorySessionCacheStrategy,
    mergeConfig,
    RedisCachePlugin,
    VendureConfig,
} from '@vendure/core';
import {
    createErrorResultGuard,
    createTestEnvironment,
    E2E_DEFAULT_CHANNEL_TOKEN,
    ErrorResultGuard,
    SimpleGraphQLClient,
} from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { channelFragment } from './graphql/fragments-admin';
import { FragmentOf, graphql } from './graphql/graphql-admin';
import {
    assignRolesToUserDocument,
    createAdministratorDocument,
    createChannelDocument,
    createRoleDocument,
    getAdministratorsDocument,
    getProductListDocument,
    removeRolesFromUserDocument,
    updateProductDocument,
} from './graphql/shared-definitions';

/**
 * OSS-792 §5 — permission changes take effect on the next request of a live session. The
 * RoleAssignment security matrix checks this with the default session cache (the
 * DefaultSessionCacheStrategy over the in-memory CacheStrategy). This suite runs the same
 * scenarios against the other session caches a deployment can use: the
 * InMemorySessionCacheStrategy, the SQL CacheStrategy of the DefaultCachePlugin, and Redis.
 */

async function isRedisAvailable(host: string, port: number): Promise<boolean> {
    try {
        const IORedis = await import('ioredis').then(m => m.default);
        const testClient = new IORedis.Redis({
            host,
            port,
            connectTimeout: 2000,
            lazyConnect: true,
            maxRetriesPerRequest: 1,
        });
        await testClient.ping();
        await testClient.quit();
        return true;
    } catch (error) {
        return false;
    }
}

const redisHost = '127.0.0.1';
const redisPort = process.env.CI ? +(process.env.E2E_REDIS_PORT || 6379) : 6379;
const PASSWORD = 'test';
const FORBIDDEN = 'You are not currently authorized to perform this action';

const createApiKeyDocument = graphql(`
    mutation SessionCacheCreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);

const roleAssignmentsOfUserDocument = graphql(`
    query SessionCacheRoleAssignments($options: RoleAssignmentListOptions) {
        roleAssignments(options: $options) {
            items {
                userId
                role {
                    code
                }
            }
        }
    }
`);

describe('Role assignment changes reach live sessions with each session cache', async () => {
    const redisAvailable = await isRedisAvailable(redisHost, redisPort);
    if (!redisAvailable) {
        // eslint-disable-next-line no-console
        console.warn(`Redis server not available at ${redisHost}:${redisPort}. Skipping the Redis variant.`);
    }

    // The SQL variant runs first: on sqljs the first environment's schema is cached for the
    // file, and only the DefaultCachePlugin adds the cache table.
    const variants: Array<{ name: string; config: Partial<VendureConfig>; skip?: boolean }> = [
        {
            name: 'DefaultSessionCacheStrategy over the SQL CacheStrategy',
            config: { plugins: [DefaultCachePlugin.init({})] },
        },
        {
            name: 'InMemorySessionCacheStrategy',
            config: { authOptions: { sessionCacheStrategy: new InMemorySessionCacheStrategy() } },
        },
        {
            name: 'DefaultSessionCacheStrategy over Redis',
            config: {
                plugins: [RedisCachePlugin.init({ redisOptions: { host: redisHost, port: redisPort } })],
            },
            skip: !redisAvailable,
        },
    ];

    for (const variant of variants) {
        describe.skipIf(variant.skip)(variant.name, () => {
            const config = mergeConfig(testConfig(), {
                ...variant.config,
                authOptions: { ...variant.config.authOptions, tokenMethod: ['bearer', 'api-key'] },
            });
            const { server, adminClient } = createTestEnvironment(config);
            const adminApiUrl = `http://localhost:${config.apiOptions.port}/${config.apiOptions.adminApiPath ?? 'admin-api'}`;
            // The administrator under test keeps a live session here while adminClient, as the
            // SuperAdmin, changes its assignments.
            const victimClient = new SimpleGraphQLClient(config as any, adminApiUrl);
            const channelGuard: ErrorResultGuard<FragmentOf<typeof channelFragment>> = createErrorResultGuard(
                input => !!input.defaultLanguageCode,
            );

            const A = 'T_1';
            let B_TOKEN: string;
            let catalogRoleId: string;
            let adminReaderRoleId: string;
            let productId: string;
            let victim: { userId: string; email: string };
            let apiKey: { key: string; userId: string };

            const grant = (userId: string, roleId: string) =>
                adminClient.query(assignRolesToUserDocument, {
                    input: { userId, assignments: [{ roleId, channelId: A }] },
                });
            const revoke = (userId: string, roleId: string) =>
                adminClient.query(removeRolesFromUserDocument, {
                    input: { userId, assignments: [{ roleId, channelId: A }] },
                });
            const updateProduct = (client: SimpleGraphQLClient) =>
                client.query(updateProductDocument, { input: { id: productId, enabled: true } });
            const listProducts = (client: SimpleGraphQLClient) =>
                client.query(getProductListDocument, { options: { take: 1 } });

            async function loginVictim() {
                await victimClient.asUserWithCredentials(victim.email, PASSWORD);
                victimClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            }

            beforeAll(async () => {
                await server.init({
                    initialData,
                    productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
                    customerCount: 1,
                });
                await adminClient.asSuperAdmin();

                const { createChannel } = await adminClient.query(createChannelDocument, {
                    input: {
                        code: 'channel-b',
                        token: 'channel-b-token',
                        defaultLanguageCode: LanguageCode.en,
                        currencyCode: CurrencyCode.GBP,
                        pricesIncludeTax: true,
                        defaultShippingZoneId: 'T_1',
                        defaultTaxZoneId: 'T_1',
                    },
                });
                channelGuard.assertSuccess(createChannel);
                B_TOKEN = createChannel.token;

                const { createRole: catalogRole } = await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'catalog',
                        description: '',
                        permissions: [Permission.ReadCatalog, Permission.UpdateCatalog],
                    },
                });
                catalogRoleId = catalogRole.id;
                const { createRole: adminReaderRole } = await adminClient.query(createRoleDocument, {
                    input: {
                        code: 'admin-reader',
                        description: '',
                        permissions: [Permission.ReadAdministrator],
                    },
                });
                adminReaderRoleId = adminReaderRole.id;

                const email = 'victim@cache.test';
                const { createAdministrator } = await adminClient.query(createAdministratorDocument, {
                    input: {
                        firstName: 'Victim',
                        lastName: 'Cache',
                        emailAddress: email,
                        password: PASSWORD,
                        roleAssignments: [{ roleId: catalogRoleId, channelId: A }],
                    },
                });
                victim = { userId: createAdministrator.user.id, email };

                const { createApiKey } = await adminClient.query(createApiKeyDocument, {
                    input: {
                        roleAssignments: [{ roleId: catalogRoleId, channelId: A }],
                        translations: [{ languageCode: LanguageCode.en, name: 'cache-key' }],
                    },
                });
                const { roleAssignments } = await adminClient.query(roleAssignmentsOfUserDocument, {});
                const keyUser = roleAssignments.items.find(
                    item => item.role.code === 'catalog' && item.userId !== victim.userId,
                );
                if (!keyUser) {
                    throw new Error('Expected to find the API-key user');
                }
                apiKey = { key: createApiKey.apiKey, userId: keyUser.userId };

                const { products } = await listProducts(adminClient);
                productId = products.items[0].id;
            }, TEST_SETUP_TIMEOUT_MS);

            afterAll(async () => {
                await server.destroy();
            });

            it('a removal is effective on the next request of a live session', async () => {
                await loginVictim();
                await updateProduct(victimClient);

                await revoke(victim.userId, catalogRoleId);
                await expect(updateProduct(victimClient)).rejects.toThrow(FORBIDDEN);

                await grant(victim.userId, catalogRoleId);
            });

            it('a removal is effective on the next request of an API-key session', async () => {
                const keyClient = new SimpleGraphQLClient(config as any, adminApiUrl);
                (keyClient as any).headers[DEFAULT_APIKEY_HEADER_KEY] = apiKey.key;
                keyClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
                await listProducts(keyClient);

                await revoke(apiKey.userId, catalogRoleId);
                await expect(listProducts(keyClient)).rejects.toThrow(FORBIDDEN);

                await grant(apiKey.userId, catalogRoleId);
            });

            it('a removal is effective after a channel switch mid-session', async () => {
                await loginVictim();
                victimClient.setChannelToken(B_TOKEN);
                await listProducts(victimClient).catch(() => undefined);
                victimClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);

                await revoke(victim.userId, catalogRoleId);
                await expect(listProducts(victimClient)).rejects.toThrow(FORBIDDEN);

                await grant(victim.userId, catalogRoleId);
            });

            it('a new grant is effective without logging in again', async () => {
                await loginVictim();
                await expect(victimClient.query(getAdministratorsDocument, {})).rejects.toThrow(FORBIDDEN);

                await grant(victim.userId, adminReaderRoleId);
                const { administrators } = await victimClient.query(getAdministratorsDocument, {});
                expect(administrators.totalItems).toBeGreaterThan(0);

                await revoke(victim.userId, adminReaderRoleId);
            });
        });
    }
});
