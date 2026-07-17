import type { AssetViewMode } from '@/vdb/components/shared/asset/asset-gallery.js';
import { z } from '@/vdb/lib/zod.js';

export const DEFAULT_ASSET_PAGE_SIZE = 24;
export const DEFAULT_ASSET_LIST_PAGE_SIZE = 10;

export function getDefaultAssetPageSize(viewMode: AssetViewMode) {
    return viewMode === 'list' ? DEFAULT_ASSET_LIST_PAGE_SIZE : DEFAULT_ASSET_PAGE_SIZE;
}

interface AssetRouteSearch {
    perPage?: number;
    viewMode?: AssetViewMode;
}

interface AssetSearchMiddlewareContext {
    search: AssetRouteSearch;
    next: (search: AssetRouteSearch) => AssetRouteSearch;
}

const assetViewModeSchema = z.enum(['grid', 'list']).catch('grid');

export function parseAssetSearch(search: Record<string, unknown>) {
    const viewMode = assetViewModeSchema.parse(search.viewMode);
    const perPage = z.coerce
        .number()
        .int()
        .positive()
        .catch(getDefaultAssetPageSize(viewMode))
        .parse(search.perPage);
    return { perPage, viewMode };
}

export function stripDefaultAssetSearchParams({ search, next }: AssetSearchMiddlewareContext) {
    const result = { ...next(search) };
    if (result.perPage === getDefaultAssetPageSize(result.viewMode ?? 'grid')) {
        delete result.perPage;
    }
    return result;
}

export function getSearchForAssetView<T extends Record<string, unknown>>(search: T, viewMode: AssetViewMode) {
    const { perPage: _perPage, ...remainingSearch } = search;
    return { ...remainingSearch, viewMode };
}
