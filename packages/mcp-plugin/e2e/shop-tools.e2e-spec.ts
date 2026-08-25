import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ConfigService,
    Customer,
    CustomerService,
    ID,
    mergeConfig,
    Order,
    OrderByCodeAccessStrategy,
    PaymentMethodHandler,
    RequestContext,
    RequestContextService,
    Session,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { McpTool, McpToolMetadata } from '@vendure/mcp-sdk';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpOauthService } from '../src/oauth/oauth.service';
import { deriveHashKey, hashLookupToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { McpToolExecutionService } from '../src/registry/mcp-tool-execution.service';
import { McpToolRegistryService } from '../src/registry/mcp-tool-registry.service';
import { shopToolProviders } from '../src/tools/built-in/shop';

import { callTool, postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow, runShopAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'shop-tools-secret-000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const CHANNEL_TOKEN_HEADER = 'vendure-token';

const shopToolNames = shopToolProviders
    .map(provider => (Reflect.getMetadata(McpTool.KEY, provider) as McpToolMetadata).name)
    .sort();

/**
 * A payment method for the checkout test. The shared test data ships no payment method, and
 * `place_order` cannot be exercised without one. It settles immediately, so a placed order lands in
 * `PaymentSettled`.
 */
const testPaymentHandler = new PaymentMethodHandler({
    code: 'e2e-payment-handler',
    description: [{ languageCode: LanguageCode.en, value: 'E2E payment handler' }],
    args: {},
    createPayment: (ctx, order, amount, args, metadata) => ({
        amount,
        state: 'Settled' as const,
        transactionId: 'e2e-checkout-1',
        metadata,
    }),
    settlePayment: () => ({ success: true }),
});
const PAYMENT_METHOD_CODE = 'e2e-payment';

/**
 * A payment method that takes a payment which does not finish the checkout: it pays one minor unit
 * and leaves the rest of the total outstanding, so Vendure keeps the order in `ArrangingPayment` and
 * never marks it as placed. Core still answers with the order rather than an error, which is the
 * case `place_order` has to report as `awaiting_payment`. The metadata is split the way a redirect
 * provider splits it, with the shopper's next step under `public` and provider-only data outside it.
 */
const pendingPaymentHandler = new PaymentMethodHandler({
    code: 'e2e-pending-payment-handler',
    description: [{ languageCode: LanguageCode.en, value: 'E2E pending payment handler' }],
    args: {},
    createPayment: () => ({
        amount: 1,
        state: 'Settled' as const,
        transactionId: 'e2e-pending-1',
        metadata: {
            public: { redirectUrl: 'https://pay.example.com/e2e-pending-1' },
            secret: 'provider-only',
        },
    }),
    settlePayment: () => ({ success: true }),
});
const PENDING_PAYMENT_METHOD_CODE = 'e2e-pending-payment';
const PENDING_PAYMENT_CUSTOMER_EMAIL = 'mcp-pending-payment@e2e.example.com';
const PENDING_PAYMENT_CUSTOMER_PASSWORD = 'test';

class TestOrderByCodeAccessStrategy implements OrderByCodeAccessStrategy {
    allow = true;

    canAccessOrder(_ctx: RequestContext, _order: Order): boolean {
        return this.allow;
    }
}

describe('MCP built-in shop tools', () => {
    const orderByCodeAccessStrategy = new TestOrderByCodeAccessStrategy();
    const config = mergeConfig(testConfig(), {
        orderOptions: { orderByCodeAccessStrategy },
        paymentOptions: { paymentMethodHandlers: [testPaymentHandler, pendingPaymentHandler] },
        plugins: [
            McpPlugin.init({
                oauth: {
                    tokenSecret: TOKEN_SECRET,
                    storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
                },
                // This suite makes more than 60 anonymous calls in well under a minute. Both
                // default limits an anonymous caller charges (per session and per IP, 60 a minute
                // each) would start refusing part way through. mcp-transport.e2e-spec.ts is where
                // those limits are tested; an rpm of 0 turns a bucket off.
                rateLimits: { perSession: { rpm: 0 }, anonymousIp: false },
            }),
        ],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);

    let adminCtx: RequestContext;
    let connection: TransactionalConnection;
    let customerAuthToken: string;
    let customerEmail: string;
    let productId: ID;
    let productAdminId: string;
    let productSlug: string;
    let variantId: ID;
    let shirtId: ID;
    let shirtVariantCount: number;
    let publicCollectionId: ID;
    let publicCollectionSlug: string;
    let privateCollectionId: ID;
    let privateCollectionSlug: string;
    let secondChannelId: string;
    let secondChannelDbId: ID;
    let secondChannelToken: string;

    beforeAll(async () => {
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();

        connection = server.app.get(TransactionalConnection);
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;

        const fixture = await adminClient.query(gql`
            query ShopToolFixture {
                activeChannel {
                    defaultLanguageCode
                    defaultCurrencyCode
                }
                zones(options: { take: 1 }) {
                    items {
                        id
                    }
                }
                products(options: { take: 1 }) {
                    items {
                        id
                        slug
                        variants {
                            id
                        }
                    }
                }
                collections(options: { filter: { isPrivate: { eq: false } }, take: 1 }) {
                    items {
                        id
                        slug
                    }
                }
                customers(options: { take: 1 }) {
                    items {
                        emailAddress
                    }
                }
            }
        `);
        const product = fixture.products.items[0];
        const collection = fixture.collections.items[0];
        const zoneId = fixture.zones.items[0]?.id;
        customerEmail = fixture.customers.items[0]?.emailAddress;
        if (!product?.variants[0] || !collection || !zoneId || !customerEmail) {
            throw new Error(
                `Expected seeded product, variant, collection, zone, and customer fixtures: ${JSON.stringify(
                    fixture,
                )}`,
            );
        }
        productAdminId = product.id;
        productId = idStrategy.decodeId(product.id);
        productSlug = product.slug;
        variantId = idStrategy.decodeId(product.variants[0].id);
        publicCollectionId = idStrategy.decodeId(collection.id);
        publicCollectionSlug = collection.slug;

        // A second fixture product carrying three variants. add_to_cart must refuse a product ID
        // when the product has more than one variant, and there is nothing to test that against
        // unless such a product exists.
        const shirtFixture = await adminClient.query(gql`
            query ShopToolShirtFixture {
                products(options: { filter: { slug: { eq: "test-shirt" } } }) {
                    items {
                        id
                        variants {
                            id
                            sku
                        }
                    }
                }
            }
        `);
        const shirt = shirtFixture.products.items[0];
        if (!shirt || shirt.variants.length < 2) {
            throw new Error(
                `Expected the seeded "test-shirt" product to have several variants: ${JSON.stringify(
                    shirtFixture,
                )}`,
            );
        }
        shirtId = idStrategy.decodeId(shirt.id);
        shirtVariantCount = shirt.variants.length;

        const channelResult = await adminClient.query(
            gql`
                mutation CreateShopToolChannel($input: CreateChannelInput!) {
                    createChannel(input: $input) {
                        ... on Channel {
                            id
                            token
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            {
                input: {
                    code: 'shop-tools-second-channel',
                    token: 'shop-tools-second-channel-token',
                    defaultLanguageCode: fixture.activeChannel.defaultLanguageCode,
                    defaultCurrencyCode: fixture.activeChannel.defaultCurrencyCode,
                    pricesIncludeTax: false,
                    defaultShippingZoneId: zoneId,
                    defaultTaxZoneId: zoneId,
                },
            },
        );
        if (!channelResult.createChannel.id) {
            throw new Error(
                `Could not create second channel: ${JSON.stringify(channelResult.createChannel)}`,
            );
        }
        secondChannelId = channelResult.createChannel.id;
        secondChannelDbId = idStrategy.decodeId(secondChannelId);
        secondChannelToken = channelResult.createChannel.token;

        await adminClient.query(
            gql`
                mutation AssignShopToolProduct($input: AssignProductsToChannelInput!) {
                    assignProductsToChannel(input: $input) {
                        id
                    }
                }
            `,
            { input: { channelId: secondChannelId, productIds: [productAdminId], priceFactor: 1 } },
        );

        const privateCollection = await adminClient.query(
            gql`
                mutation CreatePrivateShopToolCollection($input: CreateCollectionInput!) {
                    createCollection(input: $input) {
                        id
                        slug
                    }
                }
            `,
            {
                input: {
                    isPrivate: true,
                    translations: [
                        {
                            languageCode: fixture.activeChannel.defaultLanguageCode,
                            name: 'Private MCP collection',
                            slug: 'private-mcp-collection',
                            description: '',
                        },
                    ],
                    filters: [],
                },
            },
        );
        privateCollectionId = idStrategy.decodeId(privateCollection.createCollection.id);
        privateCollectionSlug = privateCollection.createCollection.slug;

        shopClient.setChannelToken(secondChannelToken);
        const login = await shopClient.asUserWithCredentials(customerEmail, 'test');
        if (!login || login.errorCode) {
            throw new Error(`Customer login failed: ${JSON.stringify(login)}`);
        }
        customerAuthToken = shopClient.getAuthToken();
        if (!customerAuthToken) {
            throw new Error('Customer login did not yield a session token');
        }
        await shopClient.query(gql`
            query PersistCustomerSessionChannel {
                activeCustomer {
                    id
                }
            }
        `);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function anonymousSession(token: string): Promise<Session> {
        return connection.getRepository(adminCtx, Session).findOneOrFail({ where: { token } });
    }

    /**
     * Starts an anonymous cart holding `quantity` of the fixture variant. The token comes from
     * the result payload (the transport sets no header for a token-less request); tests pass it
     * back as the `sessionToken` argument, or thread it as the `vendure-auth-token` header,
     * which stays supported for clients that can echo headers.
     */
    async function anonymousCart(quantity = 1): Promise<{ sessionToken: string; lineId: ID; order: any }> {
        const added = await postMcp(baseUrl(), 'shop', callTool('add_to_cart', { variantId, quantity }, 1));
        expect(added.body.result.isError).toBeUndefined();
        const sessionToken = added.body.result.structuredContent.sessionToken;
        expect(sessionToken).toBeTruthy();
        const order = added.body.result.structuredContent.order;
        return { sessionToken: sessionToken as string, lineId: order.lines[0].id, order };
    }

    async function orderByCode(code: string): Promise<Order> {
        return connection.getRepository(adminCtx, Order).findOneOrFail({
            where: { code },
            relations: ['channels'],
        });
    }

    async function shopFlow() {
        return runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: customerAuthToken,
            channelToken: secondChannelToken,
        });
    }

    it('lists exactly the built-in shop tools for an authenticated customer', async () => {
        const flow = await shopFlow();
        const response = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 1), {
            token: flow.access_token,
        });

        expect(response.status).toBe(200);
        expect(response.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
            shopToolNames,
        );
    });

    // A signed-in customer's session token is refused, not silently swapped for a fresh
    // anonymous cart — otherwise the caller gets 200s against the wrong cart.
    it('refuses an anonymous shop call carrying a signed-in customer session token', async () => {
        const response = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 1), {
            headers: { [AUTH_TOKEN_HEADER]: customerAuthToken },
        });
        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate') ?? '').toMatch(/^Bearer .*resource_metadata=/);
    });

    it('creates no session or order for token-less reads; add_to_cart lazily creates and binds both', async () => {
        const beforeOrders = await connection.getRepository(adminCtx, Order).count();
        const beforeSessions = await connection.getRepository(adminCtx, Session).count();

        // Token-less reads answer, set no session-token header, append no sessionToken, and
        // write no session row.
        const getCart = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 1));
        expect(getCart.headers.get(AUTH_TOKEN_HEADER)).toBeNull();
        expect(getCart.body.result.structuredContent).toEqual({ order: null });

        for (const [id, name] of [
            [2, 'get_eligible_payment_methods'],
            [3, 'get_eligible_shipping_methods'],
        ] as const) {
            const response = await postMcp(baseUrl(), 'shop', callTool(name, {}, id));
            expect(response.body.result.structuredContent).toEqual({ methods: [] });
        }

        expect(await connection.getRepository(adminCtx, Session).count()).toBe(beforeSessions);
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(beforeOrders);

        // The first write creates the session and hands its token back in the payload — the only
        // channel a real MCP client reliably echoes.
        const { sessionToken, order } = await anonymousCart(1);
        expect(order.totalQuantity).toBe(1);

        const session = await anonymousSession(sessionToken);
        expect(session.activeOrderId).toBeTruthy();
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(beforeOrders + 1);
        expect(String(session.activeOrderId)).toBe(String((await orderByCode(order.code)).id));
    });

    // The zero-config real-host flow: separate POSTs, no headers threaded, cart identity carried
    // only by the sessionToken field that shop tools return and accept.
    it('carries the anonymous cart across separate calls via the sessionToken payload field alone', async () => {
        const { sessionToken, order: added } = await anonymousCart(1);
        const orderCode = added.code;

        const cart = await postMcp(baseUrl(), 'shop', callTool('get_cart', { sessionToken }, 2));
        expect(cart.body.result.isError).toBeUndefined();
        const order = cart.body.result.structuredContent.order;
        expect(order.code).toBe(orderCode);
        expect(order.totalQuantity).toBe(1);
        expect(order.lines).toHaveLength(1);
        // The result echoes the token back so the agent can keep threading it.
        expect(cart.body.result.structuredContent.sessionToken).toBe(sessionToken);
    });

    it('refuses an unknown sessionToken argument with a message telling the agent to start over', async () => {
        const result = await postMcp(
            baseUrl(),
            'shop',
            callTool('get_cart', { sessionToken: 'not-a-real-session-token' }, 1),
        );
        expect(result.body.result.isError).toBe(true);
        expect(result.body.result.content[0].text).toMatch(/not valid or has expired/);
    });

    it("refuses a signed-in customer's session token passed as the sessionToken argument", async () => {
        const result = await postMcp(
            baseUrl(),
            'shop',
            callTool('get_cart', { sessionToken: customerAuthToken }, 1),
        );
        expect(result.body.result.isError).toBe(true);
        expect(result.body.result.content[0].text).toMatch(/belongs to a signed-in user/);
    });

    it('returns the sessionToken on a failed write so the caller keeps the session it created', async () => {
        const failed = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { productId: '999999', quantity: 1 }, 1),
        );
        expect(failed.body.result.isError).toBe(true);
        const sessionToken = failed.body.result.structuredContent?.sessionToken as string;
        expect(sessionToken).toBeTruthy();
        // The session the failed call created is real and reusable.
        const session = await anonymousSession(sessionToken);
        expect(session).toBeTruthy();
    });

    it('carries the sessionToken on a place_order confirmation preview, and starts no cart without one', async () => {
        const { sessionToken, order: added } = await anonymousCart(1);

        const preview = await postMcp(
            baseUrl(),
            'shop',
            callTool('place_order', { paymentMethodCode: 'not-configured', sessionToken }, 2),
        );
        expect(preview.body.result.isError).toBeUndefined();
        expect(preview.body.result.structuredContent).toEqual({
            status: 'confirmation_required',
            confirmed: false,
            sessionToken,
        });
        // The preview ran no handler, so the cart is exactly as it was.
        const cart = await postMcp(baseUrl(), 'shop', callTool('get_cart', { sessionToken }, 3));
        expect(cart.body.result.structuredContent.order.code).toBe(added.code);

        // A preview with no token has no cart to preserve, so it must not start one.
        const sessionsBefore = await connection.getRepository(adminCtx, Session).count();
        const tokenless = await postMcp(
            baseUrl(),
            'shop',
            callTool('place_order', { paymentMethodCode: 'not-configured' }, 4),
        );
        expect(tokenless.body.result.structuredContent).toEqual({
            status: 'confirmation_required',
            confirmed: false,
        });
        expect(await connection.getRepository(adminCtx, Session).count()).toBe(sessionsBefore);
    });

    it('treats a blank sessionToken argument as no token rather than refusing the call', async () => {
        const read = await postMcp(baseUrl(), 'shop', callTool('get_cart', { sessionToken: '' }, 1));
        expect(read.body.result.isError).toBeUndefined();
        expect(read.body.result.structuredContent.order).toBeNull();

        const sessionsBefore = await connection.getRepository(adminCtx, Session).count();
        const write = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1, sessionToken: '   ' }, 2),
        );
        expect(write.body.result.isError).toBeUndefined();
        const sessionToken = write.body.result.structuredContent.sessionToken as string;
        expect(sessionToken).toBeTruthy();
        expect(write.body.result.structuredContent.order.totalQuantity).toBe(1);
        expect(await connection.getRepository(adminCtx, Session).count()).toBe(sessionsBefore + 1);
    });

    it('search_products with no token creates no session row and returns no sessionToken', async () => {
        const before = await connection.getRepository(adminCtx, Session).count();
        const response = await postMcp(baseUrl(), 'shop', callTool('search_products', { query: 'test' }, 1));
        expect(response.body.result.isError).toBeUndefined();
        expect(response.body.result.structuredContent.sessionToken).toBeUndefined();
        expect(await connection.getRepository(adminCtx, Session).count()).toBe(before);
    });

    // A legacy-era batch gives no cart continuity: the SDK dispatches every batch member at once
    // (JSON-RPC 2.0 allows a server to process a batch in any order), so get_cart races
    // add_to_cart and may or may not see its cart. This pins the deterministic parts: both calls
    // answer, and add_to_cart's result carries the sessionToken that later separate POSTs thread.
    it('a legacy-era batch [add_to_cart, get_cart] answers both calls, with the token on the write', async () => {
        const batch = [callTool('add_to_cart', { variantId, quantity: 1 }, 1), callTool('get_cart', {}, 2)];
        const response = await postMcp(baseUrl(), 'shop', batch);
        const messages: any[] = Array.isArray(response.body) ? response.body : [response.body];
        const added = messages.find(message => message.id === 1).result;
        const cart = messages.find(message => message.id === 2).result;

        expect(added.isError).toBeUndefined();
        expect(added.structuredContent.order.totalQuantity).toBe(1);
        const sessionToken = added.structuredContent.sessionToken as string;
        expect(sessionToken).toBeTruthy();
        expect(cart.isError).toBeUndefined();

        // Continuity works from the NEXT request on, using the returned token.
        const followUp = await postMcp(baseUrl(), 'shop', callTool('get_cart', { sessionToken }, 3));
        expect(followUp.body.result.structuredContent.order.code).toBe(added.structuredContent.order.code);
    });

    it('creates an anonymous cart in the channel selected by vendure-token', async () => {
        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1 }, 1),
            { headers: { [CHANNEL_TOKEN_HEADER]: secondChannelToken } },
        );

        expect(added.body.result.isError).toBeUndefined();
        const order = await orderByCode(added.body.result.structuredContent.order.code);
        expect(order.channels.map(channel => String(channel.id))).toContain(String(secondChannelDbId));
    });

    it('runs an OAuth shop call in the non-default channel stored on the grant', async () => {
        const customerSession = await connection.getRepository(adminCtx, Session).findOneOrFail({
            where: { token: customerAuthToken },
        });
        expect(String(customerSession.activeChannelId)).toBe(String(secondChannelDbId));

        const flow = await shopFlow();
        const grant = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
            where: { accessTokenHash: lookupHash(flow.access_token) },
        });
        expect(String(grant.channelId)).toBe(String(secondChannelDbId));

        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1 }, 1),
            { token: flow.access_token },
        );
        expect(added.body.result.isError).toBeUndefined();
        const order = await orderByCode(added.body.result.structuredContent.order.code);
        expect(order.channels.map(channel => String(channel.id))).toContain(String(grant.channelId));
    });

    // An authenticated caller's cart is fixed by the grant. A sessionToken argument is refused
    // rather than ignored, so the agent learns it cannot switch carts; and no sessionToken is
    // ever appended to an authenticated caller's results.
    it('refuses sessionToken on an OAuth-authenticated call, and grant results carry no sessionToken', async () => {
        const flow = await shopFlow();

        const refused = await postMcp(
            baseUrl(),
            'shop',
            callTool('get_cart', { sessionToken: 'anything' }, 1),
            { token: flow.access_token },
        );
        expect(refused.body.result.isError).toBe(true);
        expect(refused.body.result.content[0].text).toMatch(/omit it/);

        const cart = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 2), {
            token: flow.access_token,
        });
        expect(cart.body.result.isError).toBeUndefined();
        expect(cart.body.result.structuredContent.sessionToken).toBeUndefined();
    });

    // The Shop API's "connected assistants" surface: list and revoke the signed-in customer's
    // own grants. Placed here, before the channel-deletion test below, because shopFlow() binds
    // its grant to the second channel and that test deletes it — once gone, shopFlow() itself
    // can no longer complete (the consent step needs a live channel to attribute the grant to).
    describe('activeMcpClientGrants / revokeMcpClientGrant', () => {
        const ACTIVE_GRANTS_QUERY = gql`
            query ActiveMcpClientGrants {
                activeMcpClientGrants {
                    id
                    createdAt
                    oauthClientName
                    lastActivityAt
                    expiresAt
                }
            }
        `;

        it("lists the signed-in customer's active grant with its client name, and no token material", async () => {
            const flow = await shopFlow();
            const grantEntity = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
                where: { accessTokenHash: lookupHash(flow.access_token) },
                relations: ['oauthClient'],
            });

            const result = await shopClient.query(ACTIVE_GRANTS_QUERY);

            // Ids are opaque (encoded by the configured entityIdStrategy), so correlate by the
            // client name this flow registered rather than by the raw database id.
            const item = result.activeMcpClientGrants.find(
                (g: { oauthClientName: string | null }) =>
                    g.oauthClientName === grantEntity.oauthClient.clientName,
            );
            expect(item).toBeTruthy();
            const raw = JSON.stringify(result);
            expect(raw).not.toContain(flow.access_token);
            expect(raw).not.toContain(flow.refresh_token);
        });

        // A raw, header-less fetch rather than `shopClient.asAnonymousUser()`: that call issues a
        // real `logout` mutation, which would destroy the session behind `customerAuthToken` —
        // the same shared client is currently authenticated as the seeded customer, and later
        // tests in this file (including the channel-deletion test right below) still need that
        // token to run `shopFlow()` again.
        it('refuses activeMcpClientGrants for an anonymous caller instead of returning an empty list', async () => {
            const response = await fetch(`${baseUrl()}/shop-api`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ query: 'query { activeMcpClientGrants { id } }' }),
            });
            const body = (await response.json()) as {
                data?: { activeMcpClientGrants?: unknown };
                errors?: Array<{ message: string }>;
            };
            expect(body.data?.activeMcpClientGrants).toBeUndefined();
            expect(body.errors?.[0]?.message).toMatch(/signed-in customer/);
        });

        it('lets the customer revoke their own grant, ending /mcp/shop access and dropping it from the list', async () => {
            const flow = await shopFlow();
            const grantEntity = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
                where: { accessTokenHash: lookupHash(flow.access_token) },
                relations: ['oauthClient'],
            });

            const before = await shopClient.query(ACTIVE_GRANTS_QUERY);
            const target = before.activeMcpClientGrants.find(
                (g: { oauthClientName: string | null }) =>
                    g.oauthClientName === grantEntity.oauthClient.clientName,
            );
            if (!target) {
                throw new Error('Expected the freshly-created grant to appear in activeMcpClientGrants');
            }

            const { revokeMcpClientGrant } = await shopClient.query(
                gql`
                    mutation RevokeOwnMcpClientGrant($id: ID!) {
                        revokeMcpClientGrant(id: $id)
                    }
                `,
                { id: target.id },
            );
            expect(revokeMcpClientGrant).toBe(true);

            const grantAfter = await connection
                .getRepository(adminCtx, McpOauthGrant)
                .findOneByOrFail({ id: grantEntity.id });
            expect(grantAfter.revokedAt).toBeTruthy();

            const denied = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 1), {
                token: flow.access_token,
            });
            expect(denied.status).toBe(401);

            const after = await shopClient.query(ACTIVE_GRANTS_QUERY);
            expect(after.activeMcpClientGrants.some((g: { id: string }) => g.id === target.id)).toBe(false);
        });

        it("refuses to revoke a grant that is not the signed-in customer's own", async () => {
            const adminFlow = await runAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                superAdminToken: adminClient.getAuthToken(),
            });
            const adminGrantEntity = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
                where: { accessTokenHash: lookupHash(adminFlow.access_token) },
            });

            // The admin API's own grants query gives us a correctly-encoded id for the admin
            // grant, without needing to touch the raw database id ourselves.
            const adminGrantsList = await adminClient.query(gql`
                query {
                    mcpOauthGrants {
                        items {
                            id
                            actorType
                        }
                    }
                }
            `);
            const adminItem = adminGrantsList.mcpOauthGrants.items.find(
                (g: { actorType: string | null }) => g.actorType === 'admin',
            );
            if (!adminItem) {
                throw new Error('Expected the freshly-created admin grant to appear in mcpOauthGrants');
            }

            await expect(
                shopClient.query(
                    gql`
                        mutation RevokeForeignMcpClientGrant($id: ID!) {
                            revokeMcpClientGrant(id: $id)
                        }
                    `,
                    { id: adminItem.id },
                ),
            ).rejects.toThrow(/could be found/i);

            const stillThere = await connection
                .getRepository(adminCtx, McpOauthGrant)
                .findOneByOrFail({ id: adminGrantEntity.id });
            expect(stillThere.revokedAt).toBeFalsy();
        });
    });

    // Channel deletion is a hard row delete (no soft-delete), so a grant scoped to a deleted
    // channel can never be honoured again. The next call must refuse it and revoke the grant,
    // not silently widen access to the default channel.
    it('ends MCP access and revokes the grant when its channel is deleted', async () => {
        const flow = await shopFlow();
        const grant = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
            where: { accessTokenHash: lookupHash(flow.access_token) },
        });
        expect(String(grant.channelId)).toBe(String(secondChannelDbId));

        const deleteResult = await adminClient.query(
            gql`
                mutation DeleteShopToolChannel($id: ID!) {
                    deleteChannel(id: $id) {
                        result
                    }
                }
            `,
            { id: secondChannelId },
        );
        expect(deleteResult.deleteChannel.result).toBe('DELETED');

        const denied = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 1), {
            token: flow.access_token,
        });
        expect(denied.status).toBe(401);

        const grantAfter = await connection
            .getRepository(adminCtx, McpOauthGrant)
            .findOneByOrFail({ id: grant.id });
        expect(grantAfter.revokedAt).toBeTruthy();

        // The revocation must stick: a retry with the same token still gets refused.
        const retry = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 2), {
            token: flow.access_token,
        });
        expect(retry.status).toBe(401);
    });

    // Mirrors the admin-side "deleted administrator" case (oauth-flow.e2e-spec.ts): deleting the
    // customer behind a shop grant must end that grant's access too, not just the customer's own
    // ordinary shop-API session. A dedicated customer (not the shared seeded one every other test
    // in this file authenticates as) is registered and verified directly, so deleting it can't
    // affect anything else in the suite. Runs under the default channel, so `adminCtx` (also
    // default-channel) can operate on the resulting Customer/grant rows directly.
    it('ends shop MCP access and revokes the grant when the granting customer is deleted', async () => {
        const oauth = server.app.get(McpOauthService);
        const customerService = server.app.get(CustomerService);
        const uniqueSuffix = Math.random().toString(36).slice(2);
        const doomedEmail = `doomed-customer-${uniqueSuffix}@test.com`;
        const doomedPassword = 'test';

        const registerResponse = await fetch(`${baseUrl()}/shop-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: `mutation ($input: RegisterCustomerInput!) {
                    registerCustomerAccount(input: $input) {
                        ... on Success { success }
                        ... on ErrorResult { errorCode message }
                    }
                }`,
                variables: {
                    input: { emailAddress: doomedEmail, firstName: 'Doomed', lastName: 'Customer' },
                },
            }),
        });
        const registerBody = (await registerResponse.json()) as {
            data?: { registerCustomerAccount?: { success?: boolean; message?: string } };
            errors?: Array<{ message: string }>;
        };
        if (!registerBody.data?.registerCustomerAccount?.success) {
            throw new Error(`Failed to register doomed customer: ${JSON.stringify(registerBody)}`);
        }

        // No email plugin is wired up in this suite, so read the verification token straight off
        // the row it creates, rather than intercepting an outgoing email.
        const doomedUser = await connection.getRepository(adminCtx, User).findOneOrFail({
            where: { identifier: doomedEmail },
            relations: ['authenticationMethods'],
        });
        const verificationToken = doomedUser.getNativeAuthenticationMethod().verificationToken;
        if (!verificationToken) {
            throw new Error('Expected a verification token on the newly-registered user');
        }

        const verifyResponse = await fetch(`${baseUrl()}/shop-api`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                query: `mutation ($token: String!, $password: String!) {
                    verifyCustomerAccount(token: $token, password: $password) {
                        ... on CurrentUser { identifier }
                        ... on ErrorResult { errorCode message }
                    }
                }`,
                variables: { token: verificationToken, password: doomedPassword },
            }),
        });
        const doomedAuthToken = verifyResponse.headers.get(AUTH_TOKEN_HEADER);
        if (!doomedAuthToken) {
            throw new Error(
                `Verifying the doomed customer did not yield a session token: ${await verifyResponse.text()}`,
            );
        }

        const flow = await runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: doomedAuthToken,
        });

        // Calling authenticateBearerToken directly, as the admin-deletion test does, keeps the
        // assertion on the precise 'Vendure user no longer exists' branch rather than on whatever
        // generic message the HTTP transport happens to surface for it.
        const authenticated = await oauth.authenticateBearerToken(flow.access_token, 'shop');
        expect(authenticated.grant.actorId).toBe(doomedUser.id);

        const doomedCustomer = await connection
            .getRepository(adminCtx, Customer)
            .findOneOrFail({ where: { emailAddress: doomedEmail } });
        await customerService.softDelete(adminCtx, doomedCustomer.id);

        await expect(oauth.authenticateBearerToken(flow.access_token, 'shop')).rejects.toThrow(
            'Vendure user no longer exists',
        );

        const grantAfter = await connection
            .getRepository(adminCtx, McpOauthGrant)
            .findOneByOrFail({ id: authenticated.grant.id });
        expect(grantAfter.revokedAt).toBeTruthy();
    });

    // Pins today's answer to an unknown channel token, and is now the suite's only test of it: a
    // looser duplicate in mcp-transport.e2e-spec.ts accepted any status at or above 400.
    //
    // OPEN QUESTION: refusing the request is right, but this is an HTTP 500 whose body is Vendure's
    // REST error rather than a JSON-RPC error envelope, and whose message is the untranslated key
    // 'CHANNEL_NOT_FOUND: error.channel-not-found'. An MCP client therefore receives a raw internal
    // error for what is a bad request. The status and the body shape are an open decision; this test
    // records what happens today so a change to either cannot pass unnoticed.
    it('rejects an invalid vendure-token instead of falling back to the default channel', async () => {
        const response = await postMcp(baseUrl(), 'shop', callTool('get_product', { id: productId }), {
            headers: { [CHANNEL_TOKEN_HEADER]: 'not-a-real-channel-token' },
        });

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
            statusCode: 500,
            message: 'CHANNEL_NOT_FOUND: error.channel-not-found',
            path: '/mcp/shop',
        });
    });

    it('lets an anonymous caller get an order only while orderByCodeAccessStrategy allows it', async () => {
        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1 }, 1),
        );
        const code = added.body.result.structuredContent.order.code;

        orderByCodeAccessStrategy.allow = true;
        const allowed = await postMcp(baseUrl(), 'shop', callTool('get_order', { code }, 2));
        expect(allowed.body.result.structuredContent.order).toMatchObject({ code });

        orderByCodeAccessStrategy.allow = false;
        try {
            const denied = await postMcp(baseUrl(), 'shop', callTool('get_order', { code }, 3));
            expect(denied.body.result.structuredContent).toEqual({ order: null });
        } finally {
            orderByCodeAccessStrategy.allow = true;
        }
    });

    it('resolves products and collections by ID or slug while enforcing visibility guards', async () => {
        for (const arguments_ of [{ id: productId }, { slug: productSlug }]) {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_product', arguments_));
            expect(response.body.result.structuredContent.product).toMatchObject({
                id: productId,
                slug: productSlug,
                enabled: true,
            });
        }
        for (const arguments_ of [{ id: publicCollectionId }, { slug: publicCollectionSlug }]) {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_collection', arguments_));
            expect(response.body.result.structuredContent.collection).toMatchObject({
                id: publicCollectionId,
                slug: publicCollectionSlug,
            });
        }
        for (const arguments_ of [{ id: privateCollectionId }, { slug: privateCollectionSlug }]) {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_collection', arguments_));
            expect(response.body.result.structuredContent).toEqual({ collection: null });
        }

        await adminClient.query(
            gql`
                mutation SetShopToolProductEnabled($input: UpdateProductInput!) {
                    updateProduct(input: $input) {
                        id
                    }
                }
            `,
            { input: { id: productAdminId, enabled: false } },
        );
        try {
            for (const arguments_ of [{ id: productId }, { slug: productSlug }]) {
                const response = await postMcp(baseUrl(), 'shop', callTool('get_product', arguments_));
                expect(response.body.result.structuredContent).toEqual({ product: null });
            }
        } finally {
            await adminClient.query(
                gql`
                    mutation RestoreShopToolProduct($input: UpdateProductInput!) {
                        updateProduct(input: $input) {
                            id
                        }
                    }
                `,
                { input: { id: productAdminId, enabled: true } },
            );
        }
    });

    it('matches search_products word by word, and retries with plurals trimmed', async () => {
        const search = async (query: string) => {
            const response = await postMcp(baseUrl(), 'shop', callTool('search_products', { query }));
            const result = response.body.result.structuredContent as {
                items: Array<{ name: string }>;
                total: number;
            };
            return { names: result.items.map(item => item.name).sort(), total: result.total };
        };

        // The seeded catalog holds exactly "Test Product" and "Test Shirt".
        expect(await search('test')).toEqual({ names: ['Test Product', 'Test Shirt'], total: 2 });
        expect(await search('shirt test')).toEqual({ names: ['Test Shirt'], total: 1 });
        // "shirts" appears in no product name, so this only passes if the second attempt with the
        // plural ending trimmed off ran. This is also what proves the nested name/slug conditions
        // survive the translated-column join that Product.name goes through.
        expect(await search('shirts')).toEqual({ names: ['Test Shirt'], total: 1 });
        expect(await search('shirt product')).toEqual({ names: [], total: 0 });
    });

    it('returns the product variants a shopper needs to add anything to a cart', async () => {
        const response = await postMcp(baseUrl(), 'shop', callTool('get_product', { slug: productSlug }, 1));

        const product = response.body.result.structuredContent.product;
        expect(product.variants.length).toBeGreaterThan(0);
        const variant = product.variants[0];
        // The id here must be the variant's own id, which is what add_to_cart needs. Asserting it
        // against the fixture's known variant id is what proves the tool is not handing back the
        // product id under a different name.
        expect(String(variant.id)).toBe(String(variantId));
        expect(variant).toMatchObject({
            name: expect.any(String),
            sku: expect.any(String),
            currencyCode: expect.any(String),
        });
        // A currency code and a price only appear if the per-channel price lookup ran, so these
        // also prove the variants were fetched through the service that applies prices.
        expect(typeof variant.priceWithTax).toBe('number');
        expect(variant.priceWithTaxDecimal).toMatch(/^\d+\.\d{2}$/);
    });

    it('returns shipping quotes with a decimal price and the cart currency', async () => {
        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1 }, 1),
        );
        const sessionToken = added.body.result.structuredContent.sessionToken as string;

        const quotes = await postMcp(baseUrl(), 'shop', callTool('get_eligible_shipping_methods', {}, 2), {
            headers: { [AUTH_TOKEN_HEADER]: sessionToken },
        });

        const standard = quotes.body.result.structuredContent.methods.find(
            (method: any) => method.name === 'Standard Shipping',
        );
        // The fixture prices this method at 500 minor units. Without the decimal string a model
        // reads that as 500 whole units of currency and quotes the shopper £500 instead of £5.00.
        expect(standard).toMatchObject({ price: 500, priceDecimal: '5.00' });
        expect(standard.currencyCode).toEqual(expect.any(String));
        expect(standard.priceWithTaxDecimal).toMatch(/^\d+\.\d{2}$/);
    });

    it('adds the only variant when given a product ID for a single-variant product', async () => {
        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { productId, quantity: 1 }, 1),
        );

        expect(added.body.result.isError).toBeUndefined();
        expect(added.body.result.structuredContent.order.totalQuantity).toBe(1);
        expect(String(added.body.result.structuredContent.order.lines[0].productVariant.id)).toBe(
            String(variantId),
        );
    });

    it('adds nothing and lists the variants when given a product ID for a multi-variant product', async () => {
        const ordersBefore = await connection.getRepository(adminCtx, Order).count();

        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { productId: shirtId, quantity: 1 }, 1),
        );

        expect(shirtVariantCount).toBeGreaterThan(1);
        expect(added.body.result.isError).toBe(true);
        // The refusal must name every variant, so a model can pick one without a further call.
        const text = JSON.stringify(added.body.result);
        expect(text).toContain('SHIRT-S');
        expect(text).toContain('SHIRT-M');
        expect(text).toContain('SHIRT-L');
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersBefore);
    });

    it('refuses when given both a variant ID and a product ID', async () => {
        const ordersBefore = await connection.getRepository(adminCtx, Order).count();

        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, productId, quantity: 1 }, 1),
        );

        expect(added.body.result.isError).toBe(true);
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersBefore);
    });

    it('refuses when given neither a variant ID nor a product ID', async () => {
        const ordersBefore = await connection.getRepository(adminCtx, Order).count();

        const added = await postMcp(baseUrl(), 'shop', callTool('add_to_cart', { quantity: 1 }, 1));

        expect(added.body.result.isError).toBe(true);
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersBefore);
    });

    it('refuses an anonymous caller with no cart for the missing cart, not for the missing login', async () => {
        const ordersBefore = await connection.getRepository(adminCtx, Order).count();

        const placed = await postMcp(
            baseUrl(),
            'shop',
            callTool('place_order', { paymentMethodCode: 'not-configured', confirm: true }, 1),
        );

        // The same refusal the other cart tools give this caller. Asking for a login first would send
        // a shopper with nothing to pay for through the OAuth flow, only to be refused afterwards.
        expect(placed.body.result.isError).toBe(true);
        expect(placed.body.result.content[0].text).toMatch(/There is no active cart/);
        expect(placed.body.result.structuredContent.requiresAuthorization).toBeUndefined();
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersBefore);
    });

    // A stock MCP SDK client threads no headers, so the sessionToken payload field is the only
    // thing keeping these calls on one cart. place_order is destructive AND anonymous-callable,
    // so `confirm` and `sessionToken` must compose in a single call.
    it('uses the SDK for cart then gates place_order before executing confirm:true with the same sessionToken', async () => {
        const client = new Client({ name: 'shop-tools-sdk-e2e', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp/shop`));
        await client.connect(transport);
        try {
            const added = await client.callTool({
                name: 'add_to_cart',
                arguments: { variantId, quantity: 1 },
            });
            expect(added.isError).toBeUndefined();
            expect((added.structuredContent as any).order.totalQuantity).toBe(1);
            const sessionToken = (added.structuredContent as any).sessionToken as string;
            expect(sessionToken).toBeTruthy();

            const preview = await client.callTool({
                name: 'place_order',
                arguments: { paymentMethodCode: 'not-configured', sessionToken },
            });
            expect(preview.isError).toBeUndefined();
            expect(preview.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });

            const confirmed = await client.callTool({
                name: 'place_order',
                arguments: { paymentMethodCode: 'not-configured', confirm: true, sessionToken },
            });
            expect(confirmed.isError).toBeUndefined();
            expect(confirmed.structuredContent).toEqual({
                requiresAuthorization: true,
                message:
                    'Placing an order requires an authorized customer. Complete the OAuth flow ' +
                    'for this store and retry with the resulting access token.',
                sessionToken,
            });

            const session = await anonymousSession(sessionToken);
            expect(session.activeOrderId).toBeTruthy();
            expect(String(session.activeOrderId)).toBe(
                String((await orderByCode((added.structuredContent as any).order.code)).id),
            );
        } finally {
            await client.close();
        }
    });

    // The in-process path: a merchant's own plugin listing and running the same tools through
    // McpToolExecutionService, with the shopper's RequestContext as identity.
    describe('in-process execution via McpToolExecutionService', () => {
        /** A Shop API context for the seeded customer, as a shop resolver would receive. */
        async function customerShopContext(): Promise<RequestContext> {
            const customer = await connection.getRepository(adminCtx, Customer).findOneOrFail({
                where: { emailAddress: customerEmail },
                relations: ['user'],
            });
            return server.app.get(RequestContextService).create({ apiType: 'shop', user: customer.user });
        }

        it('executes a tool as the signed-in customer and attributes the log to them', async () => {
            const executionService = server.app.get(McpToolExecutionService);
            const ctx = await customerShopContext();

            const result = await executionService.executeTool(ctx, 'shop', 'search_products', {
                query: 'laptop',
            });

            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toBeDefined();

            // Other tests in this file call search_products too, so take the newest log row,
            // which is the call this test just made.
            const log = await connection.getRepository(adminCtx, McpToolCallLog).findOneOrFail({
                where: { toolName: 'search_products' },
                order: { id: 'DESC' },
            });
            // No grant exists on this path, so the attribution has to come off the context.
            expect(log.grantId).toBeNull();
            expect(log.actor).toBe(String(ctx.activeUserId));
            expect(log.actorType).toBe('customer');
        });

        it('returns an isError result for arguments that do not match the schema', async () => {
            const executionService = server.app.get(McpToolExecutionService);
            const ctx = await customerShopContext();

            const result = await executionService.executeTool(ctx, 'shop', 'search_products', {
                query: 123,
            });

            expect(result.isError).toBe(true);
            expect((result.content as Array<{ text: string }>)[0].text).toContain('query');
        });

        it('throws when the context apiType does not match the toolset', async () => {
            const executionService = server.app.get(McpToolExecutionService);

            await expect(
                executionService.executeTool(adminCtx, 'shop', 'search_products', {}),
            ).rejects.toThrow(
                'The "shop" MCP toolset requires a shop API RequestContext, but the supplied ' +
                    'context is for the "admin" API.',
            );
        });

        // The discovery meta-tools are deliberately unreachable here: an in-process caller names
        // the tool it wants, so the search/execute indirection buys it nothing.
        it('returns an isError result for an unknown tool, including the discovery meta-tools', async () => {
            const executionService = server.app.get(McpToolExecutionService);
            const ctx = await customerShopContext();

            for (const name of ['no_such_tool', 'execute_tool']) {
                const result = await executionService.executeTool(ctx, 'shop', name, {});
                expect(result.isError).toBe(true);
                expect((result.content as Array<{ text: string }>)[0].text).toBe(`Unknown MCP tool: ${name}`);
            }
        });

        it('lists callable tools with their input schemas, and drops a disabled one', async () => {
            const executionService = server.app.get(McpToolExecutionService);
            const registry = server.app.get(McpToolRegistryService);
            const ctx = await customerShopContext();

            const tools = await executionService.listTools(ctx, 'shop');
            expect(tools.map(tool => tool.name).sort()).toEqual(shopToolNames);
            const searchProducts = tools.find(tool => tool.name === 'search_products');
            expect(searchProducts?.behavior).toBe('readonly');
            expect(searchProducts?.inputSchema.properties?.query).toEqual({
                type: 'string',
                description: 'Text to look up in product names and slugs.',
            });

            await registry.setToolEnabled(adminCtx, 'shop', 'get_cart', false);
            try {
                const afterDisabling = await executionService.listTools(ctx, 'shop');
                expect(afterDisabling.map(tool => tool.name)).not.toContain('get_cart');
            } finally {
                await registry.setToolEnabled(adminCtx, 'shop', 'get_cart', true);
            }
        });

        it('gates a destructive tool behind confirm', async () => {
            const executionService = server.app.get(McpToolExecutionService);
            const ctx = await customerShopContext();

            const result = await executionService.executeTool(ctx, 'shop', 'place_order', {
                paymentMethodCode: 'not-configured',
            });

            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });
        });
    });

    // A signed-in customer paying for their cart, over the same HTTP transport a real client uses.
    // `place_order` is the only tool that takes a payment, and a payment can only be taken inside a
    // database transaction, which nothing outside the tool opens for it. Every other checkout tool
    // works without one, so nothing short of a test that actually pays shows that gap.
    describe('checkout', () => {
        let checkoutAuthToken: string;
        let pendingPaymentAuthToken: string;

        beforeAll(async () => {
            // A handler registered in the config is not usable on its own: an enabled PaymentMethod
            // record has to point at it before an order can be paid with it.
            const createPaymentMethod = async (code: string, handlerCode: string, name: string) => {
                const created = await adminClient.query(
                    gql`
                        mutation CreateShopToolPaymentMethod($input: CreatePaymentMethodInput!) {
                            createPaymentMethod(input: $input) {
                                id
                                code
                            }
                        }
                    `,
                    {
                        input: {
                            code,
                            enabled: true,
                            handler: { code: handlerCode, arguments: [] },
                            translations: [{ languageCode: LanguageCode.en, name, description: '' }],
                        },
                    },
                );
                expect(created.createPaymentMethod.code).toBe(code);
            };
            await createPaymentMethod(PAYMENT_METHOD_CODE, testPaymentHandler.code, 'E2E payment');
            await createPaymentMethod(
                PENDING_PAYMENT_METHOD_CODE,
                pendingPaymentHandler.code,
                'E2E pending payment',
            );

            // The pending-payment test needs a customer of its own, and the fixture seeds only one,
            // so this makes a second. Passing a password here also marks the new user as verified,
            // which it has to be before it can log in.
            const createdCustomer = await adminClient.query(
                gql`
                    mutation CreateShopToolPendingPaymentCustomer(
                        $input: CreateCustomerInput!
                        $password: String!
                    ) {
                        createCustomer(input: $input, password: $password) {
                            __typename
                            ... on Customer {
                                emailAddress
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        emailAddress: PENDING_PAYMENT_CUSTOMER_EMAIL,
                        firstName: 'Pending',
                        lastName: 'Payment',
                    },
                    password: PENDING_PAYMENT_CUSTOMER_PASSWORD,
                },
            );
            expect(createdCustomer.createCustomer.emailAddress).toBe(PENDING_PAYMENT_CUSTOMER_EMAIL);

            // These customers need a session on the default channel. The shared `shopClient`
            // session is pinned to the second channel, which has no shipping methods to check out
            // with.
            const loginOnDefaultChannel = async (emailAddress: string, password: string) => {
                const client = new SimpleGraphQLClient(
                    config,
                    `http://localhost:${config.apiOptions.port}/${config.apiOptions.shopApiPath as string}`,
                );
                const login = await client.asUserWithCredentials(emailAddress, password);
                if (!login || login.errorCode) {
                    throw new Error(`Checkout customer login failed: ${JSON.stringify(login)}`);
                }
                return client.getAuthToken();
            };
            checkoutAuthToken = await loginOnDefaultChannel(customerEmail, 'test');
            pendingPaymentAuthToken = await loginOnDefaultChannel(
                PENDING_PAYMENT_CUSTOMER_EMAIL,
                PENDING_PAYMENT_CUSTOMER_PASSWORD,
            );
        }, TEST_SETUP_TIMEOUT_MS);

        it('walks a cart through checkout and places the order', async () => {
            const flow = await runShopAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                vendureAuthToken: checkoutAuthToken,
            });
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), { token: flow.access_token });

            const added = await call('add_to_cart', { variantId, quantity: 1 }, 1);
            expect(added.body.result.isError).toBeUndefined();

            const address = await call(
                'set_shipping_address',
                {
                    address: {
                        streetLine1: '451 Sansome Street',
                        city: 'San Francisco',
                        postalCode: '94111',
                        countryCode: 'US',
                    },
                },
                2,
            );
            expect(address.body.result.isError).toBeUndefined();

            const quotes = await call('get_eligible_shipping_methods', {}, 3);
            const methodId = quotes.body.result.structuredContent.methods[0]?.id;
            expect(methodId).toBeDefined();

            const chosen = await call('set_shipping_method', { methodId }, 4);
            expect(chosen.body.result.isError).toBeUndefined();

            const placed = await call(
                'place_order',
                { paymentMethodCode: PAYMENT_METHOD_CODE, confirm: true },
                5,
            );

            expect(placed.body.result.isError).toBeUndefined();
            expect(placed.body.result.structuredContent.status).toBe('placed');
            const placedOrder = placed.body.result.structuredContent.order;
            expect(placedOrder.state).toBe('PaymentSettled');
            expect(placedOrder.payments).toHaveLength(1);
            expect(placedOrder.payments[0]).toMatchObject({
                state: 'Settled',
                method: PAYMENT_METHOD_CODE,
            });

            const stored = await orderByCode(placedOrder.code);
            expect(stored.state).toBe('PaymentSettled');
            expect(stored.orderPlacedAt).toBeTruthy();

            // The session still points at the order that was just placed. Core's active-order
            // strategy sees that order is no longer active and clears the pointer, so these calls
            // arrive with no cart, and each one must refuse rather than start an empty cart that
            // would look to the shopper like the order they just paid for. Clearing the session's
            // stale activeOrderId is fine; what must not happen is that a call creates an Order.
            const ordersAfterCheckout = await connection.getRepository(adminCtx, Order).count();

            const orphanCoupon = await call('apply_coupon_code', { code: 'ANY-CODE' }, 6);
            expect(orphanCoupon.body.result.isError).toBe(true);
            expect(orphanCoupon.body.result.content[0].text).toMatch(/There is no active cart/);

            const orphanAddress = await call(
                'set_shipping_address',
                {
                    address: {
                        streetLine1: '451 Sansome Street',
                        city: 'San Francisco',
                        postalCode: '94111',
                        countryCode: 'US',
                    },
                },
                7,
            );
            expect(orphanAddress.body.result.isError).toBe(true);
            expect(orphanAddress.body.result.content[0].text).toMatch(/There is no active cart/);

            const orphanPlace = await call(
                'place_order',
                { paymentMethodCode: PAYMENT_METHOD_CODE, confirm: true },
                8,
            );
            expect(orphanPlace.body.result.isError).toBe(true);
            expect(orphanPlace.body.result.content[0].text).toMatch(/There is no active cart/);

            expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersAfterCheckout);
        });

        // This test uses the customer created for it on purpose. It leaves an order sitting in
        // `ArrangingPayment`, and `OrderService.findByCustomerId` only leaves out `Draft` orders, so
        // an unplaced order on the shared customer would show up in the `list_my_orders` test below
        // and break its expectation that the first listed order has an `orderPlacedAt`.
        it('answers awaiting_payment when the payment leaves the order unplaced', async () => {
            const flow = await runShopAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                vendureAuthToken: pendingPaymentAuthToken,
            });
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), { token: flow.access_token });

            const added = await call('add_to_cart', { variantId, quantity: 1 }, 1);
            expect(added.body.result.isError).toBeUndefined();

            const address = await call(
                'set_shipping_address',
                {
                    address: {
                        streetLine1: '451 Sansome Street',
                        city: 'San Francisco',
                        postalCode: '94111',
                        countryCode: 'US',
                    },
                },
                2,
            );
            expect(address.body.result.isError).toBeUndefined();

            const quotes = await call('get_eligible_shipping_methods', {}, 3);
            const methodId = quotes.body.result.structuredContent.methods[0]?.id;
            expect(methodId).toBeDefined();

            const chosen = await call('set_shipping_method', { methodId }, 4);
            expect(chosen.body.result.isError).toBeUndefined();

            const placed = await call(
                'place_order',
                { paymentMethodCode: PENDING_PAYMENT_METHOD_CODE, confirm: true },
                5,
            );

            expect(placed.body.result.isError).toBeUndefined();
            const answer = placed.body.result.structuredContent;
            expect(answer.status).toBe('awaiting_payment');
            expect(answer.message).toContain('not placed yet');
            expect(answer.message).toContain('ArrangingPayment');
            expect(answer.order.state).toBe('ArrangingPayment');
            expect(answer.order.orderPlacedAt).toBeNull();
            expect(answer.order.payments).toHaveLength(1);
            expect(answer.order.payments[0]).toMatchObject({
                state: 'Settled',
                amount: 1,
                method: PENDING_PAYMENT_METHOD_CODE,
                transactionId: 'e2e-pending-1',
                publicMetadata: { redirectUrl: 'https://pay.example.com/e2e-pending-1' },
            });
            // Whatever the handler kept outside the `public` key stays with the provider.
            expect(JSON.stringify(placed.body)).not.toContain('provider-only');

            const cart = await call('get_cart', {}, 6);
            expect(cart.body.result.isError).toBeUndefined();
            const cartOrder = cart.body.result.structuredContent.order;
            expect(cartOrder.state).toBe('ArrangingPayment');
            expect(cartOrder.payments).toHaveLength(1);
            expect(cartOrder.payments[0]).toMatchObject({
                state: 'Settled',
                publicMetadata: { redirectUrl: 'https://pay.example.com/e2e-pending-1' },
            });

            const stored = await orderByCode(answer.order.code);
            expect(stored.state).toBe('ArrangingPayment');
            expect(stored.orderPlacedAt).toBeFalsy();
        });
    });

    // The cart tools are Permission.Public, so they run on a plain anonymous session threaded
    // through the `vendure-auth-token` header. That gives each test its own cart, with no OAuth
    // flow and no shared state. The two customer reads need Permission.Authenticated, so they use
    // a real grant.
    describe('cart editing, coupons and customer reads', () => {
        const COUPON_CODE = 'MCP-E2E-10';
        const COUPON_PERCENTAGE = 10;
        let readsAccessToken: string;
        let customerOrderCodes: string[];

        beforeAll(async () => {
            const promotion = await adminClient.query(
                gql`
                    mutation CreateCouponPromotion($input: CreatePromotionInput!) {
                        createPromotion(input: $input) {
                            __typename
                            ... on Promotion {
                                couponCode
                            }
                            ... on ErrorResult {
                                errorCode
                                message
                            }
                        }
                    }
                `,
                {
                    input: {
                        enabled: true,
                        couponCode: COUPON_CODE,
                        // No conditions: entering the coupon is the only thing that applies it,
                        // which is what the two coupon tools are being tested on.
                        conditions: [],
                        actions: [
                            {
                                code: 'order_percentage_discount',
                                arguments: [{ name: 'discount', value: String(COUPON_PERCENTAGE) }],
                            },
                        ],
                        translations: [
                            { languageCode: LanguageCode.en, name: 'MCP e2e coupon', description: '' },
                        ],
                    },
                },
            );
            expect(promotion.createPromotion.couponCode).toBe(COUPON_CODE);

            // A session on the default channel. The shared `shopClient` session is pinned to the
            // second channel, which the channel-deletion test above has already removed.
            const readsClient = new SimpleGraphQLClient(
                config,
                `http://localhost:${config.apiOptions.port}/${config.apiOptions.shopApiPath as string}`,
            );
            const login = await readsClient.asUserWithCredentials(customerEmail, 'test');
            if (!login || login.errorCode) {
                throw new Error(`Customer login failed: ${JSON.stringify(login)}`);
            }
            const flow = await runShopAuthorizationCodeFlow({
                baseUrl: baseUrl(),
                issuer: ISSUER,
                vendureAuthToken: readsClient.getAuthToken(),
            });
            readsAccessToken = flow.access_token;

            // What this customer's orders are, read from the admin side. Taking the expected set
            // from here rather than from the checkout test above means this does not depend on
            // which order that test placed, only that it placed one.
            const orders = await adminClient.query(
                gql`
                    query CustomerOrdersForMcpReads($emailAddress: String!) {
                        customers(options: { filter: { emailAddress: { eq: $emailAddress } } }) {
                            items {
                                orders(options: { take: 100 }) {
                                    items {
                                        code
                                    }
                                }
                            }
                        }
                    }
                `,
                { emailAddress: customerEmail },
            );
            customerOrderCodes = (orders.customers.items[0]?.orders.items as Array<{ code: string }>).map(
                order => order.code,
            );
        }, TEST_SETUP_TIMEOUT_MS);

        it('update_cart_line changes the quantity of an existing line', async () => {
            const { sessionToken, lineId } = await anonymousCart(1);

            const updated = await postMcp(
                baseUrl(),
                'shop',
                callTool('update_cart_line', { orderLineId: lineId, quantity: 4 }, 2),
                { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
            );

            expect(updated.body.result.isError).toBeUndefined();
            const order = updated.body.result.structuredContent.order;
            expect(order.totalQuantity).toBe(4);
            expect(order.lines).toHaveLength(1);
            expect(order.lines[0].quantity).toBe(4);

            // A second request, which re-reads the cart from the database, sees the same quantity —
            // so the change was written, not just reflected back from the request that made it.
            const reread = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 3), {
                headers: { [AUTH_TOKEN_HEADER]: sessionToken },
            });
            expect(reread.body.result.structuredContent.order.lines[0].quantity).toBe(4);
        });

        it('remove_from_cart deletes the line and empties the cart', async () => {
            const { sessionToken, lineId } = await anonymousCart(2);

            const removed = await postMcp(
                baseUrl(),
                'shop',
                callTool('remove_from_cart', { orderLineId: lineId }, 2),
                { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
            );

            expect(removed.body.result.isError).toBeUndefined();
            const order = removed.body.result.structuredContent.order;
            expect(order.lines).toEqual([]);
            expect(order.totalQuantity).toBe(0);

            const reread = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 3), {
                headers: { [AUTH_TOKEN_HEADER]: sessionToken },
            });
            expect(reread.body.result.structuredContent.order.lines).toEqual([]);
        });

        it('set_billing_address writes the billing address, leaving the shipping address alone', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const shipping = await call(
                'set_shipping_address',
                {
                    address: {
                        streetLine1: '1 Shipping Way',
                        city: 'Portland',
                        postalCode: '97201',
                        countryCode: 'US',
                    },
                },
                2,
            );
            expect(shipping.body.result.isError).toBeUndefined();

            const billing = await call(
                'set_billing_address',
                {
                    address: {
                        fullName: 'Billing Person',
                        streetLine1: '2 Billing Road',
                        city: 'Seattle',
                        postalCode: '98101',
                        countryCode: 'US',
                    },
                },
                3,
            );

            expect(billing.body.result.isError).toBeUndefined();
            // setBillingAddress returns a plain Order rather than an error union, so the tool wraps
            // it as `{ order }` with no `result` branch — different from the cart tools above.
            expect(billing.body.result.structuredContent.result).toBeUndefined();
            const order = await orderByCode(billing.body.result.structuredContent.order.code);
            expect(order.billingAddress).toMatchObject({
                fullName: 'Billing Person',
                streetLine1: '2 Billing Road',
                city: 'Seattle',
                postalCode: '98101',
                countryCode: 'US',
            });
            expect(order.shippingAddress.streetLine1).toBe('1 Shipping Way');
        });

        it('apply_coupon_code discounts the cart and remove_coupon_code puts the price back', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const before = await call('get_cart', {}, 2);
            const fullTotal = before.body.result.structuredContent.order.totalWithTax as number;
            expect(fullTotal).toBeGreaterThan(0);

            const applied = await call('apply_coupon_code', { code: COUPON_CODE }, 3);
            expect(applied.body.result.isError).toBeUndefined();
            // The discount has to reach the price, not merely be recorded: a coupon the pricing
            // engine ignored would leave the total untouched.
            const discountedTotal = applied.body.result.structuredContent.order.totalWithTax as number;
            expect(discountedTotal).toBeLessThan(fullTotal);

            const removed = await call('remove_coupon_code', { code: COUPON_CODE }, 4);
            expect(removed.body.result.isError).toBeUndefined();
            expect(removed.body.result.structuredContent.order.totalWithTax).toBe(fullTotal);
        });

        it('apply_coupon_code hands back Vendure error result for a code that does not exist', async () => {
            const { sessionToken } = await anonymousCart();

            const applied = await postMcp(
                baseUrl(),
                'shop',
                callTool('apply_coupon_code', { code: 'NO-SUCH-COUPON' }, 2),
                { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
            );

            // A Vendure error result is reported as a failed call, with the error object as the structured
            // content, so the model reads Vendure's own error code and reacts to it.
            expect(applied.body.result.isError).toBe(true);
            expect(applied.body.result.structuredContent.order).toBeUndefined();
            expect(applied.body.result.structuredContent).toMatchObject({
                errorCode: 'COUPON_CODE_INVALID_ERROR',
            });
        });

        it('get_my_account returns the signed-in customer behind the grant', async () => {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_my_account', {}, 1), {
                token: readsAccessToken,
            });

            expect(response.body.result.isError).toBeUndefined();
            const customer = response.body.result.structuredContent.customer;
            expect(customer).not.toBeNull();
            expect(customer.emailAddress).toBe(customerEmail);
        });

        it('get_my_account is not callable without a grant', async () => {
            // Permission.Authenticated, so an anonymous session must not see it at all: it is
            // filtered out of the exposed set, and the SDK then rejects the unknown name.
            const listed = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 1));
            const names = (listed.body.result.tools as Array<{ name: string }>).map(tool => tool.name);
            expect(names).not.toContain('get_my_account');
            expect(names).not.toContain('list_my_orders');
            expect(names).toContain('list_collections');

            const denied = await postMcp(baseUrl(), 'shop', callTool('get_my_account', {}, 2));
            expect(denied.body.error).toBeDefined();
            expect(denied.body.result).toBeUndefined();
        });

        it("list_my_orders returns exactly the customer's own placed orders", async () => {
            const response = await postMcp(baseUrl(), 'shop', callTool('list_my_orders', {}, 1), {
                token: readsAccessToken,
            });

            expect(response.body.result.isError).toBeUndefined();
            const listed = response.body.result.structuredContent as {
                items: Array<{ code: string; orderPlacedAt: string | null }>;
                total: number;
                hasMore: boolean;
            };
            // This test needs the customer to own at least one order, and the checkout describe
            // above is what places it. The guard is here so that dependency fails loudly: without
            // it, running this test on its own would compare two empty lists and pass while
            // proving nothing.
            expect(customerOrderCodes.length).toBeGreaterThan(0);
            expect(listed.items.map(order => order.code).sort()).toEqual([...customerOrderCodes].sort());
            expect(listed.total).toBe(customerOrderCodes.length);
            expect(listed.hasMore).toBe(false);
            expect(listed.items[0].orderPlacedAt).toBeTruthy();
        });

        it('list_collections returns the public collections and hides the private one', async () => {
            const response = await postMcp(baseUrl(), 'shop', callTool('list_collections', {}, 1));

            expect(response.body.result.isError).toBeUndefined();
            const listed = response.body.result.structuredContent as {
                items: Array<{ id: ID; slug: string }>;
                total: number;
            };
            const slugs = listed.items.map(collection => collection.slug);
            expect(slugs).toContain(publicCollectionSlug);
            expect(slugs).not.toContain(privateCollectionSlug);
            expect(listed.total).toBe(listed.items.length);
        });
    });
});
