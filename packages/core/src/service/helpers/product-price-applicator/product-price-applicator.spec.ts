import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { DefaultTaxZoneStrategy } from '../../../config/tax/default-tax-zone-strategy';
import { Channel } from '../../../entity/channel/channel.entity';
import { ProductVariantPrice } from '../../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { MutableRequestContext } from '../../../plugin/default-search-plugin/indexer/mutable-request-context';
import {
    MockTaxRateService,
    taxCategoryStandard,
    zoneDefault,
    zoneOther,
} from '../../../testing/order-test-utils';

import { ProductPriceApplicator } from './product-price-applicator';

/**
 * A stand-in for the price query of the applicator: returns the stored rows of the requested
 * variants and Channel, and records each query.
 */
function createPriceConnection(stored: Array<{ variantId: string; price: ProductVariantPrice }>) {
    const queries: Array<{ variantIds: string[]; channelId: string }> = [];
    const connection = {
        getRepository: () => ({
            find: ({ where }: { where: { variantId: { value: string[] }; channelId: string } }) => {
                const variantIds = where.variantId.value;
                const { channelId } = where;
                queries.push({ variantIds, channelId });
                return Promise.resolve(
                    stored
                        .filter(r => variantIds.includes(r.variantId) && r.price.channelId === channelId)
                        .map(r => {
                            r.price.variantId = r.variantId;
                            return r.price;
                        }),
                );
            },
        }),
    };
    return { connection, queries };
}

describe('ProductPriceApplicator', () => {
    function createApplicator(connection: unknown = createPriceConnection([]).connection) {
        const requestCache = new RequestContextCacheService();
        const mockConfigService = {
            taxOptions: {
                taxZoneStrategy: new DefaultTaxZoneStrategy(),
            },
            catalogOptions: {
                productVariantPriceSelectionStrategy: {
                    selectPrice: (_ctx: any, prices: ProductVariantPrice[]) => {
                        return prices.find(p => p.channelId === _ctx.channelId);
                    },
                },
                productVariantPriceCalculationStrategy: {
                    calculate: async ({ inputPrice, ctx }: any) => ({
                        price: inputPrice,
                        priceIncludesTax: ctx.channel.pricesIncludeTax,
                    }),
                },
            },
        };
        const mockZoneService = { getAllWithMembers: () => [zoneDefault, zoneOther] };
        const mockTaxRateService = new MockTaxRateService();

        // Manually construct to avoid NestJS DI circular dependency issues
        const applicator = new (ProductPriceApplicator as any)(
            mockConfigService,
            mockTaxRateService,
            mockZoneService,
            requestCache,
            connection,
        ) as ProductPriceApplicator;

        return applicator;
    }

    it('applies correct tax zone per channel with MutableRequestContext', async () => {
        const applicator = createApplicator();

        const channelA = new Channel({
            id: 'channel-a',
            code: 'channel-a',
            defaultTaxZone: zoneDefault,
            defaultCurrencyCode: CurrencyCode.USD,
            pricesIncludeTax: false,
        });
        const channelB = new Channel({
            id: 'channel-b',
            code: 'channel-b',
            defaultTaxZone: zoneOther,
            defaultCurrencyCode: CurrencyCode.USD,
            pricesIncludeTax: false,
        });

        const ctx = new MutableRequestContext({
            apiType: 'admin',
            channel: channelA,
            authorizedAsOwnerOnly: false,
            isAuthorized: true,
            session: {} as any,
        });

        const createVariant = () =>
            new ProductVariant({
                id: 'variant-1',
                taxCategory: taxCategoryStandard,
                productVariantPrices: [
                    new ProductVariantPrice({
                        channelId: channelA.id,
                        price: 1000,
                        currencyCode: CurrencyCode.USD,
                    }),
                    new ProductVariantPrice({
                        channelId: channelB.id,
                        price: 1000,
                        currencyCode: CurrencyCode.USD,
                    }),
                ],
            });

        // Apply price with channel A (zoneDefault = 20% standard tax)
        ctx.setChannel(channelA);
        const variantA = createVariant();
        await applicator.applyChannelPriceAndTax(variantA, ctx);
        expect(variantA.taxRateApplied.value).toBe(20);

        // Switch to channel B (zoneOther = 15% standard tax)
        ctx.setChannel(channelB);
        const variantB = createVariant();
        await applicator.applyChannelPriceAndTax(variantB, ctx);

        // Without the fix, this would return 20 (channel A's cached tax zone)
        expect(variantB.taxRateApplied.value).toBe(15);

        // Switch back to channel A to verify its cache entry is intact
        ctx.setChannel(channelA);
        const variantA2 = createVariant();
        await applicator.applyChannelPriceAndTax(variantA2, ctx);
        expect(variantA2.taxRateApplied.value).toBe(20);
    });

    describe('loading the prices of the active channel', () => {
        const channelA = new Channel({
            id: 'channel-a',
            code: 'channel-a',
            defaultTaxZone: zoneDefault,
            defaultCurrencyCode: CurrencyCode.USD,
            pricesIncludeTax: false,
        });
        const channelB = new Channel({
            id: 'channel-b',
            code: 'channel-b',
            defaultTaxZone: zoneDefault,
            defaultCurrencyCode: CurrencyCode.USD,
            pricesIncludeTax: false,
        });
        const priceRow = (channelId: string, price: number) =>
            new ProductVariantPrice({ channelId, price, currencyCode: CurrencyCode.USD });
        const stored = [
            { variantId: 'v1', price: priceRow('channel-a', 1000) },
            { variantId: 'v1', price: priceRow('channel-b', 2000) },
            { variantId: 'v2', price: priceRow('channel-a', 3000) },
        ];
        const createCtx = () =>
            new MutableRequestContext({
                apiType: 'admin',
                channel: channelA,
                authorizedAsOwnerOnly: false,
                isAuthorized: true,
                session: {} as any,
            });

        it('loads the rows of the active channel for every variant priced in the same tick in one query', async () => {
            const { connection, queries } = createPriceConnection(stored);
            const applicator = createApplicator(connection);
            const ctx = createCtx();
            const v1 = new ProductVariant({ id: 'v1', taxCategory: taxCategoryStandard });
            const v2 = new ProductVariant({ id: 'v2', taxCategory: taxCategoryStandard });

            await Promise.all([
                applicator.applyChannelPriceAndTax(v1, ctx),
                applicator.applyChannelPriceAndTax(v2, ctx),
            ]);

            expect(v1.listPrice).toBe(1000);
            expect(v2.listPrice).toBe(3000);
            expect(queries).toEqual([{ variantIds: ['v1', 'v2'], channelId: 'channel-a' }]);
            // Only the active channel's row is loaded.
            expect(v1.productVariantPrices.map(p => p.channelId)).toEqual(['channel-a']);
        });

        it('preloadChannelPrices() loads the rows for a list in one query', async () => {
            const { connection, queries } = createPriceConnection(stored);
            const applicator = createApplicator(connection);
            const ctx = createCtx();
            const variants = ['v1', 'v2'].map(
                id => new ProductVariant({ id, taxCategory: taxCategoryStandard }),
            );

            await applicator.preloadChannelPrices(ctx, variants);
            for (const variant of variants) {
                await applicator.applyChannelPriceAndTax(variant, ctx);
            }

            expect(variants.map(v => v.listPrice)).toEqual([1000, 3000]);
            expect(queries.length).toBe(1);
        });

        it('does not query when the variant already carries the rows of the active channel', async () => {
            const { connection, queries } = createPriceConnection(stored);
            const applicator = createApplicator(connection);
            const variant = new ProductVariant({
                id: 'v1',
                taxCategory: taxCategoryStandard,
                productVariantPrices: [priceRow('channel-a', 1500)],
            });

            await applicator.applyChannelPriceAndTax(variant, createCtx());

            expect(variant.listPrice).toBe(1500);
            expect(queries).toEqual([]);
        });

        // The search indexer prices one variant object in every channel of its product in turn.
        it('loads each channel in turn and keeps the rows of the other channels', async () => {
            const { connection, queries } = createPriceConnection(stored);
            const applicator = createApplicator(connection);
            const ctx = createCtx();
            const variant = new ProductVariant({ id: 'v1', taxCategory: taxCategoryStandard });

            await applicator.applyChannelPriceAndTax(variant, ctx);
            expect(variant.listPrice).toBe(1000);
            ctx.setChannel(channelB);
            await applicator.applyChannelPriceAndTax(variant, ctx);
            expect(variant.listPrice).toBe(2000);

            expect(queries.map(q => q.channelId)).toEqual(['channel-a', 'channel-b']);
            expect(variant.productVariantPrices.map(p => p.channelId).sort()).toEqual([
                'channel-a',
                'channel-b',
            ]);
        });
    });
});
