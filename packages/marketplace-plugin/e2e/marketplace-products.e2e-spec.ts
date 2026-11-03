import { mergeConfig } from '@vendure/core';
import { createTestEnvironment, registerInitializer, SqljsInitializer } from '@vendure/testing';
import gql from 'graphql-tag';
import path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { initialData } from '../../../e2e-common/e2e-initial-data';
import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../e2e-common/test-config';

import { MarketplacePlugin } from '../src/plugin';

registerInitializer('sqljs', new SqljsInitializer(path.join(__dirname, '__data__')));

describe('MarketplacePlugin · 聚合商品分页（take/skip + totalItems）', () => {
    const config = mergeConfig(testConfig(), {
        plugins: [MarketplacePlugin.init({})],
    });
    const { server, adminClient, shopClient } = createTestEnvironment(config);

    const TOTAL = 25;

    beforeAll(async () => {
        await server.init({
            initialData,
            productsCsvPath: path.join(__dirname, '../../core/e2e/fixtures/e2e-products-minimal.csv'),
            customerCount: 1,
        });
        await adminClient.asSuperAdmin();
        for (let i = 0; i < TOTAL; i++) {
            await adminClient.query(gql`
                mutation {
                    createProduct(input: {
                        translations: [{ languageCode: zh_Hans, name: "聚合分页商品 ${i}", slug: "marketplace-page-${i}", description: "e2e" }]
                        customFields: { marketplaceStatus: "approved", listedInMarketplace: true }
                    }) { id }
                }
            `);
        }
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    async function allProductIds(): Promise<string[]> {
        const res = (await shopClient.query(gql`
            query { marketplaceProducts { id } }
        `)) as any;
        return res.marketplaceProducts.map((p: any) => String(p.id));
    }

    it('不传参数时保持原行为：返回全部聚合商品', async () => {
        const ids = await allProductIds();
        expect(ids).toHaveLength(TOTAL);
    });

    it('marketplaceProducts 支持 take/skip 切片', async () => {
        const all = await allProductIds();
        const res = (await shopClient.query(gql`
            query($take: Int, $skip: Int) { marketplaceProducts(take: $take, skip: $skip) { id } }
        `, { take: 10, skip: 5 })) as any;
        expect(res.marketplaceProducts).toHaveLength(10);
        expect(res.marketplaceProducts.map((p: any) => String(p.id))).toEqual(all.slice(5, 15));
    });

    it('marketplaceProductPage 返回正确切片与 totalItems', async () => {
        const all = await allProductIds();
        const first = (await shopClient.query(gql`
            query($take: Int, $skip: Int) { marketplaceProductPage(take: $take, skip: $skip) { totalItems items { id } } }
        `, { take: 10, skip: 0 })) as any;
        expect(first.marketplaceProductPage.totalItems).toBe(TOTAL);
        expect(first.marketplaceProductPage.items).toHaveLength(10);
        expect(first.marketplaceProductPage.items.map((p: any) => String(p.id))).toEqual(all.slice(0, 10));

        const last = (await shopClient.query(gql`
            query($take: Int, $skip: Int) { marketplaceProductPage(take: $take, skip: $skip) { totalItems items { id } } }
        `, { take: 10, skip: 20 })) as any;
        expect(last.marketplaceProductPage.totalItems).toBe(TOTAL);
        expect(last.marketplaceProductPage.items).toHaveLength(5);
        expect(last.marketplaceProductPage.items.map((p: any) => String(p.id))).toEqual(all.slice(20, 25));
    });

    it('take 超过上限被收敛到 100，负数 skip 归零', async () => {
        const res = (await shopClient.query(gql`
            query($take: Int, $skip: Int) { marketplaceProductPage(take: $take, skip: $skip) { items { id } } }
        `, { take: 999, skip: -5 })) as any;
        expect(res.marketplaceProductPage.items.length).toBe(TOTAL);
    });
});
