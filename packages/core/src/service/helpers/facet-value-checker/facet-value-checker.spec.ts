import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../../api/common/request-context';
import { Cache } from '../../../cache/cache';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { FacetValue } from '../../../entity/facet-value/facet-value.entity';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';

import { FacetValueChecker } from './facet-value-checker';

/**
 * The real `Cache` wrapper is used (backed by an in-memory Map), so the
 * get/set behaviour matches production. `cacheGet` counts the round trips
 * to the cache backend (one SQL query with SqlCacheStrategy).
 */
const cacheStore = new Map<string, any>();
const cacheGet = vi.fn((key: string) => Promise.resolve(cacheStore.get(key)));
const mockCacheService = {
    createCache: (config: any) =>
        new Cache(config, {
            get: cacheGet,
            set: (key: string, value: any) => {
                cacheStore.set(key, value);
                return Promise.resolve();
            },
            delete: (key: string) => {
                cacheStore.delete(key);
                return Promise.resolve();
            },
        } as any),
} as any;

const variantsInDb = new Map<string, ProductVariant>();
const findOne = vi.fn(({ where }: any) => Promise.resolve(variantsInDb.get(String(where.id)) ?? null));
const mockConnection = { getRepository: () => ({ findOne }) } as any;

function variant(id: number, variantFacetValueIds: number[], productFacetValueIds: number[]) {
    return new ProductVariant({
        id,
        facetValues: variantFacetValueIds.map(fvId => new FacetValue({ id: fvId })),
        product: new Product({ facetValues: productFacetValueIds.map(fvId => new FacetValue({ id: fvId })) }),
    });
}

function line(variantId: number | string) {
    return new OrderLine({ productVariant: new ProductVariant({ id: variantId }) });
}

function createCtx() {
    return RequestContext.empty();
}

describe('FacetValueChecker', () => {
    let checker: FacetValueChecker;

    beforeEach(() => {
        cacheStore.clear();
        cacheGet.mockClear();
        findOne.mockClear();
        variantsInDb.clear();
        variantsInDb.set('1', variant(1, [10, 11], [20]));
        variantsInDb.set('2', variant(2, [], [10]));
        checker = new FacetValueChecker(
            mockConnection,
            mockCacheService,
            undefined,
            new RequestContextCacheService(),
        );
    });

    describe('result', () => {
        it('is true when the variant and its product together have all facet values', async () => {
            expect(await checker.hasFacetValues(line(1), [10, 20], createCtx())).toBe(true);
        });

        it('is false when one facet value is missing', async () => {
            expect(await checker.hasFacetValues(line(1), [10, 99], createCtx())).toBe(false);
        });

        it('uses the facet values of the product', async () => {
            expect(await checker.hasFacetValues(line(2), [10], createCtx())).toBe(true);
            expect(await checker.hasFacetValues(line(2), [11], createCtx())).toBe(false);
        });

        it('is true for an empty list of facet values', async () => {
            expect(await checker.hasFacetValues(line(1), [], createCtx())).toBe(true);
        });

        it('compares string and number ids as equal', async () => {
            expect(await checker.hasFacetValues(line('1'), ['10', '20'], createCtx())).toBe(true);
        });

        it('is false for a variant that does not exist, unless the list is empty', async () => {
            expect(await checker.hasFacetValues(line(404), [10], createCtx())).toBe(false);
            expect(await checker.hasFacetValues(line(404), [], createCtx())).toBe(true);
        });

        it('works without a RequestContext', async () => {
            expect(await checker.hasFacetValues(line(1), [10, 20])).toBe(true);
            expect(await checker.hasFacetValues(line(1), [99])).toBe(false);
        });
    });

    describe('cache use', () => {
        it('loads a variant from the database only once over many requests', async () => {
            await checker.hasFacetValues(line(1), [10], createCtx());
            await checker.hasFacetValues(line(1), [11], createCtx());
            expect(findOne).toHaveBeenCalledTimes(1);
        });

        it('reads the shared cache on each call when no RequestContext is given', async () => {
            await checker.hasFacetValues(line(1), [10]);
            await checker.hasFacetValues(line(1), [11]);
            await checker.hasFacetValues(line(1), [20]);
            expect(cacheGet).toHaveBeenCalledTimes(3);
        });

        // A promotion condition calls hasFacetValues for every line, every time the promotion is
        // tested, so one order recalculation asks for the same variant many times.
        it('reads the shared cache only once per variant in one request', async () => {
            const ctx = createCtx();
            for (let i = 0; i < 5; i++) {
                await checker.hasFacetValues(line(1), [10], ctx);
                await checker.hasFacetValues(line('1'), [20], ctx);
                await checker.hasFacetValues(line(2), [10], ctx);
            }
            expect(cacheGet).toHaveBeenCalledTimes(2);
        });

        it('shares one cache read between concurrent calls in one request', async () => {
            const ctx = createCtx();
            await Promise.all([
                checker.hasFacetValues(line(1), [10], ctx),
                checker.hasFacetValues(line(1), [11], ctx),
            ]);
            expect(cacheGet).toHaveBeenCalledTimes(1);
            expect(findOne).toHaveBeenCalledTimes(1);
        });

        it('reads the shared cache again in a new request', async () => {
            await checker.hasFacetValues(line(1), [10], createCtx());
            await checker.hasFacetValues(line(1), [10], createCtx());
            expect(cacheGet).toHaveBeenCalledTimes(2);
        });
    });
});
