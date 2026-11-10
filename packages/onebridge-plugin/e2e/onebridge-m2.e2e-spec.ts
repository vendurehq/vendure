import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, SimpleGraphQLClient } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';
import { OnebridgePlugin } from '../src/plugin';

const SUBMIT_RFQ = gql`
    mutation ($input: SubmitRfqInput!) {
        submitRfq(input: $input) {
            id
            code
            stage
            needLabel
            customer {
                name
                contact
                locale
            }
            requirement {
                item
            }
            timeline {
                stage
                title
                state
            }
        }
    }
`;

const ADMIN_RFQ = gql`
    query ($id: ID, $code: String) {
        onebridgeRfq(id: $id, code: $code) {
            id
            code
            stage
            customer {
                name
                customerId
            }
            quote {
                amount
                currency
            }
            sample {
                status
                trackingNo
            }
            timeline {
                stage
                state
            }
        }
    }
`;

/** 业务错误码从 GraphQL extensions.code 读取（OnebridgeError extends I18nError） */
function expectCode(e: any, code: string) {
    const actual = e?.response?.errors?.[0]?.extensions?.code ?? e?.message ?? '';
    expect(actual).toBe(code);
}

describe('OnebridgePlugin · M2 接口', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [OnebridgePlugin.init({})],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);

    const emailA = 'onebridge-a@test.com';
    const emailB = 'onebridge-b@test.com';
    let variantId: string;
    let rfqA: any;
    let rfqAOrderCode: string;
    let rfqAOrderId: string;
    let reportId: string;
    let defaultChannelToken: string;
    let secondChannelToken: string;

    beforeAll(async () => {
        await server.init({
            initialData: (await import('../../../e2e-common/e2e-initial-data')).initialData,
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (const email of [emailA, emailB]) {
            await adminClient.query(gql`
                mutation {
                    createCustomer(
                        input: { firstName: "OB", lastName: "Customer", emailAddress: "${email}" }
                        password: "test"
                    ) {
                        ... on Customer { id emailAddress }
                        ... on ErrorResult { errorCode message }
                    }
                }
            `);
        }
        const products = (await adminClient.query(gql`
            query {
                products(options: { take: 1 }) {
                    items {
                        variants {
                            id
                        }
                    }
                }
            }
        `)) as any;
        variantId = products.products.items[0].variants[0].id;
        defaultChannelToken = ((await adminClient.query(gql`query { activeChannel { token } }`)) as any).activeChannel
            .token;
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('① 匿名 submitRfq 生成 OB 编号、初始阶段与首条时间轴', async () => {
        await shopClient.asAnonymousUser();
        const result = (await shopClient.query(SUBMIT_RFQ, {
            input: {
                need: 'collections',
                name: 'TEST CUSTOMER',
                contact: 'test@onebridge.dev',
                item: 'TEST ITEM (KO COPY PENDING)',
                qty: '10',
                locale: 'ko',
                idempotencyKey: 'm2-submit-1',
            },
        })) as any;
        rfqA = result.submitRfq;
        expect(rfqA.code).toMatch(/^OB-\d{8}-\d{4}$/);
        expect(rfqA.stage).toBe('quoting');
        expect(rfqA.needLabel).toBeTruthy();
        expect(rfqA.timeline).toHaveLength(1);
        expect(rfqA.timeline[0].state).toBe('now');
    });

    it('② 相同幂等键返回同一受理号，不同键生成新受理号', async () => {
        const again = (await shopClient.query(SUBMIT_RFQ, {
            input: {
                need: 'collections',
                name: 'TEST CUSTOMER',
                contact: 'test@onebridge.dev',
                item: 'TEST ITEM (KO COPY PENDING)',
                locale: 'ko',
                idempotencyKey: 'm2-submit-1',
            },
        })) as any;
        expect(again.submitRfq.code).toBe(rfqA.code);

        const fresh = (await shopClient.query(SUBMIT_RFQ, {
            input: {
                need: 'collections',
                name: 'TEST CUSTOMER',
                contact: 'test@onebridge.dev',
                item: 'TEST ITEM 2',
                locale: 'ko',
                idempotencyKey: 'm2-submit-2',
            },
        })) as any;
        expect(fresh.submitRfq.code).not.toBe(rfqA.code);
    });

    it('③ 提交校验失败返回 RFQ_VALIDATION_FAILED', async () => {
        try {
            await shopClient.query(SUBMIT_RFQ, {
                input: {
                    need: 'collections',
                    name: '',
                    contact: 'test@onebridge.dev',
                    item: 'x',
                    locale: 'ko',
                },
            });
            throw new Error('should not reach');
        } catch (e: any) {
            expectCode(e, 'RFQ_VALIDATION_FAILED');
        }
    });

    it('④ Admin 报价/样品/阶段跃迁写入时间轴', async () => {
        const detail = (await adminClient.query(ADMIN_RFQ, { code: rfqA.code })) as any;
        const rfqId = detail.onebridgeRfq.id;
        const quote = (await adminClient.query(gql`
            mutation {
                saveRfqQuote(rfqId: "${rfqId}", input: { amount: 120000, currency: KRW, note: "TEST QUOTE" }) {
                    amount
                    currency
                }
            }
        `)) as any;
        expect(quote.saveRfqQuote.amount).toBe(120000);

        const sample = (await adminClient.query(gql`
            mutation {
                saveRfqSample(rfqId: "${rfqId}", input: { status: "TEST_SAMPLE_SENT", trackingNo: "TEST-TRACK" }) {
                    status
                    trackingNo
                }
            }
        `)) as any;
        expect(sample.saveRfqSample.status).toBe('TEST_SAMPLE_SENT');

        const moved = (await adminClient.query(gql`
            mutation {
                transitionRfqStage(rfqId: "${rfqId}", stage: sample) {
                    stage
                }
            }
        `)) as any;
        expect(moved.transitionRfqStage.stage).toBe('sample');
    });

    it('⑤ 非法跃迁返回 INVALID_STAGE_TRANSITION', async () => {
        const detail = (await adminClient.query(ADMIN_RFQ, { code: rfqA.code })) as any;
        try {
            await adminClient.query(gql`
                mutation {
                    transitionRfqStage(rfqId: "${detail.onebridgeRfq.id}", stage: delivered) {
                        stage
                    }
                }
            `);
            throw new Error('should not reach');
        } catch (e: any) {
            expectCode(e, 'INVALID_STAGE_TRANSITION');
        }
    });

    it('⑥ 内容 CRUD 与发布可见性按渠道/发布态过滤', async () => {
        const saved = (await adminClient.query(gql`
            mutation {
                saveOnebridgeContentEntry(input: {
                    contentType: site_block
                    slug: "m2-test-block"
                    titleKr: "TEST TITLE (KO COPY PENDING)"
                    titleCn: "中文占位标题"
                    published: true
                    sort: 1
                }) {
                    id
                    slug
                    published
                }
            }
        `)) as any;
        expect(saved.saveOnebridgeContentEntry.published).toBe(true);

        const draft = (await adminClient.query(gql`
            mutation {
                saveOnebridgeContentEntry(input: {
                    contentType: column
                    slug: "m2-test-column-draft"
                    titleKr: "TEST DRAFT (KO COPY PENDING)"
                    published: false
                }) {
                    id
                    published
                }
            }
        `)) as any;
        expect(draft.saveOnebridgeContentEntry.published).toBe(false);

        const shop = (await shopClient.query(gql`
            query {
                siteContent {
                    slug
                    title(locale: ko)
                    titleCn
                }
            }
        `)) as any;
        expect(shop.siteContent.map((x: any) => x.slug)).toContain('m2-test-block');
        expect(shop.siteContent.map((x: any) => x.slug)).not.toContain('m2-test-column-draft');

        const adminList = (await adminClient.query(gql`
            query {
                onebridgeContentEntries(options: { take: 100 }) {
                    totalItems
                    items {
                        slug
                    }
                }
            }
        `)) as any;
        expect(adminList.onebridgeContentEntries.items.map((x: any) => x.slug)).toContain(
            'm2-test-column-draft',
        );
    });

    it('⑦ 验货报告：发布前 Shop 不可见，发布后仅归属顾客可见', async () => {
        // 归属校验以 customerId 为准，因此这里用已登录顾客 A 新建一张 RFQ
        await shopClient.asUserWithCredentials(emailA, 'test');
        const owned = (await shopClient.query(SUBMIT_RFQ, {
            input: {
                need: 'collections',
                name: 'TEST CUSTOMER A',
                contact: 'a@onebridge.dev',
                item: 'TEST OWNED ITEM',
                locale: 'ko',
                idempotencyKey: 'm2-submit-owned-a',
            },
        })) as any;
        const ownedCode = owned.submitRfq.code;

        const created = (await adminClient.query(gql`
            mutation {
                createOnebridgeInspectionReport(input: {
                    rfqCode: "${ownedCode}"
                    inspector: "TEST INSPECTOR"
                    result: pass
                }) {
                    id
                    code
                    passed
                    publishedAt
                }
            }
        `)) as any;
        reportId = created.createOnebridgeInspectionReport.id;
        expect(created.createOnebridgeInspectionReport.passed).toBe(true);
        expect(created.createOnebridgeInspectionReport.publishedAt).toBeNull();

        const before = (await shopClient.query(gql`
            query {
                inspectionReports(rfqCode: "${ownedCode}") {
                    id
                }
            }
        `)) as any;
        expect(before.inspectionReports).toHaveLength(0);

        await adminClient.query(gql`
            mutation {
                publishOnebridgeInspectionReport(id: "${reportId}") {
                    id
                    publishedAt
                }
            }
        `);
        const after = (await shopClient.query(gql`
            query {
                inspectionReports(rfqCode: "${ownedCode}") {
                    id
                    code
                }
            }
        `)) as any;
        expect(after.inspectionReports).toHaveLength(1);

        await shopClient.asUserWithCredentials(emailB, 'test');
        try {
            await shopClient.query(gql`
                query {
                    inspectionReports(rfqCode: "${ownedCode}") {
                        id
                    }
                }
            `);
            throw new Error('should not reach');
        } catch (e: any) {
            expectCode(e, 'RFQ_NOT_FOUND');
        }
    });

    it('⑧ 未通过验货不放行 qc → delivered', async () => {
        // 新 RFQ 走到 qc，再用 fail 报告阻断放行
        const project = (await shopClient.query(SUBMIT_RFQ, {
            input: {
                need: 'projects',
                name: 'TEST CUSTOMER',
                contact: 'test@onebridge.dev',
                item: 'TEST PROJECT ITEM',
                locale: 'ko',
                idempotencyKey: 'm2-submit-projects',
            },
        })) as any;
        const code = project.submitRfq.code;
        const detail = (await adminClient.query(ADMIN_RFQ, { code })) as any;
        const id = detail.onebridgeRfq.id;
        for (const stage of ['sourcing', 'producing', 'qc']) {
            await adminClient.query(gql`
                mutation {
                    transitionRfqStage(rfqId: "${id}", stage: ${stage}) { stage }
                }
            `);
        }
        await adminClient.query(gql`
            mutation {
                createOnebridgeInspectionReport(input: {
                    rfqCode: "${code}"
                    inspector: "TEST INSPECTOR"
                    result: fail
                }) { id }
            }
        `);
        try {
            await adminClient.query(gql`
                mutation {
                    transitionRfqStage(rfqId: "${id}", stage: delivered) { stage }
                }
            `);
            throw new Error('should not reach');
        } catch (e: any) {
            expectCode(e, 'INVALID_STAGE_TRANSITION');
        }

        // 通过报告后允许 qc → delivered
        await adminClient.query(gql`
            mutation {
                createOnebridgeInspectionReport(input: {
                    rfqCode: "${code}"
                    inspector: "TEST INSPECTOR"
                    result: pass
                }) { id }
            }
        `);
        const ok = (await adminClient.query(gql`
            mutation {
                transitionRfqStage(rfqId: "${id}", stage: delivered) { stage }
            }
        `)) as any;
        expect(ok.transitionRfqStage.stage).toBe('delivered');
    });

    it('⑨ 清关回写幂等、订单阶段回写与非法回退拦截', async () => {
        await shopClient.asUserWithCredentials(emailA, 'test');
        const add = (await shopClient.query(gql`
            mutation {
                addItemToOrder(productVariantId: "${variantId}", quantity: 1) {
                    ... on Order { id code }
                    ... on ErrorResult { errorCode message }
                }
            }
        `)) as any;
        rfqAOrderCode = add.addItemToOrder.code;
        rfqAOrderId = add.addItemToOrder.id;

        const first = (await adminClient.query(gql`
            mutation {
                upsertOnebridgeCustomsRecord(input: {
                    orderCode: "${rfqAOrderCode}"
                    customsStatus: docs_preparing
                    idempotencyKey: "m2-customs-1"
                }) { id customsStatus }
            }
        `)) as any;
        expect(first.upsertOnebridgeCustomsRecord.customsStatus).toBe('docs_preparing');

        await adminClient.query(gql`
            mutation {
                upsertOnebridgeCustomsRecord(input: {
                    orderCode: "${rfqAOrderCode}"
                    customsStatus: declared
                    declarationNo: "TEST-DECL"
                }) { id customsStatus }
            }
        `);
        await adminClient.query(gql`
            mutation {
                upsertOnebridgeCustomsRecord(input: {
                    orderCode: "${rfqAOrderCode}"
                    customsStatus: cleared
                    idempotencyKey: "m2-customs-cleared"
                }) { id customsStatus }
            }
        `);
        const repeat = (await adminClient.query(gql`
            mutation {
                upsertOnebridgeCustomsRecord(input: {
                    orderCode: "${rfqAOrderCode}"
                    customsStatus: cleared
                    idempotencyKey: "m2-customs-cleared"
                }) { id customsStatus }
            }
        `)) as any;
        expect(repeat.upsertOnebridgeCustomsRecord.customsStatus).toBe('cleared');

        try {
            await adminClient.query(gql`
                mutation {
                    upsertOnebridgeCustomsRecord(input: {
                        orderCode: "${rfqAOrderCode}"
                        customsStatus: docs_preparing
                    }) { id customsStatus }
                }
            `);
            throw new Error('should not reach');
        } catch (e: any) {
            expectCode(e, 'CUSTOMS_SYNC_FAILED');
        }

        const orders = (await adminClient.query(gql`
            query {
                orders(options: { take: 10 }) {
                    items {
                        code
                        customFields {
                            crossBorderStage
                        }
                    }
                }
            }
        `)) as any;
        const current = orders.orders.items.find((o: any) => o.code === rfqAOrderCode);
        expect(current.customFields.crossBorderStage).toBe('customs');

        const timeline = (await shopClient.query(gql`
            query {
                orderTimeline(orderCode: "${rfqAOrderCode}") {
                    stage
                }
            }
        `)) as any;
        expect(timeline.orderTimeline.filter((e: any) => e.stage === 'customs')).toHaveLength(1);
    });

    it('⑩ 订单聚合字段（customFields + items + timeline）', async () => {
        await adminClient.query(gql`
            mutation {
                setOrderCustomFields(input: {
                    id: "${rfqAOrderId}"
                    customFields: {
                        businessLine: "net"
                        crossBorderStage: "shipping"
                        rfqCode: "${rfqA.code}"
                        needType: "daily"
                        krwAmount: 12345
                        expectedEta: "2026-12-01T00:00:00.000Z"
                    }
                }) { id }
            }
        `);
        const summary = (await shopClient.query(gql`
            query {
                orderSummary(orderCode: "${rfqAOrderCode}") {
                    code
                    businessLine
                    crossBorderStage
                    rfqCode
                    needType
                    krwAmount
                    expectedEta
                    items {
                        name
                        qty
                        price
                    }
                    timeline {
                        stage
                    }
                }
            }
        `)) as any;
        expect(summary.orderSummary.businessLine).toBe('net');
        expect(summary.orderSummary.needType).toBe('daily');
        expect(summary.orderSummary.krwAmount).toBe(12345);
        expect(summary.orderSummary.items.length).toBeGreaterThan(0);
        expect(summary.orderSummary.timeline.some((e: any) => e.stage === 'customs')).toBe(true);
    });

    it('⑪ 渠道隔离：第二 Channel 看不到默认渠道的 RFQ/内容', async () => {
        const zones = (await adminClient.query(gql`query { zones { items { id } } }`)) as any;
        const zoneId = zones.zones.items[0].id;
        const channel = (await adminClient.query(gql`
            mutation {
                createChannel(input: {
                    code: "onebridge-b"
                    token: "onebridge-b"
                    defaultLanguageCode: en
                    currencyCode: USD
                    pricesIncludeTax: true
                    defaultTaxZoneId: "${zoneId}"
                    defaultShippingZoneId: "${zoneId}"
                }) {
                    ... on Channel { id token }
                    ... on ErrorResult { errorCode message }
                }
            }
        `)) as any;
        secondChannelToken = channel.createChannel.token;

        adminClient.setChannelToken(secondChannelToken);
        const listB = (await adminClient.query(gql`
            query {
                onebridgeRfqs { totalItems }
                onebridgeContentEntries { totalItems }
            }
        `)) as any;
        expect(listB.onebridgeRfqs.totalItems).toBe(0);
        expect(listB.onebridgeContentEntries.totalItems).toBe(0);

        // Shop 在第二渠道提交 RFQ，只能在第二渠道查到
        await shopClient.asAnonymousUser();
        shopClient.setChannelToken(secondChannelToken);
        const inB = (await shopClient.query(SUBMIT_RFQ, {
            input: {
                need: 'daily',
                name: 'TEST B CUSTOMER',
                contact: 'b@onebridge.dev',
                item: 'TEST B ITEM',
                locale: 'zh',
                idempotencyKey: 'm2-channel-b',
            },
        })) as any;
        const listB2 = (await adminClient.query(gql`
            query {
                onebridgeRfqs { totalItems }
            }
        `)) as any;
        expect(listB2.onebridgeRfqs.totalItems).toBe(1);

        adminClient.setChannelToken(defaultChannelToken);
        try {
            await adminClient.query(ADMIN_RFQ, { code: inB.submitRfq.code });
            throw new Error('should not reach');
        } catch (e: any) {
            expectCode(e, 'RFQ_NOT_FOUND');
        }
        shopClient.setChannelToken(defaultChannelToken);
    });

    it('⑫ 无 OnebridgeRfqManage 权限的管理员被拒绝', async () => {
        const role = (await adminClient.query(gql`
            mutation {
                createRole(input: {
                    code: "onebridge-reader"
                    description: "TEST read-only role"
                    permissions: [ReadCatalog]
                }) { id }
            }
        `)) as any;
        await adminClient.query(gql`
            mutation {
                createAdministrator(input: {
                    firstName: "OB"
                    lastName: "Reader"
                    emailAddress: "onebridge-reader@test.com"
                    password: "test"
                    roleIds: ["${role.createRole.id}"]
                }) { id }
            }
        `);
        const restricted = new SimpleGraphQLClient(
            config,
            `http://localhost:${config.apiOptions.port}/${config.apiOptions.adminApiPath}`,
        );
        await restricted.asUserWithCredentials('onebridge-reader@test.com', 'test');
        try {
            await restricted.query(gql`query { onebridgeRfqs { totalItems } }`);
            throw new Error('should not reach');
        } catch (e: any) {
            expect(e.message).toMatch(/not currently authorized|not authorized|Forbidden/i);
        }

        // 规格表沿用原生目录权限口径：ReadCatalog 即可只读，且不会因此获得 RFQ 权限
        const specSheets = (await restricted.query(gql`
            query { onebridgeSpecSheets { slug } }
        `)) as any;
        expect(Array.isArray(specSheets.onebridgeSpecSheets)).toBe(true);
    });
});
