import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { PageActionBarRight } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteCustomersBulkAction } from './components/customer-bulk-actions.js';
import { CustomerStatusBadge } from './components/customer-status-badge.js';
import { customerListDocument } from './customers.graphql.js';

export const Route = createFileRoute('/_authenticated/_customers/customers')({
    component: CustomerListPage,
    loader: () => ({ breadcrumb: () => <Trans>Customers</Trans> }),
});

function CustomerListPage() {
    return (
        <ListPage
            title={<Trans>Customers</Trans>}
            pageId="customer-list"
            listQuery={customerListDocument}
            onSearchTermChange={searchTerm => {
                return {
                    lastName: {
                        contains: searchTerm,
                    },
                    emailAddress: {
                        contains: searchTerm,
                    },
                    phoneNumber: {
                        contains: searchTerm,
                    },
                };
            }}
            transformVariables={variables => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            route={Route}
            customizeColumns={{
                user: {
                    header: () => <Trans>Status</Trans>,
                    cell: ({ row }) => {
                        const value = row.original.user;
                        return <CustomerStatusBadge user={value} />;
                    },
                },
                groups: {
                    cell: ({ row }) => {
                        return (
                            <div className="flex flex-wrap gap-1">
                                {row.original.groups?.map(g => (
                                    <Badge variant="secondary" key={g.id}>
                                        {g.name}
                                    </Badge>
                                ))}
                            </div>
                        );
                    },
                },
            }}
            additionalColumns={{
                name: {
                    id: 'name',
                    meta: {
                        dependencies: ['id', 'firstName', 'lastName'],
                    },
                    header: () => <Trans>Name</Trans>,
                    cell: ({ row }) => {
                        const value = `${row.original.firstName} ${row.original.lastName}`;
                        return <DetailPageButton id={row.original.id} label={value} />;
                    },
                },
            }}
            defaultColumnOrder={['name', 'emailAddress', 'user', 'createdAt']}
            defaultVisibility={{
                name: true,
                emailAddress: true,
                user: true,
            }}
            bulkActions={[
                {
                    component: DeleteCustomersBulkAction,
                    order: 500,
                },
            ]}
        >
            <PageActionBarRight>
                <PermissionGuard requires={['CreateCustomer']}>
                    <Button asChild>
                        <Link to="./new">
                            <PlusIcon />
                            <Trans>New Customer</Trans>
                        </Link>
                    </Button>
                </PermissionGuard>
            </PageActionBarRight>
        </ListPage>
    );
}
