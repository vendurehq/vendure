import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { StatusBadge } from '@/vdb/components/ui/status-badge.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteTaxCategoriesBulkAction } from './components/tax-category-bulk-actions.js';
import { taxCategoryListQuery } from './tax-categories.graphql.js';

export const Route = createFileRoute('/_authenticated/_tax-categories/tax-categories')({
    component: TaxCategoryListPage,
    loader: () => ({ breadcrumb: () => <Trans>Tax Categories</Trans> }),
});

function TaxCategoryListPage() {
    const { t } = useLingui();
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
            searchPlaceholder={t`Search tax categories...`}
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
                    // Only the single default row is noteworthy — the rest stay blank.
                    cell: ({ row }) =>
                        row.original.isDefault ? (
                            <StatusBadge tone="info">
                                <Trans>Default</Trans>
                            </StatusBadge>
                        ) : null,
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
