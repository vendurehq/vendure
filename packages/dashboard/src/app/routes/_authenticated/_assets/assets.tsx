import { AssetGallery, AssetViewMode } from '@/vdb/components/shared/asset/asset-gallery.js';
import { Page, PageBlock, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { DeleteAssetsBulkAction } from './components/asset-bulk-actions.js';
import {
    getSearchForAssetView,
    parseAssetSearch,
    stripDefaultAssetSearchParams,
} from './utils/assets-search.js';

type AssetSearch = ReturnType<typeof parseAssetSearch>;

// Hoisted so the gallery receives a stable bulkActions identity across renders.
const assetBulkActions = [{ component: DeleteAssetsBulkAction }];

export const Route = createFileRoute('/_authenticated/_assets/assets')({
    component: RouteComponent,
    loader: () => ({ breadcrumb: () => <Trans>Assets</Trans> }),
    validateSearch: parseAssetSearch,
    search: {
        middlewares: [stripDefaultAssetSearchParams],
    },
});

function RouteComponent() {
    const navigate = useNavigate({ from: Route.fullPath });
    const { perPage, viewMode } = Route.useSearch();

    const handlePageSizeChange = (newPageSize: number) => {
        navigate({
            search: (prev: AssetSearch) => ({ ...prev, perPage: newPageSize }),
        });
    };

    const handleViewModeChange = (mode: AssetViewMode) => {
        navigate({
            search: (previous: AssetSearch) => getSearchForAssetView(previous, mode),
        });
    };

    return (
        <Page pageId="asset-list">
            <PageTitle>
                <Trans>Assets</Trans>
            </PageTitle>
            <PageBlock blockId="asset-gallery" column="main" layout="bare">
                <AssetGallery
                    selectable={true}
                    multiSelect="auto"
                    pageSize={perPage}
                    onPageSizeChange={handlePageSizeChange}
                    viewMode={viewMode}
                    onViewModeChange={handleViewModeChange}
                    bulkActions={assetBulkActions}
                />
            </PageBlock>
        </Page>
    );
}
