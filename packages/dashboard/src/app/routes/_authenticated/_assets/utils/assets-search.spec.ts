import { describe, expect, it } from 'vitest';
import {
    getDefaultAssetPageSize,
    getSearchForAssetView,
    parseAssetSearch,
    stripDefaultAssetSearchParams,
} from './assets-search.js';

describe('getSearchForAssetView', () => {
    it('uses the default page size for each view', () => {
        expect(getDefaultAssetPageSize('grid')).toBe(24);
        expect(getDefaultAssetPageSize('list')).toBe(10);
        expect(parseAssetSearch({ viewMode: 'grid' })).toEqual({ viewMode: 'grid', perPage: 24 });
        expect(parseAssetSearch({ viewMode: 'list' })).toEqual({ viewMode: 'list', perPage: 10 });
    });

    it('removes the persisted page size when switching views', () => {
        const search = stripDefaultAssetSearchParams({
            search: { viewMode: 'grid', perPage: 48 },
            next: currentSearch => parseAssetSearch(getSearchForAssetView(currentSearch, 'list')),
        });

        expect(search).toEqual({ viewMode: 'list' });
        expect(search).not.toHaveProperty('perPage');
    });
});
