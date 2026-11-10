import { describe, expect, it, vi } from 'vitest';

import { OnebridgeSpecSheetService } from '../services/spec-sheet.service';

describe('OnebridgeSpecSheetService', () => {
    const ctx = { channel: { token: 't1' } } as any;

    function createService(products: any[], price = 19900) {
        const productService = {
            findAll: vi.fn().mockResolvedValue({ items: products, totalItems: products.length }),
        };
        const productVariantService = {
            hydratePriceFields: vi.fn().mockResolvedValue(price),
        };
        const service = new OnebridgeSpecSheetService(productService as any, productVariantService as any);
        return { service, productService, productVariantService };
    }

    it('maps Product customFields and the first variant price', async () => {
        const { service, productService } = createService([
            {
                slug: 'wood-chair',
                name: 'Wood Chair',
                customFields: { krName: '원목 의자', spec: '원목 / 45x45x80cm', moq: 10, leadTime: '15일' },
                variants: [{ id: 1 }],
            },
        ]);

        await expect(service.list(ctx, { take: 10 })).resolves.toEqual([
            {
                slug: 'wood-chair',
                krName: '원목 의자',
                spec: '원목 / 45x45x80cm',
                moq: 10,
                leadTime: '15일',
                price: 19900,
            },
        ]);
        expect(productService.findAll).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                take: 10,
                filter: { enabled: { eq: true }, spec: { notEq: '' } },
            }),
            ['variants'],
        );
    });

    it('skips empty spec and falls back to product name / null price', async () => {
        const { service } = createService([
            {
                slug: 'no-spec',
                name: 'No Spec',
                customFields: { krName: '규격 없음', spec: '   ' },
                variants: [{ id: 1 }],
            },
            {
                slug: 'fallback-name',
                name: 'Fallback Product',
                customFields: { spec: '알루미늄' },
                variants: [],
            },
        ]);

        await expect(service.list(ctx)).resolves.toEqual([
            {
                slug: 'fallback-name',
                krName: 'Fallback Product',
                spec: '알루미늄',
                moq: null,
                leadTime: '',
                price: null,
            },
        ]);
    });

    it('returns null price when the variant has no resolvable price', async () => {
        const productService = {
            findAll: vi.fn().mockResolvedValue({
                items: [
                    {
                        slug: 'unpriced',
                        name: 'Unpriced',
                        customFields: { krName: '가격 미정', spec: '스틸' },
                        variants: [{ id: 2 }],
                    },
                ],
                totalItems: 1,
            }),
        };
        const productVariantService = {
            hydratePriceFields: vi.fn().mockRejectedValue(new Error('no price')),
        };
        const service = new OnebridgeSpecSheetService(productService as any, productVariantService as any);

        const [sheet] = await service.list(ctx);
        expect(sheet.price).toBeNull();
    });
});
