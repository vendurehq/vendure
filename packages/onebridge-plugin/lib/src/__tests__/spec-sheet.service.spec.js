"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const spec_sheet_service_1 = require("../services/spec-sheet.service");
(0, vitest_1.describe)('OnebridgeSpecSheetService', () => {
    const ctx = { channel: { token: 't1' } };
    function createService(products, price = 19900) {
        const productService = {
            findAll: vitest_1.vi.fn().mockResolvedValue({ items: products, totalItems: products.length }),
        };
        const productVariantService = {
            hydratePriceFields: vitest_1.vi.fn().mockResolvedValue(price),
        };
        const service = new spec_sheet_service_1.OnebridgeSpecSheetService(productService, productVariantService);
        return { service, productService, productVariantService };
    }
    (0, vitest_1.it)('maps Product customFields and the first variant price', async () => {
        const { service, productService } = createService([
            {
                slug: 'wood-chair',
                name: 'Wood Chair',
                customFields: { krName: '원목 의자', spec: '원목 / 45x45x80cm', moq: 10, leadTime: '15일' },
                variants: [{ id: 1 }],
            },
        ]);
        await (0, vitest_1.expect)(service.list(ctx, { take: 10 })).resolves.toEqual([
            {
                slug: 'wood-chair',
                krName: '원목 의자',
                spec: '원목 / 45x45x80cm',
                moq: 10,
                leadTime: '15일',
                price: 19900,
            },
        ]);
        (0, vitest_1.expect)(productService.findAll).toHaveBeenCalledWith(ctx, vitest_1.expect.objectContaining({
            take: 10,
            filter: { enabled: { eq: true }, spec: { notEq: '' } },
        }), ['variants']);
    });
    (0, vitest_1.it)('skips empty spec and falls back to product name / null price', async () => {
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
        await (0, vitest_1.expect)(service.list(ctx)).resolves.toEqual([
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
    (0, vitest_1.it)('returns null price when the variant has no resolvable price', async () => {
        const productService = {
            findAll: vitest_1.vi.fn().mockResolvedValue({
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
            hydratePriceFields: vitest_1.vi.fn().mockRejectedValue(new Error('no price')),
        };
        const service = new spec_sheet_service_1.OnebridgeSpecSheetService(productService, productVariantService);
        const [sheet] = await service.list(ctx);
        (0, vitest_1.expect)(sheet.price).toBeNull();
    });
});
//# sourceMappingURL=spec-sheet.service.spec.js.map