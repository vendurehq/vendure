/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    Channel,
    ChannelIdentityScopeStrategy,
    ConfigService,
    Customer,
    GlobalIdentityScopeStrategy,
    IdentityScopeService,
    IdentityScopeStrategy,
    mergeConfig,
    migrateCustomerIdentityScopes,
    RequestContext,
    TransactionalConnection,
    UserService,
} from '@vendure/core';
import { createTestEnvironment, E2E_DEFAULT_CHANNEL_TOKEN } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    assignProductToChannelDocument,
    attemptLoginDocument,
    createChannelDocument,
    getCustomerListDocument,
    updateChannelDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveCustomerDocument,
    getActiveOrderDocument,
    registerAccountDocument,
    requestPasswordResetDocument,
    setCustomerDocument,
} from './graphql/shop-definitions';

/**
 * Data migration for Customer.identityScope.
 *
 * Builds realistic pre-v4 data under the default global identity, removes the new column to get
 * the pre-migration schema, then runs (1) the schema migration TypeORM generates and (2) the
 * opt-in helper that moves Customers into per-channel scopes.
 */
const BRAND_A = { code: 'mig-brand-a', token: 'mig-brand-a-token' };
const BRAND_B = { code: 'mig-brand-b', token: 'mig-brand-b-token' };

describe('Customer identity scope migration', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeConfig(mergeAuth(testConfig(), { requireVerification: false }), {
            // A list relation custom field, stored in a join table, to check that a split copies it.
            customFields: {
                Customer: [{ name: 'favouriteChannels', type: 'relation', entity: Channel, list: true }],
            },
        }),
    );
    const channelIds: Record<string, string> = {};
    let shared: { id: string; emailAddress: string };
    let storefront: { emailAddress: string };
    let defaultOnly: { emailAddress: string };

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 3,
        });
        await adminClient.asSuperAdmin();
        for (const { code, token } of [BRAND_A, BRAND_B]) {
            const { createChannel } = await adminClient.query(createChannelDocument, {
                input: {
                    code,
                    token,
                    defaultLanguageCode: LanguageCode.en,
                    currencyCode: CurrencyCode.GBP,
                    pricesIncludeTax: true,
                    defaultShippingZoneId: 'T_1',
                    defaultTaxZoneId: 'T_1',
                },
            });
            if (!('id' in createChannel)) {
                throw new Error('channel not created');
            }
            channelIds[code] = createChannel.id;
            await adminClient.query(assignProductToChannelDocument, {
                input: { channelId: createChannel.id, productIds: ['T_1'] },
            });
        }
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 3 } });
        [shared, storefront, defaultOnly] = customers.items;

        // A registered Customer who shops on both brands (auto-joined on login) with an order on each.
        for (const brand of [BRAND_A, BRAND_B]) {
            await login(brand.token, shared.emailAddress, 'test');
            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        }
        // A pending password reset token on the shared Customer's User.
        shopClient.setChannelToken(BRAND_A.token);
        await shopClient.asAnonymousUser();
        await shopClient.query(requestPasswordResetDocument, { identifier: shared.emailAddress });
        // A Customer who uses the default Channel as a storefront (an order placed there only) and
        // brand A.
        for (const token of [E2E_DEFAULT_CHANNEL_TOKEN, BRAND_A.token]) {
            await login(token, storefront.emailAddress, 'test');
            await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        }
        // A guest on brand A only, and a registration on brand B only.
        shopClient.setChannelToken(BRAND_A.token);
        await shopClient.asAnonymousUser();
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await shopClient.query(setCustomerDocument, {
            input: { emailAddress: 'guest-a@test.com', firstName: 'Guest', lastName: 'A' },
        });
        shopClient.setChannelToken(BRAND_B.token);
        await shopClient.asAnonymousUser();
        await shopClient.query(registerAccountDocument, {
            input: { emailAddress: 'only-b@test.com', password: 'test', firstName: 'Only', lastName: 'B' },
        });

        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        // A draft order an administrator created on the default Channel for the brand B customer.
        // Draft orders are not storefront use, so they must not split the customer.
        const { customers: onlyB } = await adminClient.query(getCustomerListDocument, {
            options: { filter: { emailAddress: { eq: 'only-b@test.com' } } },
        });
        const { createDraftOrder } = await adminClient.query(gql`
            mutation {
                createDraftOrder {
                    id
                }
            }
        `);
        await adminClient.query(
            gql`
                mutation ($orderId: ID!, $customerId: ID!) {
                    setCustomerForDraftOrder(orderId: $orderId, customerId: $customerId) {
                        ... on Order {
                            id
                        }
                    }
                }
            `,
            { orderId: createDraftOrder.id, customerId: onlyB.items[0].id },
        );
        // The shared customer's list relation custom field.
        await adminClient.query(
            gql`
                mutation ($id: ID!, $channelIds: [ID!]) {
                    updateCustomer(input: { id: $id, customFields: { favouriteChannelsIds: $channelIds } }) {
                        ... on Customer {
                            id
                        }
                    }
                }
            `,
            { id: shared.id, channelIds: [channelIds[BRAND_A.code], channelIds[BRAND_B.code]] },
        );
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function login(channelToken: string, username: string, password: string) {
        shopClient.setChannelToken(channelToken);
        await shopClient.asAnonymousUser();
        const { login: result } = await shopClient.query(attemptLoginDocument, { username, password });
        shopClient.setChannelToken(channelToken);
        return result as any;
    }

    function rawConnection() {
        return server.app.get(TransactionalConnection).rawConnection;
    }

    /** Quotes an identifier for the database under test. */
    function quote(name: string) {
        return rawConnection().driver.escape(name);
    }

    /** A positional parameter placeholder for the database under test. */
    function p(index: number) {
        return rawConnection().options.type === 'postgres' ? `$${index}` : '?';
    }

    async function customerRows(): Promise<
        Array<{ id: number; emailAddress: string; identityScope: string; userId: number | null }>
    > {
        return rawConnection().query(
            `SELECT ${quote('id')}, ${quote('emailAddress')}, ${quote('identityScope')}, ${quote('userId')}
             FROM ${quote('customer')} ORDER BY ${quote('id')}`,
        );
    }

    it('the default migration only adds the column and index, and every Customer is global', async () => {
        const qr = rawConnection().createQueryRunner();
        const isSqlite = ['sqljs', 'sqlite', 'better-sqlite3'].includes(rawConnection().options.type);
        // SQLite rebuilds the table to add or drop a column. TypeORM's migration runner does the
        // same with foreign key checks off.
        if (isSqlite) {
            await qr.query('PRAGMA foreign_keys = OFF');
        }
        // Recreate the pre-v4 schema.
        await qr.dropIndex('customer', 'IDX_CUSTOMER_IDENTITY_SCOPE_EMAIL');
        await qr.dropColumn('customer', 'identityScope');
        expect((await qr.getTable('customer'))!.findColumnByName('identityScope')).toBeUndefined();

        // What `vendure migrate` would generate for this change.
        const sqlInMemory = await rawConnection().driver.createSchemaBuilder().log();
        const upQueries = sqlInMemory.upQueries.map(q => q.query);
        expect(upQueries.length).toBeGreaterThan(0);
        expect(upQueries.every(q => /customer/i.test(q))).toBe(true);
        for (const q of sqlInMemory.upQueries) {
            await qr.query(q.query, q.parameters);
        }
        if (isSqlite) {
            await qr.query('PRAGMA foreign_keys = ON');
        }
        await qr.release();

        const rows = await customerRows();
        expect(rows.length).toBe(5);
        expect(new Set(rows.map(r => r.identityScope))).toEqual(new Set(['global']));

        // Code without a Channel keeps working under the default strategy.
        await expect(
            server.app
                .get(UserService)
                .getUserByEmailAddress(RequestContext.empty(), shared.emailAddress, 'customer'),
        ).resolves.toBeDefined();

        // Nothing changes for users: the shared Customer still logs in on both brands.
        expect((await login(BRAND_A.token, shared.emailAddress, 'test')).identifier).toBe(
            shared.emailAddress,
        );
        expect((await login(BRAND_B.token, shared.emailAddress, 'test')).identifier).toBe(
            shared.emailAddress,
        );
    });

    it('opting into per-channel scopes assigns single-scope Customers and splits shared ones', async () => {
        // A Customer created outside the CustomerService, with no Channel membership.
        await rawConnection()
            .getRepository(Customer)
            .save(
                new Customer({ emailAddress: 'no-channel@test.com', firstName: 'No', lastName: 'Channel' }),
            );
        // A guest Customer on brand B with the email of the brand B registration, as pre-v4 data can
        // hold (OSS-912). Both end up in brand B's scope.
        await rawConnection()
            .getRepository(Customer)
            .save(
                new Customer({
                    emailAddress: 'only-b@test.com',
                    firstName: 'Guest',
                    lastName: 'B',
                    channels: [{ id: idOf(BRAND_B) } as any],
                }),
            );
        const strategy = new ChannelIdentityScopeStrategy();
        const qr = rawConnection().createQueryRunner();
        const dryRun = await migrateCustomerIdentityScopes(qr, strategy, { dryRun: true });
        expect(new Set((await customerRows()).map(r => r.identityScope))).toEqual(new Set(['global']));
        const result = await migrateCustomerIdentityScopes(qr, strategy);
        await qr.release();
        expect(dryRun).toEqual(result);
        expect(result.duplicateEmails).toEqual([
            {
                identityScope: `channel:${idOf(BRAND_B)}`,
                emailAddress: 'only-b@test.com',
                customerIds: expect.any(Array),
            },
        ]);
        // Switch the running server to the strategy the migration was written for.
        server.app.get(ConfigService).authOptions.identityScopeStrategy = new ChannelIdentityScopeStrategy();

        expect(result.split).toBe(2);
        expect(result.copiesCreated).toBe(2);
        expect(result.withoutChannel).toBe(1);

        const rows = await customerRows();
        const byEmail = (e: string) => rows.filter(r => r.emailAddress === e);
        const sharedRows = byEmail(shared.emailAddress);
        expect(sharedRows.map(r => r.identityScope).sort()).toEqual(
            [`channel:${idOf(BRAND_A)}`, `channel:${idOf(BRAND_B)}`].sort(),
        );
        expect(sharedRows[0].userId).not.toBe(sharedRows[1].userId);
        expect(byEmail('guest-a@test.com')[0].identityScope).toBe(`channel:${idOf(BRAND_A)}`);
        expect(byEmail('only-b@test.com')[0].identityScope).toBe(`channel:${idOf(BRAND_B)}`);
        expect(byEmail(defaultOnly.emailAddress)[0].identityScope).toBe('channel:1');
        expect(byEmail('no-channel@test.com')[0].identityScope).toBe('channel:1');
        // The default Channel counts as a storefront for a Customer who placed an order there.
        expect(
            byEmail(storefront.emailAddress)
                .map(r => r.identityScope)
                .sort(),
        ).toEqual(['channel:1', `channel:${idOf(BRAND_A)}`].sort());
    });

    it('a draft order on the default Channel does not split a customer', async () => {
        const onlyB = (await customerRows()).filter(r => r.emailAddress === 'only-b@test.com');
        expect(new Set(onlyB.map(r => r.identityScope))).toEqual(new Set([`channel:${idOf(BRAND_B)}`]));
    });

    it('the split copies list relation custom fields', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { customers } = await adminClient.query(
            gql`
                query ($email: String!) {
                    customers(options: { filter: { emailAddress: { eq: $email } } }) {
                        items {
                            id
                            customFields {
                                favouriteChannels {
                                    code
                                }
                            }
                        }
                    }
                }
            `,
            { email: shared.emailAddress },
        );
        expect(customers.items.length).toBe(2);
        for (const customer of customers.items) {
            expect(customer.customFields.favouriteChannels.map((c: any) => c.code).sort()).toEqual(
                [BRAND_A.code, BRAND_B.code].sort(),
            );
        }
    });

    it('the split copies addresses and logins, but not pending tokens', async () => {
        const rows = (await customerRows()).filter(r => r.emailAddress === shared.emailAddress);
        const [original, copy] = rows;
        const addressCount = async (customerId: number) =>
            Number(
                (
                    await rawConnection().query(
                        `SELECT COUNT(*) AS ${quote('n')} FROM ${quote('address')} WHERE ${quote('customerId')} = ${p(1)}`,
                        [customerId],
                    )
                )[0].n,
            );
        expect(await addressCount(original.id)).toBeGreaterThan(0);
        expect(await addressCount(copy.id)).toBe(await addressCount(original.id));

        const tokens = async (userId: number | null) =>
            (
                await rawConnection().query(
                    `SELECT ${quote('passwordResetToken')}, ${quote('verificationToken')}, ${quote('identifierChangeToken')}
                     FROM ${quote('authentication_method')} WHERE ${quote('userId')} = ${p(1)}`,
                    [userId],
                )
            )[0];
        expect((await tokens(original.userId)).passwordResetToken).toBeTruthy();
        expect(await tokens(copy.userId)).toEqual({
            passwordResetToken: null,
            verificationToken: null,
            identifierChangeToken: null,
        });
    });

    it('after the split, a Customer can still log in on the default storefront and brand A', async () => {
        const onDefault = await login(E2E_DEFAULT_CHANNEL_TOKEN, storefront.emailAddress, 'test');
        const { activeOrder: orderDefault } = await shopClient.query(getActiveOrderDocument);
        const onA = await login(BRAND_A.token, storefront.emailAddress, 'test');
        expect(onDefault.identifier).toBe(storefront.emailAddress);
        expect(onA.identifier).toBe(storefront.emailAddress);
        expect(onDefault.id).not.toBe(onA.id);
        expect(orderDefault?.lines.length).toBe(1);
    });

    it('after the split, the same password works on both brands and each sees its own order', async () => {
        const onA = await login(BRAND_A.token, shared.emailAddress, 'test');
        const { activeOrder: orderA } = await shopClient.query(getActiveOrderDocument);
        const onB = await login(BRAND_B.token, shared.emailAddress, 'test');
        const { activeOrder: orderB } = await shopClient.query(getActiveOrderDocument);

        expect(onA.id).not.toBe(onB.id);
        expect(onA.channels.map((ch: any) => ch.code)).toEqual([BRAND_A.code]);
        expect(onB.channels.map((ch: any) => ch.code)).toEqual([BRAND_B.code]);
        expect(orderA?.lines.length).toBe(1);
        expect(orderB?.lines.length).toBe(1);
        expect(orderA?.id).not.toBe(orderB?.id);
    });

    it('the default channel still lists both copies in the Admin API', async () => {
        adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { filter: { emailAddress: { eq: shared.emailAddress } } },
        });
        expect(customers.totalItems).toBe(2);
    });

    it('sessions are anonymous on a Channel outside their scope after the migration', async () => {
        await login(BRAND_A.token, shared.emailAddress, 'test');
        shopClient.setChannelToken(BRAND_B.token);
        // The brand A session is a guest on brand B, so it can check out as one.
        await shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        const { setCustomerForOrder } = await shopClient.query(setCustomerDocument, {
            input: { emailAddress: 'someone@test.com', firstName: 'Some', lastName: 'One' },
        });
        expect((setCustomerForOrder as any).errorCode).toBeUndefined();
        const { activeCustomer } = await shopClient.query(getActiveCustomerDocument);
        expect(activeCustomer).toBeNull();
    });

    it('the startup check accepts the migrated data and refuses going back to the global strategy', async () => {
        const authOptions = server.app.get(ConfigService).authOptions;
        const identityScopeService = server.app.get(IdentityScopeService);
        await expect(identityScopeService.onApplicationBootstrap()).resolves.toBeUndefined();

        authOptions.identityScopeStrategy = new GlobalIdentityScopeStrategy();
        try {
            await expect(identityScopeService.onApplicationBootstrap()).rejects.toThrow(
                /does not match the identity scopes stored on Customers/,
            );
        } finally {
            authOptions.identityScopeStrategy = new ChannelIdentityScopeStrategy();
        }
    });

    it('refuses a Channel update that would move its Customers to another scope', async () => {
        const authOptions = server.app.get(ConfigService).authOptions;
        // A strategy that reads an editable value, as a custom field based one would.
        const codeBased: IdentityScopeStrategy = {
            getIdentityScope: (channel: Channel) =>
                channel.code === 'renamed-brand-a' ? 'renamed' : `channel:${channel.id}`,
        };
        authOptions.identityScopeStrategy = codeBased;
        try {
            adminClient.setChannelToken(E2E_DEFAULT_CHANNEL_TOKEN);
            await expect(
                adminClient.query(updateChannelDocument, {
                    input: { id: channelIds[BRAND_A.code], code: 'renamed-brand-a' },
                }),
            ).rejects.toThrow(/would move the Channel from identity scope/);
        } finally {
            authOptions.identityScopeStrategy = new ChannelIdentityScopeStrategy();
        }
    });

    function idOf(brand: { code: string }) {
        return channelIds[brand.code].replace(/^T_/, '');
    }
});

function mergeAuth<T extends { authOptions: any }>(config: T, authOptions: Record<string, any>): T {
    return { ...config, authOptions: { ...config.authOptions, ...authOptions } };
}
