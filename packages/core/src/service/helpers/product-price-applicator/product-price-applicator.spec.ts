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

describe('ProductPriceApplicator', () => {
    function createApplicator() {
        const requestCache = new RequestContextCacheService();
        const mockConfigService = {
            taxOptions: {
                taxZoneStrategy: new DefaultTaxZoneStrategy(),
            },
            catalogOptions: {
                productVariantPriceLoadingStrategy: {
                    eagerLoading: true,
                    loadPrices: (_ctx: any, variant: ProductVariant) => variant.productVariantPrices,
                },
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

    it('loads the rows of each channel in turn through the loading strategy', async () => {
        const requestCache = new RequestContextCacheService();
        const loadedChannels: string[] = [];
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
        const rowFor = (channelId: string, price: number) =>
            new ProductVariantPrice({ channelId, price, currencyCode: CurrencyCode.USD });
        const mockConfigService = {
            taxOptions: { taxZoneStrategy: new DefaultTaxZoneStrategy() },
            catalogOptions: {
                // A strategy like ActiveChannelProductVariantPriceLoadingStrategy: no eager rows,
                // the rows of the context's channel are loaded when the variant is priced.
                productVariantPriceLoadingStrategy: {
                    eagerLoading: false,
                    loadPrices: (requestContext: any) => {
                        loadedChannels.push(requestContext.channelId);
                        return [
                            rowFor(
                                requestContext.channelId,
                                requestContext.channelId === 'channel-a' ? 1000 : 2000,
                            ),
                        ];
                    },
                },
                productVariantPriceSelectionStrategy: {
                    selectPrice: (requestContext: any, prices: ProductVariantPrice[]) =>
                        prices.find(p => p.channelId === requestContext.channelId),
                },
                productVariantPriceCalculationStrategy: {
                    calculate: async ({ inputPrice, ctx: requestContext }: any) => ({
                        price: inputPrice,
                        priceIncludesTax: requestContext.channel.pricesIncludeTax,
                    }),
                },
            },
        };
        const applicator = new (ProductPriceApplicator as any)(
            mockConfigService,
            new MockTaxRateService(),
            { getAllWithMembers: () => [zoneDefault, zoneOther] },
            requestCache,
        ) as ProductPriceApplicator;
        const ctx = new MutableRequestContext({
            apiType: 'admin',
            channel: channelA,
            authorizedAsOwnerOnly: false,
            isAuthorized: true,
            session: {} as any,
        });
        // One variant object priced in two channels in turn, as the search indexers do.
        const variant = new ProductVariant({ id: 'variant-1', taxCategory: taxCategoryStandard });

        await applicator.applyChannelPriceAndTax(variant, ctx);
        expect(variant.listPrice).toBe(1000);

        ctx.setChannel(channelB);
        await applicator.applyChannelPriceAndTax(variant, ctx);
        expect(variant.listPrice).toBe(2000);
        expect(loadedChannels).toEqual(['channel-a', 'channel-b']);
        // The rows of both channels stay on the variant.
        expect(variant.productVariantPrices.map(p => p.channelId).sort()).toEqual(['channel-a', 'channel-b']);
    });
});
