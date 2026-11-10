import { describe, expect, it, vi } from 'vitest';

import { OnebridgeContentService } from '../services/content.service';

describe('OnebridgeContentService.shopBundle', () => {
    const ctx = { channel: { token: 'onebridge' } } as any;

    function createService(entries: any[]) {
        const repo = { find: vi.fn().mockResolvedValue(entries) };
        const connection = { getRepository: vi.fn(() => repo) };
        const service = new OnebridgeContentService(connection as any);
        return { service, repo };
    }

    it('keeps the flat list and groups by payload.section or slug prefix', async () => {
        const entries = [
            { slug: 'hero', payload: { section: 'modules' }, contentType: 'site_block' },
            { slug: 'shared-footer', payload: null, contentType: 'site_block' },
            { slug: 'roles-cta', payload: { section: 'Roles' }, contentType: 'site_block' },
            { slug: 'review-01', payload: {}, contentType: 'site_block' },
            { slug: 'site-default', payload: { points: [] }, contentType: 'site_block' },
        ];
        const { service } = createService(entries);

        const bundle = await service.shopBundle(ctx, { take: 10 });

        expect(bundle.blocks).toEqual(entries);
        expect(bundle.modules.map(e => e.slug)).toEqual(['hero']);
        expect(bundle.shared.map(e => e.slug)).toEqual(['shared-footer']);
        expect(bundle.roles.map(e => e.slug)).toEqual(['roles-cta']);
        expect(bundle.reviews.map(e => e.slug)).toEqual(['review-01']);
    });

    it('reuses siteContent query semantics: published + channel + default take', async () => {
        const { service, repo } = createService([]);

        const bundle = await service.shopBundle(ctx);

        expect(repo.find).toHaveBeenCalledWith({
            where: { channelToken: 'onebridge', contentType: 'site_block', published: true },
            order: { sort: 'ASC', createdAt: 'ASC' },
            take: 50,
        });
        expect(bundle).toEqual({ blocks: [], modules: [], shared: [], roles: [], reviews: [] });
    });
});
