import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteSellersBulkAction } from './components/seller-bulk-actions.js';
import { sellerListQuery } from './sellers.graphql.js';

export const Route = createFileRoute('/_authenticated/_sellers/sellers')({
    component: SellerListPage,
    loader: () => ({ breadcrumb: () => <Trans>Sellers</Trans> }),
});

function SellerListPage() {
    return (
        <ListPage
            pageId="seller-list"
            listQuery={sellerListQuery}
            route={Route}
            title={<Trans>Sellers</Trans>}
            defaultVisibility={{
                name: true,
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
            }}
            bulkActions={[
                {
                    component: DeleteSellersBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateSeller']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Seller</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
