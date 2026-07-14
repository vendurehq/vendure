import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import {
    AssignOptionGroupsToChannelBulkAction,
    DeleteOptionGroupsBulkAction,
    RemoveOptionGroupsFromChannelBulkAction,
} from './components/option-group-bulk-actions.js';
import { optionGroupListDocument } from './option-groups.graphql.js';

export const Route = createFileRoute('/_authenticated/_option-groups/option-groups')({
    component: OptionGroupListPage,
    loader: () => ({ breadcrumb: () => <Trans>Option Groups</Trans> }),
});

function OptionGroupListPage() {
    return (
        <ListPage
            pageId="option-group-list"
            title={<Trans>Option Groups</Trans>}
            listQuery={optionGroupListDocument}
            defaultVisibility={{
                name: true,
                code: true,
                productCount: true,
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => (
                        <DetailPageButton id={row.original.id} label={row.original.name} />
                    ),
                },
                productCount: {
                    header: () => <Trans>Products</Trans>,
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
                        order: 100,
                        component: AssignOptionGroupsToChannelBulkAction,
                    },
                    {
                        order: 200,
                        component: RemoveOptionGroupsFromChannelBulkAction,
                    },
                ],
                [
                    {
                        component: DeleteOptionGroupsBulkAction,
                    },
                ],
            ]}
            route={Route}
        >
            <ActionBarItem
                itemId="create-button"
                requiresPermission={['CreateProduct', 'CreateCatalog']}
            >
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Option Group</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
