"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const content_service_1 = require("../services/content.service");
(0, vitest_1.describe)('OnebridgeContentService.shopBundle', () => {
    const ctx = { channel: { token: 'onebridge' } };
    function createService(entries) {
        const repo = { find: vitest_1.vi.fn().mockResolvedValue(entries) };
        const connection = { getRepository: vitest_1.vi.fn(() => repo) };
        const service = new content_service_1.OnebridgeContentService(connection);
        return { service, repo };
    }
    (0, vitest_1.it)('keeps the flat list and groups by payload.section or slug prefix', async () => {
        const entries = [
            { slug: 'hero', payload: { section: 'modules' }, contentType: 'site_block' },
            { slug: 'shared-footer', payload: null, contentType: 'site_block' },
            { slug: 'roles-cta', payload: { section: 'Roles' }, contentType: 'site_block' },
            { slug: 'review-01', payload: {}, contentType: 'site_block' },
            { slug: 'site-default', payload: { points: [] }, contentType: 'site_block' },
        ];
        const { service } = createService(entries);
        const bundle = await service.shopBundle(ctx, { take: 10 });
        (0, vitest_1.expect)(bundle.blocks).toEqual(entries);
        (0, vitest_1.expect)(bundle.modules.map(e => e.slug)).toEqual(['hero']);
        (0, vitest_1.expect)(bundle.shared.map(e => e.slug)).toEqual(['shared-footer']);
        (0, vitest_1.expect)(bundle.roles.map(e => e.slug)).toEqual(['roles-cta']);
        (0, vitest_1.expect)(bundle.reviews.map(e => e.slug)).toEqual(['review-01']);
    });
    (0, vitest_1.it)('reuses siteContent query semantics: published + channel + default take', async () => {
        const { service, repo } = createService([]);
        const bundle = await service.shopBundle(ctx);
        (0, vitest_1.expect)(repo.find).toHaveBeenCalledWith({
            where: { channelToken: 'onebridge', contentType: 'site_block', published: true },
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: 50,
        });
        (0, vitest_1.expect)(bundle).toEqual({ blocks: [], modules: [], shared: [], roles: [], reviews: [] });
    });
});
//# sourceMappingURL=content.service.spec.js.map