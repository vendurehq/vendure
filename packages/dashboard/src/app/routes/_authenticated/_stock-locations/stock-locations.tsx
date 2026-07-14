import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import {
    AssignStockLocationsToChannelBulkAction,
    DeleteStockLocationsBulkAction,
    RemoveStockLocationsFromChannelBulkAction,
} from './components/stock-location-bulk-actions.js';
import { stockLocationListQuery } from './stock-locations.graphql.js';

export const Route = createFileRoute('/_authenticated/_stock-locations/stock-locations')({
    component: StockLocationListPage,
    loader: () => ({ breadcrumb: () => <Trans>Stock Locations</Trans> }),
});

function StockLocationListPage() {
    return (
        <ListPage
            pageId="stock-location-list"
            title={<Trans>Stock Locations</Trans>}
            listQuery={stockLocationListQuery}
            route={Route}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            bulkActions={[
                [
                    {
                        component: AssignStockLocationsToChannelBulkAction,
                        order: 100,
                    },
                    {
                        component: RemoveStockLocationsFromChannelBulkAction,
                        order: 200,
                    },
                ],
                [
                    {
                        component: DeleteStockLocationsBulkAction,
                    },
                ],
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateStockLocation']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Stock Location</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
