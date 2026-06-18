import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import { DeleteCountriesBulkAction } from './components/country-bulk-actions.js';
import { countriesListQuery } from './countries.graphql.js';

export const Route = createFileRoute('/_authenticated/_countries/countries')({
    component: CountryListPage,
    loader: () => ({ breadcrumb: () => <Trans>Countries</Trans> }),
});

function CountryListPage() {
    return (
        <ListPage
            pageId="country-list"
            listQuery={countriesListQuery}
            route={Route}
            title={<Trans>Countries</Trans>}
            defaultVisibility={{
                name: true,
                code: true,
                enabled: true,
            }}
            onSearchTermChange={searchTerm => {
                return searchTerm
                    ? {
                          name: { contains: searchTerm },
                          code: { contains: searchTerm },
                      }
                    : {};
            }}
            transformVariables={variables => {
                return {
                    ...variables,
                    options: {
                        ...variables.options,
                        filterOperator: 'OR',
                    },
                };
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
            }}
            bulkActions={[
                {
                    component: DeleteCountriesBulkAction,
                },
            ]}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateCountry']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon />
                    <Trans>Add Country</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
