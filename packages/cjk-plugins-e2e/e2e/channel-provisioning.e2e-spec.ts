import { createTestEnvironment } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CjkPlugin } from '@vendure/cjk-plugin';
import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

/**
 * B-01 / B-02 回归：新建租户（channelService.create）必须自带可下单的基础配置。
 *
 * 历史故障：新渠道没有税区 / 配送区 / 配送方式 / 支付方式 / 配送档案，
 * 导致 specSheets 价格 null、eligibleShippingMethods 为空、订单卡
 * `not all lines have shipping`（BoxShippingLineAssignmentStrategy 找不到生效档案）。
 */
describe('新建租户默认配置（B-01/B-02）', () => {
    const { server, adminClient } = createTestEnvironment({
        ...testConfig(),
        plugins: [
            CjkPlugin.init({
                i18n: { enabled: true },
                regions: { enabled: true },
                tenant: { enabled: true },
                cod: { enabled: true },
            }),
        ],
    });

    let defaultTaxZoneId: string;
    let defaultShippingZoneId: string;
    let tenantToken: string;
    let tenantId: string;

    beforeAll(async () => {
        await server.init({
            initialData: { ...initialData, paymentMethods: [] },
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();

        const active = (await adminClient.query(gql`
            query {
                activeChannel {
                    id
                    defaultTaxZone { id }
                    defaultShippingZone { id }
                }
            }
        `)) as any;
        defaultTaxZoneId = active.activeChannel.defaultTaxZone?.id;
        defaultShippingZoneId = active.activeChannel.defaultShippingZone?.id;
        // 前置：默认渠道本身必须有税区/配送区，否则继承无从谈起（Vendure initialData 的 defaultZone）
        expect(defaultTaxZoneId).toBeTruthy();
        expect(defaultShippingZoneId).toBeTruthy();

        // 前置：准备新渠道要继承的两类「默认方式」
        const sm = (await adminClient.query(gql`
            mutation {
                createShippingMethod(
                    input: {
                        code: "courier-delivery"
                        translations: [{ languageCode: en, name: "Courier Delivery" }]
                        calculator: {
                            code: "default-shipping-calculator"
                            arguments: [
                                { name: "rate", value: "500" }
                                { name: "includesTax", value: "true" }
                                { name: "taxRate", value: "0" }
                            ]
                        }
                        checker: { code: "default-shipping-eligibility-checker", arguments: [] }
                        fulfillmentHandler: "manual-fulfillment"
                    }
                ) {
                    id
                    code
                }
            }
        `)) as any;
        expect(sm.createShippingMethod.code).toBe('courier-delivery');

        const pm = (await adminClient.query(gql`
            mutation {
                createPaymentMethod(
                    input: {
                        code: "cash-on-delivery"
                        enabled: true
                        translations: [{ languageCode: en, name: "Cash on delivery" }]
                        handler: { code: "cash-on-delivery", arguments: [] }
                    }
                ) {
                    id
                    code
                }
            }
        `)) as any;
        expect(pm.createPaymentMethod.code).toBe('cash-on-delivery');

        // 建租户：跨境场景（ko / KRW）
        const created = (await adminClient.query(gql`
            mutation {
                createTenant(input: { name: "OB Provisioning", token: "ob-provisioning", defaultLanguageCode: ko, currencyCode: KRW }) {
                    id
                    code
                    token
                    defaultTaxZone { id }
                    defaultShippingZone { id }
                }
            }
        `)) as any;
        const tenant = created.createTenant;
        expect(tenant?.id).toBeTruthy();
        tenantId = tenant.id;
        tenantToken = tenant.token;

        // 后续查询切到新租户渠道
        adminClient.setChannelToken(tenantToken);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    it('新渠道继承默认渠道的税区 / 配送区', async () => {
        const res = (await adminClient.query(gql`
            query {
                activeChannel {
                    id
                    defaultTaxZone { id }
                    defaultShippingZone { id }
                }
            }
        `)) as any;
        expect(String(res.activeChannel.id)).toBe(String(tenantId));
        expect(String(res.activeChannel.defaultTaxZone?.id)).toBe(String(defaultTaxZoneId));
        expect(String(res.activeChannel.defaultShippingZone?.id)).toBe(String(defaultShippingZoneId));
    });

    it('新渠道自动绑定配送方式与支付方式', async () => {
        const res = (await adminClient.query(gql`
            query {
                shippingMethods { items { id code } }
                paymentMethods { items { id code } }
            }
        `)) as any;
        expect(res.shippingMethods.items.map((m: any) => m.code)).toContain('courier-delivery');
        expect(res.paymentMethods.items.map((m: any) => m.code)).toContain('cash-on-delivery');
    });

    it('新渠道自动创建租户默认配送档案（含配送方式）', async () => {
        const res = (await adminClient.query(gql`
            query {
                shippingProfiles {
                    items {
                        id
                        code
                        isTenantDefault
                        enabled
                        shippingMethods { id code }
                    }
                }
            }
        `)) as any;
        const def = res.shippingProfiles.items.find((p: any) => p.isTenantDefault && p.enabled);
        expect(def).toBeTruthy();
        expect(def.shippingMethods.map((m: any) => m.code)).toContain('courier-delivery');
    });
});
