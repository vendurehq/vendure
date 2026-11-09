/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import {
    ChannelIdentityScopeStrategy,
    ConfigService,
    migrateCustomerIdentityScopes,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import fs from 'fs';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    assignProductToChannelDocument,
    attemptLoginDocument,
    createChannelDocument,
    getCustomerListDocument,
} from './graphql/shared-definitions';
import {
    addItemToOrderDocument,
    getActiveOrderDocument,
    registerAccountDocument,
    setCustomerDocument,
} from './graphql/shop-definitions';

/**
 * OSS-999 spike: data migration for Customer.identityScope.
 *
 * Builds realistic pre-v4 data under the default global identity, removes the new column to get
 * the pre-migration schema, then runs (1) the schema migration TypeORM generates and (2) the
 * opt-in helper that moves Customers into per-channel scopes.
 */
const BRAND_A = { code: 'mig-brand-a', token: 'mig-brand-a-token' };
const BRAND_B = { code: 'mig-brand-b', token: 'mig-brand-b-token' };

describe('Customer identity scope migration (OSS-999)', () => {
    const { server, adminClient, shopClient } = createTestEnvironment(
        mergeAuth(testConfig(), { requireVerification: false }),
    );
    const channelIds: Record<string, string> = {};
    let shared: { emailAddress: string };

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 2,
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
        const { customers } = await adminClient.query(getCustomerListDocument, { options: { take: 1 } });
        shared = customers.items[0];

        // A registered Customer who shops on both brands (auto-joined on login) with an order on each.
        for (const brand of [BRAND_A, BRAND_B]) {
            await login(brand.token, shared.emailAddress, 'test');
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

    async function customerRows() {
        return rawConnection().query(
            'SELECT "id", "emailAddress", "identityScope", "userId" FROM "customer" ORDER BY "id"',
        ) as Promise<Array<{ id: number; emailAddress: string; identityScope: string; userId: number }>>;
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
        if (process.env.OSS999_SQL_OUT) {
            fs.writeFileSync(process.env.OSS999_SQL_OUT, upQueries.join(';\n') + ';\n');
        }
        expect(upQueries.every(q => /customer/i.test(q))).toBe(true);
        for (const q of sqlInMemory.upQueries) {
            await qr.query(q.query, q.parameters);
        }
        if (isSqlite) {
            await qr.query('PRAGMA foreign_keys = ON');
        }
        await qr.release();

        const rows = await customerRows();
        expect(rows.length).toBeGreaterThanOrEqual(4);
        expect(new Set(rows.map(r => r.identityScope))).toEqual(new Set(['global']));

        // Nothing changes for users: the shared Customer still logs in on both brands.
        expect((await login(BRAND_A.token, shared.emailAddress, 'test')).identifier).toBe(
            shared.emailAddress,
        );
        expect((await login(BRAND_B.token, shared.emailAddress, 'test')).identifier).toBe(
            shared.emailAddress,
        );
    });

    it('opting into per-channel scopes assigns single-scope Customers and splits shared ones', async () => {
        const qr = rawConnection().createQueryRunner();
        const result = await migrateCustomerIdentityScopes(qr, ch => `channel:${ch.id}`);
        await qr.release();
        // Switch the running server to the strategy the migration was written for.
        server.app.get(ConfigService).authOptions.identityScopeStrategy = new ChannelIdentityScopeStrategy();

        expect(result.split).toBe(1);
        expect(result.copiesCreated).toBe(1);

        const rows = await customerRows();
        const byEmail = (e: string) => rows.filter(r => r.emailAddress === e);
        const sharedRows = byEmail(shared.emailAddress);
        expect(sharedRows.map(r => r.identityScope).sort()).toEqual(
            [`channel:${idOf(BRAND_A)}`, `channel:${idOf(BRAND_B)}`].sort(),
        );
        expect(sharedRows[0].userId).not.toBe(sharedRows[1].userId);
        expect(byEmail('guest-a@test.com')[0].identityScope).toBe(`channel:${idOf(BRAND_A)}`);
        expect(byEmail('only-b@test.com')[0].identityScope).toBe(`channel:${idOf(BRAND_B)}`);
        // The second populated Customer only ever used the default Channel.
        const defaultOnly = rows.find(
            r => ![shared.emailAddress, 'guest-a@test.com', 'only-b@test.com'].includes(r.emailAddress),
        )!;
        expect(defaultOnly.identityScope).toBe('channel:1');
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
        adminClient.setChannelToken('e2e-default-channel');
        const { customers } = await adminClient.query(getCustomerListDocument, {
            options: { filter: { emailAddress: { eq: shared.emailAddress } } },
        });
        expect(customers.totalItems).toBe(2);
    });

    function idOf(brand: { code: string }) {
        return channelIds[brand.code].replace(/^T_/, '');
    }
});

function mergeAuth<T extends { authOptions: any }>(config: T, authOptions: Record<string, any>): T {
    return { ...config, authOptions: { ...config.authOptions, ...authOptions } };
}
