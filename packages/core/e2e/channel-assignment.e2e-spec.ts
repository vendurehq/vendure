import { ChannelAssignmentService, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

/**
 * Every ChannelAware entity has a channel assignment entity which owns the junction table of its
 * `channels` relation (see `ChannelAssignment`).
 */
describe('Channel assignment entities', () => {
    const { server, adminClient } = createTestEnvironment(testConfig());

    const CHANNEL_AWARE = [
        'Asset',
        'ApiKey',
        'Collection',
        'Customer',
        'Facet',
        'FacetValue',
        'Order',
        'PaymentMethod',
        'Product',
        'ProductOption',
        'ProductOptionGroup',
        'ProductVariant',
        'Promotion',
        'ShippingMethod',
        'StockLocation',
    ];

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

    it('every ChannelAware entity has a channel assignment entity owning its junction table', () => {
        const service = server.app.get(ChannelAssignmentService);
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        for (const name of CHANNEL_AWARE) {
            const entityMetadata = dataSource.getMetadata(name);
            const meta = service.getMetadata(entityMetadata.target as any);
            expect(meta?.target.name, name).toBe(`${name}Channel`);
            const junction = entityMetadata.findRelationWithPropertyPath('channels')?.junctionEntityMetadata;
            expect(meta && dataSource.getMetadata(meta.target).tableName).toBe(junction?.tableName);
        }
    });

    it('the channels relations still read and write the junction tables', async () => {
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const product = await dataSource
            .getRepository('Product')
            .findOne({ where: { id: 1 }, relations: { channels: true } });
        expect(product?.channels.map((c: any) => c.code)).toEqual(['__default_channel__']);
        const rows = await dataSource.getRepository('ProductChannel').find({ where: { productId: 1 } });
        expect(rows.map((r: any) => r.channelId)).toEqual([1]);
    });

    it('schema synchronization keeps every junction row', async () => {
        const dataSource = server.app.get(TransactionalConnection).rawConnection;
        const count = async () => {
            const result: Record<string, number> = {};
            for (const name of CHANNEL_AWARE) {
                result[name] = await dataSource.getRepository(`${name}Channel`).count();
            }
            return result;
        };
        const before = await count();
        expect(before.Product).toBeGreaterThan(0);
        await dataSource.synchronize();
        await dataSource.synchronize();
        expect(await count()).toEqual(before);
    });
});
