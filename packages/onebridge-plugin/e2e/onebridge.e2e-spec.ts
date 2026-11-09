import { mergeConfig, Order, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import gql from 'graphql-tag';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { Rfq } from '../src/entities/rfq.entity';
import { OnebridgePlugin } from '../src/plugin';
import { OnebridgePermissions } from '../src/permissions';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

/**
 * M1 冒烟：插件能在真实 Vendure 实例中启动，实体/迁移/customFields/权限均生效。
 * Shop/Admin resolver 的完整业务 e2e 留到 M2。
 */
describe('OnebridgePlugin · M1 骨架冒烟', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [OnebridgePlugin.init({})],
    });
    const { server, adminClient } = createTestEnvironment(config);

    beforeAll(async () => {
        await server.init({
            initialData: (await import('../../../e2e-common/e2e-initial-data')).initialData,
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('registers the four custom permissions', async () => {
        const result = (await adminClient.query(gql`
            query {
                globalSettings {
                    serverConfig {
                        permissions {
                            name
                        }
                    }
                }
            }
        `)) as any;
        const names = result.globalSettings.serverConfig.permissions.map((p: any) => p.name);
        for (const permission of Object.values(OnebridgePermissions)) {
            expect(names).toContain(permission);
        }
    });

    it('creates the onebridge_* tables via the idempotent migration', async () => {
        const connection = server.app.get(TransactionalConnection);
        const raw = connection.rawConnection;
        const rows: Array<{ name: string }> = await raw.query(
            `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'onebridge_%' ORDER BY name`,
        );
        expect(rows.map(r => r.name)).toEqual([
            'onebridge_content_entry',
            'onebridge_customs_record',
            'onebridge_exchange_rate',
            'onebridge_inspection_report',
            'onebridge_rfq',
            'onebridge_rfq_quote',
            'onebridge_rfq_sample',
            'onebridge_stage_event',
        ]);
    });

    it('adds the Order custom fields (businessLine / crossBorderStage / rfqCode)', async () => {
        const connection = server.app.get(TransactionalConnection);
        const metadata = connection.rawConnection.getMetadata(Order) as any;
        const columnNames: string[] = metadata.columns.map((c: any) => c.databaseName.toLowerCase());
        expect(columnNames.some(n => n.includes('businessline'))).toBe(true);
        expect(columnNames.some(n => n.includes('crossborder'))).toBe(true);
        expect(columnNames.some(n => n.includes('rfqcode'))).toBe(true);
    });

    it('persists an RFQ and rejects a duplicated idempotency key', async () => {
        const connection = server.app.get(TransactionalConnection);
        const repo = connection.rawConnection.getRepository(Rfq);
        const rfq = await repo.save(
            new Rfq({
                code: 'OB-20261109-0001',
                channelToken: 'onebridge',
                needType: 'collections',
                needLabel: '精选专栏询价',
                customerName: '테스트 고객',
                customerContact: '010-0000-0000',
                locale: 'ko',
                item: '10개 샘플',
                qty: '10개',
                stage: 'quoting',
                businessLine: 'pond',
                idempotencyKey: 'm1-smoke-1',
            }),
        );
        expect(rfq.id).toBeDefined();

        const duplicate = new Rfq({
            code: 'OB-20261109-0002',
            channelToken: 'onebridge',
            needType: 'collections',
            needLabel: '精选专栏询价',
            customerName: 'dup',
            customerContact: 'dup',
            locale: 'ko',
            item: 'dup',
            stage: 'quoting',
            businessLine: 'pond',
            idempotencyKey: 'm1-smoke-1',
        });
        await expect(repo.save(duplicate)).rejects.toBeTruthy();
    });
});
