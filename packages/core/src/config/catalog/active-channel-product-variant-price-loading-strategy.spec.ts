import { CurrencyCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it } from 'vitest';

import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Channel } from '../../entity/channel/channel.entity';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { MutableRequestContext } from '../../plugin/default-search-plugin/indexer/mutable-request-context';

import { ActiveChannelProductVariantPriceLoadingStrategy } from './active-channel-product-variant-price-loading-strategy';

describe('ActiveChannelProductVariantPriceLoadingStrategy', () => {
    const rows: Array<{ variantId: string; channelId: string; price: number }> = [
        { variantId: 'v1', channelId: 'ch-a', price: 100 },
        { variantId: 'v1', channelId: 'ch-b', price: 200 },
        { variantId: 'v2', channelId: 'ch-a', price: 300 },
    ];

    function createStrategy() {
        const queries: Array<{ variantIds: string[]; channelId: string }> = [];
        const queryBuilder = {
            params: {} as { variantIds?: string[]; channelId?: string },
            where(_sql: string, params: { variantIds: string[] }) {
                this.params.variantIds = params.variantIds;
                return this;
            },
            andWhere(_sql: string, params: { channelId: string }) {
                this.params.channelId = params.channelId;
                return this;
            },
            async getRawAndEntities() {
                const { variantIds = [], channelId = '' } = this.params;
                queries.push({ variantIds, channelId });
                const matching = rows.filter(
                    r => variantIds.includes(r.variantId) && r.channelId === channelId,
                );
                return {
                    entities: matching.map(
                        r =>
                            new ProductVariantPrice({
                                channelId: r.channelId,
                                price: r.price,
                                currencyCode: CurrencyCode.USD,
                            }),
                    ),
                    raw: matching.map(r => ({ price_variantId: r.variantId })),
                };
            },
        };
        const connection = {
            getRepository: () => ({ createQueryBuilder: () => ({ ...queryBuilder, params: {} }) }),
        };
        const strategy = new ActiveChannelProductVariantPriceLoadingStrategy();
        strategy.init({
            get: (token: any) =>
                token === RequestContextCacheService ? new RequestContextCacheService() : connection,
        } as any);
        return { strategy, queries };
    }

    function createContext(channelId: string) {
        return new MutableRequestContext({
            apiType: 'shop',
            channel: new Channel({ id: channelId, code: channelId, defaultCurrencyCode: CurrencyCode.USD }),
            authorizedAsOwnerOnly: false,
            isAuthorized: true,
            session: {} as any,
        });
    }

    it('is not eager', () => {
        expect(new ActiveChannelProductVariantPriceLoadingStrategy().eagerLoading).toBe(false);
    });

    it('loads only the rows of the active channel', async () => {
        const { strategy, queries } = createStrategy();
        const prices = await strategy.loadPrices(createContext('ch-a'), new ProductVariant({ id: 'v1' }));
        expect(prices.map(p => p.price)).toEqual([100]);
        expect(queries).toEqual([{ variantIds: ['v1'], channelId: 'ch-a' }]);
    });

    it('batches the variants priced in the same tick into one query', async () => {
        const { strategy, queries } = createStrategy();
        const ctx = createContext('ch-a');
        const [v1, v2, none] = await Promise.all([
            strategy.loadPrices(ctx, new ProductVariant({ id: 'v1' })),
            strategy.loadPrices(ctx, new ProductVariant({ id: 'v2' })),
            strategy.loadPrices(ctx, new ProductVariant({ id: 'v3' })),
        ]);
        expect(v1.map(p => p.price)).toEqual([100]);
        expect(v2.map(p => p.price)).toEqual([300]);
        expect(none).toEqual([]);
        expect(queries).toEqual([{ variantIds: ['v1', 'v2', 'v3'], channelId: 'ch-a' }]);
    });

    it('keeps the channels of one context apart when the channel is switched', async () => {
        const { strategy, queries } = createStrategy();
        const ctx = createContext('ch-a');
        const variant = new ProductVariant({ id: 'v1' });
        const inA = await strategy.loadPrices(ctx, variant);
        ctx.setChannel(new Channel({ id: 'ch-b', code: 'ch-b', defaultCurrencyCode: CurrencyCode.USD }));
        const inB = await strategy.loadPrices(ctx, variant);
        expect(inA.map(p => p.price)).toEqual([100]);
        expect(inB.map(p => p.price)).toEqual([200]);
        expect(queries.map(q => q.channelId)).toEqual(['ch-a', 'ch-b']);
    });

    it('does not query again for a channel whose rows the variant already carries', async () => {
        const { strategy, queries } = createStrategy();
        const variant = new ProductVariant({
            id: 'v1',
            productVariantPrices: [
                new ProductVariantPrice({ channelId: 'ch-a', price: 100, currencyCode: CurrencyCode.USD }),
            ],
        });
        const prices = await strategy.loadPrices(createContext('ch-a'), variant);
        expect(prices.map(p => p.price)).toEqual([100]);
        expect(queries).toEqual([]);
    });
});
