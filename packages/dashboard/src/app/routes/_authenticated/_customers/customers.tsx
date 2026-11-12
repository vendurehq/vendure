import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { NoCustomersIllustration } from '@/vdb/components/ui/illustrations.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { Trans, useLingui } from '@lingui/react/macro';
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
    const { t } = useLingui();
    // With separate customer bases, one email address can belong to several Customers, so the
    // storefronts each one belongs to are shown.
    const customerIdentityIsGlobal = useServerConfig()?.customerIdentityIsGlobal ?? true;
    return (
        <ListPage
            title={<Trans>Customers</Trans>}
            pageId="customer-list"
            emptyStateIllustration={<NoCustomersIllustration />}
            listQuery={customerListDocument}
            searchPlaceholder={t`Search customers...`}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          _or: [
                              { lastName: { contains: searchTerm } },
                              { emailAddress: { contains: searchTerm } },
                              { phoneNumber: { contains: searchTerm } },
                          ],
                      }
                    : {};
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
                identityScopeChannels: {
                    header: () => <Trans>Storefronts</Trans>,
                    cell: ({ row }) => (
                        <div className="flex flex-wrap gap-1">
                            {row.original.identityScopeChannels?.map(channel => (
                                <Badge variant="outline" key={channel.id}>
                                    {channel.code}
                                </Badge>
                            ))}
                        </div>
                    ),
                },
                groups: {
                    cell: ({ row }) => {
                        return (
                            <div className="flex flex-wrap gap-1">
                                {row.original.groups?.map(g => (
                                    <Badge variant="default" key={g.id}>
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
                identityScopeChannels: !customerIdentityIsGlobal,
            }}
            bulkActions={[
                {
                    component: DeleteCustomersBulkAction,
                },
            ]}
            emptyStateAction={
                <PermissionGuard requires={['CreateCustomer']}>
                    <Button render={<Link to="./new" />}>
                        <PlusIcon />
                        <Trans>Create your first customer</Trans>
                    </Button>
                </PermissionGuard>
            }
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateCustomer']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    <Trans>New Customer</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
