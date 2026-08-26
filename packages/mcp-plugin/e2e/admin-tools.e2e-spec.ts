import { LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Asset,
    AssetService,
    ConfigService,
    Customer,
    DefaultAssetImportStrategy,
    ID,
    mergeConfig,
    Order,
    Payment,
    Product,
    ProductVariant,
    RequestContext,
    RequestContextService,
    StockAdjustment,
    StockLevel,
    TransactionalConnection,
} from '@vendure/core';
import { McpTool, McpToolMetadata } from '@vendure/mcp-sdk';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import * as http from 'http';
import { AddressInfo } from 'net';
import { Readable } from 'stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { deriveHashKey, hashLookupToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { adminToolProviders } from '../src/tools/built-in/admin';
import { McpPluginOptions } from '../src/types';

import { callTool, postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow } from './utils/oauth-test-client';
import { testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'admin-tools-secret-0000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;

const adminToolMetadata = adminToolProviders.map(
    provider => Reflect.getMetadata(McpTool.KEY, provider) as McpToolMetadata,
);
const adminToolNames = adminToolMetadata.map(metadata => metadata.name).sort();
const destructiveToolNames = adminToolMetadata
    .filter(metadata => metadata.behavior === 'destructive')
    .map(metadata => metadata.name)
    .sort();

/** A 1x1 red PNG, the smallest thing `upload_asset` can be asked to fetch and store. */
const PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
);

/** Bytes that no image format claims, used by the two file-type rejection fixtures. */
const NOT_AN_IMAGE = Buffer.from('this is not an image');

/**
 * A loopback HTTP server standing in for the public web address `upload_asset` fetches from, so the
 * test needs no network access. Counts requests, so a test can prove the bytes were really fetched.
 */
async function startAssetFileServer(): Promise<{
    baseUrl: string;
    requestCount: (path: string) => number;
    close: () => Promise<void>;
}> {
    const counts = new Map<string, number>();
    const server = http.createServer((req, res) => {
        const path = (req.url ?? '').split('?')[0];
        counts.set(path, (counts.get(path) ?? 0) + 1);
        // Plain text under a .txt name, so the store's permittedFileTypes refuses it.
        if (path === '/notes.txt') {
            res.setHeader('content-type', 'text/plain');
            res.setHeader('content-length', String(NOT_AN_IMAGE.length));
            return res.end(NOT_AN_IMAGE);
        }
        // Text bytes behind an image name and an image content type, so nothing but the leading
        // bytes gives the file away.
        if (path === '/not-really.png') {
            res.setHeader('content-type', 'image/png');
            res.setHeader('content-length', String(NOT_AN_IMAGE.length));
            return res.end(NOT_AN_IMAGE);
        }
        if (path !== '/pixel.png') {
            res.statusCode = 404;
            return res.end('not found');
        }
        res.setHeader('content-type', 'image/png');
        res.setHeader('content-length', String(PIXEL_PNG.length));
        res.end(PIXEL_PNG);
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        requestCount: path => counts.get(path) ?? 0,
        close: () =>
            new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve()))),
    };
}

const SECOND_CHANNEL_CODE = 'admin-tools-second-channel';
const LIMITED_ADMIN_PASSWORD = 'test';
// Approving the MCP consent screen requires UpdateMcpServer, so every administrator that connects an
// MCP client holds it on top of whatever the test is actually about.
const READ_CUSTOMER_ADMIN = {
    emailAddress: 'limited-admin@example.test',
    roleCode: 'mcp-limited-role',
    permissions: ['ReadCustomer', 'UpdateMcpServer'],
};
const READ_CHANNEL_ADMIN = {
    emailAddress: 'channel-admin@example.test',
    roleCode: 'mcp-channel-role',
    permissions: ['ReadChannel', 'UpdateMcpServer'],
};

/**
 * Creates an administrator holding only the given permissions, and only in the given channel, then
 * returns its admin-API bearer token. Logging in over the admin API directly (rather than via the
 * shared client) avoids rotating the superadmin session.
 */
async function provisionLimitedAdmin(
    adminClient: SimpleGraphQLClient,
    channelId: string,
    adminApiUrl: string,
    admin: { emailAddress: string; roleCode: string; permissions: string[] } = READ_CUSTOMER_ADMIN,
): Promise<string> {
    const role = await adminClient.query(
        gql`
            mutation CreateLimitedRole($input: CreateRoleInput!) {
                createRole(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                code: admin.roleCode,
                description: `MCP ${admin.roleCode}`,
                permissions: admin.permissions,
                channelIds: [channelId],
            },
        },
    );
    await adminClient.query(
        gql`
            mutation CreateLimitedAdmin($input: CreateAdministratorInput!) {
                createAdministrator(input: $input) {
                    id
                }
            }
        `,
        {
            input: {
                firstName: 'Limited',
                lastName: 'Admin',
                emailAddress: admin.emailAddress,
                password: LIMITED_ADMIN_PASSWORD,
                roleIds: [role.createRole.id],
            },
        },
    );
    const response = await fetch(adminApiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            query: `mutation { login(username: "${admin.emailAddress}", password: "${LIMITED_ADMIN_PASSWORD}") { __typename } }`,
        }),
    });
    const token = response.headers.get('vendure-auth-token');
    if (!token) {
        throw new Error(`Limited admin login failed: ${await response.text()}`);
    }
    return token;
}

describe('MCP built-in admin tools (direct mode)', () => {
    // Every test that needs a grant spends three requests of the 60-per-minute OAuth-IP budget
    // (register, authorize, token). This file runs enough of them that the budget would be spent
    // mid-run and later tests would fail on a 429 raised during their setup, not on anything they
    // test. Neither describe in this file tests OAuth rate limiting, so the budget is off.
    const options: McpPluginOptions = {
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { oauthIp: false },
    };
    const config = mergeConfig(testConfig(), {
        // `upload_asset` fetches over HTTP, and core's default import strategy refuses hostnames
        // that resolve to private or loopback addresses (its server-side request forgery guard).
        // The fixture server this suite starts is on 127.0.0.1, so the strategy is configured to
        // allow it. Nothing else in the suite fetches a URL.
        importExportOptions: {
            assetImportStrategy: new DefaultAssetImportStrategy({ allowPrivateNetworks: true }),
        },
        plugins: [McpPlugin.init(options)],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;
    const hashKey = deriveHashKey(TOKEN_SECRET);
    const lookupHash = (value: string) => hashLookupToken(value, hashKey);

    let connection: TransactionalConnection;
    let adminCtx: RequestContext;
    let superAdminToken: string;
    let limitedAdminToken: string;
    let seededCustomerEmail: string;
    let productGraphqlId: string;
    let productId: ID;
    let variantId: ID;
    let variantGraphqlId: string;
    let stockLocationId: ID;
    let secondChannelToken: string;
    let secondChannelDbId: ID;
    let channelAdminToken: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();

        connection = server.app.get(TransactionalConnection);
        const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });

        const fixture = await adminClient.query(gql`
            query AdminToolFixture {
                activeChannel {
                    id
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
                    }
                }
                productVariants(options: { take: 1 }) {
                    items {
                        id
                    }
                }
                stockLocations {
                    items {
                        id
                    }
                }
                customers(options: { take: 1 }) {
                    items {
                        emailAddress
                    }
                }
            }
        `);
        const defaultChannelId = fixture.activeChannel.id;
        const zoneId = fixture.zones.items[0]?.id;
        productGraphqlId = fixture.products.items[0]?.id;
        variantGraphqlId = fixture.productVariants.items[0]?.id;
        const stockLocationGraphqlId = fixture.stockLocations.items[0]?.id;
        seededCustomerEmail = fixture.customers.items[0]?.emailAddress;
        if (
            !productGraphqlId ||
            !zoneId ||
            !seededCustomerEmail ||
            !variantGraphqlId ||
            !stockLocationGraphqlId
        ) {
            throw new Error(`Missing seeded fixtures: ${JSON.stringify(fixture)}`);
        }
        productId = idStrategy.decodeId(productGraphqlId);
        variantId = idStrategy.decodeId(variantGraphqlId);
        stockLocationId = idStrategy.decodeId(stockLocationGraphqlId);

        const channelResult = await adminClient.query(
            gql`
                mutation CreateAdminToolChannel($input: CreateChannelInput!) {
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
                    code: SECOND_CHANNEL_CODE,
                    token: 'admin-tools-second-channel-token',
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
        secondChannelToken = channelResult.createChannel.token;
        secondChannelDbId = idStrategy.decodeId(channelResult.createChannel.id);

        const adminApiUrl = `${baseUrl()}/${config.apiOptions.adminApiPath ?? 'admin-api'}`;
        // A limited administrator (ReadCustomer only) proves permission filtering and call-time rejection.
        limitedAdminToken = await provisionLimitedAdmin(adminClient, defaultChannelId, adminApiUrl);
        // An administrator who may read channels, but only holds a role in the default channel. It can
        // call the channel tools, so it proves they are scoped to the caller's own channels.
        channelAdminToken = await provisionLimitedAdmin(
            adminClient,
            defaultChannelId,
            adminApiUrl,
            READ_CHANNEL_ADMIN,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    /** Runs a fresh admin OAuth flow (a new grant) and returns its access token. */
    async function adminAccessToken(consentToken: string = superAdminToken): Promise<string> {
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: consentToken,
        });
        return flow.access_token;
    }

    async function createDraftOrder(): Promise<{ graphqlId: string; id: ID }> {
        const result = await adminClient.query(gql`
            mutation {
                createDraftOrder {
                    id
                    state
                }
            }
        `);
        const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        return { graphqlId: result.createDraftOrder.id, id: idStrategy.decodeId(result.createDraftOrder.id) };
    }

    async function orderState(graphqlId: string): Promise<string> {
        const result = await adminClient.query(
            gql`
                query OrderState($id: ID!) {
                    order(id: $id) {
                        id
                        state
                    }
                }
            `,
            { id: graphqlId },
        );
        return result.order.state;
    }

    /**
     * Runs a real shop checkout up to `ArrangingPayment`, then records a fully-settled manual
     * payment against it via the admin `addManualPaymentToOrder` mutation. That mutation drives
     * the real payment state machine straight to `Settled` without needing a configured
     * `PaymentMethodHandler`, so the resulting order and payment are genuine, not hand-inserted rows.
     */
    async function createSettledOrder(): Promise<{ orderId: ID; graphqlId: string; paymentId: ID }> {
        const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;

        const added = await shopClient.query(
            gql`
                mutation AddItemForRefundTest($productVariantId: ID!) {
                    addItemToOrder(productVariantId: $productVariantId, quantity: 1) {
                        ... on Order {
                            id
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { productVariantId: variantGraphqlId },
        );
        const orderGraphqlId = added.addItemToOrder.id;
        if (!orderGraphqlId) {
            throw new Error(`Could not add item to order: ${JSON.stringify(added.addItemToOrder)}`);
        }

        await shopClient.query(
            gql`
                mutation SetCustomerForRefundTestOrder($input: CreateCustomerInput!) {
                    setCustomerForOrder(input: $input) {
                        ... on Order {
                            id
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
                    firstName: 'Refund',
                    lastName: 'Tester',
                    emailAddress: `refund-test-${String(orderGraphqlId)}@example.test`,
                },
            },
        );

        await shopClient.query(
            gql`
                mutation SetShippingAddressForRefundTest($input: CreateAddressInput!) {
                    setOrderShippingAddress(input: $input) {
                        ... on Order {
                            id
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
                    fullName: 'Refund Tester',
                    streetLine1: '12 Test Street',
                    city: 'Testville',
                    postalCode: '12345',
                    countryCode: 'US',
                },
            },
        );

        const { eligibleShippingMethods } = await shopClient.query(gql`
            query {
                eligibleShippingMethods {
                    id
                }
            }
        `);
        await shopClient.query(
            gql`
                mutation SetShippingMethodForRefundTest($id: [ID!]!) {
                    setOrderShippingMethod(shippingMethodId: $id) {
                        ... on Order {
                            id
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { id: [eligibleShippingMethods[0].id] },
        );

        const transitioned = await shopClient.query(
            gql`
                mutation TransitionRefundTestOrder($state: String!) {
                    transitionOrderToState(state: $state) {
                        ... on Order {
                            id
                            state
                        }
                        ... on ErrorResult {
                            errorCode
                            message
                        }
                    }
                }
            `,
            { state: 'ArrangingPayment' },
        );
        if (transitioned.transitionOrderToState?.state !== 'ArrangingPayment') {
            throw new Error(
                `Could not transition order to ArrangingPayment: ${JSON.stringify(transitioned.transitionOrderToState)}`,
            );
        }

        const manualPayment = await adminClient.query(
            gql`
                mutation AddManualPaymentForRefundTest($input: ManualPaymentInput!) {
                    addManualPaymentToOrder(input: $input) {
                        ... on Order {
                            id
                            state
                            payments {
                                id
                                amount
                                state
                            }
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
                    orderId: orderGraphqlId,
                    method: 'refund-test-manual-payment',
                    transactionId: 'refund-test-tx',
                    metadata: {},
                },
            },
        );
        const resultOrder = manualPayment.addManualPaymentToOrder;
        if (!resultOrder?.payments?.length) {
            throw new Error(`Could not add manual payment: ${JSON.stringify(resultOrder)}`);
        }
        const payment = resultOrder.payments[resultOrder.payments.length - 1];
        return {
            orderId: idStrategy.decodeId(orderGraphqlId),
            graphqlId: orderGraphqlId,
            paymentId: idStrategy.decodeId(payment.id),
        };
    }

    it('lists exactly the built-in admin tools for a superadmin grant', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), { token });

        expect(response.status).toBe(200);
        expect(response.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual(
            adminToolNames,
        );
    });

    it('advertises optional confirm on exactly the destructive admin tools (wire schema)', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), { token });
        const tools = response.body.result.tools as Array<{
            name: string;
            inputSchema: { properties?: Record<string, { type?: string }>; required?: string[] };
        }>;

        const withConfirm = tools
            .filter(tool => tool.inputSchema?.properties?.confirm !== undefined)
            .map(tool => tool.name)
            .sort();
        expect(withConfirm).toEqual(destructiveToolNames);

        for (const tool of tools.filter(candidate => destructiveToolNames.includes(candidate.name))) {
            expect(tool.inputSchema.properties?.confirm?.type).toBe('boolean');
            expect(tool.inputSchema.required ?? []).not.toContain('confirm');
        }

        const listOrders = tools.find(tool => tool.name === 'list_orders');
        expect(listOrders?.inputSchema.properties?.confirm).toBeUndefined();
    });

    it('gates cancel_order until confirm:true, without mutating on the preview call', async () => {
        const token = await adminAccessToken();
        const order = await createDraftOrder();
        const stateBefore = await orderState(order.graphqlId);

        const preview = await postMcp(baseUrl(), 'admin', callTool('cancel_order', { id: order.id }, 1), {
            token,
        });
        expect(preview.body.result.isError).toBeUndefined();
        expect(preview.body.result.structuredContent).toMatchObject({ status: 'confirmation_required' });
        expect(await orderState(order.graphqlId)).toBe(stateBefore);

        const confirmed = await postMcp(
            baseUrl(),
            'admin',
            callTool('cancel_order', { id: order.id, confirm: true }, 2),
            { token },
        );
        expect(confirmed.body.result.isError).toBe(true);
        // The gate passed and the handler ran the real cancelOrder. An empty draft has no lines to
        // cancel, so the tool surfaces the concrete EmptyOrderLineSelectionError union — proof the
        // handler executed and shaped its business result, not merely that the confirm gate opened.
        expect(confirmed.body.result.structuredContent).toMatchObject({
            __typename: 'EmptyOrderLineSelectionError',
            errorCode: 'EMPTY_ORDER_LINE_SELECTION_ERROR',
        });
    });

    it('does not require confirmation for a readonly tool', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool('list_orders', {}, 1), { token });
        expect(response.body.result.isError).toBeUndefined();
        expect(response.body.result.structuredContent).toHaveProperty('items');
        expect((response.body.result.structuredContent as { status?: string }).status).not.toBe(
            'confirmation_required',
        );

        // Every order result carries the same keys, whichever tool produced it.
        const items = (response.body.result.structuredContent as { items: Array<Record<string, unknown>> })
            .items;
        expect(items.length).toBeGreaterThan(0);
        expect(Array.isArray(items[0].shippingLines)).toBe(true);
        expect(items[0]).toHaveProperty('couponCodes');
        expect(items[0]).toHaveProperty('discounts');
    });

    it('get_order returns the same order shape as the order list', async () => {
        const token = await adminAccessToken();
        const draft = await createDraftOrder();

        const response = await postMcp(baseUrl(), 'admin', callTool('get_order', { id: draft.id }, 1), {
            token,
        });

        expect(response.body.result.isError).toBeUndefined();
        const order = (response.body.result.structuredContent as { order: Record<string, unknown> }).order;
        expect(String(order.id)).toBe(String(draft.id));
        expect(Array.isArray(order.shippingLines)).toBe(true);
        expect(order).toHaveProperty('couponCodes');
        expect(order).toHaveProperty('discounts');
    });

    it("sorts the order list on request and returns each order's dates", async () => {
        const token = await adminAccessToken();
        const earlier = await createDraftOrder();
        const later = await createDraftOrder();

        // Two orders created a moment apart share the same createdAt to the second, so nothing
        // could tell them apart in a sorted list. Give them placed dates a day apart instead,
        // which is also the field the tool sorts by when the caller asks for no sort.
        await connection
            .getRepository(adminCtx, Order)
            .update(earlier.id, { orderPlacedAt: new Date('2026-01-01T00:00:00.000Z') });
        await connection
            .getRepository(adminCtx, Order)
            .update(later.id, { orderPlacedAt: new Date('2026-01-02T00:00:00.000Z') });

        const listWith = async (args: Record<string, unknown>, id: number) => {
            const response = await postMcp(baseUrl(), 'admin', callTool('list_orders', args, id), {
                token,
            });
            expect(response.body.result.isError).toBeUndefined();
            return (response.body.result.structuredContent as { items: Array<{ id: ID }> }).items;
        };
        const positionOf = (items: Array<{ id: ID }>, id: ID) =>
            items.findIndex(item => String(item.id) === String(id));

        // No sort arguments: the tool defaults to the most recently placed order first. Before this
        // default existed the query ran with no ORDER BY at all and returned an arbitrary page.
        const defaulted = await listWith({ limit: 100 }, 1);
        expect(positionOf(defaulted, later.id)).toBeLessThan(positionOf(defaulted, earlier.id));

        const oldestFirst = await listWith({ sortBy: 'orderPlacedAt', sortDirection: 'ASC', limit: 100 }, 2);
        expect(positionOf(oldestFirst, earlier.id)).toBeLessThan(positionOf(oldestFirst, later.id));

        const placed = defaulted[positionOf(defaulted, later.id)] as {
            createdAt?: string;
            updatedAt?: string;
            orderPlacedAt?: string | null;
        };
        expect(placed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(placed.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(placed.orderPlacedAt).toBe('2026-01-02T00:00:00.000Z');
    });

    /**
     * Calls a list tool and returns its envelope. The filter tests below all need the same three
     * lines, and each one gets a fresh grant so it does not depend on any other test's token.
     */
    async function listFiltered<T>(
        tool: string,
        args: Record<string, unknown>,
    ): Promise<{ items: T[]; total: number }> {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool(tool, args, 1), { token });
        expect(response.body.result.isError).toBeUndefined();
        return response.body.result.structuredContent as { items: T[]; total: number };
    }

    it('list_customers finds one customer by email address, and answers an empty page for an unknown one', async () => {
        const found = await listFiltered<{ emailAddress: string }>('list_customers', {
            filter: { emailAddress: { eq: seededCustomerEmail } },
        });
        expect(found.items).toHaveLength(1);
        expect(found.items[0].emailAddress).toBe(seededCustomerEmail);
        expect(found.total).toBe(1);

        const missing = await listFiltered<{ emailAddress: string }>('list_customers', {
            filter: { emailAddress: { eq: 'nobody-at-all@example.test' } },
        });
        expect(missing.items).toEqual([]);
        expect(missing.total).toBe(0);
    });

    it('list_orders returns only the orders in the state asked for', async () => {
        await createDraftOrder();

        const drafts = await listFiltered<{ state: string }>('list_orders', {
            limit: 100,
            filter: { state: { eq: 'Draft' } },
        });
        expect(drafts.items.length).toBeGreaterThan(0);
        expect(drafts.items.every(order => order.state === 'Draft')).toBe(true);
    });

    it('list_orders filters on the date an order was placed', async () => {
        const earlier = await createDraftOrder();
        const later = await createDraftOrder();
        // Draft orders have no orderPlacedAt of their own, so the dates are written directly, the
        // same way the sort test above does it.
        await connection
            .getRepository(adminCtx, Order)
            .update(earlier.id, { orderPlacedAt: new Date('2026-01-01T00:00:00.000Z') });
        await connection
            .getRepository(adminCtx, Order)
            .update(later.id, { orderPlacedAt: new Date('2026-01-02T00:00:00.000Z') });

        const placedAfter = await listFiltered<{ id: ID }>('list_orders', {
            limit: 100,
            filter: { orderPlacedAt: { after: '2026-01-01T12:00:00.000Z' } },
        });
        const ids = placedAfter.items.map(order => String(order.id));
        expect(ids).toContain(String(later.id));
        expect(ids).not.toContain(String(earlier.id));
    });

    it('list_orders filters on when an order last changed', async () => {
        const future = new Date(Date.now() + 60_000).toISOString();

        const changedBefore = await listFiltered<{ id: ID }>('list_orders', {
            filter: { updatedAt: { before: future } },
        });
        expect(changedBefore.items.length).toBeGreaterThan(0);

        const changedAfter = await listFiltered<{ id: ID }>('list_orders', {
            filter: { updatedAt: { after: future } },
        });
        expect(changedAfter.items).toEqual([]);
        expect(changedAfter.total).toBe(0);
    });

    it('list_products finds the product a variant SKU belongs to', async () => {
        const bySku = await listFiltered<{ slug: string }>('list_products', {
            filter: { sku: { contains: 'SHIRT-L' } },
        });
        // The fixture shirt has three variants and only one of them carries this SKU, so a product
        // must not come back once per matching variant either.
        expect(bySku.items).toHaveLength(1);
        expect(bySku.items[0].slug).toBe('test-shirt');
    });

    it('list_products returns only disabled products when asked for them', async () => {
        const disabled = await listFiltered<{ enabled: boolean }>('list_products', {
            filter: { enabled: { eq: false } },
        });
        // The fixture catalog is all enabled, and the write tests that disable a product run in a
        // later describe, so what matters here is that nothing enabled slips through.
        expect(disabled.items.every(product => product.enabled === false)).toBe(true);
    });

    it('list_orders refuses a page size or a filter value its schema does not allow', async () => {
        const token = await adminAccessToken();
        const refusal = async (args: Record<string, unknown>, id: number) => {
            const response = await postMcp(baseUrl(), 'admin', callTool('list_orders', args, id), { token });
            expect(response.body.result.isError).toBe(true);
            return response.body.result.content[0].text as string;
        };

        // A limit of 0 used to reach core, which reads a falsy take as "no limit" and returned the
        // whole table; 101 used to come back as the raw error.list-query-limit-exceeded key.
        expect(await refusal({ limit: 0 }, 1)).toContain('limit');
        expect(await refusal({ limit: 101 }, 2)).toContain('limit');
        expect(await refusal({ offset: -1 }, 3)).toContain('offset');
        // Only the operators the tool advertises are accepted, and a date has to be ISO 8601.
        expect(await refusal({ filter: { state: { regex: 'x' } } }, 4)).toContain('regex');
        expect(await refusal({ filter: { orderPlacedAt: { after: 'yesterday' } } }, 5)).toContain('after');
    });

    it('filters tools a caller lacks permission for and rejects them at call time', async () => {
        const token = await adminAccessToken(limitedAdminToken);
        const listed = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), { token });
        const names = (listed.body.result.tools as Array<{ name: string }>).map(tool => tool.name);
        expect(names).toContain('list_customers');
        expect(names).toContain('get_customer');
        expect(names).not.toContain('list_orders');
        expect(names).not.toContain('create_product');
        // Reading the channel list is settings-level, so it is hidden from an admin who only reads customers.
        expect(names).not.toContain('list_channels');
        // Customer groups need ReadCustomerGroup, which this administrator does not hold, even though
        // it may read customers.
        expect(names).not.toContain('list_customer_groups');

        // list_orders was filtered out of the exposed set, so it is not callable: the SDK rejects it
        // as an unknown tool, with a top-level JSON-RPC error and no tool result. The registry's own
        // permission check, which answers with an isError result instead, is covered by the registry
        // unit spec and by the discovery-mode execute_tool test below.
        const denied = await postMcp(baseUrl(), 'admin', callTool('list_orders', {}, 2), { token });
        expect(denied.body.error).toBeDefined();
        expect(denied.body.result).toBeUndefined();
    });

    it('list_channels returns every channel to a superadmin grant', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool('list_channels', {}, 1), { token });

        expect(response.body.result.isError).toBeUndefined();
        const listed = response.body.result.structuredContent as {
            items: Array<{ code: string }>;
            total: number;
        };
        expect(listed.items.map(channel => channel.code)).toContain(SECOND_CHANNEL_CODE);
        expect(listed.total).toBe(listed.items.length);
    });

    it('list_channels returns only the channels the caller holds a role in', async () => {
        const token = await adminAccessToken(channelAdminToken);
        const response = await postMcp(baseUrl(), 'admin', callTool('list_channels', {}, 1), { token });

        expect(response.body.result.isError).toBeUndefined();
        const listed = response.body.result.structuredContent as {
            items: Array<{ code: string }>;
            total: number;
        };
        // The role was created against the default channel only, so the second channel — and its
        // token — must not reach this caller.
        expect(listed.items.map(channel => channel.code)).not.toContain(SECOND_CHANNEL_CODE);
        expect(listed.total).toBe(1);
    });

    it('set_active_channel refuses a channel the caller holds no role in', async () => {
        const token = await adminAccessToken(channelAdminToken);
        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool('set_active_channel', { channelToken: secondChannelToken }, 1),
            { token },
        );

        expect(response.body.result.isError).toBe(true);
        // The refusal happens before the write, so the grant still points at the channel it was issued for.
        const grant = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
            where: { accessTokenHash: lookupHash(token) },
        });
        expect(String(grant.channelId)).not.toBe(String(secondChannelDbId));
    });

    it('set_active_channel writes the grant row and changes the active channel for later calls', async () => {
        const token = await adminAccessToken();

        // The seeded product is on the default channel, so it is visible before switching channels.
        const before = await postMcp(baseUrl(), 'admin', callTool('get_product', { id: productId }, 1), {
            token,
        });
        expect(before.body.result.structuredContent.product).toMatchObject({ id: productId });

        const switched = await postMcp(
            baseUrl(),
            'admin',
            callTool('set_active_channel', { channelToken: secondChannelToken }, 2),
            { token },
        );
        expect(switched.body.result.isError).toBeUndefined();
        expect(switched.body.result.structuredContent.channel).toMatchObject({ token: secondChannelToken });

        const grant = await connection.getRepository(adminCtx, McpOauthGrant).findOneOrFail({
            where: { accessTokenHash: lookupHash(token) },
        });
        expect(String(grant.channelId)).toBe(String(secondChannelDbId));

        // Later calls run on the newly-selected channel, where the seeded product is not assigned.
        const after = await postMcp(baseUrl(), 'admin', callTool('get_product', { id: productId }, 3), {
            token,
        });
        expect(after.body.result.structuredContent).toEqual({ product: null });
    });

    it('runs a create-customer flow and shapes ErrorResult unions as success structuredContent', async () => {
        const token = await adminAccessToken();

        const created = await postMcp(
            baseUrl(),
            'admin',
            callTool(
                'create_customer',
                { input: { firstName: 'Ada', lastName: 'Lovelace', emailAddress: 'ada@example.test' } },
                1,
            ),
            { token },
        );
        expect(created.body.result.isError).toBeUndefined();
        expect(created.body.result.structuredContent.customer).toMatchObject({
            emailAddress: 'ada@example.test',
        });

        // Creating a registered account for an email that already has a user returns an ErrorResult,
        // which the tool surfaces as a non-error result (customer: null), not an isError envelope.
        const conflict = await postMcp(
            baseUrl(),
            'admin',
            callTool(
                'create_customer',
                {
                    input: { firstName: 'Dup', lastName: 'Licate', emailAddress: seededCustomerEmail },
                },
                2,
            ),
            { token },
        );
        expect(conflict.body.result.isError).toBeUndefined();
        expect(conflict.body.result.structuredContent).toEqual({ customer: null });
    });

    it('get_product returns the variants whose IDs the stock and variant tools take', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool('get_product', { id: productId }, 1), {
            token,
        });

        expect(response.body.result.isError).toBeUndefined();
        const product = response.body.result.structuredContent.product as {
            variants: Array<{ id: ID; sku: string; enabled: boolean; priceDecimal: string }>;
            optionGroups: unknown[];
        };
        expect(product.variants.length).toBeGreaterThan(0);
        expect(product.variants[0]).toMatchObject({
            id: expect.anything(),
            sku: expect.any(String),
            enabled: expect.any(Boolean),
            priceDecimal: expect.any(String),
        });
        // This seeded product has a single variant with no options, so it has no option groups. The
        // test below reads the seeded shirt, which does have them.
        expect(product.optionGroups).toEqual([]);
    });

    it('get_product returns option groups with the option IDs create_variant takes', async () => {
        const token = await adminAccessToken();
        const listed = await postMcp(
            baseUrl(),
            'admin',
            callTool('list_products', { filter: { slug: { eq: 'test-shirt' } } }, 1),
            { token },
        );
        const shirt = (listed.body.result.structuredContent.items as Array<{ id: ID }>)[0];
        expect(shirt).toBeDefined();

        const response = await postMcp(baseUrl(), 'admin', callTool('get_product', { id: shirt.id }, 2), {
            token,
        });
        expect(response.body.result.isError).toBeUndefined();
        const optionGroups = response.body.result.structuredContent.product.optionGroups as Array<{
            id: ID;
            code: string;
            name: string;
            options: Array<{ id: ID; code: string; name: string }>;
        }>;
        expect(optionGroups.length).toBeGreaterThan(0);
        expect(optionGroups[0]).toMatchObject({
            id: expect.anything(),
            code: expect.any(String),
            name: expect.any(String),
        });
        expect(optionGroups[0].options.length).toBeGreaterThan(0);
        expect(optionGroups[0].options[0]).toMatchObject({
            id: expect.anything(),
            code: expect.any(String),
            name: expect.any(String),
        });
    });

    it('get_product shows a disabled variant, which an administrator has to be able to find', async () => {
        const token = await adminAccessToken();
        const setEnabled = (enabled: boolean, requestId: number) =>
            postMcp(
                baseUrl(),
                'admin',
                callTool('update_variant', { id: variantId, input: { enabled } }, requestId),
                { token },
            );

        const disabled = await setEnabled(false, 1);
        expect(disabled.body.result.isError).toBeUndefined();

        const response = await postMcp(baseUrl(), 'admin', callTool('get_product', { id: productId }, 2), {
            token,
        });
        const variants = response.body.result.structuredContent.product.variants as Array<{
            id: ID;
            enabled: boolean;
        }>;
        expect(variants.find(variant => String(variant.id) === String(variantId))).toMatchObject({
            enabled: false,
        });

        // Put the variant back, so the disabled state does not leak into later tests.
        const restored = await setEnabled(true, 3);
        expect(restored.body.result.isError).toBeUndefined();
    });

    it('reads stock levels for a variant through get_stock_levels', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', callTool('get_stock_levels', { variantId }, 1), {
            token,
        });
        expect(response.body.result.isError).toBeUndefined();
        const stockLevels = response.body.result.structuredContent.stockLevels as Array<{
            stockOnHand: number;
            stockAllocated: number;
            stockLocationId: ID;
            stockLocationName: string;
        }>;
        expect(Array.isArray(stockLevels)).toBe(true);
        // The seeded variant carries stock at the default location (stockOnHand 100 in the fixture CSV),
        // so its level for that location is present and shaped as a stock-level record.
        const atLocation = stockLevels.find(
            level => String(level.stockLocationId) === String(stockLocationId),
        );
        expect(atLocation).toEqual({
            stockLocationId: expect.anything(),
            stockLocationName: expect.any(String),
            stockOnHand: expect.any(Number),
            stockAllocated: expect.any(Number),
        });
        // The raw StockLevel row is not handed back, so a caller sees only the figures and the
        // location id that adjust_stock takes.
        expect(atLocation).not.toHaveProperty('createdAt');
        expect(atLocation).not.toHaveProperty('productVariantId');
        expect(atLocation).not.toHaveProperty('stockLocation');
    });

    it('adjust_stock applies the delta to stock on hand when confirmed', async () => {
        const token = await adminAccessToken();
        const readOnHand = async () => {
            const res = await postMcp(baseUrl(), 'admin', callTool('get_stock_levels', { variantId }, 1), {
                token,
            });
            const levels = res.body.result.structuredContent.stockLevels as Array<{
                stockOnHand: number;
                stockLocationId: ID;
            }>;
            return (
                levels.find(level => String(level.stockLocationId) === String(stockLocationId))
                    ?.stockOnHand ?? 0
            );
        };

        const before = await readOnHand();
        const adjustmentsBefore = await connection
            .getRepository(adminCtx, StockAdjustment)
            .count({ where: { productVariant: { id: variantId } } });
        const delta = 7;

        const adjusted = await postMcp(
            baseUrl(),
            'admin',
            callTool('adjust_stock', { variantId, locationId: stockLocationId, delta, confirm: true }, 2),
            { token },
        );
        expect(adjusted.body.result.isError).toBeUndefined();
        const returned = adjusted.body.result.structuredContent.stockLevels as Array<{
            stockOnHand: number;
            stockAllocated: number;
            stockLocationId: ID;
            stockLocationName: string;
        }>;
        const returnedAtLocation = returned.find(
            level => String(level.stockLocationId) === String(stockLocationId),
        );
        // Both stock tools answer with the same shape, so an agent can read one and write the other
        // without reshaping anything.
        expect(returnedAtLocation).toEqual({
            stockLocationId: expect.anything(),
            stockLocationName: expect.any(String),
            stockOnHand: before + delta,
            stockAllocated: expect.any(Number),
        });
        // A fresh read confirms the change persisted, not just that the response echoed it.
        expect(await readOnHand()).toBe(before + delta);

        // The change is recorded as a stock movement, as it would be if an administrator made the same
        // adjustment in the dashboard, so it does not bypass the inventory history.
        const adjustments = await connection.getRepository(adminCtx, StockAdjustment).find({
            where: { productVariant: { id: variantId } },
            order: { id: 'ASC' },
        });
        expect(adjustments.length).toBe(adjustmentsBefore + 1);
        expect(adjustments[adjustments.length - 1]).toMatchObject({
            quantity: delta,
            stockLocationId,
        });
    });

    it('adjust_stock refuses a fractional delta', async () => {
        const token = await adminAccessToken();
        const stockLevel = () =>
            connection
                .getRepository(adminCtx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variantId, stockLocationId } });
        const before = await stockLevel();

        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool(
                'adjust_stock',
                { variantId, locationId: stockLocationId, delta: 1.5, confirm: true },
                1,
            ),
            { token },
        );

        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.content[0].text).toContain('delta');
        expect((await stockLevel()).stockOnHand).toBe(before.stockOnHand);
    });

    it('adjust_stock refuses a variant that is not in the active channel', async () => {
        const token = await adminAccessToken();
        // The seeded variant belongs to the default channel only, so once this grant is switched to the
        // second channel the variant is out of scope for it.
        const switched = await postMcp(
            baseUrl(),
            'admin',
            callTool('set_active_channel', { channelToken: secondChannelToken }, 1),
            { token },
        );
        expect(switched.body.result.isError).toBeUndefined();

        const stockLevel = () =>
            connection
                .getRepository(adminCtx, StockLevel)
                .findOneOrFail({ where: { productVariantId: variantId, stockLocationId } });
        const before = await stockLevel();

        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool('adjust_stock', { variantId, locationId: stockLocationId, delta: 5, confirm: true }, 2),
            { token },
        );

        expect(response.body.result.isError).toBe(true);
        expect((await stockLevel()).stockOnHand).toBe(before.stockOnHand);
    });

    it('refund_order defaults to the first Settled payment and refunds its full remainder', async () => {
        const token = await adminAccessToken();
        const { orderId, paymentId } = await createSettledOrder();
        const paymentBefore = await connection
            .getRepository(adminCtx, Payment)
            .findOneOrFail({ where: { id: paymentId } });

        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool('refund_order', { id: orderId, confirm: true }, 1),
            { token },
        );

        expect(response.body.result.isError).toBeUndefined();
        expect(response.body.result.structuredContent.refund).toMatchObject({
            total: paymentBefore.amount,
        });
        // A DB-level check that the payment was actually refunded, not just that the response echoed it.
        const paymentAfter = await connection
            .getRepository(adminCtx, Payment)
            .findOneOrFail({ where: { id: paymentId }, relations: ['refunds'] });
        expect(paymentAfter.refunds.reduce((sum, r) => sum + r.total, 0)).toBe(paymentBefore.amount);
    });

    it('refund_order defaults to the remaining refundable amount, not the order total, after a partial refund', async () => {
        const token = await adminAccessToken();
        const { orderId, paymentId } = await createSettledOrder();
        const paymentBefore = await connection
            .getRepository(adminCtx, Payment)
            .findOneOrFail({ where: { id: paymentId } });
        const partialAmount = Math.floor(paymentBefore.amount / 2);

        const partial = await postMcp(
            baseUrl(),
            'admin',
            callTool('refund_order', { id: orderId, paymentId, amount: partialAmount, confirm: true }, 1),
            { token },
        );
        expect(partial.body.result.isError).toBeUndefined();
        expect(partial.body.result.structuredContent.refund).toMatchObject({ total: partialAmount });

        // Calling again with only the order id must default to the REMAINDER. Before the fix, the
        // default fell back to the order total, which now exceeds what's left on the payment, so
        // core would reject the call instead of refunding the rest.
        const remainder = await postMcp(
            baseUrl(),
            'admin',
            callTool('refund_order', { id: orderId, confirm: true }, 2),
            { token },
        );
        expect(remainder.body.result.isError).toBeUndefined();
        expect(remainder.body.result.structuredContent.refund).toMatchObject({
            total: paymentBefore.amount - partialAmount,
        });

        const paymentAfter = await connection
            .getRepository(adminCtx, Payment)
            .findOneOrFail({ where: { id: paymentId }, relations: ['refunds'] });
        expect(paymentAfter.refunds.reduce((sum, r) => sum + r.total, 0)).toBe(paymentBefore.amount);
    });

    it('refund_order returns RefundPaymentIdMissingError with errorCode when no payment is refundable', async () => {
        const token = await adminAccessToken();
        const { orderId } = await createSettledOrder();

        await postMcp(baseUrl(), 'admin', callTool('refund_order', { id: orderId, confirm: true }, 1), {
            token,
        });

        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool('refund_order', { id: orderId, confirm: true }, 2),
            { token },
        );
        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.structuredContent).toMatchObject({
            __typename: 'RefundPaymentIdMissingError',
            errorCode: 'REFUND_PAYMENT_ID_MISSING_ERROR',
        });
    });

    it('refund_order rejects a paymentId that belongs to a different order and leaves that order untouched', async () => {
        const token = await adminAccessToken();
        const orderA = await createSettledOrder();
        const orderB = await createSettledOrder();
        const orderBPaymentBefore = await connection
            .getRepository(adminCtx, Payment)
            .findOneOrFail({ where: { id: orderB.paymentId }, relations: ['refunds'] });
        expect(orderBPaymentBefore.refunds).toHaveLength(0);

        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool(
                'refund_order',
                { id: orderA.orderId, paymentId: orderB.paymentId, amount: 100, confirm: true },
                1,
            ),
            { token },
        );

        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.structuredContent).toMatchObject({
            __typename: 'RefundPaymentIdMissingError',
            errorCode: 'REFUND_PAYMENT_ID_MISSING_ERROR',
            message: 'The requested payment was not found on this order.',
        });

        // Order B's payment must be exactly as it was: the wrong order was never touched.
        const orderBPaymentAfter = await connection
            .getRepository(adminCtx, Payment)
            .findOneOrFail({ where: { id: orderB.paymentId }, relations: ['refunds'] });
        expect(orderBPaymentAfter.refunds).toHaveLength(0);
    });

    it('refund_order returns RefundPaymentIdMissingError when the paymentId exists on no order', async () => {
        const token = await adminAccessToken();
        const { orderId } = await createSettledOrder();

        const response = await postMcp(
            baseUrl(),
            'admin',
            callTool('refund_order', { id: orderId, paymentId: 999999, amount: 100, confirm: true }, 1),
            { token },
        );

        expect(response.body.result.isError).toBe(true);
        expect(response.body.result.structuredContent).toMatchObject({
            __typename: 'RefundPaymentIdMissingError',
            errorCode: 'REFUND_PAYMENT_ID_MISSING_ERROR',
            message: 'The requested payment was not found on this order.',
        });
    });

    describe('catalog, customer and order writes', () => {
        let assetIds: ID[];
        let customerGroupId: ID;
        let emptyProductId: ID;
        let secondCustomerEmail: string;
        let seededCustomerId: ID;

        beforeAll(async () => {
            const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;

            // The shared test data ships no assets, so `update_product` has nothing to
            // attach until two exist. They are created through AssetService rather than through
            // `upload_asset`, so that test does not depend on the tool it sits next to.
            const assetService = server.app.get(AssetService);
            assetIds = [];
            for (const name of ['mcp-asset-a.png', 'mcp-asset-b.png']) {
                const created = await assetService.createFromFileStream(
                    Readable.from(PIXEL_PNG),
                    name,
                    adminCtx,
                );
                // createFromFileStream answers either the Asset or a MimeTypeError.
                if (!('id' in created)) {
                    throw new Error(`Could not create asset fixture: ${JSON.stringify(created)}`);
                }
                assetIds.push(created.id);
            }

            const customers = await adminClient.query(gql`
                query AdminWriteToolCustomer {
                    customers(options: { take: 1 }) {
                        items {
                            id
                        }
                    }
                }
            `);
            const seededCustomerGraphqlId = customers.customers.items[0]?.id;
            if (!seededCustomerGraphqlId) {
                throw new Error('Expected at least one seeded customer');
            }
            seededCustomerId = idStrategy.decodeId(seededCustomerGraphqlId);

            // A second customer of this describe's own, so the email-conflict case below has an
            // address that genuinely belongs to someone else and does not depend on which other
            // tests in this file have run.
            secondCustomerEmail = `conflict-target-${Math.random().toString(36).slice(2)}@example.test`;
            await adminClient.query(
                gql`
                    mutation CreateConflictTargetCustomer($input: CreateCustomerInput!) {
                        createCustomer(input: $input) {
                            __typename
                            ... on Customer {
                                id
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
                        firstName: 'Conflict',
                        lastName: 'Target',
                        emailAddress: secondCustomerEmail,
                    },
                },
            );

            const group = await adminClient.query(
                gql`
                    mutation CreateMcpCustomerGroup($input: CreateCustomerGroupInput!) {
                        createCustomerGroup(input: $input) {
                            id
                        }
                    }
                `,
                { input: { name: 'MCP tool group', customerIds: [] } },
            );
            customerGroupId = idStrategy.decodeId(group.createCustomerGroup.id);

            // A product with no variants yet. `create_variant` cannot be tested against the seeded
            // product: that product already has a variant with no options, and a second variant with
            // no options would be a duplicate option combination, which Vendure refuses.
            const emptyProduct = await adminClient.query(
                gql`
                    mutation CreateEmptyProductForVariantTool($input: CreateProductInput!) {
                        createProduct(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        enabled: true,
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'MCP Variant Host',
                                slug: `mcp-variant-host-${Math.random().toString(36).slice(2, 8)}`,
                                description: '',
                            },
                        ],
                    },
                },
            );
            emptyProductId = idStrategy.decodeId(emptyProduct.createProduct.id);
        }, TEST_SETUP_TIMEOUT_MS);

        it('list_products pages through the catalog', async () => {
            const token = await adminAccessToken();

            // The catalog size is read from an unpaged call rather than hardcoded: other tests in
            // this file create products, so a fixed number would break as they are added.
            const all = await postMcp(baseUrl(), 'admin', callTool('list_products', {}, 1), { token });
            expect(all.body.result.isError).toBeUndefined();
            const catalog = all.body.result.structuredContent as {
                items: Array<{ id: ID; name: string }>;
                total: number;
                hasMore: boolean;
            };
            expect(catalog.total).toBeGreaterThan(1);
            expect(catalog.items).toHaveLength(catalog.total);
            expect(catalog.hasMore).toBe(false);

            const first = await postMcp(baseUrl(), 'admin', callTool('list_products', { limit: 1 }, 2), {
                token,
            });
            const firstPage = first.body.result.structuredContent as {
                items: Array<{ id: ID; name: string }>;
                total: number;
                hasMore: boolean;
            };
            expect(firstPage.items).toHaveLength(1);
            expect(firstPage.total).toBe(catalog.total);
            expect(firstPage.hasMore).toBe(true);

            const last = await postMcp(
                baseUrl(),
                'admin',
                callTool('list_products', { limit: 1, offset: catalog.total - 1 }, 3),
                { token },
            );
            const lastPage = last.body.result.structuredContent as {
                items: Array<{ id: ID; name: string }>;
                hasMore: boolean;
            };
            expect(lastPage.items[0].id).not.toBe(firstPage.items[0].id);
            expect(lastPage.hasMore).toBe(false);
        });

        it('update_customer changes the stored customer, and reports an email conflict as customer: null', async () => {
            const token = await adminAccessToken();

            const updated = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'update_customer',
                    { id: seededCustomerId, input: { firstName: 'Renamed', phoneNumber: '555-0100' } },
                    1,
                ),
                { token },
            );

            expect(updated.body.result.isError).toBeUndefined();
            expect(updated.body.result.structuredContent.customer).toMatchObject({
                firstName: 'Renamed',
                phoneNumber: '555-0100',
            });
            const stored = await connection
                .getRepository(adminCtx, Customer)
                .findOneByOrFail({ id: seededCustomerId });
            expect(stored.firstName).toBe('Renamed');

            // Moving this customer onto another customer's email address returns a typed Vendure
            // error result. The customer tools map that to `customer: null` rather than passing the
            // error object back, which is the opposite of what the order tools do with theirs — so
            // this pins the shape a model actually receives on a conflict.
            const conflict = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'update_customer',
                    { id: seededCustomerId, input: { emailAddress: secondCustomerEmail } },
                    2,
                ),
                { token },
            );
            expect(conflict.body.result.isError).toBeUndefined();
            expect(conflict.body.result.structuredContent).toEqual({ customer: null });
            const afterConflict = await connection
                .getRepository(adminCtx, Customer)
                .findOneByOrFail({ id: seededCustomerId });
            expect(afterConflict.emailAddress).not.toBe(secondCustomerEmail);
        });

        it('update_product writes the new name and enabled state', async () => {
            const token = await adminAccessToken();

            const updated = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'update_product',
                    {
                        id: productId,
                        input: {
                            enabled: false,
                            translations: [{ languageCode: 'en', name: 'Renamed Test Product' }],
                        },
                    },
                    1,
                ),
                { token },
            );

            expect(updated.body.result.isError).toBeUndefined();
            expect(updated.body.result.structuredContent.product).toMatchObject({
                name: 'Renamed Test Product',
            });

            // Read back through a second tool call, so this proves a write rather than an echo.
            const read = await postMcp(baseUrl(), 'admin', callTool('get_product', { id: productId }, 2), {
                token,
            });
            expect(read.body.result.structuredContent.product.name).toBe('Renamed Test Product');

            // Put the product back, so the disabled state does not leak into later tests.
            await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'update_product',
                    {
                        id: productId,
                        input: {
                            enabled: true,
                            translations: [{ languageCode: 'en', name: 'Test Product' }],
                        },
                    },
                    3,
                ),
                { token },
            );
        });

        it('update_variant writes the new price and SKU', async () => {
            const token = await adminAccessToken();

            const updated = await postMcp(
                baseUrl(),
                'admin',
                callTool('update_variant', { id: variantId, input: { price: 4242, sku: 'MCP-SKU-1' } }, 1),
                { token },
            );

            expect(updated.body.result.isError).toBeUndefined();
            const variants = updated.body.result.structuredContent.variants as Array<{
                id: ID;
                sku: string;
                price: number;
            }>;
            // The tool takes one id and calls the plural service method, so the result is a
            // one-element array rather than a single variant.
            expect(variants).toHaveLength(1);
            expect(variants[0]).toMatchObject({ sku: 'MCP-SKU-1', price: 4242 });

            const stored = await connection
                .getRepository(adminCtx, ProductVariant)
                .findOneByOrFail({ id: variantId });
            expect(stored.sku).toBe('MCP-SKU-1');
        });

        it('update_variant refuses an oversized stockOnHand value', async () => {
            const token = await adminAccessToken();

            const oversized = await postMcp(
                baseUrl(),
                'admin',
                callTool('update_variant', { id: variantId, input: { stockOnHand: 2147483648 } }, 1),
                { token },
            );

            expect(oversized.body.result.isError).toBe(true);
            expect(oversized.body.result.content[0].text).toContain('stockOnHand');
        });

        it('create_variant adds a variant to an existing product', async () => {
            const token = await adminAccessToken();
            const sku = `MCP-NEW-${Math.random().toString(36).slice(2, 8)}`;

            const created = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'create_variant',
                    {
                        productId: emptyProductId,
                        input: {
                            sku,
                            price: 1999,
                            stockOnHand: 7,
                            translations: [{ languageCode: 'en', name: 'MCP Extra Variant' }],
                        },
                    },
                    1,
                ),
                { token },
            );

            expect(created.body.result.isError).toBeUndefined();
            const variants = created.body.result.structuredContent.variants as Array<{
                id: ID;
                sku: string;
                name: string;
            }>;
            expect(variants[0]).toMatchObject({ sku, name: 'MCP Extra Variant' });

            const stored = await connection
                .getRepository(adminCtx, ProductVariant)
                .findOneOrFail({ where: { sku }, relations: ['product'] });
            expect(String(stored.product.id)).toBe(String(emptyProductId));
        });

        it('update_product sets the asset list and the featured asset', async () => {
            const token = await adminAccessToken();

            const updated = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'update_product',
                    { id: productId, input: { assetIds, featuredAssetId: assetIds[1] } },
                    1,
                ),
                { token },
            );

            expect(updated.body.result.isError).toBeUndefined();
            const stored = await connection
                .getRepository(adminCtx, Product)
                .findOneOrFail({ where: { id: productId }, relations: ['assets', 'featuredAsset'] });
            expect(stored.assets.map(entry => String(entry.assetId)).sort()).toEqual(
                assetIds.map(String).sort(),
            );
            expect(String(stored.featuredAsset.id)).toBe(String(assetIds[1]));
        });

        it('add_note_to_order writes a history entry against the order', async () => {
            const token = await adminAccessToken();
            const order = await createDraftOrder();

            const noted = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'add_note_to_order',
                    { id: order.id, note: 'Called the customer', isPublic: true },
                    1,
                ),
                { token },
            );

            expect(noted.body.result.isError).toBeUndefined();
            expect(noted.body.result.structuredContent.order.id).toBeDefined();
            const stored = await adminClient.query(
                gql`
                    query McpOrderNotes($id: ID!, $type: String!) {
                        order(id: $id) {
                            history(options: { filter: { type: { eq: $type } } }) {
                                items {
                                    type
                                    isPublic
                                    data
                                }
                            }
                        }
                    }
                `,
                { id: order.graphqlId, type: 'ORDER_NOTE' },
            );
            const notes = stored.order.history.items as Array<{
                isPublic: boolean;
                data: { note?: string };
            }>;
            expect(notes).toHaveLength(1);
            expect(notes[0].data.note).toBe('Called the customer');
            // isPublic reaches the stored entry — it decides whether the shopper can read the note.
            expect(notes[0].isPublic).toBe(true);
        });

        it('add_customer_to_group puts the customer in the group', async () => {
            const token = await adminAccessToken();

            const added = await postMcp(
                baseUrl(),
                'admin',
                callTool(
                    'add_customer_to_group',
                    { customerId: seededCustomerId, groupId: customerGroupId },
                    1,
                ),
                { token },
            );

            expect(added.body.result.isError).toBeUndefined();
            const members = await adminClient.query(
                gql`
                    query McpGroupMembers($id: ID!) {
                        customerGroup(id: $id) {
                            customers {
                                items {
                                    id
                                }
                            }
                        }
                    }
                `,
                { id: customerGroupId },
            );
            const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
            const memberIds = (members.customerGroup.customers.items as Array<{ id: string }>).map(customer =>
                String(idStrategy.decodeId(customer.id)),
            );
            expect(memberIds).toContain(String(seededCustomerId));
        });

        it('list_customer_groups returns the group id add_customer_to_group needs', async () => {
            const token = await adminAccessToken();

            const listed = await postMcp(baseUrl(), 'admin', callTool('list_customer_groups', {}, 1), {
                token,
            });

            expect(listed.body.result.isError).toBeUndefined();
            const result = listed.body.result.structuredContent as {
                items: Array<{ id: ID; name: string }>;
                total: number;
            };
            expect(result.total).toBeGreaterThanOrEqual(1);
            expect(result.items.find(group => String(group.id) === String(customerGroupId))).toMatchObject({
                name: 'MCP tool group',
            });
        });

        it('update_order_state gates the transition behind confirm, then performs it', async () => {
            const token = await adminAccessToken();
            const order = await createDraftOrder();

            const preview = await postMcp(
                baseUrl(),
                'admin',
                callTool('update_order_state', { id: order.id, state: 'Cancelled' }, 1),
                { token },
            );
            expect(preview.body.result.isError).toBeUndefined();
            expect(preview.body.result.structuredContent).toMatchObject({
                status: 'confirmation_required',
                confirmed: false,
            });
            expect(await orderState(order.graphqlId)).toBe('Draft');

            const confirmed = await postMcp(
                baseUrl(),
                'admin',
                callTool('update_order_state', { id: order.id, state: 'Cancelled', confirm: true }, 2),
                { token },
            );
            expect(confirmed.body.result.isError).toBeUndefined();
            expect(confirmed.body.result.structuredContent.order.state).toBe('Cancelled');
            expect(await orderState(order.graphqlId)).toBe('Cancelled');
        });

        it('update_order_state hands back the transition error for a state the order cannot reach', async () => {
            const token = await adminAccessToken();
            const order = await createDraftOrder();

            const refused = await postMcp(
                baseUrl(),
                'admin',
                callTool('update_order_state', { id: order.id, state: 'Shipped', confirm: true }, 1),
                { token },
            );

            // The state machine's refusal is a Vendure error result, so the call is reported as failed and
            // the model reads Vendure's own error code instead of a generic tool failure.
            expect(refused.body.result.isError).toBe(true);
            expect(refused.body.result.structuredContent.order).toBeUndefined();
            expect(refused.body.result.structuredContent).toMatchObject({
                __typename: 'OrderStateTransitionError',
                errorCode: 'ORDER_STATE_TRANSITION_ERROR',
            });
            expect(await orderState(order.graphqlId)).toBe('Draft');
        });

        describe('upload_asset', () => {
            let fileServer: Awaited<ReturnType<typeof startAssetFileServer>>;

            beforeAll(async () => {
                fileServer = await startAssetFileServer();
            });

            afterAll(async () => {
                await fileServer.close();
            });

            const assetRepo = () => connection.getRepository(adminCtx, Asset);

            /** Calls the tool over HTTP the way an MCP client does, with a fresh admin grant. */
            async function callUploadAsset(args: Record<string, unknown>, consentToken?: string) {
                const token = await adminAccessToken(consentToken ?? superAdminToken);
                return postMcp(baseUrl(), 'admin', callTool('upload_asset', args, 1), { token });
            }

            it('stores the asset and answers with the stored asset, not the entity', async () => {
                const fetchesBefore = fileServer.requestCount('/pixel.png');
                const countBefore = await assetRepo().count();

                const response = await callUploadAsset({ url: `${fileServer.baseUrl}/pixel.png` });

                expect(response.body.result.isError).toBeUndefined();
                const asset = response.body.result.structuredContent.asset;
                // The fields McpToolSerializerService picks, and nothing else. The Asset entity
                // itself cannot be sent: it carries `translations`, each translation points back
                // at an Asset, and JSON.stringify refuses that loop.
                expect(Object.keys(asset).sort()).toEqual([
                    'fileSize',
                    'focalPoint',
                    'height',
                    'id',
                    'mimeType',
                    'name',
                    'preview',
                    'source',
                    'type',
                    'width',
                ]);
                expect(asset).toMatchObject({ name: 'pixel.png', mimeType: 'image/png', type: 'IMAGE' });
                expect(asset.source).toContain('pixel');
                expect(asset.preview).toContain('pixel');
                // `width`, `height` and `fileSize` go unasserted on purpose: the testing asset
                // storage strategy answers every read with a fixed 48x48 placeholder, so those
                // three describe the placeholder rather than the uploaded file.

                expect(fileServer.requestCount('/pixel.png')).toBe(fetchesBefore + 1);
                expect(await assetRepo().count()).toBe(countBefore + 1);
                const [newest] = await assetRepo().find({ order: { id: 'DESC' }, take: 1 });
                expect(newest.source).toBe(asset.source);
            });

            it('names the asset from the URL path and drops the query string', async () => {
                const response = await callUploadAsset({ url: `${fileServer.baseUrl}/pixel.png?v=2` });

                expect(response.body.result.isError).toBeUndefined();
                expect(response.body.result.structuredContent.asset.name).toBe('pixel.png');
            });

            it('stores a separate asset each time, with no reuse of an identical URL', async () => {
                const first = await callUploadAsset({ url: `${fileServer.baseUrl}/pixel.png` });
                const second = await callUploadAsset({ url: `${fileServer.baseUrl}/pixel.png` });

                expect(second.body.result.structuredContent.asset.id).not.toBe(
                    first.body.result.structuredContent.asset.id,
                );
            });

            it('refuses a file type the store does not permit, and stores nothing', async () => {
                const countBefore = await assetRepo().count();

                const response = await callUploadAsset({ url: `${fileServer.baseUrl}/notes.txt` });

                expect(response.body.result.isError).toBe(true);
                expect(response.body.result.content[0].text).toBe(
                    'Unsupported asset file type for "notes.txt": text/plain',
                );
                expect(await assetRepo().count()).toBe(countBefore);
            });

            it('accepts bytes it cannot identify when the file extension is permitted', async () => {
                // Core weighs three signals: the declared content type, the file extension, and
                // the leading bytes. Bytes it cannot identify pass as long as the extension is
                // permitted, which core made deliberate in 037056aa1 so that SVG uploads work.
                // So this tool does not promise the stored file is really an image.
                const response = await callUploadAsset({ url: `${fileServer.baseUrl}/not-really.png` });

                expect(response.body.result.isError).toBeUndefined();
                expect(response.body.result.structuredContent.asset).toMatchObject({
                    name: 'not-really.png',
                    mimeType: 'image/png',
                });
            });

            it('answers a source URL that 404s with the generic failure, and stores nothing', async () => {
                // OPEN QUESTION, pinned rather than fixed. Core's asset import strategy does not
                // look at the HTTP status, so the 404 body flows on and something downstream
                // throws "no elements in sequence". That error is not caller-safe, so the caller
                // gets the generic text and no idea the URL was wrong. Whether this tool should
                // answer a broken URL with a readable reason is a separate decision.
                const countBefore = await assetRepo().count();

                const response = await callUploadAsset({ url: `${fileServer.baseUrl}/gone.png` });

                expect(response.body.result.isError).toBe(true);
                expect(response.body.result.content[0].text).toBe('The tool failed unexpectedly');
                expect(await assetRepo().count()).toBe(countBefore);
            });

            it('refuses a URL that is not http or https, and stores nothing', async () => {
                const countBefore = await assetRepo().count();

                const response = await callUploadAsset({ url: 'file:///etc/passwd' });

                // A UserInputError is caller-safe, so its own message comes back rather than the
                // generic internal-failure text.
                expect(response.body.result.isError).toBe(true);
                expect(response.body.result.content[0].text).toContain(
                    'Unsupported asset URL scheme (only http and https URLs are allowed)',
                );
                expect(await assetRepo().count()).toBe(countBefore);
            });

            it('refuses an empty URL with the same scheme message', async () => {
                const response = await callUploadAsset({ url: '' });

                expect(response.body.result.isError).toBe(true);
                expect(response.body.result.content[0].text).toContain('Unsupported asset URL scheme');
            });

            it('refuses a missing url, and refuses an argument the schema does not declare', async () => {
                const missing = await callUploadAsset({});
                expect(missing.body.result.isError).toBe(true);
                expect(missing.body.result.content[0].text).toContain('expected string, received undefined');

                const unknown = await callUploadAsset({
                    url: `${fileServer.baseUrl}/pixel.png`,
                    tags: ['x'],
                });
                expect(unknown.body.result.isError).toBe(true);
                expect(unknown.body.result.content[0].text).toContain('Unrecognized key: "tags"');
            });

            it('is not callable by an administrator without CreateAsset, and stores nothing', async () => {
                // Direct mode leaves an unpermitted tool out of the exposed set, so the SDK
                // rejects the call as an unknown tool before the registry sees it: a top-level
                // JSON-RPC error and no tool result. The registry's own permission check is a
                // separate path, covered for every tool by the tests above.
                const countBefore = await assetRepo().count();

                const response = await callUploadAsset(
                    { url: `${fileServer.baseUrl}/pixel.png` },
                    limitedAdminToken,
                );

                expect(response.body.error).toBeDefined();
                expect(response.body.result).toBeUndefined();
                expect(await assetRepo().count()).toBe(countBefore);
            });
        });
    });
});

describe('MCP built-in admin tools (discovery mode)', () => {
    const options: McpPluginOptions = {
        toolExposure: 'discovery',
        oauth: { tokenSecret: TOKEN_SECRET },
        rateLimits: { oauthIp: false },
    };
    const config = mergeConfig(testConfig(), { plugins: [McpPlugin.init(options)] });
    const { server, adminClient } = createTestEnvironment(config);
    const baseUrl = () => `http://localhost:${config.apiOptions.port}`;

    let superAdminToken: string;
    let limitedAdminToken: string;

    beforeAll(async () => {
        McpPlugin.init(options);
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();
        superAdminToken = adminClient.getAuthToken();
        const { activeChannel } = await adminClient.query(gql`
            query {
                activeChannel {
                    id
                }
            }
        `);
        limitedAdminToken = await provisionLimitedAdmin(
            adminClient,
            activeChannel.id,
            `${baseUrl()}/${config.apiOptions.adminApiPath ?? 'admin-api'}`,
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function adminAccessToken(): Promise<string> {
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken,
        });
        return flow.access_token;
    }

    async function createDraftOrder(): Promise<ID> {
        const result = await adminClient.query(gql`
            mutation {
                createDraftOrder {
                    id
                }
            }
        `);
        const idStrategy = server.app.get(ConfigService).entityOptions.entityIdStrategy;
        return idStrategy.decodeId(result.createDraftOrder.id);
    }

    it('exposes exactly the two discovery meta-tools (single execute_tool)', async () => {
        const token = await adminAccessToken();
        const response = await postMcp(baseUrl(), 'admin', rpc('tools/list', {}, 1), { token });
        expect(response.body.result.tools.map((tool: { name: string }) => tool.name).sort()).toEqual([
            'execute_tool',
            'search_tools',
        ]);
    });

    it('gates a destructive tool via execute_tool, then runs it with confirm:true', async () => {
        const token = await adminAccessToken();
        const orderId = await createDraftOrder();

        const preview = await postMcp(
            baseUrl(),
            'admin',
            callTool('execute_tool', { name: 'cancel_order', arguments: { id: orderId } }, 1),
            { token },
        );
        expect(preview.body.result.isError).toBeUndefined();
        expect(preview.body.result.structuredContent).toMatchObject({ status: 'confirmation_required' });

        const confirmed = await postMcp(
            baseUrl(),
            'admin',
            callTool('execute_tool', { name: 'cancel_order', arguments: { id: orderId, confirm: true } }, 2),
            { token },
        );
        expect(confirmed.body.result.isError).toBe(true);
        // Through the discovery funnel too, confirm:true reaches the real cancelOrder: an empty draft
        // has no lines to cancel, so the concrete EmptyOrderLineSelectionError union comes back — not
        // the confirmation gate.
        expect(confirmed.body.result.structuredContent).toMatchObject({
            __typename: 'EmptyOrderLineSelectionError',
            errorCode: 'EMPTY_ORDER_LINE_SELECTION_ERROR',
        });
    });

    // search_tools is the only way an agent finds anything in discovery mode, which is the mode for
    // hosts with a small tool cap. If it ignored permissions it would advertise tools every call
    // would then refuse. Direct mode's equivalent assertion is
    // 'filters tools a caller lacks permission for and rejects them at call time' above.
    it('search_tools omits the tools the calling administrator has no permission for', async () => {
        const superAdminSearch = await postMcp(
            baseUrl(),
            'admin',
            callTool('search_tools', { query: 'customers orders', limit: 50 }, 1),
            { token: await adminAccessToken() },
        );
        const superAdminNames = (
            superAdminSearch.body.result.structuredContent.tools as Array<{ name: string }>
        ).map(tool => tool.name);
        // The comparison is what makes this test mean something: the same query must reach both
        // tools for a superadmin, or the limited administrator's missing result proves nothing.
        expect(superAdminNames).toContain('list_customers');
        expect(superAdminNames).toContain('list_orders');

        const limitedFlow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: limitedAdminToken,
        });
        const limitedSearch = await postMcp(
            baseUrl(),
            'admin',
            callTool('search_tools', { query: 'customers orders', limit: 50 }, 2),
            { token: limitedFlow.access_token },
        );
        expect(limitedSearch.body.result.isError).toBeUndefined();
        const limitedNames = (
            limitedSearch.body.result.structuredContent.tools as Array<{ name: string }>
        ).map(tool => tool.name);
        // ReadCustomer is held, ReadOrder is not.
        expect(limitedNames).toContain('list_customers');
        expect(limitedNames).not.toContain('list_orders');
    });

    it('rejects an unpermitted tool at call time through the execute_tool funnel (defense-in-depth)', async () => {
        // The single execute_tool meta-tool routes every call through the registry funnel, which
        // re-checks permissions even for tools the caller was never shown — so a ReadCustomer-only
        // grant is denied list_orders with an isError result, not silently allowed.
        const flow = await runAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            superAdminToken: limitedAdminToken,
        });
        const denied = await postMcp(
            baseUrl(),
            'admin',
            callTool('execute_tool', { name: 'list_orders', arguments: {} }, 1),
            { token: flow.access_token },
        );
        expect(denied.body.result.isError).toBe(true);
        expect(denied.body.result.content[0].text).toMatch(/permission/i);
    });
});
