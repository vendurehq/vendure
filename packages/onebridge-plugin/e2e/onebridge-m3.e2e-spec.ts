import { mergeConfig, TransactionalConnection } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import gql from 'graphql-tag';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { OnebridgePlugin } from '../src/plugin';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

/**
 * M3 联调桩：韩国 PG 回调契约（路径/错误映射/幂等/paid 节点）与 C 端字段别名。
 */
describe('OnebridgePlugin · M3 联调桩', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [OnebridgePlugin.init({})],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);
    let baseUrl: string;

    beforeAll(async () => {
        await server.init({
            initialData: (await import('../../../e2e-common/e2e-initial-data')).initialData,
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        const address = (server.app.getHttpServer().address() as any) ?? {};
        baseUrl = `http://127.0.0.1:${address.port}`;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function postCallback(body: Record<string, unknown>) {
        const res = await fetch(`${baseUrl}/onebridge/payments/korea-pg/callback`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        return { status: res.status, body: (await res.json()) as any };
    }

    it('回调端点已注册；未知订单返回 400 + ORDER_NOT_FOUND', async () => {
        const res = await postCallback({ orderCode: 'PP-NOT-EXIST', transactionId: 'tx-1', status: 'paid' });
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('缺少必填字段返回 400', async () => {
        const res = await postCallback({ transactionId: 'tx-1', status: 'paid' });
        expect(res.status).toBe(400);
    });

    it('paid 回调写 paid 节点，重复回调幂等并返回 PAYMENT_CALLBACK_DUPLICATE', async () => {
        const addResult = (await shopClient.query(gql`
            mutation {
                addItemToOrder(productVariantId: 1, quantity: 1) {
                    ... on Order {
                        code
                        totalWithTax
                        currencyCode
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `)) as any;
        expect(addResult.addItemToOrder.code).toBeTruthy();

        const order = addResult.addItemToOrder;
        const payload = {
            orderCode: order.code,
            transactionId: 'STUB-TX-M3-1',
            status: 'paid',
            amount: order.totalWithTax,
            currencyCode: order.currencyCode,
        };

        const first = await postCallback(payload);
        expect(first.status).toBe(200);
        expect(first.body).toMatchObject({ success: true, duplicate: false, orderCode: order.code });

        const second = await postCallback({ ...payload, transactionId: 'STUB-TX-M3-2' });
        expect(second.status).toBe(200);
        expect(second.body).toMatchObject({
            success: true,
            duplicate: true,
            code: 'PAYMENT_CALLBACK_DUPLICATE',
        });

        const connection = server.app.get(TransactionalConnection);
        const rows: Array<{ stage: string; idempotencyKey: string; titleCn: string }> = await connection.rawConnection.query(
            `SELECT stage, idempotencyKey, titleCn FROM onebridge_stage_event WHERE ownerType='order' AND ownerCode=?`,
            [order.code],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ stage: 'wait_pay', titleCn: '支付完成' });
        expect(rows[0].idempotencyKey).toContain(':paid');
    });

    it('金额/币种不符时拒绝落账', async () => {
        const addResult = (await shopClient.query(gql`
            mutation {
                addItemToOrder(productVariantId: 1, quantity: 1) {
                    ... on Order {
                        code
                        totalWithTax
                        currencyCode
                    }
                    ... on ErrorResult {
                        errorCode
                        message
                    }
                }
            }
        `)) as any;
        const order = addResult.addItemToOrder;
        const mismatch = await postCallback({
            orderCode: order.code,
            transactionId: 'STUB-TX-M3-3',
            status: 'paid',
            amount: order.totalWithTax + 1,
            currencyCode: order.currencyCode,
        });
        expect(mismatch.status).toBe(400);
    });

    it('清关记录暴露 C 端字段别名与时间轴', async () => {
        await adminClient.query(gql`
            mutation {
                upsertOnebridgeCustomsRecord(
                    input: {
                        orderCode: "PP-ALIAS-1"
                        customsStatus: declared
                        declarationNo: "DECL-1"
                        note: "note"
                        docs: ["a.pdf"]
                    }
                ) {
                    id
                }
            }
        `);
        const result = (await adminClient.query(gql`
            query {
                onebridgeCustomsRecord(orderCode: "PP-ALIAS-1") {
                    customsStatus
                    customsDeclaredAt
                    customsClearedAt
                    customsNote
                    customsDocs
                    timeline {
                        stage
                        state
                    }
                }
            }
        `)) as any;
        const record = result.onebridgeCustomsRecord;
        expect(record.customsNote).toBe('note');
        expect(record.customsDocs).toEqual(['a.pdf']);
        expect(record.customsDeclaredAt).toBeTruthy();
        expect(Array.isArray(record.timeline)).toBe(true);
    });
});
