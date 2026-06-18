import { AssetGallery, AssetViewMode } from '@/vdb/components/shared/asset/asset-gallery.js';
import { Page, PageBlock, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { z } from '@/vdb/lib/zod.js';
import { DeleteAssetsBulkAction } from './components/asset-bulk-actions.js';

const assetSearchSchema = z.object({
    perPage: z.coerce.number().int().positive().catch(24),
    viewMode: z.enum(['grid', 'list']).catch('grid'),
});

type AssetSearch = z.infer<typeof assetSearchSchema>;

export const Route = createFileRoute('/_authenticated/_assets/assets')({
    component: RouteComponent,
    loader: () => ({ breadcrumb: () => <Trans>Assets</Trans> }),
    validateSearch: (search: Record<string, unknown>) => assetSearchSchema.parse(search),
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
            search: (prev: AssetSearch) => ({ ...prev, viewMode: mode }),
        });
    };

    return (
        <Page pageId="asset-list">
            <PageTitle>
                <Trans>Assets</Trans>
            </PageTitle>
            <PageBlock blockId="asset-gallery" column="main">
                <AssetGallery
                    selectable={true}
                    multiSelect="auto"
                    pageSize={perPage}
                    onPageSizeChange={handlePageSizeChange}
                    viewMode={viewMode}
                    onViewModeChange={handleViewModeChange}
                    bulkActions={[
                        {
                            component: DeleteAssetsBulkAction,
                        },
                    ]}
                />
            </PageBlock>
        </Page>
    );
}
