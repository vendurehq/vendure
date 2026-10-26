import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    DEFAULT_APIKEY_HEADER_KEY,
    SUPER_ADMIN_USER_IDENTIFIER,
    SUPER_ADMIN_USER_PASSWORD,
} from '@vendure/common/lib/shared-constants';
import {
    API_KEY_AUTH_STRATEGY_NAME,
    ApiKey,
    AuthenticatedSession,
    ConfigService,
    mergeConfig,
    NativeAuthenticationStrategy,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    TestSSOStrategyAdmin,
    TestSSOStrategyRoleOnly,
    TestSSOStrategyShopOnlyAdmin,
} from './fixtures/test-authentication-strategies';
import { SessionApiTypeTestPlugin } from './fixtures/test-plugins/session-api-type-test-plugin';
import { assertThrowsWithMessage } from './utils/assert-throws-with-message';

const SSO_ADMIN_EMAIL = 'sso-admin@test.com';
// The SuperAdmin Role in the e2e seed data.
const SUPER_ADMIN_ROLE_ID = '1';

const ADMINISTRATORS_QUERY = '{ administrators { totalItems items { emailAddress } } }';
const GET_ADMINISTRATORS = gql(ADMINISTRATORS_QUERY);

function emailsOf(result: { data?: any }): string[] {
    return (result.data?.administrators?.items ?? []).map((a: { emailAddress: string }) => a.emailAddress);
}

const SHOP_ME = gql`
    query {
        me {
            id
            identifier
        }
    }
`;

const SHOP_LOGIN = gql`
    mutation ShopLogin($username: String!, $password: String!) {
        login(username: $username, password: $password) {
            ... on CurrentUser {
                identifier
            }
            ... on ErrorResult {
                errorCode
            }
        }
    }
`;

const CREATE_API_KEY = gql`
    mutation CreateApiKey($input: CreateApiKeyInput!) {
        createApiKey(input: $input) {
            apiKey
            entityId
        }
    }
`;

const ROTATE_API_KEY = gql`
    mutation RotateApiKey($id: ID!) {
        rotateApiKey(id: $id) {
            apiKey
        }
    }
`;

function postJson(url: string, headers: Record<string, string>, query: string) {
    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ query }),
    }).then(res => res.json() as Promise<{ data?: any; errors?: any[] }>);
}

const SHOP_AUTHENTICATE = gql`
    mutation ShopAuthenticate($input: AuthenticationInput!) {
        authenticate(input: $input) {
            ... on CurrentUser {
                identifier
            }
            ... on ErrorResult {
                errorCode
            }
        }
    }
`;

describe('session API type binding (GHSA-5fpx-9m35-w745)', () => {
    const config = mergeConfig(testConfig(), {
        authOptions: {
            // The configuration described by the advisory: one AuthenticationStrategy which resolves
            // to an administrator User is registered on both the Shop and the Admin API.
            // TestSSOStrategyShopOnlyAdmin is on the Shop API only, and TestSSOStrategyRoleOnly
            // resolves a User with no Administrator row. Those two are the shapes which cross a
            // privilege boundary, see the "escalation shapes" block below.
            shopAuthenticationStrategy: [
                new NativeAuthenticationStrategy(),
                new TestSSOStrategyAdmin(),
                new TestSSOStrategyShopOnlyAdmin(),
                new TestSSOStrategyRoleOnly(),
            ],
            adminAuthenticationStrategy: [
                new NativeAuthenticationStrategy(),
                new TestSSOStrategyAdmin(),
                new TestSSOStrategyRoleOnly(),
            ],
            tokenMethod: ['bearer', 'api-key'],
        },
        plugins: [SessionApiTypeTestPlugin],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const baseUrl = `http://localhost:${config.apiOptions.port}`;
    const adminApiUrl = `${baseUrl}/${String(config.apiOptions.adminApiPath)}`;
    const shopApiUrl = `${baseUrl}/${String(config.apiOptions.shopApiPath)}`;

    let shopMintedAdminToken: string;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        // Authenticate on the Shop API with the strategy which resolves to an administrator. The
        // resulting session belongs to a SuperAdmin User but was minted on the Shop API.
        const { authenticate } = await shopClient.query(SHOP_AUTHENTICATE, {
            input: { test_sso_strategy_admin: { email: SSO_ADMIN_EMAIL } },
        });
        expect(authenticate.identifier).toBe(SSO_ADMIN_EMAIL);
        shopMintedAdminToken = shopClient.getAuthToken();
        expect(shopMintedAdminToken).not.toBe('');
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('a Shop-minted administrator session is rejected by the Admin API', async () => {
        // Asserted on the returned payload rather than on a thrown message, so that a run on an
        // unpatched build fails by naming the leaked administrator rows.
        const result = await postJson(
            adminApiUrl,
            { Authorization: `Bearer ${shopMintedAdminToken}` },
            ADMINISTRATORS_QUERY,
        );
        // The data assertions come first, so that a failure prints the leaked rows.
        expect(emailsOf(result)).toEqual([]);
        expect(result.data?.administrators ?? null).toBeNull();
        expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
    });

    it('the Shop-minted session still works on the Shop API it was created on', async () => {
        // This runs after the rejected Admin API request above, so it also proves that the rejection
        // does not clear the session token. Both APIs share a session cookie by default, so clearing it
        // would log the user out of the API the session belongs to.
        shopClient.setAuthToken(shopMintedAdminToken);
        const { me } = await shopClient.query(SHOP_ME);
        expect(me.identifier).toBe(SSO_ADMIN_EMAIL);
    });

    it('an Admin-API-authenticated administrator still has full access', async () => {
        adminClient.setAuthToken('');
        await adminClient.asSuperAdmin();
        const { administrators } = await adminClient.query(GET_ADMINISTRATORS);
        // The superadmin plus the Administrator created by TestSSOStrategyAdmin.
        expect(administrators.items.map((a: { emailAddress: string }) => a.emailAddress).sort()).toEqual(
            [SSO_ADMIN_EMAIL, SUPER_ADMIN_USER_IDENTIFIER].sort(),
        );
    });

    it(
        'a session created before this column existed is rejected by the Admin API',
        assertThrowsWithMessage(async () => {
            adminClient.setAuthToken('');
            await adminClient.asSuperAdmin();
            const legacyToken = adminClient.getAuthToken();
            // Simulate a session row which pre-dates the apiType column.
            await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(AuthenticatedSession)
                .update({ token: legacyToken }, { apiType: null });
            await server.app.get(ConfigService).authOptions.sessionCacheStrategy.clear();
            await adminClient.query(GET_ADMINISTRATORS);
        }, 'You are not currently authorized to perform this action'),
    );

    it('an Admin-minted session is still accepted on the Shop API', async () => {
        // The binding is enforced in one direction only. An Admin-minted session used on the Shop API
        // gains no privilege it does not already have, and both APIs share a session cookie by default,
        // so rejecting it would break storefront browsing for logged-in administrators.
        adminClient.setAuthToken('');
        await adminClient.asSuperAdmin();
        shopClient.setAuthToken(adminClient.getAuthToken());
        const { me } = await shopClient.query(SHOP_ME);
        expect(me.identifier).toBe(SUPER_ADMIN_USER_IDENTIFIER);
    });

    it('a session created by a REST route for the Shop API is rejected by the Admin API', async () => {
        // A REST controller has apiType 'custom', but it authenticated against the Shop API strategy
        // list, so the session belongs to the Shop API and must not be honoured on the Admin API.
        const { token } = (await fetch(
            `${baseUrl}/test-session/shop-sso-callback?email=rest-sso-admin@test.com`,
        ).then(res => res.json())) as { token: string };
        expect(typeof token).toBe('string');
        expect(token.length).toBeGreaterThan(0);

        const adminResult = await postJson(
            adminApiUrl,
            { Authorization: `Bearer ${token}` },
            ADMINISTRATORS_QUERY,
        );
        expect(adminResult.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        expect(adminResult.data?.administrators ?? null).toBeNull();

        const shopResult = await postJson(
            shopApiUrl,
            { Authorization: `Bearer ${token}` },
            '{ me { identifier } }',
        );
        expect(shopResult.data?.me?.identifier).toBe('rest-sso-admin@test.com');
    });

    it('an Admin-minted session is accepted on a REST route', async () => {
        adminClient.setAuthToken('');
        await adminClient.asSuperAdmin();
        const response = await fetch(`${baseUrl}/test-session/restricted`, {
            headers: { Authorization: `Bearer ${adminClient.getAuthToken()}` },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('success');
    });

    describe('API-Key sessions', () => {
        let apiKey: string;

        beforeAll(async () => {
            adminClient.setAuthToken('');
            await adminClient.asSuperAdmin();
            const result = await adminClient.query(CREATE_API_KEY, {
                input: {
                    roleIds: [SUPER_ADMIN_ROLE_ID],
                    translations: [{ languageCode: LanguageCode.en, name: 'Session API type test key' }],
                },
            });
            apiKey = result.createApiKey.apiKey;
            expect(apiKey).toBeTruthy();
        });

        it('works on the Admin API', async () => {
            const result = await postJson(
                adminApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: apiKey },
                ADMINISTRATORS_QUERY,
            );
            expect(result.errors).toBeUndefined();
            expect(emailsOf(result)).toContain(SUPER_ADMIN_USER_IDENTIFIER);
            expect(emailsOf(result)).toContain(SSO_ADMIN_EMAIL);
        });

        it('is still usable on the Shop API', async () => {
            // The key is created by an Admin API mutation, so its session records apiType 'admin'.
            // Nothing rejects it on the Shop API, which is where the one-way rule matters.
            const result = await postJson(
                shopApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: apiKey },
                '{ me { identifier } }',
            );
            expect(result.errors).toBeUndefined();
            // The default RandomBytesApiKeyStrategy issues keys as `<lookupId>:<secret>`, and
            // ApiKeyService derives the key User's identifier from the lookupId.
            expect(result.data?.me?.identifier).toBe(`apikey-user-${apiKey.split(':')[0]}`);
        });

        it('records apiType admin on the session it creates', async () => {
            const session = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(AuthenticatedSession)
                .findOne({ where: { authenticationStrategy: API_KEY_AUTH_STRATEGY_NAME } });
            expect(session?.apiType).toBe('admin');
        });

        it('is exempt from the Admin API check when it has no recorded apiType', async () => {
            // API-Keys issued before this column existed have a null apiType. They must keep working
            // without a rotation, so the AuthGuard exempts API-Key sessions with a null apiType.
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const keyEntity = await connection
                .getRepository(ApiKey)
                .findOne({ where: { lookupId: apiKey.split(':')[0] } });
            expect(keyEntity).not.toBeNull();
            // Scoped to this key, so that the other API-Key tests do not depend on the order of this file.
            await connection
                .getRepository(AuthenticatedSession)
                .update({ token: String(keyEntity?.apiKeyHash) }, { apiType: null });
            await server.app.get(ConfigService).authOptions.sessionCacheStrategy.clear();
            const result = await postJson(
                adminApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: apiKey },
                ADMINISTRATORS_QUERY,
            );
            expect(result.errors).toBeUndefined();
            expect(emailsOf(result)).toContain(SUPER_ADMIN_USER_IDENTIFIER);
        });
    });

    describe('API-Key created from a Shop API context', () => {
        // A plugin can expose ApiKeyService.create() from a Shop API resolver, which the
        // shopApiKeyStrategy config option exists to support. The session minted for the key must
        // record the Shop API context it was created from, otherwise the key would carry its roles
        // into the Admin API.
        let shopContextApiKey: string;

        beforeAll(async () => {
            // The Shop-minted administrator session holds the SuperAdmin role, so it may grant
            // role 1 to the key.
            const result = await postJson(
                shopApiUrl,
                { Authorization: `Bearer ${shopMintedAdminToken}` },
                'mutation { createTestShopApiKey }',
            );
            expect(result.errors).toBeUndefined();
            shopContextApiKey = result.data?.createTestShopApiKey;
            expect(shopContextApiKey).toBeTruthy();
        });

        it('records apiType shop on the session it creates', async () => {
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const keyEntity = await connection
                .getRepository(ApiKey)
                .findOne({ where: { lookupId: shopContextApiKey.split(':')[0] } });
            expect(keyEntity).not.toBeNull();
            // The session token of an API-Key session is the key's hash.
            const session = await connection
                .getRepository(AuthenticatedSession)
                .findOne({ where: { token: String(keyEntity?.apiKeyHash) } });
            expect(session?.apiType).toBe('shop');
        });

        it('works on the Shop API it was created from', async () => {
            const result = await postJson(
                shopApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: shopContextApiKey },
                '{ me { identifier } }',
            );
            expect(result.errors).toBeUndefined();
            expect(result.data?.me?.identifier).toBe(`apikey-user-${shopContextApiKey.split(':')[0]}`);
        });

        it('is refused by the Admin API', async () => {
            const result = await postJson(
                adminApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: shopContextApiKey },
                ADMINISTRATORS_QUERY,
            );
            // The data assertions come first, so that a failure prints the leaked rows.
            expect(emailsOf(result)).toEqual([]);
            expect(result.data?.administrators ?? null).toBeNull();
            expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        });
    });

    it('a session created by a REST route without an apiType records custom and is rejected by the Admin API', async () => {
        // createNewAuthenticatedSession() without an apiType records ctx.apiType, which is 'custom' for
        // a REST route. Only 'admin' is accepted on the Admin API, so this is the behaviour change a
        // plugin author sees if they do not pass the argument.
        const { token } = (await fetch(
            `${baseUrl}/test-session/custom-session?identifier=${SUPER_ADMIN_USER_IDENTIFIER}`,
        ).then(res => res.json())) as { token: string | null };
        expect(typeof token).toBe('string');

        const customToken = String(token);
        const session = await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(AuthenticatedSession)
            .findOne({ where: { token: customToken } });
        expect(session?.apiType).toBe('custom');

        const adminResult = await postJson(
            adminApiUrl,
            { Authorization: `Bearer ${customToken}` },
            ADMINISTRATORS_QUERY,
        );
        expect(adminResult.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        expect(adminResult.data?.administrators ?? null).toBeNull();
    });

    describe('sessions created outside the request-response cycle', () => {
        // A context built outside a request states nothing about the API a caller reached:
        // RequestContext.empty() hardcodes apiType 'admin' and RequestContextService.create() takes
        // whatever the caller passed. Omitting the apiType argument must fail closed.

        it('records shop and is rejected by the Admin API', async () => {
            const { token } = (await fetch(
                `${baseUrl}/test-session/synthetic-session?identifier=${SUPER_ADMIN_USER_IDENTIFIER}`,
            ).then(res => res.json())) as { token: string };
            expect(token).toBeTruthy();

            const adminResult = await postJson(
                adminApiUrl,
                { Authorization: `Bearer ${token}` },
                ADMINISTRATORS_QUERY,
            );
            // The data assertions come first, so that a failure prints the leaked rows.
            expect(emailsOf(adminResult)).toEqual([]);
            expect(adminResult.data?.administrators ?? null).toBeNull();
            expect(adminResult.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

            const session = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(AuthenticatedSession)
                .findOne({ where: { token } });
            // The context passed apiType 'admin'.
            expect(session?.apiType).toBe('shop');

            // The session is refused on the Admin API, not broken: it works on the API it records.
            const shopResult = await postJson(
                shopApiUrl,
                { Authorization: `Bearer ${token}` },
                '{ me { identifier } }',
            );
            expect(shopResult.data?.me?.identifier).toBe(SUPER_ADMIN_USER_IDENTIFIER);
        });

        it('records shop when the context comes from RequestContext.empty()', async () => {
            const { token } = (await fetch(
                `${baseUrl}/test-session/empty-context-session?identifier=${SUPER_ADMIN_USER_IDENTIFIER}`,
            ).then(res => res.json())) as { token: string };
            expect(token).toBeTruthy();

            const session = await server.app
                .get(TransactionalConnection)
                .rawConnection.getRepository(AuthenticatedSession)
                .findOne({ where: { token } });
            expect(session?.apiType).toBe('shop');
        });

        it('records admin when the caller passes the apiType argument', async () => {
            // The escape hatch the auth guide documents for a plugin which authenticates against the
            // Admin API outside the request-response cycle.
            const { token } = (await fetch(
                `${baseUrl}/test-session/synthetic-session?identifier=${SUPER_ADMIN_USER_IDENTIFIER}&apiType=admin`,
            ).then(res => res.json())) as { token: string };
            expect(token).toBeTruthy();

            const result = await postJson(
                adminApiUrl,
                { Authorization: `Bearer ${token}` },
                ADMINISTRATORS_QUERY,
            );
            expect(result.errors).toBeUndefined();
            expect(emailsOf(result)).toContain(SUPER_ADMIN_USER_IDENTIFIER);
        });
    });

    describe('the API an API-Key belongs to', () => {
        // The API is recorded on the ApiKey itself, so rotation and session recovery cannot move a key
        // from one API to the other.

        async function sessionOfKey(key: string) {
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const keyEntity = await connection
                .getRepository(ApiKey)
                .findOne({ where: { lookupId: key.split(':')[0] } });
            expect(keyEntity).not.toBeNull();
            return connection
                .getRepository(AuthenticatedSession)
                .findOne({ where: { token: String(keyEntity?.apiKeyHash) } });
        }

        it('a key created outside the request-response cycle records shop and is refused by the Admin API', async () => {
            const { apiKey } = (await fetch(
                `${baseUrl}/test-session/synthetic-api-key?identifier=${SUPER_ADMIN_USER_IDENTIFIER}`,
            ).then(res => res.json())) as { apiKey: string };
            expect(apiKey).toBeTruthy();
            expect((await sessionOfKey(apiKey))?.apiType).toBe('shop');

            const result = await postJson(
                adminApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: apiKey },
                ADMINISTRATORS_QUERY,
            );
            expect(emailsOf(result)).toEqual([]);
            expect(result.data?.administrators ?? null).toBeNull();
            expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        });

        it('a key created from a REST context records shop, the API whose strategy hashed it', async () => {
            // ApiKeyService serves every context which is not an Admin API request with the shop
            // api-key strategy, so 'custom' must not reach the session.
            const { apiKey } = (await fetch(
                `${baseUrl}/test-session/rest-context-api-key?identifier=${SUPER_ADMIN_USER_IDENTIFIER}`,
            ).then(res => res.json())) as { apiKey: string };
            expect(apiKey).toBeTruthy();
            expect((await sessionOfKey(apiKey))?.apiType).toBe('shop');
        });

        it('rotating a Shop API key from the Admin API keeps it a Shop API key', async () => {
            // rotateApiKey is exposed on the Admin API only. Taking the API from the rotating caller
            // would turn every rotated Shop API key into an Admin API key.
            const created = await postJson(
                shopApiUrl,
                { Authorization: `Bearer ${shopMintedAdminToken}` },
                'mutation { createTestShopApiKey }',
            );
            const shopKey = created.data?.createTestShopApiKey as string;
            expect(shopKey).toBeTruthy();
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const keyEntity = await connection
                .getRepository(ApiKey)
                .findOne({ where: { lookupId: shopKey.split(':')[0] } });
            expect(keyEntity).not.toBeNull();
            expect(keyEntity?.apiType).toBe('shop');

            adminClient.setAuthToken('');
            await adminClient.asSuperAdmin();
            const { rotateApiKey } = await adminClient.query(ROTATE_API_KEY, { id: keyEntity?.id });
            const rotatedKey = rotateApiKey.apiKey as string;
            expect(rotatedKey).toBeTruthy();
            expect((await sessionOfKey(rotatedKey))?.apiType).toBe('shop');

            const adminResult = await postJson(
                adminApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: rotatedKey },
                ADMINISTRATORS_QUERY,
            );
            expect(emailsOf(adminResult)).toEqual([]);
            expect(adminResult.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');

            const shopResult = await postJson(
                shopApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: rotatedKey },
                '{ me { identifier } }',
            );
            expect(shopResult.errors).toBeUndefined();
        });

        it('recovering the session of an Admin API key on the Shop API keeps it an Admin API key', async () => {
            // The AuthGuard recreates the session when its row is missing. Recording the API the key
            // was presented on would take an Admin API key's access away after one Shop API call.
            adminClient.setAuthToken('');
            await adminClient.asSuperAdmin();
            const { createApiKey } = await adminClient.query(CREATE_API_KEY, {
                input: {
                    roleIds: [SUPER_ADMIN_ROLE_ID],
                    translations: [{ languageCode: LanguageCode.en, name: 'Recovery test key' }],
                },
            });
            const adminKey = createApiKey.apiKey as string;
            const connection = server.app.get(TransactionalConnection).rawConnection;
            const keyEntity = await connection
                .getRepository(ApiKey)
                .findOne({ where: { lookupId: adminKey.split(':')[0] } });
            expect(keyEntity?.apiType).toBe('admin');

            // Simulate the session row being deleted, which is the case the recovery path exists for.
            await connection
                .getRepository(AuthenticatedSession)
                .delete({ token: String(keyEntity?.apiKeyHash) });
            await server.app.get(ConfigService).authOptions.sessionCacheStrategy.clear();

            const shopResult = await postJson(
                shopApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: adminKey },
                '{ me { identifier } }',
            );
            expect(shopResult.errors).toBeUndefined();
            expect((await sessionOfKey(adminKey))?.apiType).toBe('admin');

            const adminResult = await postJson(
                adminApiUrl,
                { [DEFAULT_APIKEY_HEADER_KEY]: adminKey },
                ADMINISTRATORS_QUERY,
            );
            expect(adminResult.errors).toBeUndefined();
            expect(emailsOf(adminResult)).toContain(SUPER_ADMIN_USER_IDENTIFIER);
        });
    });

    it('a Shop-created administrator session is still accepted on a REST route gated by an administrator permission', async () => {
        // Documented gap: the check runs on the Admin API only, not on REST routes, because a REST
        // request cannot say which API it belongs to. A plugin REST route gated by an administrator
        // permission must check ctx.session.apiType itself. This test pins that decision.
        const response = await fetch(`${baseUrl}/test-session/admin-restricted`, {
            headers: { Authorization: `Bearer ${shopMintedAdminToken}` },
        });
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('admin-success');
    });

    it('native login on the Shop API cannot resolve an administrator account', async () => {
        // Covered by UserService.getUserByEmailAddress, which scopes the lookup to the Customer table on
        // the Shop API. Asserted here so that the native path stays closed.
        const { login } = await shopClient.query(SHOP_LOGIN, {
            username: SUPER_ADMIN_USER_IDENTIFIER,
            password: SUPER_ADMIN_USER_PASSWORD,
        });
        expect(login.errorCode).toBe('INVALID_CREDENTIALS_ERROR');
    });

    describe('escalation shapes', () => {
        // TestSSOStrategyAdmin is on both strategy lists, so the Admin API's own authenticate mutation
        // issues the same SuperAdmin session and the replay above is a shortcut. The three cases here
        // are the ones where the Admin API refuses to issue the session itself, so the Shop-minted
        // token is the only way in. Each asserts on returned data, so that a run on an unpatched
        // build fails by naming what leaked.

        const SHOP_ONLY_ADMIN_EMAIL = 'shop-only-sso-admin@test.com';
        const ROLE_ONLY_EMAIL = 'role-only-sso@test.com';
        const ADMIN_ME_QUERY = '{ me { identifier } }';
        const AUTHENTICATED_ONLY_QUERY = '{ activeChannel { code } globalSettings { availableLanguages } }';

        function adminAuthenticateQuery(field: string, email: string) {
            return `mutation { authenticate(input: { ${field}: { email: "${email}" } }) { ... on CurrentUser { identifier } ... on ErrorResult { errorCode } } }`;
        }

        function expectForbiddenWithNullData(result: { data?: any; errors?: any[] }, field: string) {
            // The data assertion comes first, so that a failure prints what leaked.
            expect(result.data?.[field] ?? null).toBeNull();
            expect(result.errors?.[0]?.extensions?.code).toBe('FORBIDDEN');
        }

        describe('a storefront customer with no custom strategy', () => {
            // The weakest precondition: native login as a seeded customer. The session carries only
            // Permission.Authenticated, and the Admin API has resolvers gated by exactly that.
            let customerToken: string;

            beforeAll(async () => {
                adminClient.setAuthToken('');
                await adminClient.asSuperAdmin();
                const { customers } = await adminClient.query(gql`
                    query {
                        customers(options: { take: 1 }) {
                            items {
                                emailAddress
                            }
                        }
                    }
                `);
                await shopClient.asUserWithCredentials(customers.items[0].emailAddress, 'test');
                customerToken = shopClient.getAuthToken();
                expect(customerToken).not.toBe('');
            });

            it('is refused by the Admin API me query, which checks for an Administrator row', async () => {
                const result = await postJson(
                    adminApiUrl,
                    { Authorization: `Bearer ${customerToken}` },
                    ADMIN_ME_QUERY,
                );
                expectForbiddenWithNullData(result, 'me');
            });

            it('is refused by Admin API queries gated by Permission.Authenticated', async () => {
                const result = await postJson(
                    adminApiUrl,
                    { Authorization: `Bearer ${customerToken}` },
                    AUTHENTICATED_ONLY_QUERY,
                );
                expectForbiddenWithNullData(result, 'activeChannel');
                expect(result.data?.globalSettings ?? null).toBeNull();
            });
        });

        describe('a strategy on the Shop API only which resolves an administrator', () => {
            let shopOnlyToken: string;

            beforeAll(async () => {
                shopClient.setAuthToken('');
                const { authenticate } = await shopClient.query(SHOP_AUTHENTICATE, {
                    input: { test_sso_strategy_shop_only_admin: { email: SHOP_ONLY_ADMIN_EMAIL } },
                });
                expect(authenticate.identifier).toBe(SHOP_ONLY_ADMIN_EMAIL);
                shopOnlyToken = shopClient.getAuthToken();
                expect(shopOnlyToken).not.toBe('');
            });

            it('has no input field on the Admin API authenticate mutation', async () => {
                // The AuthenticationInput union is built per API from that API's strategy list, so
                // the Admin API cannot issue this session at all.
                const result = await postJson(
                    adminApiUrl,
                    {},
                    adminAuthenticateQuery('test_sso_strategy_shop_only_admin', SHOP_ONLY_ADMIN_EMAIL),
                );
                expect(result.data ?? null).toBeNull();
                expect(result.errors?.[0]?.extensions?.code).toBe('GRAPHQL_VALIDATION_FAILED');
                expect(result.errors?.[0]?.message).toContain('test_sso_strategy_shop_only_admin');
            });

            it('cannot log in natively on the Admin API, because the User has no password', async () => {
                adminClient.setAuthToken('');
                const { login } = await adminClient.query(SHOP_LOGIN, {
                    username: SHOP_ONLY_ADMIN_EMAIL,
                    password: 'anything',
                });
                expect(login.errorCode).toBe('INVALID_CREDENTIALS_ERROR');
            });

            it('is refused when the Shop-minted session is replayed on the Admin API', async () => {
                const result = await postJson(
                    adminApiUrl,
                    { Authorization: `Bearer ${shopOnlyToken}` },
                    ADMINISTRATORS_QUERY,
                );
                expectForbiddenWithNullData(result, 'administrators');
                expect(emailsOf(result)).not.toContain(SUPER_ADMIN_USER_IDENTIFIER);
            });
        });

        describe('a strategy which resolves a User with the SuperAdmin role and no Administrator row', () => {
            let roleOnlyToken: string;

            beforeAll(async () => {
                shopClient.setAuthToken('');
                const { authenticate } = await shopClient.query(SHOP_AUTHENTICATE, {
                    input: { test_sso_strategy_role_only: { email: ROLE_ONLY_EMAIL } },
                });
                expect(authenticate.identifier).toBe(ROLE_ONLY_EMAIL);
                roleOnlyToken = shopClient.getAuthToken();
                expect(roleOnlyToken).not.toBe('');
            });

            it('is refused a session by the Admin API authenticate mutation, even though the strategy is on the admin list', async () => {
                const result = await postJson(
                    adminApiUrl,
                    {},
                    adminAuthenticateQuery('test_sso_strategy_role_only', ROLE_ONLY_EMAIL),
                );
                expect(result.errors).toBeUndefined();
                expect(result.data?.authenticate?.errorCode).toBe('INVALID_CREDENTIALS_ERROR');
            });

            it('is refused by the Admin API me query', async () => {
                const result = await postJson(
                    adminApiUrl,
                    { Authorization: `Bearer ${roleOnlyToken}` },
                    ADMIN_ME_QUERY,
                );
                expectForbiddenWithNullData(result, 'me');
            });

            it('is refused when the Shop-minted session is replayed on a permission-gated Admin API query', async () => {
                const result = await postJson(
                    adminApiUrl,
                    { Authorization: `Bearer ${roleOnlyToken}` },
                    ADMINISTRATORS_QUERY,
                );
                expectForbiddenWithNullData(result, 'administrators');
                expect(emailsOf(result)).not.toContain(SUPER_ADMIN_USER_IDENTIFIER);
            });

            it('still works on the Shop API it was created on', async () => {
                const result = await postJson(
                    shopApiUrl,
                    { Authorization: `Bearer ${roleOnlyToken}` },
                    '{ me { identifier } }',
                );
                expect(result.data?.me?.identifier).toBe(ROLE_ONLY_EMAIL);
            });
        });
    });
});
