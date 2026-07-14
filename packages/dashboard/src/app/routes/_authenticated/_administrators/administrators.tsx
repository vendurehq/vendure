import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { RoleCodeLabel } from '@/vdb/components/shared/role-code-label.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { administratorListDocument } from './administrators.graphql.js';
import { DeleteAdministratorsBulkAction } from './components/administrator-bulk-actions.js';

export const Route = createFileRoute('/_authenticated/_administrators/administrators')({
    component: AdministratorListPage,
    loader: () => ({ breadcrumb: () => <Trans>Administrators</Trans> }),
});

function AdministratorListPage() {
    return (
        <ListPage
            pageId="administrator-list"
            title={<Trans>Administrators</Trans>}
            listQuery={administratorListDocument}
            route={Route}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          firstName: { contains: searchTerm },
                          lastName: { contains: searchTerm },
                          emailAddress: { contains: searchTerm },
                      }
                    : {};
            }}
            transformVariables={variables => {
                return {
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            additionalColumns={{
                name: {
                    meta: { dependencies: ['id', 'firstName', 'lastName'] },
                    header: () => <Trans>Name</Trans>,
                    cell: ({ row }) => (
                        <DetailPageButton
                            id={row.original.id}
                            label={`${row.original.firstName} ${row.original.lastName}`}
                        />
                    ),
                },
                roles: {
                    meta: { dependencies: ['user'] },
                    header: () => <Trans>Roles</Trans>,
                    cell: ({ row }) => {
                        return (
                            <div className="flex flex-wrap gap-2">
                                {row.original.user?.roles.map(role => {
                                    return (
                                        <Badge variant="secondary" key={role.id}>
                                            <RoleCodeLabel code={role.code} />
                                        </Badge>
                                    );
                                })}
                            </div>
                        );
                    },
                },
            }}
            customizeColumns={{
                emailAddress: {
                    header: () => <Trans>Identifier</Trans>,
                    cell: ({ row }) => {
                        return <div>{row.original.emailAddress}</div>;
                    },
                },
            }}
            defaultVisibility={{
                emailAddress: true,
                name: true,
            }}
            defaultColumnOrder={['name', 'emailAddress', 'roles']}
            bulkActions={[
                {
                    component: DeleteAdministratorsBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateAdministrator']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    New Administrator
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
