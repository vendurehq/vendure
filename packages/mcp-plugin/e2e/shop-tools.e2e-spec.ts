import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import {
    ConfigService,
    Customer,
    ID,
    mergeConfig,
    Order,
    OrderByCodeAccessStrategy,
    RequestContext,
    RequestContextService,
    Session,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { deriveHashKey, hashToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { McpToolExecutionService } from '../src/registry/mcp-tool-execution.service';
import { McpToolRegistryService } from '../src/registry/mcp-tool-registry.service';

import { postMcp, rpc } from './utils/mcp-http-client';
import { runShopAuthorizationCodeFlow } from './utils/oauth-test-client';

const TOKEN_SECRET = 'shop-tools-secret-000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const productsCsvPath = path.join(__dirname, 'fixtures/e2e-products.csv');
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const CHANNEL_TOKEN_HEADER = 'vendure-token';

const shopToolNames = [
    'add_to_cart',
    'apply_coupon_code',
    'get_cart',
    'get_collection',
    'get_eligible_payment_methods',
    'get_eligible_shipping_methods',
    'get_my_account',
    'get_order',
    'get_product',
    'list_collections',
    'list_my_orders',
    'place_order',
    'remove_coupon_code',
    'remove_from_cart',
    'search_products',
    'set_billing_address',
    'set_shipping_address',
    'set_shipping_method',
    'update_cart_line',
].sort();

class TestOrderByCodeAccessStrategy implements OrderByCodeAccessStrategy {
    allow = true;

    canAccessOrder(_ctx: RequestContext, _order: Order): boolean {
        return this.allow;
    }
}

const callTool = (name: string, args: Record<string, unknown> = {}, id = 1) =>
    rpc('tools/call', { name, arguments: args }, id);

describe('MCP built-in shop tools', () => {
    const orderByCodeAccessStrategy = new TestOrderByCodeAccessStrategy();
    const config = mergeConfig(testConfig(), {
        orderOptions: { orderByCodeAccessStrategy },
        plugins: [
            McpPlugin.init({
                oauth: {
                    tokenSecret: TOKEN_SECRET,
                    storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
                },
            }),
        ],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    const lookupHash = (value: string) => hashToken(`lookup:${value}`, deriveHashKey(TOKEN_SECRET));

    let adminCtx: RequestContext;
    let connection: TransactionalConnection;
    let customerAuthToken: string;
    let customerEmail: string;
    let productId: ID;
    let productAdminId: string;
    let productSlug: string;
    let variantId: ID;
    let publicCollectionId: ID;
    let publicCollectionSlug: string;
    let privateCollectionId: ID;
    let privateCollectionSlug: string;
    let secondChannelId: string;
    let secondChannelDbId: ID;
    let secondChannelToken: string;

    beforeAll(async () => {
        await server.init({ initialData, productsCsvPath, customerCount: 1 });
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

    it('lists exactly the 19 built-in shop tools for an authenticated customer', async () => {
        const flow = await shopFlow();
        const response = await postMcp(baseUrl(), 'shop', rpc('tools/list', {}, 1), {
            token: flow.access_token,
        });

        expect(response.status).toBe(200);
        expect(response.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
            shopToolNames,
        );
    });

    // Read-only cart helpers must not create an empty Order for a fresh session.
    it('keeps a fresh anonymous session order-free until add_to_cart creates and binds a cart', async () => {
        const beforeCount = await connection.getRepository(adminCtx, Order).count();
        const getCart = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 1));
        const sessionToken = getCart.headers.get(AUTH_TOKEN_HEADER);
        expect(sessionToken).toBeTruthy();
        expect(getCart.body.result.structuredContent).toEqual({ order: null });

        for (const [id, name] of [
            [2, 'get_eligible_payment_methods'],
            [3, 'get_eligible_shipping_methods'],
        ] as const) {
            const response = await postMcp(baseUrl(), 'shop', callTool(name, {}, id), {
                headers: { [AUTH_TOKEN_HEADER]: sessionToken as string },
            });
            expect(response.headers.get(AUTH_TOKEN_HEADER)).toBe(sessionToken);
            expect(response.body.result.structuredContent).toEqual({ methods: [] });
        }

        expect(await connection.getRepository(adminCtx, Order).count()).toBe(beforeCount);
        expect((await anonymousSession(sessionToken as string)).activeOrderId).toBeFalsy();

        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1 }, 4),
            { headers: { [AUTH_TOKEN_HEADER]: sessionToken as string } },
        );
        expect(added.body.result.isError).toBeUndefined();
        expect(added.body.result.structuredContent.order.totalQuantity).toBe(1);

        const session = await anonymousSession(sessionToken as string);
        expect(session.activeOrderId).toBeTruthy();
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(beforeCount + 1);
        expect(String(session.activeOrderId)).toBe(
            String((await orderByCode(added.body.result.structuredContent.order.code)).id),
        );
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

    it('uses the SDK for cart then gates place_order before executing confirm:true in the same session', async () => {
        const sessionResponse = await postMcp(baseUrl(), 'shop', rpc('ping', {}, 1));
        const sessionToken = sessionResponse.headers.get(AUTH_TOKEN_HEADER);
        expect(sessionToken).toBeTruthy();

        const client = new Client({ name: 'shop-tools-sdk-e2e', version: '1.0.0' });
        const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl()}/mcp/shop`), {
            requestInit: { headers: { [AUTH_TOKEN_HEADER]: sessionToken as string } },
        });
        await client.connect(transport);
        try {
            const added = await client.callTool({
                name: 'add_to_cart',
                arguments: { variantId, quantity: 1 },
            });
            expect(added.isError).toBeUndefined();
            expect((added.structuredContent as any).order.totalQuantity).toBe(1);

            const preview = await client.callTool({
                name: 'place_order',
                arguments: { paymentMethodCode: 'not-configured' },
            });
            expect(preview.isError).toBeUndefined();
            expect(preview.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });

            const confirmed = await client.callTool({
                name: 'place_order',
                arguments: { paymentMethodCode: 'not-configured', confirm: true },
            });
            expect(confirmed.isError).toBeUndefined();
            expect(confirmed.structuredContent).toEqual({
                requiresAuthorization: true,
                message:
                    'Placing an order requires an authorized customer. Complete the OAuth flow ' +
                    'for this store and retry with the resulting access token.',
            });

            const session = await anonymousSession(sessionToken as string);
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

            const log = await connection.getRepository(adminCtx, McpToolCallLog).findOneOrFail({
                where: { toolName: 'search_products' },
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
            ).rejects.toThrow(/shop/);
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
});
