import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteTaxCategoriesBulkAction } from './components/tax-category-bulk-actions.js';
import { taxCategoryListQuery } from './tax-categories.graphql.js';

export const Route = createFileRoute('/_authenticated/_tax-categories/tax-categories')({
    component: TaxCategoryListPage,
    loader: () => ({ breadcrumb: () => <Trans>Tax Categories</Trans> }),
});

function TaxCategoryListPage() {
    return (
        <ListPage
            pageId="tax-category-list"
            listQuery={taxCategoryListQuery}
            route={Route}
            title={<Trans>Tax Categories</Trans>}
            defaultVisibility={{
                name: true,
                isDefault: true,
            }}
            onSearchTermChange={searchTerm => {
                if (searchTerm === '') {
                    return {};
                }

                return {
                    name: { contains: searchTerm },
                };
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                isDefault: {
                    cell: ({ row }) => (
                        <Badge variant={row.original.isDefault ? 'success' : 'secondary'}>
                            <Trans>{row.original.isDefault ? 'Yes' : 'No'}</Trans>
                        </Badge>
                    ),
                },
            }}
            bulkActions={[
                {
                    component: DeleteTaxCategoriesBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateTaxCategory']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    <Trans>New Tax Category</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
