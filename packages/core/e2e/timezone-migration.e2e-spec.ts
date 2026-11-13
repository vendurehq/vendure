/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * OSS-1007: migrating an existing Postgres database from `timestamp` to `timestamptz`.
 *
 * 1. Runs a server with the pre-v4 column type and writes data in the current process TZ.
 * 2. Runs `migrateTimestampColumnsToTimestamptz()` with the TZ the data was written in.
 * 3. Starts a server with `timestamptz` on the same database and checks every value.
 *
 * Postgres only: `TZ=Europe/Vienna DB=postgres ... vitest timezone-migration`
 */
import { mergeConfig, migrateTimestampColumnsToTimestamptz, previewTimestamptzMigration, revertTimestamptzMigration } from '@vendure/core';
import { preBootstrapConfig } from '@vendure/core/dist/bootstrap';
import { initializeDataSource } from '@vendure/core/dist/connection/initialize-data-source';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { DataSource } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

const isPostgres = process.env.DB === 'postgres';
const PROCESS_TZ = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
const MINUTE = 60_000;
const WINTER = '2026-01-15T12:00:00.000Z';
const DST_FIRST = '2026-10-25T00:30:00.000Z';
const DST_SECOND = '2026-10-25T01:30:00.000Z';
const DB_NAME = 'e2e_timezone_migration_e2e_spec_ts';

const CREATE_PROMOTION = gql`
    mutation CreatePromotion($input: CreatePromotionInput!) {
        createPromotion(input: $input) {
            ... on Promotion {
                id
            }
        }
    }
`;
const GET_PROMOTION = gql`
    query GetPromotion($id: ID!) {
        promotion(id: $id) {
            id
            createdAt
            startsAt
            endsAt
            customFields {
                validFrom
            }
        }
    }
`;
const GET_ORDER = gql`
    query GetOrderDates($id: ID!) {
        order(id: $id) {
            id
            createdAt
            orderPlacedAt
        }
    }
`;

function config(timestampColumnType: 'timestamp' | 'timestamptz') {
    return mergeConfig(testConfig(), {
        paymentOptions: { paymentMethodHandlers: [testSuccessfulPaymentMethod] },
        entityOptions: { timestampColumnType },
        customFields: { Promotion: [{ name: 'validFrom', type: 'datetime', nullable: true }] },
    });
}

describe.skipIf(!isPostgres)(`timestamp -> timestamptz migration (process TZ ${PROCESS_TZ})`, () => {
    const legacy = createTestEnvironment(config('timestamp'));
    const migratedConfig = config('timestamptz');
    (migratedConfig.dbConnectionOptions as any).database = DB_NAME;
    const migrated = createTestEnvironment(migratedConfig);

    let promotionId: string;
    let orderId: string;
    let promotionCreated: [number, number];
    let orderPlaced: [number, number];
    const legacyValues: Record<string, any> = {};

    beforeAll(async () => {
        await legacy.server.init({
            initialData: {
                ...initialData,
                paymentMethods: [{ name: testSuccessfulPaymentMethod.code, handler: { code: testSuccessfulPaymentMethod.code, arguments: [] } }],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await legacy.adminClient.asSuperAdmin();
        let t0 = Date.now();
        const { createPromotion } = await legacy.adminClient.query(CREATE_PROMOTION, {
            input: {
                enabled: true,
                couponCode: 'TZMIG',
                startsAt: DST_FIRST,
                endsAt: DST_SECOND,
                conditions: [],
                actions: [{ code: 'order_percentage_discount', arguments: [{ name: 'discount', value: '10' }] }],
                translations: [{ languageCode: 'en', name: 'tz' }],
                customFields: { validFrom: WINTER },
            },
        });
        promotionCreated = [t0, Date.now()];
        promotionId = createPromotion.id;
        await legacy.shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        t0 = Date.now();
        await legacy.shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
        await proceedToArrangingPayment(legacy.shopClient);
        const order = await addPaymentToOrder(legacy.shopClient, testSuccessfulPaymentMethod);
        orderPlaced = [t0, Date.now()];
        orderId = order.id;
        legacyValues.promotion = (await legacy.adminClient.query(GET_PROMOTION, { id: promotionId })).promotion;
        legacyValues.order = (await legacy.adminClient.query(GET_ORDER, { id: orderId })).order;
        await legacy.server.destroy();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await migrated.server.destroy();
    });

    let dataSource: DataSource;

    it('migrates', async () => {
        // Build the v4 entity metadata (timestamptz) without starting a server
        const { dbConnectionOptions } = await preBootstrapConfig(migratedConfig);
        // synchronize would drop and re-add the columns, so it must refuse
        await expect(
            initializeDataSource({ ...(dbConnectionOptions as any), database: DB_NAME, synchronize: true }),
        ).rejects.toThrow(/deletes their data/);
        dataSource = new DataSource({ ...(dbConnectionOptions as any), database: DB_NAME, synchronize: false, migrations: [] });
        await dataSource.initialize();

        const preview = await previewTimestamptzMigration(dataSource.createQueryRunner());
        // eslint-disable-next-line no-console
        console.log('preview', JSON.stringify({ ...preview, columns: preview.columns.length }), JSON.stringify(preview.columns.filter(c => ['order', 'promotion'].includes(c.table))));
        expect(preview.columns.find(c => c.table === 'order' && c.column === 'orderPlacedAt')).toBeDefined();
        expect(preview.columns.find(c => c.table === 'promotion' && c.column === 'customFieldsValidfrom')).toBeDefined();

        const qr = dataSource.createQueryRunner();
        await qr.startTransaction();
        const converted = await migrateTimestampColumnsToTimestamptz(qr, { processTimezone: PROCESS_TZ, log: false });
        await qr.commitTransaction();
        await qr.release();
        // eslint-disable-next-line no-console
        console.log(`converted ${converted.length} columns`);
        expect(converted.length).toBeGreaterThan(50);

        // What TypeORM would still generate: nothing for the date columns
        const diff = await dataSource.driver.createSchemaBuilder().log();
        const dateQueries = diff.upQueries.map(q => q.query).filter(q => /timestamp|createdAt|updatedAt|At"/i.test(q));
        expect(dateQueries).toEqual([]);
        // running it again is a no-op
        expect(await migrateTimestampColumnsToTimestamptz(dataSource.createQueryRunner(), { processTimezone: PROCESS_TZ })).toEqual([]);
    });

    it('values are the correct instants after migrating', async () => {
        await migrated.server.bootstrap();
        await migrated.adminClient.asSuperAdmin();
        const { promotion } = await migrated.adminClient.query(GET_PROMOTION, { id: promotionId });
        const { order } = await migrated.adminClient.query(GET_ORDER, { id: orderId });
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({ legacy: legacyValues, migrated: { promotion, order } }, null, 2));

        const within = (iso: string, [a, b]: [number, number]) => {
            const t = Date.parse(iso);
            return t >= a - MINUTE && t <= b + MINUTE;
        };
        expect(within(promotion.createdAt, promotionCreated), `promotion.createdAt ${promotion.createdAt}`).toBe(true);
        expect(within(order.createdAt, orderPlaced), `order.createdAt ${order.createdAt}`).toBe(true);
        expect(within(order.orderPlacedAt, orderPlaced), `order.orderPlacedAt ${order.orderPlacedAt}`).toBe(true);
        expect(promotion.startsAt).toBe(DST_FIRST);
        expect(promotion.customFields.validFrom).toBe(WINTER);
        // The second 02:30 of the Vienna fall-back day was already stored ambiguously before the
        // migration, so it can't be recovered when the process TZ was Europe/Vienna.
        if (PROCESS_TZ !== 'Europe/Vienna') {
            expect(promotion.endsAt).toBe(DST_SECOND);
        }
        // The values the legacy server returned for explicit dates are unchanged
        expect(order.orderPlacedAt).toBe(legacyValues.order.orderPlacedAt);
        expect(promotion.startsAt).toBe(legacyValues.promotion.startsAt);
    });

    it('revert, then migrate again, keeps the values', async () => {
        const qr = dataSource.createQueryRunner();
        await qr.startTransaction();
        await revertTimestamptzMigration(qr, { processTimezone: PROCESS_TZ, log: false });
        expect((await previewTimestamptzMigration(qr)).columns.length).toBeGreaterThan(50);
        await migrateTimestampColumnsToTimestamptz(qr, { processTimezone: PROCESS_TZ, log: false });
        await qr.commitTransaction();
        await qr.release();
        const { order } = await migrated.adminClient.query(GET_ORDER, { id: orderId });
        expect(Date.parse(order.orderPlacedAt)).toBeGreaterThanOrEqual(orderPlaced[0] - MINUTE);
        expect(Date.parse(order.orderPlacedAt)).toBeLessThanOrEqual(orderPlaced[1] + MINUTE);
        await dataSource.destroy();
    });
});
