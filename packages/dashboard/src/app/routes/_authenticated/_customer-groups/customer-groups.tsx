import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteCustomerGroupsBulkAction } from './components/customer-group-bulk-actions.js';
import { CustomerGroupMembersSheet } from './components/customer-group-members-sheet.js';
import { customerGroupListDocument } from './customer-groups.graphql.js';

export const Route = createFileRoute('/_authenticated/_customer-groups/customer-groups')({
    component: CustomerGroupListPage,
    loader: () => ({ breadcrumb: () => <Trans>Customer Groups</Trans> }),
});

function CustomerGroupListPage() {
    return (
        <ListPage
            pageId="customer-group-list"
            title={<Trans>Customer Groups</Trans>}
            listQuery={customerGroupListDocument}
            route={Route}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                customers: {
                    cell: ({ cell }) => {
                        const value = cell.getValue();
                        if (!value) {
                            return null;
                        }
                        return (
                            <div className="flex flex-wrap gap-2 items-center">
                                <CustomerGroupMembersSheet
                                    customerGroupId={cell.row.original.id}
                                    customerGroupName={cell.row.original.name}
                                >
                                    <Trans>{value.totalItems} customers</Trans>
                                </CustomerGroupMembersSheet>
                            </div>
                        );
                    },
                },
            }}
            onSearchTermChange={searchTerm => {
                return {
                    name: { contains: searchTerm },
                };
            }}
            bulkActions={[
                {
                    component: DeleteCustomerGroupsBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateCustomerGroup']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Customer Group</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
