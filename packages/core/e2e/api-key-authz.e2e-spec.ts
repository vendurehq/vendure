import { Permission } from '@vendure/common/lib/generated-types';
import { SUPER_ADMIN_USER_IDENTIFIER } from '@vendure/common/lib/shared-constants';
import { ApiKeyService, RequestContextService, Role, TransactionalConnection, User } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { graphql } from './graphql/graphql-admin';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

/**
 * Regression guard for GHSA-37xp-mjp8-6f9x.
 *
 * `ApiKeyService` loaded the target key scoped by channel alone, with no check that the caller holds
 * the key's own permissions. `rotate` was the escalation: it mints a new secret, binds a session to
 * the key's underlying user (whose roles may exceed the caller's), and returns the plaintext secret,
 * so an administrator holding only `UpdateApiKey` could rotate a higher-privileged key and receive a
 * working credential for it. `update` and `deleteApiKeys` share the root cause: neither hands the
 * caller a credential, but a low-privilege admin could rename, strip the roles of, or destroy a key
 * they do not own. `create`'s impersonation path bound a session to an existing User while checking
 * only the requested roleIds. `apiKey(id)` and `apiKeys` disclosed the metadata of keys the caller
 * could not manage.
 *
 * The fix applies one rule everywhere: the caller must already hold every Permission the key's user
 * holds. These tests assert the SECURE behaviour, so they FAIL on the unpatched code and PASS once
 * the guard is added.
 *
 * This is a dedicated environment rather than a section of api-key.e2e-spec.ts so the security
 * assertions stay self-contained. The read-visibility test asserts exactly which keys the low-privilege
 * manager can list and that totalItems matches. Folded into the main suite, that assertion would run
 * against whatever keys earlier tests left behind, and the shared adminClient session would switch
 * between the SuperAdmin and a low-privilege admin partway through the file.
 */
describe('API-key authorization (GHSA-37xp-mjp8-6f9x)', () => {
    const config = testConfig();
    // Needed so the rotate tests can authenticate a request with a raw API key.
    config.authOptions.tokenMethod = ['cookie', 'bearer', 'api-key'];

    const { server, adminClient } = createTestEnvironment(config);
    const adminApiUrl = `http://localhost:${config.apiOptions.port}/${String(config.apiOptions.adminApiPath)}`;
    const apiKeyHeader = String(config.authOptions.apiKeyHeaderKey);

    const manager = { emailAddress: 'apikey-manager@test.com', password: 'test-password' };

    // A privileged key whose user holds the SuperAdmin role.
    let highPrivKeyId: string;
    // Low-privileged keys whose user holds only ReadCatalog, a subset of the manager's permissions.
    let lowPrivKeyIdForRotate: string;
    let lowPrivKeyIdForUpdate: string;
    let lowPrivKeyIdForDelete: string;
    // Captured as SuperAdmin so the strip test does not need a Role query the manager cannot run.
    let catalogRoleId: string;

    /**
     * Runs a query against the Admin API authenticated by a raw API key, bypassing the client's
     * cookie/bearer session. Returns the parsed GraphQL response.
     */
    async function queryWithApiKey(apiKey: string, query: string): Promise<any> {
        return fetch(adminApiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', [apiKeyHeader]: apiKey },
            body: JSON.stringify({ query }),
        }).then(res => res.json());
    }

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const { createApiKey: high } = await adminClient.query(CREATE_API_KEY, {
            input: {
                roleIds: ['1'],
                translations: [{ languageCode: 'en' as any, name: 'High-priv key' }],
            },
        });
        highPrivKeyId = high.entityId;

        const { createRole: catalogRole } = await adminClient.query(CREATE_ROLE, {
            input: {
                code: 'catalog-reader',
                description: 'Catalog reader',
                permissions: [Permission.ReadCatalog],
                channelIds: ['T_1'],
            },
        });
        catalogRoleId = catalogRole.id;

        for (const target of ['rotate', 'update', 'delete'] as const) {
            const { createApiKey: low } = await adminClient.query(CREATE_API_KEY, {
                input: {
                    roleIds: [catalogRole.id],
                    translations: [{ languageCode: 'en' as any, name: `Low-priv key (${target})` }],
                },
            });
            if (target === 'rotate') lowPrivKeyIdForRotate = low.entityId;
            else if (target === 'update') lowPrivKeyIdForUpdate = low.entityId;
            else lowPrivKeyIdForDelete = low.entityId;
        }

        // The attacker: can manage API keys, holds no elevated permissions. ReadCatalog is included
        // only so the positive controls (acting on a ReadCatalog-only key) are legitimate.
        const { createRole: managerRole } = await adminClient.query(CREATE_ROLE, {
            input: {
                code: 'apikey-manager',
                description: 'Can manage API keys',
                permissions: [
                    Permission.ReadCatalog,
                    Permission.ReadApiKey,
                    Permission.CreateApiKey,
                    Permission.UpdateApiKey,
                    Permission.DeleteApiKey,
                ],
                channelIds: ['T_1'],
            },
        });
        await adminClient.query(CREATE_ADMINISTRATOR, {
            input: {
                emailAddress: manager.emailAddress,
                firstName: 'Mallory',
                lastName: 'Manager',
                password: manager.password,
                roleIds: [managerRole.id],
            },
        });
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    describe('rotateApiKey', () => {
        it(
            'blocks a UpdateApiKey-only admin from rotating a higher-privileged key',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
                await adminClient.query(ROTATE_API_KEY, { id: highPrivKeyId });
            }, 'could be found'),
        );

        it('does not destroy the original secret when a rotate is refused', async () => {
            // Give the privileged key a known secret we control, as the SuperAdmin.
            await adminClient.asSuperAdmin();
            const { rotateApiKey: reset } = await adminClient.query(ROTATE_API_KEY, { id: highPrivKeyId });
            const originalSecret = reset.apiKey;

            // Sanity: the secret works before the attack.
            const before = await queryWithApiKey(
                originalSecret,
                '{ administrators(options: { take: 1 }) { totalItems } }',
            );
            expect(before.data?.administrators?.totalItems).toBeGreaterThan(0);

            // The attacker attempts to rotate it.
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            await adminClient.query(ROTATE_API_KEY, { id: highPrivKeyId }).catch(() => undefined);

            // A correct fix rejects BEFORE deleting the session, so the original secret still works.
            const after = await queryWithApiKey(
                originalSecret,
                '{ administrators(options: { take: 1 }) { totalItems } }',
            );
            expect(after.data?.administrators?.totalItems).toBeGreaterThan(0);
        });

        it('still allows rotating a key whose permissions the caller fully holds', async () => {
            // Positive control: the manager holds ReadCatalog, so rotating the ReadCatalog-only key is
            // legitimate and must keep working after the fix.
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { rotateApiKey } = await adminClient.query(ROTATE_API_KEY, { id: lowPrivKeyIdForRotate });
            expect(typeof rotateApiKey.apiKey).toBe('string');
            expect(rotateApiKey.apiKey.length).toBeGreaterThan(0);
        });
    });

    describe('updateApiKey', () => {
        it(
            'blocks renaming a higher-privileged key',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
                await adminClient.query(UPDATE_API_KEY, {
                    input: {
                        id: highPrivKeyId,
                        translations: [{ languageCode: 'en' as any, name: 'hijacked-name' }],
                    },
                });
            }, 'could be found'),
        );

        it(
            'blocks stripping the roles of a higher-privileged key',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
                // The manager holds ReadCatalog, so without the current-permission guard this
                // downgrade would pass the existing incoming-roleIds check.
                await adminClient.query(UPDATE_API_KEY, {
                    input: { id: highPrivKeyId, roleIds: [catalogRoleId] },
                });
            }, 'could be found'),
        );

        it('leaves the higher-privileged key intact after blocked attempts', async () => {
            await adminClient.asSuperAdmin();
            const { apiKey } = await adminClient.query(GET_API_KEY_WITH_ROLES, { id: highPrivKeyId });
            expect(apiKey?.name).toBe('High-priv key');
            expect(apiKey?.user.roles.some(r => r.code === '__super_admin_role__')).toBe(true);
        });

        it('still allows updating a key whose permissions the caller fully holds', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { updateApiKey } = await adminClient.query(UPDATE_API_KEY, {
                input: {
                    id: lowPrivKeyIdForUpdate,
                    translations: [{ languageCode: 'en' as any, name: 'renamed by manager' }],
                },
            });
            expect(updateApiKey.name).toBe('renamed by manager');
        });

        it(
            'blocks raising a manageable key to roles the caller does not hold',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
                // The manager may manage this ReadCatalog-only key, so only the incoming-roleIds check
                // stands between them and a key holding the SuperAdmin role.
                await adminClient.query(UPDATE_API_KEY, {
                    input: { id: lowPrivKeyIdForUpdate, roleIds: ['1'] },
                });
            }, 'sufficient permissions'),
        );

        it('leaves the manageable key at its original roles after a blocked raise', async () => {
            await adminClient.asSuperAdmin();
            const { apiKey } = await adminClient.query(GET_API_KEY_WITH_ROLES, { id: lowPrivKeyIdForUpdate });
            expect(apiKey?.user.roles.map(r => r.code)).toEqual(['catalog-reader']);
        });
    });

    describe('deleteApiKeys', () => {
        it(
            'blocks deleting a higher-privileged key',
            assertThrowsWithMessage(async () => {
                await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
                await adminClient.query(DELETE_API_KEYS, { ids: [highPrivKeyId] });
            }, 'could be found'),
        );

        it('leaves the higher-privileged key readable after a blocked delete', async () => {
            await adminClient.asSuperAdmin();
            const { apiKey } = await adminClient.query(GET_API_KEY_WITH_ROLES, { id: highPrivKeyId });
            expect(apiKey?.id).toBe(highPrivKeyId);
        });

        // A key the caller may not manage is hidden from apiKey(id) and apiKeys, so the mutations must
        // not disclose that it exists either: they report it exactly like an id that does not exist.
        it('reports a hidden key the same as a non-existent one', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const nonExistentId = 'T_999999';
            const errorMessage = (fn: () => Promise<unknown>, id: string) =>
                fn().then(
                    () => 'no error',
                    (e: any) => String(e.message).replace(id.replace('T_', ''), '<id>'),
                );

            for (const mutate of [
                (id: string) => adminClient.query(ROTATE_API_KEY, { id }),
                (id: string) => adminClient.query(DELETE_API_KEYS, { ids: [id] }),
                (id: string) =>
                    adminClient.query(UPDATE_API_KEY, {
                        input: { id, translations: [{ languageCode: 'en' as any, name: 'probe' }] },
                    }),
            ]) {
                const hidden = await errorMessage(() => mutate(highPrivKeyId), highPrivKeyId);
                const missing = await errorMessage(() => mutate(nonExistentId), nonExistentId);
                expect(hidden).toContain('could be found');
                expect(hidden).toBe(missing);
            }
        });

        it('still allows deleting a key whose permissions the caller fully holds', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { deleteApiKeys } = await adminClient.query(DELETE_API_KEYS, {
                ids: [lowPrivKeyIdForDelete],
            });
            expect(deleteApiKeys[0].result).toBe('DELETED');
        });
    });

    // The impersonation path of create() takes a userIdApiKeyUser and binds the session to that
    // existing User. It is not reachable through the createApiKey mutation (the resolver never passes
    // the argument), so these tests drive the service directly with a RequestContext built as the
    // low-privilege manager.
    describe('create (impersonation path)', () => {
        async function loadUser(identifier: string): Promise<User> {
            return server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(User)
                .findOneOrFail({ where: { identifier }, relations: { roles: { channels: true } } });
        }

        async function loadRole(code: string): Promise<Role> {
            return server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(Role)
                .findOneOrFail({ where: { code } });
        }

        async function ctxAs(user: User) {
            return server.app.get(RequestContextService).create({ apiType: 'admin', user });
        }

        it('blocks binding a key to a higher-privileged existing User', async () => {
            const managerUser = await loadUser(manager.emailAddress);
            const superAdminUser = await loadUser(SUPER_ADMIN_USER_IDENTIFIER);
            const catalogRole = await loadRole('catalog-reader');
            const ctx = await ctxAs(managerUser);
            const apiKeyService = server.app.get(ApiKeyService);

            // roleIds is a role the manager may grant, so the existing incoming-roleIds check passes;
            // the guard must still reject because the bound User holds SuperAdmin. A direct service
            // call surfaces the raw i18n key (the GraphQL layer is what translates it).
            await expect(
                apiKeyService.create(
                    ctx,
                    { roleIds: [catalogRole.id], translations: [{ languageCode: 'en' as any, name: 'x' }] },
                    managerUser.id,
                    superAdminUser.id,
                ),
            ).rejects.toThrow('active-user-does-not-have-sufficient-permissions');
        });

        it('allows binding a key to a User whose permissions the caller fully holds', async () => {
            const managerUser = await loadUser(manager.emailAddress);
            const catalogRole = await loadRole('catalog-reader');
            const ctx = await ctxAs(managerUser);
            const apiKeyService = server.app.get(ApiKeyService);

            // Binding to the caller's own User: they hold all of its permissions, so this is legitimate.
            const result = await apiKeyService.create(
                ctx,
                {
                    roleIds: [catalogRole.id],
                    translations: [{ languageCode: 'en' as any, name: 'self key' }],
                },
                managerUser.id,
                managerUser.id,
            );
            expect(typeof result.apiKey).toBe('string');

            // Prove the key was created and bound to the intended User, not merely that no error threw.
            const created = await apiKeyService.findOne(ctx, result.entityId);
            expect(created).not.toBeNull();
            expect(String(created?.userId)).toBe(String(managerUser.id));
        });
    });

    // Read side: a low-privilege admin must not learn a higher-privileged key's metadata, via the
    // single lookup or the list. This is information disclosure, not escalation, but the same rule.
    describe('read visibility', () => {
        it('hides a higher-privileged key from the apiKey(id) query', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { apiKey } = await adminClient.query(GET_API_KEY_MINIMAL, { id: highPrivKeyId });
            expect(apiKey).toBeNull();
        });

        it('lists the manageable keys but excludes higher-privileged ones', async () => {
            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { apiKeys } = await adminClient.query(GET_API_KEYS, {});
            const ids = apiKeys.items.map(item => item.id);
            // Positive control: a key whose permissions the manager holds is present, so an
            // over-hiding regression (empty list) would fail this test.
            expect(ids).toContain(lowPrivKeyIdForUpdate);
            // The higher-privileged key is hidden.
            expect(ids).not.toContain(highPrivKeyId);
            // totalItems reflects the visible set, not the whole table, so post-filtering would fail here.
            expect(apiKeys.totalItems).toBe(ids.length);
        });

        // findOne checks the union of the key user's Roles, while the list excludes a key as soon as one
        // of its Roles is hidden. A key mixing a visible Role with a hidden one must be hidden by both.
        it('hides a key holding both a visible and a hidden role from apiKey(id) and apiKeys', async () => {
            await adminClient.asSuperAdmin();
            const { createApiKey: mixed } = await adminClient.query(CREATE_API_KEY, {
                input: {
                    roleIds: [catalogRoleId, '1'],
                    translations: [{ languageCode: 'en' as any, name: 'Mixed-role key' }],
                },
            });

            await adminClient.asUserWithCredentials(manager.emailAddress, manager.password);
            const { apiKey } = await adminClient.query(GET_API_KEY_MINIMAL, { id: mixed.entityId });
            expect(apiKey).toBeNull();
            const { apiKeys } = await adminClient.query(GET_API_KEYS, {});
            const ids = apiKeys.items.map(item => item.id);
            expect(ids).toContain(lowPrivKeyIdForUpdate);
            expect(ids).not.toContain(mixed.entityId);
            expect(apiKeys.totalItems).toBe(ids.length);
        });

        it('still lets a SuperAdmin read the higher-privileged key', async () => {
            await adminClient.asSuperAdmin();
            const { apiKey } = await adminClient.query(GET_API_KEY_MINIMAL, { id: highPrivKeyId });
            expect(apiKey?.id).toBe(highPrivKeyId);
        });
    });
});

const CREATE_API_KEY = graphql(`
    mutation Ghsa37xpCreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`);

const ROTATE_API_KEY = graphql(`
    mutation Ghsa37xpRotateApiKey($id: ID!) {
        rotateApiKey(id: $id) {
            apiKey
        }
    }
`);

const UPDATE_API_KEY = graphql(`
    mutation Ghsa37xpUpdateApiKey($input: UpdateApiKeyInput!) {
        updateApiKey(input: $input) {
            id
            name
        }
    }
`);

const DELETE_API_KEYS = graphql(`
    mutation Ghsa37xpDeleteApiKeys($ids: [ID!]!) {
        deleteApiKeys(ids: $ids) {
            result
        }
    }
`);

const CREATE_ROLE = graphql(`
    mutation Ghsa37xpCreateRole($input: CreateRoleInput!) {
        createRole(input: $input) {
            id
        }
    }
`);

const CREATE_ADMINISTRATOR = graphql(`
    mutation Ghsa37xpCreateAdministrator($input: CreateAdministratorInput!) {
        createAdministrator(input: $input) {
            id
        }
    }
`);

const GET_API_KEY_MINIMAL = graphql(`
    query Ghsa37xpApiKeyMinimal($id: ID!) {
        apiKey(id: $id) {
            id
            name
        }
    }
`);

const GET_API_KEYS = graphql(`
    query Ghsa37xpApiKeys {
        apiKeys(options: { take: 100 }) {
            items {
                id
            }
            totalItems
        }
    }
`);

const GET_API_KEY_WITH_ROLES = graphql(`
    query Ghsa37xpApiKey($id: ID!) {
        apiKey(id: $id) {
            id
            name
            user {
                roles {
                    code
                }
            }
        }
    }
`);
