import { mergeConfig, TransactionalConnection, UuidIdStrategy } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import {
    TestChannelThing,
    TestChannelThingChannel,
    TestChannelThingPlugin,
} from './fixtures/test-plugins/channel-assignment-test-plugin';

/**
 * Channel assignment entities with UUID ids: the junction key columns must match the referenced
 * primary keys exactly (e.g. varchar(36) on MySQL), otherwise schema sync rebuilds them.
 */
describe('Channel assignment entities with UuidIdStrategy', () => {
    const { server, adminClient } = createTestEnvironment(
        mergeConfig(testConfig(), {
            entityOptions: { entityIdStrategy: new UuidIdStrategy() },
            plugins: [TestChannelThingPlugin],
        }),
    );

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, 'fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('schema sync finds no difference between the entities and the database', async () => {
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const { upQueries } = await dataSource.driver.createSchemaBuilder().log();
        expect(upQueries.map(q => q.query)).toEqual([]);
    });

    it('schema sync keeps junction rows and per-channel values', async () => {
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const channel = await dataSource.getRepository('Channel').findOneOrFail({ where: {} });
        const thing = await dataSource
            .getRepository(TestChannelThing)
            .save(new TestChannelThing({ name: 'uuid', channels: [channel as any] }));
        const rows = dataSource.getRepository(TestChannelThingChannel);
        await rows.update({ testChannelThingId: thing.id }, { note: 'kept' });
        const productRowsBefore = await dataSource.getRepository('ProductChannel').count();

        await dataSource.synchronize();
        await dataSource.synchronize();

        expect(await dataSource.getRepository('ProductChannel').count()).toBe(productRowsBefore);
        expect((await rows.findOneByOrFail({ testChannelThingId: thing.id })).note).toBe('kept');
    });
});
