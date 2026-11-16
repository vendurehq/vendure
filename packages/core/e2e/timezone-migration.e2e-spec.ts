/* eslint-disable @typescript-eslint/no-non-null-assertion */
/**
 * Upgrading an existing Postgres database from `timestamp` to `timestamptz` date columns (#1719).
 *
 * A server with the pre-v4 column type writes data while the process runs in Europe/Vienna and
 * Postgres in UTC, the usual setup of a developer machine. That data has `createdAt` 1 hour off.
 * The tests convert it with the migration helper, and check that `synchronize: true` refuses to
 * start rather than drop the columns.
 */
import {
    findTimestampColumnsToMigrate,
    mergeConfig,
    migrateTimestampColumnsToTimestamptz,
    previewTimestamptzMigration,
    revertTimestamptzMigration,
} from '@vendure/core';
import { preBootstrapConfig } from '@vendure/core/dist/bootstrap';
import { initializeDataSource } from '@vendure/core/dist/connection/initialize-data-source';
import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { DataSource, DataSourceOptions, EntitySchema, QueryRunner } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { testSuccessfulPaymentMethod } from './fixtures/test-payment-methods';
import { addItemToOrderDocument } from './graphql/shop-definitions';
import { addPaymentToOrder, proceedToArrangingPayment } from './utils/test-order-utils';

const isPostgres = process.env.DB === 'postgres';
const PROCESS_TZ = 'Europe/Vienna';
const MINUTE = 60_000;
const WINTER = '2026-01-15T12:00:00.000Z';
// Vienna fall-back: 02:30 local happens twice. A `timestamp` column written in Vienna can only
// hold one of them, and pre-v4 Vendure read it back as the first.
const DST_FIRST = '2026-10-25T00:30:00.000Z';
const DST_SECOND = '2026-10-25T01:30:00.000Z';
const DB_NAME = 'e2e_timezone_migration_e2e_spec_ts';
// The consistency check needs at least 3 orders in a month
const ORDER_COUNT = 3;

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
                reminderAt
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

const REMINDER_DEFAULT = '2026-07-15T12:00:00.000Z';

function config(timestampColumnType: 'timestamp' | 'timestamptz') {
    return mergeConfig(testConfig(), {
        paymentOptions: { paymentMethodHandlers: [testSuccessfulPaymentMethod] },
        entityOptions: { timestampColumnType },
        // The expected offsets assume a UTC session, whatever the server's timezone setting
        dbConnectionOptions: { extra: { options: '-c timezone=UTC' } },
        customFields: {
            Promotion: [
                { name: 'validFrom', type: 'datetime', nullable: true },
                {
                    name: 'reminderAt',
                    type: 'datetime',
                    nullable: true,
                    defaultValue: new Date(REMINDER_DEFAULT),
                },
            ],
        },
    });
}

function within(iso: string, [start, end]: [number, number]) {
    const t = Date.parse(iso);
    return t >= start - MINUTE && t <= end + MINUTE;
}

describe.skipIf(!isPostgres)('timestamp to timestamptz migration', () => {
    const legacy = createTestEnvironment(config('timestamp'));
    const migratedConfig = config('timestamptz');
    (migratedConfig.dbConnectionOptions as any).database = DB_NAME;
    const migrated = createTestEnvironment(migratedConfig);

    const originalTz = process.env.TZ;
    let promotionId: string;
    let promotionCreated: [number, number];
    const orders: Array<{ id: string; placed: [number, number] }> = [];
    let legacyPromotion: any;
    let legacyOrder: any;
    let dbOptions: DataSourceOptions;
    let dataSource: DataSource;

    beforeAll(async () => {
        process.env.TZ = PROCESS_TZ;
        await legacy.server.init({
            initialData: {
                ...initialData,
                paymentMethods: [
                    {
                        name: testSuccessfulPaymentMethod.code,
                        handler: { code: testSuccessfulPaymentMethod.code, arguments: [] },
                    },
                ],
            },
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await legacy.adminClient.asSuperAdmin();
        let start = Date.now();
        const { createPromotion } = await legacy.adminClient.query(CREATE_PROMOTION, {
            input: {
                enabled: true,
                couponCode: 'TZMIG',
                startsAt: DST_FIRST,
                endsAt: DST_SECOND,
                conditions: [],
                actions: [
                    { code: 'order_percentage_discount', arguments: [{ name: 'discount', value: '10' }] },
                ],
                translations: [{ languageCode: 'en', name: 'tz' }],
                customFields: { validFrom: WINTER },
            },
        });
        promotionCreated = [start, Date.now()];
        promotionId = createPromotion.id;
        await legacy.shopClient.asUserWithCredentials('hayden.zieme12@hotmail.com', 'test');
        for (let i = 0; i < ORDER_COUNT; i++) {
            start = Date.now();
            await legacy.shopClient.query(addItemToOrderDocument, { productVariantId: 'T_1', quantity: 1 });
            await proceedToArrangingPayment(legacy.shopClient);
            const order = await addPaymentToOrder(legacy.shopClient, testSuccessfulPaymentMethod);
            orders.push({ id: order.id, placed: [start, Date.now()] });
        }
        legacyPromotion = (await legacy.adminClient.query(GET_PROMOTION, { id: promotionId })).promotion;
        legacyOrder = (await legacy.adminClient.query(GET_ORDER, { id: orders[0].id })).order;
        await legacy.server.destroy();

        // The v4 entity metadata (timestamptz), without starting a server
        const runtimeConfig = await preBootstrapConfig(migratedConfig);
        dbOptions = { ...(runtimeConfig.dbConnectionOptions as any), database: DB_NAME, synchronize: false };
        dataSource = new DataSource({ ...(dbOptions as any), migrations: [] });
        await dataSource.initialize();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await dataSource?.destroy();
        await migrated.server.destroy();
        if (originalTz === undefined) {
            delete process.env.TZ;
        } else {
            process.env.TZ = originalTz;
        }
    });

    async function inTransaction<T>(work: (queryRunner: QueryRunner) => Promise<T>): Promise<T> {
        const queryRunner = dataSource.createQueryRunner();
        await queryRunner.startTransaction();
        try {
            const result = await work(queryRunner);
            await queryRunner.commitTransaction();
            return result;
        } catch (e) {
            await queryRunner.rollbackTransaction();
            throw e;
        } finally {
            await queryRunner.release();
        }
    }

    async function legacyColumnCount() {
        const queryRunner = dataSource.createQueryRunner();
        try {
            return (await findTimestampColumnsToMigrate(queryRunner)).length;
        } finally {
            await queryRunner.release();
        }
    }

    it('the legacy data has createdAt 1 hour off', () => {
        expect(within(legacyOrder.orderPlacedAt, orders[0].placed)).toBe(true);
        expect(within(legacyOrder.createdAt, orders[0].placed)).toBe(false);
    });

    it('preview lists the columns and the offset between the two timezones', async () => {
        const queryRunner = dataSource.createQueryRunner();
        const preview = await previewTimestamptzMigration(queryRunner);
        await queryRunner.release();
        expect(preview.columns.length).toBeGreaterThan(100);
        expect(preview.columns).toContainEqual(
            expect.objectContaining({
                schema: 'public',
                table: 'order',
                column: 'orderPlacedAt',
                filledByDatabase: false,
            }),
        );
        expect(preview.columns).toContainEqual(
            expect.objectContaining({ table: 'order', column: 'createdAt', filledByDatabase: true }),
        );
        expect(preview.columns).toContainEqual(
            expect.objectContaining({ table: 'promotion', column: 'customFieldsValidfrom' }),
        );
        // Vienna (CET, +1h) minus UTC
        expect(preview.offsetByMonth).toEqual([
            expect.objectContaining({ hours: 1, orders: ORDER_COUNT, conclusive: true }),
        ]);
    });

    it('does not judge months in which payments were not created as the order was placed', async () => {
        // As with an OrderPlacedStrategy which places orders before payment
        await expect(
            inTransaction(async qr => {
                await qr.query(
                    `UPDATE "payment" SET "createdAt" = "createdAt" - interval '2 days 37 minutes'`,
                );
                const preview = await previewTimestamptzMigration(qr);
                expect(preview.offsetByMonth).toEqual([expect.objectContaining({ conclusive: false })]);
                // Not refused, although these timezones are wrong for this data
                await migrateTimestampColumnsToTimestamptz(qr, { processTimezone: 'UTC', log: false });
                throw new Error('roll back');
            }),
        ).rejects.toThrow('roll back');
        expect(await legacyColumnCount()).toBeGreaterThan(100);
    });

    it('refuses a timezone which Node.js does not know', async () => {
        await expect(
            inTransaction(qr =>
                migrateTimestampColumnsToTimestamptz(qr, { processTimezone: 'Factory', log: false }),
            ),
        ).rejects.toThrow(/Node.js does not know it/);
    });

    it('refuses timezones which the orders contradict', async () => {
        await expect(
            inTransaction(qr =>
                migrateTimestampColumnsToTimestamptz(qr, { processTimezone: 'UTC', log: false }),
            ),
        ).rejects.toThrow(/do not look like they were written with processTimezone "UTC"/);
        expect(await legacyColumnCount()).toBeGreaterThan(100);
    });

    it('refuses to run outside a transaction', async () => {
        const queryRunner = dataSource.createQueryRunner();
        try {
            await expect(migrateTimestampColumnsToTimestamptz(queryRunner, { log: false })).rejects.toThrow(
                /inside a transaction/,
            );
        } finally {
            await queryRunner.release();
        }
    });

    it('synchronize refuses to start while the columns are still timestamp', async () => {
        await expect(initializeDataSource({ ...dbOptions, synchronize: true })).rejects.toThrow(
            /Set synchronize to false and run a migration/,
        );
        // Nothing was dropped
        expect(await legacyColumnCount()).toBeGreaterThan(100);
        expect(within(legacyOrder.createdAt, orders[0].placed)).toBe(false);
    });

    it('migrates, defaulting to the process and session timezones', async () => {
        const converted = await inTransaction(qr => migrateTimestampColumnsToTimestamptz(qr, { log: false }));
        expect(converted.length).toBeGreaterThan(100);
        // TypeORM would generate nothing more for the date columns, nor for the datetime default
        const diff = await dataSource.driver.createSchemaBuilder().log();
        expect(
            diff.upQueries.map(q => q.query).filter(q => /timestamp|customFieldsReminderat/i.test(q)),
        ).toEqual([]);
        // A second run is a no-op, so it needs no transaction
        const queryRunner = dataSource.createQueryRunner();
        expect(await migrateTimestampColumnsToTimestamptz(queryRunner, { log: false })).toEqual([]);
        await queryRunner.release();
    });

    async function expectCorrectValues() {
        const { promotion } = await migrated.adminClient.query(GET_PROMOTION, { id: promotionId });
        expect(
            within(promotion.createdAt, promotionCreated),
            `promotion.createdAt ${promotion.createdAt}`,
        ).toBe(true);
        for (const { id, placed } of orders) {
            const { order } = await migrated.adminClient.query(GET_ORDER, { id });
            expect(within(order.createdAt, placed), `order.createdAt ${order.createdAt}`).toBe(true);
            expect(within(order.orderPlacedAt, placed), `order.orderPlacedAt ${order.orderPlacedAt}`).toBe(
                true,
            );
        }
        // Dates written by the application keep the instant the legacy server returned for them
        expect(promotion.startsAt).toBe(DST_FIRST);
        expect(promotion.customFields.validFrom).toBe(WINTER);
        expect(promotion.endsAt).toBe(legacyPromotion.endsAt);
        expect(promotion.customFields.reminderAt).toBe(legacyPromotion.customFields.reminderAt);
    }

    it('the values are the correct instants', async () => {
        await migrated.server.bootstrap();
        await migrated.adminClient.asSuperAdmin();
        await expectCorrectValues();
    });

    it('a datetime custom field default is the configured instant', async () => {
        const { createPromotion } = await migrated.adminClient.query(CREATE_PROMOTION, {
            input: {
                enabled: true,
                couponCode: 'TZMIG2',
                conditions: [],
                actions: [
                    { code: 'order_percentage_discount', arguments: [{ name: 'discount', value: '10' }] },
                ],
                translations: [{ languageCode: 'en', name: 'tz2' }],
            },
        });
        const { promotion } = await migrated.adminClient.query(GET_PROMOTION, { id: createPromotion.id });
        expect(promotion.customFields.reminderAt).toBe(REMINDER_DEFAULT);
    });

    it('reverts, then migrates again, keeping the values and the session settings', async () => {
        const settings = `SELECT current_setting('TimeZone') AS tz, current_setting('lock_timeout') AS lt`;
        await inTransaction(async qr => {
            const [before] = await qr.query(settings);
            await revertTimestamptzMigration(qr, { log: false, lockTimeout: '5s' });
            expect(await qr.query(settings)).toEqual([before]);
            expect((await findTimestampColumnsToMigrate(qr)).length).toBeGreaterThan(100);
            await migrateTimestampColumnsToTimestamptz(qr, { log: false, lockTimeout: '5s' });
            expect(await qr.query(settings)).toEqual([before]);
        });
        await expectCorrectValues();
    });

    it("synchronize refuses to turn timestamptz columns back into 'timestamp'", async () => {
        const legacyOptions = (await preBootstrapConfig(config('timestamp'))).dbConnectionOptions;
        try {
            await expect(
                initializeDataSource({ ...(legacyOptions as any), database: DB_NAME, synchronize: true }),
            ).rejects.toThrow(/Synchronizing would drop and re-create them/);
        } finally {
            await preBootstrapConfig(migratedConfig);
        }
        expect(await legacyColumnCount()).toBe(0);
        await expectCorrectValues();
    });

    it("only converts tables in the entity's own schema", async () => {
        const schema = 'tz_custom_schema';
        const Probe = new EntitySchema<any>({
            name: 'TzProbe',
            tableName: 'tz_probe',
            schema,
            columns: {
                id: { type: Number, primary: true, generated: true },
                createdAt: { type: 'timestamptz', createDate: true },
                placedAt: { type: 'timestamptz', nullable: true },
            },
        });
        await dataSource.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
        // The same table in the session's default schema must be left alone
        for (const s of [schema, 'public']) {
            await dataSource.query(
                `CREATE TABLE "${s}"."tz_probe" (id serial PRIMARY KEY, ` +
                    `"createdAt" timestamp NOT NULL DEFAULT now(), "placedAt" timestamp)`,
            );
            await dataSource.query(
                `INSERT INTO "${s}"."tz_probe" ("placedAt") VALUES ('2026-01-15 12:00:00')`,
            );
        }
        const probeSource = new DataSource({
            ...(dbOptions as any),
            entities: [Probe],
            schema,
            migrations: [],
            subscribers: [],
        });
        await probeSource.initialize();
        try {
            const queryRunner = probeSource.createQueryRunner();
            await queryRunner.startTransaction();
            const converted = await migrateTimestampColumnsToTimestamptz(queryRunner, {
                processTimezone: 'UTC',
                log: false,
            });
            await queryRunner.commitTransaction();
            await queryRunner.release();
            expect(converted.map(c => `${c.schema}.${c.table}.${c.column}`).sort()).toEqual([
                `${schema}.tz_probe.createdAt`,
                `${schema}.tz_probe.placedAt`,
            ]);
            const types = await dataSource.query(
                `SELECT table_schema, data_type FROM information_schema.columns
                 WHERE table_name = 'tz_probe' AND column_name = 'placedAt' ORDER BY table_schema`,
            );
            expect(types).toEqual([
                { table_schema: 'public', data_type: 'timestamp without time zone' },
                { table_schema: schema, data_type: 'timestamp with time zone' },
            ]);
            const [{ placedAt }] = await probeSource.query(`SELECT "placedAt" FROM "${schema}"."tz_probe"`);
            expect(placedAt.toISOString()).toBe(WINTER);
        } finally {
            await probeSource.destroy();
            await dataSource.query(`DROP TABLE "public"."tz_probe"`);
            await dataSource.query(`DROP SCHEMA "${schema}" CASCADE`);
        }
    });
});
