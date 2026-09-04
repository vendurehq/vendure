import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ActiveOrderService,
    ChannelService,
    ConfigService,
    Customer,
    CustomerService,
    defaultShippingEligibilityChecker,
    ID,
    mergeConfig,
    Order,
    OrderByCodeAccessStrategy,
    OrderService,
    PaymentMethod,
    PaymentMethodHandler,
    RequestContext,
    RequestContextService,
    Session,
    SessionService,
    ShippingEligibilityChecker,
    ShippingMethod,
    TransactionalConnection,
    User,
} from '@vendure/core';
import { McpTool, McpToolMetadata } from '@vendure/mcp-sdk';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { awaitRunningJobs } from '../../core/e2e/utils/await-running-jobs';
import { McpOauthGrant } from '../src/entities/mcp-oauth-grant.entity';
import { McpToolCallLog } from '../src/entities/mcp-tool-call-log.entity';
import { McpOauthService } from '../src/oauth/oauth.service';
import { deriveHashKey, hashLookupToken } from '../src/oauth/token-hash';
import { McpPlugin } from '../src/plugin';
import { McpToolExecutionService } from '../src/registry/mcp-tool-execution.service';
import { shopToolProviders } from '../src/tools/built-in/shop';

import { callTool, postMcp, rpc } from './utils/mcp-http-client';
import { runAuthorizationCodeFlow, runShopAuthorizationCodeFlow } from './utils/oauth-test-client';
import { getIdStrategy, testServerInit } from './utils/test-server';

const TOKEN_SECRET = 'shop-tools-secret-000000000000000000000';
const ISSUER = `http://localhost:${testConfig().apiOptions.port}`;
const AUTH_TOKEN_HEADER = 'vendure-auth-token';
const CHANNEL_TOKEN_HEADER = 'vendure-token';

/**
 * The fixture prices the shirt's Small, Medium and Large sizes at 500.00, 600.00 and 700.00 net,
 * and the channel's tax zone adds 20%, so these are the shirt's `priceRange` values with all
 * three sizes counted, and with the Large size left out.
 */
const SHIRT_SMALL_TO_LARGE = { min: 60000, minDecimal: '600.00', max: 84000, maxDecimal: '840.00' };
const SHIRT_SMALL_TO_MEDIUM = { min: 60000, minDecimal: '600.00', max: 72000, maxDecimal: '720.00' };

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
const NO_SHIPPING_CUSTOMER_EMAIL = 'mcp-no-shipping@e2e.example.com';
const NO_SHIPPING_CUSTOMER_PASSWORD = 'test';
// The buyer of the guest checkout below. No customer with this address exists until that test
// names it, which is what makes the order a guest order.
const GUEST_CHECKOUT_EMAIL = 'mcp-guest-checkout@e2e.example.com';

class TestOrderByCodeAccessStrategy implements OrderByCodeAccessStrategy {
    allow = true;

    canAccessOrder(_ctx: RequestContext, _order: Order): boolean {
        return this.allow;
    }
}

// Eligible only for a US shipping address. The set_checkout_details tests use it to show what
// core does when a new address makes the chosen shipping method ineligible.
const US_ONLY_SHIPPING_METHOD_CODE = 'mcp-e2e-us-only';
/** The address the two Address custom field tests send, so only the custom fields differ. */
const CUSTOM_FIELD_ADDRESS = {
    streetLine1: '1 Custom Field Way',
    city: 'Portland',
    postalCode: '97201',
    countryCode: 'US',
};

const UK_ADDRESS = {
    streetLine1: '10 Downing Street',
    city: 'London',
    postalCode: 'SW1A 2AA',
    countryCode: 'GB',
};
/** One custom field a shopper may see and two that must never leave the Admin API. */
const QUOTE_CUSTOM_FIELDS = [
    { name: 'quoteNote', type: 'string' as const },
    { name: 'internalCode', type: 'string' as const, internal: true },
    { name: 'adminNote', type: 'string' as const, public: false },
];

const usOnlyShippingChecker = new ShippingEligibilityChecker({
    code: US_ONLY_SHIPPING_METHOD_CODE,
    description: [{ languageCode: LanguageCode.en, value: 'US addresses only' }],
    args: {},
    check: (ctx, order) => order.shippingAddress?.countryCode === 'US',
});

describe('MCP built-in shop tools', () => {
    const orderByCodeAccessStrategy = new TestOrderByCodeAccessStrategy();
    const config = mergeConfig(testConfig(), {
        // Three Address custom fields: one a shopper may write, one internal, one admin-only.
        // The same three shapes on ShippingMethod and PaymentMethod, so the quote tools can show
        // that only the plain one reaches a shopper.
        customFields: {
            Address: [
                { name: 'deliveryNote', type: 'string' },
                { name: 'internalRef', type: 'string', internal: true },
                { name: 'riskScore', type: 'int', public: false },
            ],
            ShippingMethod: QUOTE_CUSTOM_FIELDS,
            PaymentMethod: QUOTE_CUSTOM_FIELDS,
        },
        orderOptions: { orderByCodeAccessStrategy },
        shippingOptions: {
            shippingEligibilityCheckers: [defaultShippingEligibilityChecker, usOnlyShippingChecker],
        },
        paymentOptions: { paymentMethodHandlers: [testPaymentHandler, pendingPaymentHandler] },
        plugins: [
            McpPlugin.init({
                oauth: {
                    tokenSecret: TOKEN_SECRET,
                    storefrontConsentUrl: 'https://storefront.example.com/mcp/authorize',
                },
                // This suite makes more than 60 anonymous calls in well under a minute. Both
                // default limits an anonymous caller charges (per session and per IP, 60 a minute
                // each) would start refusing part way through, and so would place_order's own
                // limit of 5 a minute once several checkout tests run together.
                // mcp-transport.e2e-spec.ts is where those limits are tested; an rpm of 0 turns a
                // bucket off.
                rateLimits: {
                    perSession: { rpm: 0 },
                    anonymousIp: false,
                    perTool: { place_order: { rpm: 0 } },
                },
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
    let variantName: string;
    let variantSku: string;
    let variantAdminId: string;
    let defaultChannelAdminId: string;
    let defaultCurrencyCode: CurrencyCode;
    let secondVariantId: ID;
    let secondVariantAdminId: string;
    let shirtId: ID;
    let shirtVariantCount: number;
    let shirtVariants: Array<{ id: string; sku: string }>;
    let shirtCollectionId: ID;
    let shirtCollectionSlug: string;
    let publicCollectionId: ID;
    let publicCollectionSlug: string;
    let privateCollectionId: ID;
    let privateCollectionSlug: string;
    let secondChannelId: string;
    let secondChannelDbId: ID;
    let secondChannelToken: string;
    let usOnlyShippingMethodId: string;
    // Language, currency and zones every channel this suite creates shares with the default one.
    let channelInputDefaults: Record<string, unknown>;

    beforeAll(async () => {
        await server.init(testServerInit);
        await adminClient.asSuperAdmin();

        connection = server.app.get(TransactionalConnection);
        adminCtx = await server.app.get(RequestContextService).create({ apiType: 'admin' });
        const idStrategy = getIdStrategy(server.app.get(ConfigService));

        const fixture = await adminClient.query(gql`
            query ShopToolFixture {
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
                        slug
                        variants {
                            id
                            name
                            sku
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
        variantAdminId = product.variants[0].id;
        variantName = product.variants[0].name;
        variantSku = product.variants[0].sku;
        defaultChannelAdminId = fixture.activeChannel.id;
        defaultCurrencyCode = fixture.activeChannel.defaultCurrencyCode;
        publicCollectionId = idStrategy.decodeId(collection.id);
        publicCollectionSlug = collection.slug;

        // A shipping method only a US address can use, for the set_checkout_details tests.
        const usOnly = await adminClient.query(
            gql`
                mutation CreateUsOnlyShippingMethod($input: CreateShippingMethodInput!) {
                    createShippingMethod(input: $input) {
                        id
                        code
                    }
                }
            `,
            {
                input: {
                    code: US_ONLY_SHIPPING_METHOD_CODE,
                    fulfillmentHandler: 'manual-fulfillment',
                    checker: { code: usOnlyShippingChecker.code, arguments: [] },
                    calculator: {
                        code: 'default-shipping-calculator',
                        arguments: [
                            { name: 'rate', value: '700' },
                            { name: 'includesTax', value: 'auto' },
                            { name: 'taxRate', value: '0' },
                        ],
                    },
                    translations: [{ languageCode: LanguageCode.en, name: 'US only shipping' }],
                },
            },
        );
        expect(usOnly.createShippingMethod.code).toBe(US_ONLY_SHIPPING_METHOD_CODE);
        usOnlyShippingMethodId = usOnly.createShippingMethod.id;
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
        shirtVariants = shirt.variants;
        // The parallel add_to_cart test needs a variant other than the first product's, so that
        // the two calls produce two lines rather than merging into one.
        secondVariantId = idStrategy.decodeId(shirt.variants[0].id);
        secondVariantAdminId = shirt.variants[0].id;

        channelInputDefaults = {
            defaultLanguageCode: fixture.activeChannel.defaultLanguageCode,
            defaultCurrencyCode: fixture.activeChannel.defaultCurrencyCode,
            pricesIncludeTax: false,
            defaultShippingZoneId: zoneId,
            defaultTaxZoneId: zoneId,
        };
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
                    ...channelInputDefaults,
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

        // A public collection holding only the shirt, for the search_products collection filter.
        // Core works out which variants belong to a collection in a background job after the
        // collection is created, so this waits for that job.
        const shirtCollection = await adminClient.query(
            gql`
                mutation CreateShirtCollection($input: CreateCollectionInput!) {
                    createCollection(input: $input) {
                        id
                        slug
                    }
                }
            `,
            {
                input: {
                    translations: [
                        {
                            languageCode: fixture.activeChannel.defaultLanguageCode,
                            name: 'MCP shirts',
                            slug: 'mcp-shirts',
                            description: '',
                        },
                    ],
                    filters: [
                        {
                            code: 'product-id-filter',
                            arguments: [{ name: 'productIds', value: JSON.stringify([shirt.id]) }],
                        },
                    ],
                },
            },
        );
        shirtCollectionId = idStrategy.decodeId(shirtCollection.createCollection.id);
        shirtCollectionSlug = shirtCollection.createCollection.slug;
        await awaitRunningJobs(adminClient);

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

    /**
     * Signs a customer in on the default channel, authorizes an MCP grant for them and answers the
     * access token to call the shop tools with. The shared `shopClient` session is pinned to the
     * second channel, so tests that need the default channel get a client of their own from here.
     */
    async function shopAccessTokenFor(emailAddress: string, password: string): Promise<string> {
        const client = new SimpleGraphQLClient(
            config,
            `http://localhost:${config.apiOptions.port}/${config.apiOptions.shopApiPath as string}`,
        );
        const login = await client.asUserWithCredentials(emailAddress, password);
        if (!login || login.errorCode) {
            throw new Error(`Customer login failed for ${emailAddress}: ${JSON.stringify(login)}`);
        }
        const flow = await runShopAuthorizationCodeFlow({
            baseUrl: baseUrl(),
            issuer: ISSUER,
            vendureAuthToken: client.getAuthToken(),
        });
        return flow.access_token;
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

    // `McpActiveOrderService.findOrCreate` now locks the session row inside a transaction, so the
    // second call waits for the first to commit and then finds its order. Without the lock both
    // calls saw an empty cart, both created an order, and the session kept only one of them.
    //
    // The race only shows under `DB=postgres`. The default sql.js database runs its queries on the
    // event loop, so the first call is already finished before the second one starts and the two
    // never overlap.
    it('adds both lines to one cart when two add_to_cart calls share a session and run at once', async () => {
        const session = await server.app.get(SessionService).createAnonymousSession();
        const ordersBefore = await connection.getRepository(adminCtx, Order).count();

        const [first, second] = await Promise.all([
            postMcp(
                baseUrl(),
                'shop',
                callTool('add_to_cart', { variantId, quantity: 1, sessionToken: session.token }, 1),
            ),
            postMcp(
                baseUrl(),
                'shop',
                callTool(
                    'add_to_cart',
                    { variantId: secondVariantId, quantity: 1, sessionToken: session.token },
                    2,
                ),
            ),
        ]);

        for (const response of [first, second]) {
            expect(response.status).toBe(200);
            expect(response.body.result.isError).toBeUndefined();
            expect(response.body.result.structuredContent.sessionToken).toBe(session.token);
        }
        expect(first.body.result.structuredContent.order.code).toBe(
            second.body.result.structuredContent.order.code,
        );
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersBefore + 1);

        const order = await connection.getRepository(adminCtx, Order).findOneOrFail({
            where: { code: first.body.result.structuredContent.order.code },
            relations: ['lines'],
        });
        expect(order.lines).toHaveLength(2);
        expect(String((await anonymousSession(session.token)).activeOrderId)).toBe(String(order.id));
    });

    // When the currency of a request differs from the currency of the order it writes to, core
    // re-prices the whole order into the request's currency. The plugin sends no currency with a
    // request, so every tool call used to run in the channel's default currency and flipped a cart
    // the storefront had built in another one. Cart tools now run in the cart's own currency.
    it("keeps the cart's own currency when a tool writes to a cart the storefront built", async () => {
        const second = defaultCurrencyCode === CurrencyCode.EUR ? CurrencyCode.USD : CurrencyCode.EUR;
        const channelUpdate = await adminClient.query(
            gql`
                mutation AllowSecondCurrency($input: UpdateChannelInput!) {
                    updateChannel(input: $input) {
                        ... on Channel {
                            id
                            availableCurrencyCodes
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
                    id: defaultChannelAdminId,
                    availableCurrencyCodes: [defaultCurrencyCode, second],
                },
            },
        );
        expect(channelUpdate.updateChannel.availableCurrencyCodes).toContain(second);

        const variantUpdate = await adminClient.query(
            gql`
                mutation SetSecondCurrencyPrice($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                        prices {
                            currencyCode
                            price
                        }
                    }
                }
            `,
            {
                input: [{ id: variantAdminId, prices: [{ currencyCode: second, price: 2000 }] }],
            },
        );
        expect(variantUpdate.updateProductVariants[0].prices).toContainEqual({
            currencyCode: second,
            price: 2000,
        });

        // The cart a storefront request would build: the shopper is browsing in the second
        // currency, so their request carries it and the order is stored in it.
        const session = await server.app.get(SessionService).createAnonymousSession();
        const channel = await server.app.get(ChannelService).getDefaultChannel();
        const storefrontCtx = new RequestContext({
            apiType: 'shop',
            channel,
            session,
            currencyCode: second,
            isAuthorized: false,
            authorizedAsOwnerOnly: true,
        });
        const created = await server.app
            .get(ActiveOrderService)
            .getActiveOrder(storefrontCtx, undefined, true);
        await server.app.get(OrderService).addItemToOrder(storefrontCtx, created.id, variantId, 1);
        const beforeMcp = await connection
            .getRepository(adminCtx, Order)
            .findOneOrFail({ where: { id: created.id } });
        expect(beforeMcp.currencyCode).toBe(second);

        const added = await postMcp(
            baseUrl(),
            'shop',
            callTool('add_to_cart', { variantId, quantity: 1, sessionToken: session.token }, 1),
        );
        expect(added.body.result.isError).toBeUndefined();
        expect(added.body.result.structuredContent.order.currencyCode).toBe(second);

        const orderLineId = added.body.result.structuredContent.order.lines[0].id;
        const updated = await postMcp(
            baseUrl(),
            'shop',
            callTool('update_cart_line', { orderLineId, quantity: 3, sessionToken: session.token }, 2),
        );
        expect(updated.body.result.isError).toBeUndefined();
        expect(updated.body.result.structuredContent.order.currencyCode).toBe(second);

        const stored = await connection
            .getRepository(adminCtx, Order)
            .findOneOrFail({ where: { id: created.id }, relations: ['lines'] });
        expect(stored.currencyCode).toBe(second);
        expect(stored.lines).toHaveLength(1);
        expect(stored.lines[0].quantity).toBe(3);
        // The price the line was charged at. Re-pricing into another currency would replace it
        // with that currency's price for the same variant.
        expect(stored.lines[0].listPrice).toBe(2000);
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

    // The suite's only test of the answer to an unknown channel token: a looser duplicate in
    // mcp-transport.e2e-spec.ts accepted any status at or above 400.
    it('rejects an invalid vendure-token instead of falling back to the default channel', async () => {
        const response = await postMcp(baseUrl(), 'shop', callTool('get_product', { id: productId }), {
            headers: { [CHANNEL_TOKEN_HEADER]: 'not-a-real-channel-token' },
        });

        expect(response.status).toBe(400);
        expect(response.body).toMatchObject({
            statusCode: 400,
            message: expect.stringContaining(CHANNEL_TOKEN_HEADER),
            path: '/mcp/shop',
        });
        // An unusable channel token is a bad request, not a failed authentication, so the caller
        // must not be challenged for credentials.
        expect(response.headers.get('www-authenticate')).toBeNull();
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
        const line = allowed.body.result.structuredContent.order.lines[0];
        expect(String(line.productVariant.id)).toBe(String(variantId));
        expect(line.productVariant).toMatchObject({ name: variantName, sku: variantSku });

        // A miss and a refusal look the same to the caller on purpose: saying which it was would tell an
        // anonymous caller that the code exists. The message says what to do about either.
        const notVisible = (orderCode: string) =>
            `No order with code ${orderCode} is visible to this caller. Sign in as the customer who placed it to see it.`;
        orderByCodeAccessStrategy.allow = false;
        try {
            const denied = await postMcp(baseUrl(), 'shop', callTool('get_order', { code }, 3));
            expect(denied.body.result.isError).toBeUndefined();
            expect(denied.body.result.structuredContent).toEqual({ order: null, message: notVisible(code) });
        } finally {
            orderByCodeAccessStrategy.allow = true;
        }
        const unknown = await postMcp(baseUrl(), 'shop', callTool('get_order', { code: 'NO-SUCH-CODE' }, 4));
        expect(unknown.body.result.isError).toBeUndefined();
        expect(unknown.body.result.structuredContent).toEqual({
            order: null,
            message: notVisible('NO-SUCH-CODE'),
        });
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
        // A private collection is as good as unknown to a shopper, and the miss is answered the same
        // way search_products answers an unknown collection.
        const privateMisses = [
            {
                arguments_: { id: privateCollectionId },
                message: `No collection with id ${privateCollectionId}.`,
            },
            {
                arguments_: { slug: privateCollectionSlug },
                message: `No collection with slug ${privateCollectionSlug}.`,
            },
            {
                arguments_: { slug: 'no-such-collection' },
                message: 'No collection with slug no-such-collection.',
            },
        ];
        for (const { arguments_, message } of privateMisses) {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_collection', arguments_));
            expect(response.body.result.structuredContent).toEqual({ collection: null, message });
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

    it('limits search_products to one collection when asked', async () => {
        const collectionSlug = shirtCollectionSlug;
        const collectionId = shirtCollectionId;
        // The fixture shirt's three sizes are the whole collection.
        const membership = await adminClient.query(
            gql`
                query ShirtCollectionMembers($slug: String!) {
                    collection(slug: $slug) {
                        productVariants {
                            totalItems
                        }
                    }
                }
            `,
            { slug: collectionSlug },
        );
        expect(membership.collection.productVariants.totalItems).toBe(3);

        const search = async (args: Record<string, unknown>) => {
            const response = await postMcp(baseUrl(), 'shop', callTool('search_products', args));
            expect(response.body.result.isError).toBeUndefined();
            const result = response.body.result.structuredContent as {
                items: Array<{ name: string }>;
                total: number;
                message?: string;
            };
            return {
                names: result.items.map(item => item.name).sort(),
                total: result.total,
                message: result.message,
            };
        };

        expect(await search({ collectionSlug })).toEqual({
            names: ['Test Shirt'],
            total: 1,
            message: undefined,
        });
        expect(await search({ collectionId })).toEqual({
            names: ['Test Shirt'],
            total: 1,
            message: undefined,
        });
        // The word filter and the collection filter apply together: "product" matches "Test Product",
        // which is not in the collection.
        expect(await search({ query: 'product', collectionSlug })).toEqual({
            names: [],
            total: 0,
            message: undefined,
        });
        expect(await search({ collectionSlug: 'no-such-collection' })).toEqual({
            names: [],
            total: 0,
            message: 'No collection with slug no-such-collection.',
        });
        // A private collection is as good as unknown to a shopper, the same as in get_collection.
        expect(await search({ collectionId: privateCollectionId })).toEqual({
            names: [],
            total: 0,
            message: `No collection with id ${privateCollectionId}.`,
        });

        const both = await postMcp(
            baseUrl(),
            'shop',
            callTool('search_products', { collectionId, collectionSlug }),
        );
        expect(both.body.result.isError).toBe(true);
        expect(both.body.result.content[0].text).toContain('collectionId or collectionSlug');
    });

    it('search_products refuses a query with too many words or too many characters', async () => {
        const search = (query: string, id: number) =>
            postMcp(baseUrl(), 'shop', callTool('search_products', { query }, id));

        // Every word becomes another set of conditions on the query, so the word count is capped.
        const tenWords = await search('one two three four five six seven eight nine ten', 1);
        expect(tenWords.body.result.isError).toBeUndefined();
        const elevenWords = await search('one two three four five six seven eight nine ten eleven', 2);
        expect(elevenWords.body.result.isError).toBe(true);
        expect(elevenWords.body.result.content[0].text).toContain('Use at most 10 words.');

        const atCap = await search('a'.repeat(200), 3);
        expect(atCap.body.result.isError).toBeUndefined();
        const overCap = await search('a'.repeat(201), 4);
        expect(overCap.body.result.isError).toBe(true);
    });

    /** Searches for the shirt and returns its list item's price range, in the channel the request names. */
    async function shirtRange(headers: Record<string, string> = {}) {
        const response = await postMcp(baseUrl(), 'shop', callTool('search_products', { query: 'shirt' }), {
            headers,
        });
        expect(response.body.result.isError).toBeUndefined();
        const [item] = response.body.result.structuredContent.items as Array<{
            name: string;
            priceRange: unknown;
        }>;
        expect(item.name).toBe('Test Shirt');
        return item.priceRange;
    }

    function setShirtVariantsEnabled(variantIds: string[], enabled: boolean) {
        return adminClient.query(
            gql`
                mutation SetShirtVariantsEnabled($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                    }
                }
            `,
            { input: variantIds.map(id => ({ id, enabled })) },
        );
    }

    it('search_products leaves a disabled variant out of the price range and the collection filter', async () => {
        const largeId = shirtVariants.filter(variant => variant.sku === 'SHIRT-L').map(variant => variant.id);
        const allIds = shirtVariants.map(variant => variant.id);
        try {
            // Only the Large size costs 840.00, so without it the range stops at the Medium size.
            await setShirtVariantsEnabled(largeId, false);
            expect(await shirtRange()).toEqual({
                ...SHIRT_SMALL_TO_MEDIUM,
                currencyCode: defaultCurrencyCode,
            });

            // With no enabled variant left the shirt is still an enabled product, so a name search
            // finds it, but it has no price and the collection has nothing a shopper can buy.
            await setShirtVariantsEnabled(allIds, false);
            expect(await shirtRange()).toBeNull();
            const inCollection = await postMcp(
                baseUrl(),
                'shop',
                callTool('search_products', { collectionSlug: shirtCollectionSlug }),
            );
            expect(inCollection.body.result.structuredContent).toMatchObject({ items: [], total: 0 });
        } finally {
            await setShirtVariantsEnabled(allIds, true);
        }
    });

    it('search_products leaves a variant with no price in the channel out of the price range', async () => {
        const [large] = shirtVariants.filter(variant => variant.sku === 'SHIRT-L');
        const setLargePrice = (prices: Array<Record<string, unknown>>) =>
            adminClient.query(
                gql`
                    mutation SetLargeShirtPrice($input: [UpdateProductVariantInput!]!) {
                        updateProductVariants(input: $input) {
                            id
                        }
                    }
                `,
                { input: [{ id: large.id, prices }] },
            );
        // Core still lists a variant whose price row for the channel is gone, at a price of 0. It
        // must not drag the range down to 0.
        await setLargePrice([{ currencyCode: defaultCurrencyCode, price: 0, delete: true }]);
        try {
            expect(await shirtRange()).toEqual({
                ...SHIRT_SMALL_TO_MEDIUM,
                currencyCode: defaultCurrencyCode,
            });
        } finally {
            await setLargePrice([{ currencyCode: defaultCurrencyCode, price: 70000 }]);
        }
    });

    it('search_products prices a product from the variants in the active channel only', async () => {
        // A channel holding the Small and Medium shirt only; the Large one stays in the default
        // channel alone. Created here rather than shared: the second channel is deleted by an
        // earlier test.
        const created = await adminClient.query(
            gql`
                mutation CreateRangeChannel($input: CreateChannelInput!) {
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
                    code: 'shop-tools-range-channel',
                    token: 'shop-tools-range-channel-token',
                    ...channelInputDefaults,
                },
            },
        );
        expect(created.createChannel.id).toBeDefined();
        try {
            await adminClient.query(
                gql`
                    mutation AssignSmallAndMediumShirt($input: AssignProductVariantsToChannelInput!) {
                        assignProductVariantsToChannel(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        channelId: created.createChannel.id,
                        productVariantIds: shirtVariants
                            .filter(variant => variant.sku !== 'SHIRT-L')
                            .map(variant => variant.id),
                        priceFactor: 1,
                    },
                },
            );
            expect(await shirtRange({ [CHANNEL_TOKEN_HEADER]: created.createChannel.token })).toEqual({
                ...SHIRT_SMALL_TO_MEDIUM,
                currencyCode: defaultCurrencyCode,
            });
        } finally {
            await adminClient.query(
                gql`
                    mutation DeleteRangeChannel($id: ID!) {
                        deleteChannel(id: $id) {
                            result
                        }
                    }
                `,
                { id: created.createChannel.id },
            );
        }
    });

    it('pages through a product with more variants than one answer returns', async () => {
        const get = async (args: Record<string, unknown>) => {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_product', args, 1));
            return response.body.result.structuredContent.product;
        };
        expect(shirtVariantCount).toBeGreaterThan(1);

        const all = await get({ id: shirtId });
        expect(all.variants).toHaveLength(shirtVariantCount);
        expect(all.variantTotal).toBe(shirtVariantCount);
        expect(all.hasMoreVariants).toBe(false);

        const skipped = await get({ id: shirtId, variantOffset: 1 });
        expect(skipped.variants).toHaveLength(shirtVariantCount - 1);
        expect(skipped.variantTotal).toBe(shirtVariantCount);
        expect(skipped.hasMoreVariants).toBe(false);

        const past = await get({ id: shirtId, variantOffset: shirtVariantCount });
        expect(past.variants).toEqual([]);
        expect(past.variantTotal).toBe(shirtVariantCount);
        expect(past.hasMoreVariants).toBe(false);
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

    it('add_to_cart refuses a fractional, zero or oversized quantity', async () => {
        const ordersBefore = await connection.getRepository(adminCtx, Order).count();

        for (const quantity of [1.5, 0, 2147483648]) {
            const added = await postMcp(
                baseUrl(),
                'shop',
                callTool('add_to_cart', { variantId, quantity }, 1),
            );

            expect(added.body.result.isError).toBe(true);
            expect(added.body.result.content[0].text).toContain('quantity');
        }
        expect(await connection.getRepository(adminCtx, Order).count()).toBe(ordersBefore);
    });

    it('place_order reports the missing customer on an anonymous cart', async () => {
        const { sessionToken } = await anonymousCart();
        const refused = await postMcp(
            baseUrl(),
            'shop',
            callTool('place_order', { paymentMethodCode: 'not-configured', confirm: true, sessionToken }, 1),
        );

        expect(refused.body.result.isError).toBe(true);
        expect(refused.body.result.content[0].text).toBe(
            'This cart has no customer yet. For a guest checkout call set_checkout_details ' +
                'with customer { emailAddress, firstName, lastName } first, or sign in as a customer.',
        );
        expect(refused.body.result.structuredContent).toEqual({ sessionToken });
    });

    it('says there is no cart on the three reads that would otherwise look like real answers', async () => {
        const noCart =
            'There is no cart for this session. Call add_to_cart first; it returns the ' +
            'sessionToken to use on later calls.';

        const cart = await postMcp(baseUrl(), 'shop', callTool('get_cart', {}, 1));
        expect(cart.body.result.isError).toBeUndefined();
        expect(cart.body.result.structuredContent).toMatchObject({ order: null, message: noCart });

        const payments = await postMcp(baseUrl(), 'shop', callTool('get_eligible_payment_methods', {}, 2));
        expect(payments.body.result.isError).toBeUndefined();
        expect(payments.body.result.structuredContent).toMatchObject({ methods: [], message: noCart });

        const shipping = await postMcp(baseUrl(), 'shop', callTool('get_eligible_shipping_methods', {}, 3));
        expect(shipping.body.result.isError).toBeUndefined();
        expect(shipping.body.result.structuredContent).toMatchObject({ methods: [], message: noCart });
    });

    describe('in-process execution via McpToolExecutionService', () => {
        async function customerShopContext(): Promise<RequestContext> {
            const customer = await connection.getRepository(adminCtx, Customer).findOneOrFail({
                where: { emailAddress: customerEmail },
                relations: ['user'],
            });
            return server.app.get(RequestContextService).create({ apiType: 'shop', user: customer.user });
        }

        it('executes a tool with DI and attributes the call to the signed-in customer', async () => {
            const executionService = server.app.get(McpToolExecutionService);
            const ctx = await customerShopContext();

            const result = await executionService.executeTool(ctx, 'shop', 'search_products', {
                query: 'laptop',
            });

            expect(result.isError).toBeUndefined();
            expect(result.structuredContent).toBeDefined();
            const log = await connection.getRepository(adminCtx, McpToolCallLog).findOneOrFail({
                where: { toolName: 'search_products' },
                order: { id: 'DESC' },
            });
            expect(log.grantId).toBeNull();
            expect(log.actor).toBe(String(ctx.activeUserId));
            expect(log.actorType).toBe('customer');
        });

        it('refuses in-process execution with a mismatched RequestContext apiType', async () => {
            const executionService = server.app.get(McpToolExecutionService);

            await expect(
                executionService.executeTool(adminCtx, 'shop', 'search_products', {}),
            ).rejects.toThrow(
                'The "shop" MCP toolset requires a shop API RequestContext, but the supplied ' +
                    'context is for the "admin" API.',
            );
        });
    });

    // A signed-in customer paying for their cart, over the same HTTP transport a real client uses.
    // `place_order` is the only tool that takes a payment, and a payment can only be taken inside a
    // database transaction, which nothing outside the tool opens for it. Every other checkout tool
    // works without one, so nothing short of a test that actually pays shows that gap.
    describe('checkout', () => {
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

            // Two tests here need a customer of their own, and the fixture seeds only one, so this
            // makes them. Passing a password also marks the new user as verified, which it has to
            // be before it can log in.
            const createCustomer = async (emailAddress: string, name: string, password: string) => {
                const createdCustomer = await adminClient.query(
                    gql`
                        mutation CreateShopToolCheckoutCustomer(
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
                        input: { emailAddress, firstName: name, lastName: 'Checkout' },
                        password,
                    },
                );
                expect(createdCustomer.createCustomer.emailAddress).toBe(emailAddress);
            };
            await createCustomer(
                PENDING_PAYMENT_CUSTOMER_EMAIL,
                'Pending',
                PENDING_PAYMENT_CUSTOMER_PASSWORD,
            );
            await createCustomer(NO_SHIPPING_CUSTOMER_EMAIL, 'NoShipping', NO_SHIPPING_CUSTOMER_PASSWORD);
        }, TEST_SETUP_TIMEOUT_MS);

        it('shows a shopper only the custom fields the Shop API would show on a quote', async () => {
            // Written straight to the database because an internal custom field is in no API at all,
            // so there is no mutation that could set all three.
            const customFields = {
                quoteNote: 'Arrives in two days',
                internalCode: 'OPS-1',
                adminNote: 'Staff only',
            };
            const shippingMethod = await connection
                .getRepository(adminCtx, ShippingMethod)
                .findOneOrFail({ where: { code: 'standard-shipping' } });
            await connection
                .getRepository(adminCtx, ShippingMethod)
                .update(shippingMethod.id, { customFields } as any);
            const paymentMethod = await connection
                .getRepository(adminCtx, PaymentMethod)
                .findOneOrFail({ where: { code: PAYMENT_METHOD_CODE } });
            await connection
                .getRepository(adminCtx, PaymentMethod)
                .update(paymentMethod.id, { customFields } as any);

            const { sessionToken } = await anonymousCart();
            const call = (name: string, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, {}, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const quotes = await call('get_eligible_shipping_methods', 2);
            const standard = quotes.body.result.structuredContent.methods.find(
                (method: any) => method.code === 'standard-shipping',
            );
            expect(standard.customFields).toEqual({ quoteNote: 'Arrives in two days' });

            const payments = await call('get_eligible_payment_methods', 3);
            const payment = payments.body.result.structuredContent.methods.find(
                (method: any) => method.code === PAYMENT_METHOD_CODE,
            );
            expect(payment.customFields).toEqual({ quoteNote: 'Arrives in two days' });
        });

        it('walks a cart through checkout and places the order', async () => {
            const accessToken = await shopAccessTokenFor(customerEmail, 'test');
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), { token: accessToken });

            const added = await call('add_to_cart', { variantId, quantity: 1 }, 1);
            expect(added.body.result.isError).toBeUndefined();

            const address = await call(
                'set_checkout_details',
                {
                    shippingAddress: {
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
                'set_checkout_details',
                {
                    shippingAddress: {
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

        // A guest checkout: no login anywhere in the sequence, the buyer is named in the same call
        // that sets the address. This test lives here rather than with the other anonymous tests
        // because the payment method it pays with is created in this block's `beforeAll`.
        it('places an order for a guest who names themselves in set_checkout_details', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, { ...args, sessionToken }, id));

            const emptyCart = await call('get_cart', {}, 2);
            expect(emptyCart.body.result.structuredContent.order.customer).toBeNull();
            const addresses = await call(
                'set_checkout_details',
                {
                    shippingAddress: {
                        streetLine1: '451 Sansome Street',
                        city: 'San Francisco',
                        postalCode: '94111',
                        countryCode: 'US',
                    },
                    customer: {
                        emailAddress: GUEST_CHECKOUT_EMAIL,
                        firstName: 'Jane',
                        lastName: 'Doe',
                    },
                },
                3,
            );
            expect(addresses.body.result.isError).toBeUndefined();
            expect(addresses.body.result.structuredContent.order.customer).toMatchObject({
                emailAddress: GUEST_CHECKOUT_EMAIL,
                firstName: 'Jane',
                lastName: 'Doe',
            });
            const cart = await call('get_cart', {}, 4);
            expect(cart.body.result.structuredContent.order.customer).toMatchObject({
                emailAddress: GUEST_CHECKOUT_EMAIL,
            });

            const quotes = await call('get_eligible_shipping_methods', {}, 5);
            const methodId = quotes.body.result.structuredContent.methods[0]?.id;
            expect(methodId).toBeDefined();
            const chosen = await call('set_shipping_method', { methodId }, 6);
            expect(chosen.body.result.isError).toBeUndefined();

            const placed = await call(
                'place_order',
                { paymentMethodCode: PAYMENT_METHOD_CODE, confirm: true },
                7,
            );

            expect(placed.body.result.isError).toBeUndefined();
            expect(placed.body.result.structuredContent.status).toBe('placed');
            const placedOrder = placed.body.result.structuredContent.order;
            expect(placedOrder.customer.emailAddress).toBe(GUEST_CHECKOUT_EMAIL);

            const stored = await connection.getRepository(adminCtx, Order).findOneOrFail({
                where: { code: placedOrder.code as string },
                relations: ['customer', 'customer.user'],
            });
            expect(stored.orderPlacedAt).toBeTruthy();
            expect(stored.customer?.emailAddress).toBe(GUEST_CHECKOUT_EMAIL);
            // A guest gets a Customer record but no User, so there is nothing to log in with.
            expect(stored.customer?.user).toBeNull();

            // The storefront's own checkout saves a new customer's checkout address to their
            // address book, so this one does too.
            const buyer = await connection.getRepository(adminCtx, Customer).findOneOrFail({
                where: { id: stored.customer?.id },
                relations: ['addresses'],
            });
            expect(buyer.addresses).toHaveLength(1);
            expect(buyer.addresses[0]).toMatchObject({
                streetLine1: '451 Sansome Street',
                city: 'San Francisco',
                postalCode: '94111',
                defaultShippingAddress: true,
                defaultBillingAddress: true,
            });

            // The session let go of the order it just paid for, so the next add_to_cart starts a
            // fresh cart rather than reopening the placed one.
            const restarted = await call('add_to_cart', { variantId, quantity: 1 }, 8);
            expect(restarted.body.result.isError).toBeUndefined();
            expect(restarted.body.result.structuredContent.order.code).not.toBe(placedOrder.code);
            expect(restarted.body.result.structuredContent.order.totalQuantity).toBe(1);
        });

        // This test uses the customer created for it on purpose. It leaves an order sitting in
        // `ArrangingPayment`, and `OrderService.findByCustomerId` only leaves out `Draft` orders, so
        // an unplaced order on the shared customer would show up in the `list_my_orders` test below
        // and break its expectation that the first listed order has an `orderPlacedAt`.
        it('answers awaiting_payment when the payment leaves the order unplaced', async () => {
            const accessToken = await shopAccessTokenFor(
                PENDING_PAYMENT_CUSTOMER_EMAIL,
                PENDING_PAYMENT_CUSTOMER_PASSWORD,
            );
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), { token: accessToken });

            const added = await call('add_to_cart', { variantId, quantity: 1 }, 1);
            expect(added.body.result.isError).toBeUndefined();

            const address = await call(
                'set_checkout_details',
                {
                    shippingAddress: {
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
                // The cart's payments carry the same keys as every other order's, refunds included.
                refunds: [],
            });

            const stored = await orderByCode(answer.order.code);
            expect(stored.state).toBe('ArrangingPayment');
            expect(stored.orderPlacedAt).toBeFalsy();
        });

        // Acts on the order the test above left waiting for payment. A fresh authorization flow
        // starts a session with no cart of its own, and core then falls back to the customer's
        // active order, which is that one.
        it('refuses coupon and address changes once the order is waiting for payment', async () => {
            const accessToken = await shopAccessTokenFor(
                PENDING_PAYMENT_CUSTOMER_EMAIL,
                PENDING_PAYMENT_CUSTOMER_PASSWORD,
            );
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), { token: accessToken });

            const cart = await call('get_cart', {}, 1);
            expect(cart.body.result.isError).toBeUndefined();
            const waitingForPayment = cart.body.result.structuredContent.order;
            expect(waitingForPayment.state).toBe('ArrangingPayment');

            const applied = await call('apply_coupon_code', { code: 'ANY-CODE' }, 2);
            const removed = await call('remove_coupon_code', { code: 'ANY-CODE' }, 3);
            const address = await call('set_checkout_details', { shippingAddress: UK_ADDRESS }, 4);

            const cartClosedMessage = 'Order contents may only be modified when in the "AddingItems" state';
            for (const refusal of [applied, removed, address]) {
                expect(refusal.body.result.isError).toBe(true);
                expect(refusal.body.result.structuredContent.errorCode).toBe('ORDER_MODIFICATION_ERROR');
                // The text content is the error result as JSON, so the quotes around the state name
                // are escaped inside it.
                expect(refusal.body.result.content[0].text).toContain(JSON.stringify(cartClosedMessage));
            }

            // Proves nothing was written, not only that an error came back. The stored address is
            // still the US one the order was checked out with, not the UK one just sent.
            const untouched = await orderByCode(waitingForPayment.code);
            expect(untouched.couponCodes).toEqual([]);
            expect(untouched.totalWithTax).toBe(waitingForPayment.totalWithTax);
            expect(untouched.shippingAddress.countryCode).toBe('US');
        });

        // Like the test above, this one uses a customer created for it. It leaves a cart sitting in
        // `AddingItems`, and `OrderService.findByCustomerId` only leaves out `Draft` orders, so an
        // unplaced order on the shared customer would show up in the `list_my_orders` test further
        // down and break its expectation that the first listed order has an `orderPlacedAt`.
        it('place_order without a shipping method answers a translated refusal', async () => {
            const accessToken = await shopAccessTokenFor(
                NO_SHIPPING_CUSTOMER_EMAIL,
                NO_SHIPPING_CUSTOMER_PASSWORD,
            );
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), { token: accessToken });

            const added = await call('add_to_cart', { variantId, quantity: 1 }, 1);
            expect(added.body.result.isError).toBeUndefined();

            const address = await call('set_checkout_details', { shippingAddress: UK_ADDRESS }, 2);
            expect(address.body.result.isError).toBeUndefined();

            const placed = await call(
                'place_order',
                { paymentMethodCode: PAYMENT_METHOD_CODE, confirm: true },
                3,
            );

            expect(placed.body.result.isError).toBe(true);
            const failure = placed.body.result.structuredContent;
            expect(failure.errorCode).toBe('ORDER_STATE_TRANSITION_ERROR');
            expect(failure.message).toBe('Cannot transition Order from "AddingItems" to "ArrangingPayment"');
            // Core builds this nested field with ctx.translate, so it only reads as a sentence when
            // the context the OAuth flow built carries the request's translate function.
            expect(failure.transitionError).toBe(
                'Cannot transition Order to the "ArrangingPayment" state without a ShippingMethod',
            );
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

            // A session on the default channel, because the second channel the shared `shopClient`
            // is pinned to has already been removed by the channel-deletion test above.
            readsAccessToken = await shopAccessTokenFor(customerEmail, 'test');

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

        it('translates a core error into English and keeps its variables', async () => {
            const { sessionToken } = await anonymousCart();

            const failed = await postMcp(
                baseUrl(),
                'shop',
                callTool('update_cart_line', { orderLineId: 999999, quantity: 2 }, 2),
                { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
            );

            expect(failed.body.result.isError).toBe(true);
            // Core throws the key "error.order-does-not-contain-line-with-id" here. Reaching the
            // agent as a sentence with the ID in it proves the translation middleware ran.
            expect(failed.body.result.content[0].text).toBe(
                'This order does not contain an OrderLine with the id 999999',
            );
        });

        it('translates into the language of the Accept-Language header', async () => {
            const { sessionToken } = await anonymousCart();

            const failed = await postMcp(
                baseUrl(),
                'shop',
                callTool('update_cart_line', { orderLineId: 999999, quantity: 2 }, 2),
                {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken, 'Accept-Language': 'de' },
                },
            );

            expect(failed.body.result.isError).toBe(true);
            // Only a distinctive word is pinned, because the German sentence in core carries a
            // typo that a later release may correct.
            expect(failed.body.result.content[0].text).toMatch(/Bestellung/);
            expect(failed.body.result.content[0].text).toContain('999999');
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

        it('set_checkout_details with only billingAddress writes it, leaving the shipping address alone', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const shipping = await call(
                'set_checkout_details',
                {
                    shippingAddress: {
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
                'set_checkout_details',
                {
                    billingAddress: {
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
            // Both core address setters return a plain Order rather than an error union, so the tool
            // wraps it as `{ order }` with no `result` branch — different from the cart tools above.
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

        it('set_checkout_details copies the shipping address into billing on billingSameAsShipping', async () => {
            const { sessionToken, order: cart } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            // A fresh cart has no shipping address to copy, so the flag alone is refused and nothing
            // is written.
            const nothingToCopy = await call('set_checkout_details', { billingSameAsShipping: true }, 2);
            expect(nothingToCopy.body.result.isError).toBe(true);
            expect(nothingToCopy.body.result.content[0].text).toMatch(/needs a shipping address/);

            const together = await call(
                'set_checkout_details',
                {
                    shippingAddress: {
                        fullName: 'Same Person',
                        streetLine1: '3 Copy Street',
                        city: 'Denver',
                        countryCode: 'US',
                        defaultShippingAddress: true,
                    },
                    billingSameAsShipping: true,
                },
                3,
            );
            expect(together.body.result.isError).toBeUndefined();
            let stored = await orderByCode(cart.code);
            expect(stored.billingAddress).toMatchObject({
                fullName: 'Same Person',
                streetLine1: '3 Copy Street',
                city: 'Denver',
                countryCode: 'US',
            });
            // The address-book flag describes the customer's saved addresses, not an order, so it
            // is not carried into the billing copy.
            expect('defaultShippingAddress' in stored.billingAddress).toBe(false);

            // With a shipping address already on the cart, the flag alone copies that one.
            const later = await call(
                'set_checkout_details',
                { shippingAddress: { streetLine1: '4 Later Lane', city: 'Boise', countryCode: 'US' } },
                4,
            );
            expect(later.body.result.isError).toBeUndefined();
            const copied = await call('set_checkout_details', { billingSameAsShipping: true }, 5);
            expect(copied.body.result.isError).toBeUndefined();
            stored = await orderByCode(cart.code);
            expect(stored.billingAddress.streetLine1).toBe('4 Later Lane');
        });

        it('set_checkout_details refuses an empty call and a billing address paired with the copy flag', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool('set_checkout_details', args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const empty = await call({}, 2);
            expect(empty.body.result.isError).toBe(true);
            expect(empty.body.result.content[0].text).toMatch(
                /Pass shippingAddress, billingAddress, billingSameAsShipping: true, or customer/,
            );

            const conflicting = await call(
                {
                    billingAddress: { streetLine1: '2 Billing Road', countryCode: 'US' },
                    billingSameAsShipping: true,
                },
                3,
            );
            expect(conflicting.body.result.isError).toBe(true);
            expect(conflicting.body.result.content[0].text).toMatch(/cannot both be given/);
        });

        it('set_checkout_details refuses a customer from a caller who is already signed in', async () => {
            const refused = await postMcp(
                baseUrl(),
                'shop',
                callTool(
                    'set_checkout_details',
                    {
                        shippingAddress: { streetLine1: '1 Shipping Way', countryCode: 'US' },
                        customer: {
                            emailAddress: 'someone.else@e2e.example.com',
                            firstName: 'Someone',
                            lastName: 'Else',
                        },
                    },
                    2,
                ),
                { token: readsAccessToken },
            );

            // The order already belongs to the customer behind the grant. Taking a second identity
            // here would either overwrite that customer's details or move the order to someone else.
            expect(refused.body.result.isError).toBe(true);
            expect(refused.body.result.content[0].text).toBe(
                'This call is signed in as a customer; omit customer.',
            );
        });

        it('set_checkout_details refuses a guest whose email already has an account, and writes no address', async () => {
            const { sessionToken, order: cart } = await anonymousCart();

            const refused = await postMcp(
                baseUrl(),
                'shop',
                callTool(
                    'set_checkout_details',
                    {
                        shippingAddress: {
                            streetLine1: '1 Shipping Way',
                            city: 'Portland',
                            countryCode: 'US',
                        },
                        customer: {
                            emailAddress: customerEmail,
                            firstName: 'Someone',
                            lastName: 'Else',
                        },
                    },
                    2,
                ),
                { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
            );

            expect(refused.body.result.isError).toBe(true);
            expect(refused.body.result.structuredContent.errorCode).toBe('EMAIL_ADDRESS_CONFLICT_ERROR');
            // A returned error result leaves the transaction committed as it stands, so the buyer
            // has to be named before any address is written. Nothing was.
            const stored = await connection.getRepository(adminCtx, Order).findOneOrFail({
                where: { code: cart.code as string },
                relations: ['customer'],
            });
            expect(stored.shippingAddress?.streetLine1).toBeUndefined();
            expect(stored.customer).toBeNull();
        });

        it('set_checkout_details reports shippingMethodChanged when the new address makes the store swap the method', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });
            const usAddress = {
                streetLine1: '451 Sansome Street',
                city: 'San Francisco',
                postalCode: '94111',
                countryCode: 'US',
            };

            const first = await call('set_checkout_details', { shippingAddress: usAddress }, 2);
            expect(first.body.result.isError).toBeUndefined();
            expect(first.body.result.structuredContent.shippingMethodChanged).toBeUndefined();

            const quotes = await call('get_eligible_shipping_methods', {}, 3);
            const usOnly = quotes.body.result.structuredContent.methods.find(
                (method: any) => method.code === US_ONLY_SHIPPING_METHOD_CODE,
            );
            expect(usOnly).toBeDefined();
            const chosen = await call('set_shipping_method', { methodId: usOnly.id }, 4);
            expect(chosen.body.result.isError).toBeUndefined();

            // Another US address keeps the method, and the response says nothing about a removal.
            const moved = await call(
                'set_checkout_details',
                { shippingAddress: { ...usAddress, streetLine1: '1 Market Street' } },
                5,
            );
            expect(moved.body.result.isError).toBeUndefined();
            expect(moved.body.result.structuredContent.shippingMethodChanged).toBeUndefined();
            const keptLines = moved.body.result.structuredContent.order.shippingLines;
            expect(keptLines).toHaveLength(1);
            expect(String(keptLines[0].shippingMethodId)).toBe(String(usOnly.id));

            // A UK address makes the US-only method ineligible. The default channel has other
            // methods that ship anywhere, so core swaps the shipping line to the cheapest of them
            // while it reprices the cart. The tool has to say so rather than answer with a bare order.
            const abroad = await call('set_checkout_details', { shippingAddress: UK_ADDRESS }, 6);
            expect(abroad.body.result.isError).toBeUndefined();
            expect(abroad.body.result.structuredContent.shippingMethodChanged).toBe(true);
            expect(abroad.body.result.structuredContent.message).toMatch(/replaced it with the cheapest/);
            const swappedLines = abroad.body.result.structuredContent.order.shippingLines;
            expect(swappedLines).toHaveLength(1);
            expect(String(swappedLines[0].shippingMethodId)).not.toBe(String(usOnly.id));
        });

        it('set_checkout_details reports shippingMethodChanged when no method is left for the new address', async () => {
            // A channel whose only shipping method is the US-only one, so there is nothing to swap
            // to and core drops the shipping line instead. It is created here rather than shared:
            // the second channel is deleted by an earlier test.
            const created = await adminClient.query(
                gql`
                    mutation CreateDropCaseChannel($input: CreateChannelInput!) {
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
                        code: 'shop-tools-us-only-channel',
                        token: 'shop-tools-us-only-channel-token',
                        ...channelInputDefaults,
                    },
                },
            );
            expect(created.createChannel.id).toBeDefined();
            await adminClient.query(
                gql`
                    mutation AssignDropCaseProduct($input: AssignProductsToChannelInput!) {
                        assignProductsToChannel(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        channelId: created.createChannel.id,
                        productIds: [productAdminId],
                        priceFactor: 1,
                    },
                },
            );
            await adminClient.query(
                gql`
                    mutation AssignDropCaseShippingMethod($input: AssignShippingMethodsToChannelInput!) {
                        assignShippingMethodsToChannel(input: $input) {
                            id
                        }
                    }
                `,
                {
                    input: {
                        channelId: created.createChannel.id,
                        shippingMethodIds: [usOnlyShippingMethodId],
                    },
                },
            );
            const channel = { headers: { [CHANNEL_TOKEN_HEADER]: created.createChannel.token } };
            const added = await postMcp(
                baseUrl(),
                'shop',
                callTool('add_to_cart', { variantId, quantity: 1 }, 1),
                channel,
            );
            expect(added.body.result.isError).toBeUndefined();
            const sessionToken = added.body.result.structuredContent.sessionToken as string;
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { ...channel.headers, [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const first = await call(
                'set_checkout_details',
                {
                    shippingAddress: {
                        streetLine1: '451 Sansome Street',
                        city: 'San Francisco',
                        countryCode: 'US',
                    },
                },
                2,
            );
            expect(first.body.result.isError).toBeUndefined();
            const quotes = await call('get_eligible_shipping_methods', {}, 3);
            const methods = quotes.body.result.structuredContent.methods;
            expect(methods.map((method: any) => method.code)).toEqual([US_ONLY_SHIPPING_METHOD_CODE]);
            const chosen = await call('set_shipping_method', { methodId: methods[0].id }, 4);
            expect(chosen.body.result.isError).toBeUndefined();

            const abroad = await call('set_checkout_details', { shippingAddress: UK_ADDRESS }, 5);
            expect(abroad.body.result.isError).toBeUndefined();
            expect(abroad.body.result.structuredContent.shippingMethodChanged).toBe(true);
            expect(abroad.body.result.structuredContent.message).toMatch(/no shipping method/);
            expect(abroad.body.result.structuredContent.order.shippingLines).toEqual([]);
            expect(abroad.body.result.structuredContent.order.shippingWithTax).toBe(0);
        });

        it('set_checkout_details refuses an address custom field a shopper may not write', async () => {
            const { sessionToken } = await anonymousCart();
            const call = (customFields: Record<string, unknown>, id: number) =>
                postMcp(
                    baseUrl(),
                    'shop',
                    callTool(
                        'set_checkout_details',
                        { shippingAddress: { ...CUSTOM_FIELD_ADDRESS, customFields } },
                        id,
                    ),
                    { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
                );

            const internal = await call({ internalRef: 'ops-1' }, 2);
            expect(internal.body.result.isError).toBe(true);
            expect(internal.body.result.content[0].text).toContain('internalRef');

            const adminOnly = await call({ riskScore: 7 }, 3);
            expect(adminOnly.body.result.isError).toBe(true);
            expect(adminOnly.body.result.content[0].text).toContain('riskScore');
        });

        it('set_checkout_details writes a public address custom field the shopper can read back', async () => {
            const { sessionToken } = await anonymousCart();
            const written = await postMcp(
                baseUrl(),
                'shop',
                callTool(
                    'set_checkout_details',
                    {
                        shippingAddress: {
                            ...CUSTOM_FIELD_ADDRESS,
                            customFields: { deliveryNote: 'Leave with the neighbour' },
                        },
                    },
                    2,
                ),
                { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
            );
            expect(written.body.result.isError).toBeUndefined();

            // Read back over the Shop API to prove the value reached the shopper's order, not just the tool's reply.
            const shopApi = new SimpleGraphQLClient(
                config,
                `http://localhost:${config.apiOptions.port}/${config.apiOptions.shopApiPath as string}`,
            );
            shopApi.setAuthToken(sessionToken);
            const { activeOrder } = await shopApi.query(gql`
                query ActiveOrderShippingCustomFields {
                    activeOrder {
                        shippingAddress {
                            customFields {
                                deliveryNote
                            }
                        }
                    }
                }
            `);
            expect(activeOrder.shippingAddress.customFields.deliveryNote).toBe('Leave with the neighbour');
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
            const appliedOrder = applied.body.result.structuredContent.order;
            expect(appliedOrder.totalWithTax as number).toBeLessThan(fullTotal);
            // Without these two keys the agent cannot tell a coupon that reduced the price from
            // one Vendure merely accepted.
            expect(appliedOrder.couponCodes).toEqual([COUPON_CODE]);
            expect(appliedOrder.discounts).toHaveLength(1);
            expect(appliedOrder.discounts[0].description).toBe('MCP e2e coupon');
            expect(appliedOrder.discounts[0].amountWithTax).toBeLessThan(0);
            expect(typeof appliedOrder.discounts[0].amountWithTaxDecimal).toBe('string');

            const removed = await call('remove_coupon_code', { code: COUPON_CODE }, 4);
            expect(removed.body.result.isError).toBeUndefined();
            const removedOrder = removed.body.result.structuredContent.order;
            expect(removedOrder.totalWithTax).toBe(fullTotal);
            expect(removedOrder.couponCodes).toEqual([]);
            expect(removedOrder.discounts).toEqual([]);
        });

        it('apply_coupon_code lists a code whose conditions the cart does not meet without any discount', async () => {
            const bigSpendCode = 'MCP-E2E-BIG-SPEND';
            const promotion = await adminClient.query(
                gql`
                    mutation CreateBigSpendPromotion($input: CreatePromotionInput!) {
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
                        couponCode: bigSpendCode,
                        // A minimum spend no cart in this suite reaches, so the promotion is valid
                        // but never earns its discount.
                        conditions: [
                            {
                                code: 'minimum_order_amount',
                                arguments: [
                                    { name: 'amount', value: '100000000' },
                                    { name: 'taxInclusive', value: 'false' },
                                ],
                            },
                        ],
                        actions: [
                            {
                                code: 'order_percentage_discount',
                                arguments: [{ name: 'discount', value: String(COUPON_PERCENTAGE) }],
                            },
                        ],
                        translations: [
                            {
                                languageCode: LanguageCode.en,
                                name: 'MCP e2e big spend coupon',
                                description: '',
                            },
                        ],
                    },
                },
            );
            expect(promotion.createPromotion.couponCode).toBe(bigSpendCode);

            const { sessionToken, order: cart } = await anonymousCart();
            const call = (name: string, args: Record<string, unknown>, id: number) =>
                postMcp(baseUrl(), 'shop', callTool(name, args, id), {
                    headers: { [AUTH_TOKEN_HEADER]: sessionToken },
                });

            const applied = await call('apply_coupon_code', { code: bigSpendCode }, 2);
            // Vendure accepts a code whose conditions do not hold and leaves it on the cart, so
            // the call succeeds and the price does not move. Only discounts shows that.
            expect(applied.body.result.isError).toBeUndefined();
            const order = applied.body.result.structuredContent.order;
            expect(order.couponCodes).toContain(bigSpendCode);
            expect(order.discounts).toEqual([]);
            expect(order.totalWithTax).toBe(cart.totalWithTax);

            const removed = await call('remove_coupon_code', { code: bigSpendCode }, 3);
            expect(removed.body.result.isError).toBeUndefined();
            expect(removed.body.result.structuredContent.order.couponCodes).toEqual([]);
        });

        it('add_to_cart cut short by stock answers the resulting cart in the normal order shape', async () => {
            const updateVariant = gql`
                mutation UpdateShirtVariantStock($input: [UpdateProductVariantInput!]!) {
                    updateProductVariants(input: $input) {
                        id
                        stockOnHand
                        trackInventory
                    }
                }
            `;
            const current = await adminClient.query(
                gql`
                    query ShirtVariantStock($id: ID!) {
                        productVariant(id: $id) {
                            stockOnHand
                            trackInventory
                        }
                    }
                `,
                { id: secondVariantAdminId },
            );
            await adminClient.query(updateVariant, {
                input: [{ id: secondVariantAdminId, trackInventory: 'TRUE', stockOnHand: 3 }],
            });

            try {
                const cutShort = await postMcp(
                    baseUrl(),
                    'shop',
                    callTool('add_to_cart', { variantId: secondVariantId, quantity: 5 }, 1),
                );
                expect(cutShort.body.result.isError).toBe(true);
                const structured = cutShort.body.result.structuredContent;
                expect(structured).toMatchObject({
                    errorCode: 'INSUFFICIENT_STOCK_ERROR',
                    quantityAvailable: 3,
                    message: 'Only 3 items were added to the order due to insufficient stock',
                });
                // Core attaches the cart as it stands after the partial add. It goes through the
                // same serializer as a successful result, so totals and decimal prices are there
                // and the raw entity graph is not.
                expect(structured.order.totalQuantity).toBe(3);
                expect(structured.order.lines[0].quantity).toBe(3);
                expect(typeof structured.order.totalWithTaxDecimal).toBe('string');
                expect(structured.order.lines[0].productVariant).not.toHaveProperty('productVariantPrices');
                const sessionToken = structured.sessionToken as string;
                expect(sessionToken).toBeTruthy();

                const noneLeft = await postMcp(
                    baseUrl(),
                    'shop',
                    callTool('add_to_cart', { variantId: secondVariantId, quantity: 1 }, 2),
                    { headers: { [AUTH_TOKEN_HEADER]: sessionToken } },
                );
                expect(noneLeft.body.result.isError).toBe(true);
                expect(noneLeft.body.result.structuredContent).toMatchObject({
                    errorCode: 'INSUFFICIENT_STOCK_ERROR',
                    quantityAvailable: 0,
                    message: 'No items were added to the order due to insufficient stock',
                });
                expect(noneLeft.body.result.structuredContent.order.totalQuantity).toBe(3);
            } finally {
                await adminClient.query(updateVariant, {
                    input: [
                        {
                            id: secondVariantAdminId,
                            trackInventory: current.productVariant.trackInventory,
                            stockOnHand: current.productVariant.stockOnHand,
                        },
                    ],
                });
            }
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

        it("get_my_account lists the customer's saved addresses", async () => {
            const response = await postMcp(baseUrl(), 'shop', callTool('get_my_account', {}, 1), {
                token: readsAccessToken,
            });

            expect(response.body.result.isError).toBeUndefined();
            const addresses = response.body.result.structuredContent.customer.addresses;
            expect(addresses).toHaveLength(1);
            expect(addresses[0]).toMatchObject({
                id: expect.anything(),
                streetLine1: expect.any(String),
                countryCode: expect.any(String),
            });
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
                items: Array<{
                    code: string;
                    orderPlacedAt: string | null;
                    shippingLines?: unknown;
                    lines: Array<{ productVariant: { id: ID; name: string } | null }>;
                }>;
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
            // Each line names its product variant, so "what did I order?" can be answered from the list.
            expect(String(listed.items[0].lines[0].productVariant?.id)).toBe(String(variantId));
            expect(listed.items[0].lines[0].productVariant?.name).toBe(variantName);
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
