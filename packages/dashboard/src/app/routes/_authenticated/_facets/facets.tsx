import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { FacetValueChip } from '@/vdb/components/shared/facet-value-chip.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { Trans } from '@lingui/react/macro';
import { createFileRoute, Link } from '@tanstack/react-router';
import { PlusIcon } from 'lucide-react';
import {
    AssignFacetsToChannelBulkAction,
    DeleteFacetsBulkAction,
    DuplicateFacetsBulkAction,
    RemoveFacetsFromChannelBulkAction,
} from './components/facet-bulk-actions.js';
import { FacetValuesSheet } from './components/facet-values-sheet.js';
import { facetListDocument } from './facets.graphql.js';

export const Route = createFileRoute('/_authenticated/_facets/facets')({
    component: FacetListPage,
    loader: () => ({ breadcrumb: () => <Trans>Facets</Trans> }),
});

function FacetListPage() {
    return (
        <ListPage
            pageId="facet-list"
            title={<Trans>Facets</Trans>}
            listQuery={facetListDocument}
            defaultVisibility={{
                name: true,
                isPrivate: true,
            }}
            customizeColumns={{
                name: {
                    cell: ({ row }) => <DetailPageButton id={row.original.id} label={row.original.name} />,
                },
                isPrivate: {
                    header: () => <Trans>Visibility</Trans>,
                    cell: ({ row }) => {
                        const isPrivate = row.original.isPrivate;
                        return (
                            <Badge variant={isPrivate ? 'warning' : 'success'}>
                                {isPrivate ? <Trans>private</Trans> : <Trans>public</Trans>}
                            </Badge>
                        );
                    },
                },
                valueList: {
                    header: () => <Trans>Values</Trans>,
                    cell: ({ row }) => {
                        const list = row.original.valueList;
                        return (
                            <div className="flex flex-wrap gap-2 items-center">
                                {list?.items.map(item => (
                                    <FacetValueChip
                                        key={item.id}
                                        facetValue={item}
                                        removable={false}
                                        displayFacetName={false}
                                    />
                                ))}
                                <FacetValuesSheet facetId={row.original.id} facetName={row.original.name}>
                                    {list && list.totalItems > 3 ? (
                                        <Trans>+ {list.totalItems - 3} more</Trans>
                                    ) : (
                                        <Trans>View values</Trans>
                                    )}
                                </FacetValuesSheet>
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
            transformVariables={variables => {
                return {
                    ...variables,
                    facetValueListOptions: {
                        take: 3,
                    },
                };
            }}
            bulkActions={[
                [
                    {
                        order: 100,
                        component: AssignFacetsToChannelBulkAction,
                    },
                    {
                        order: 200,
                        component: RemoveFacetsFromChannelBulkAction,
                    },
                    {
                        order: 300,
                        component: DuplicateFacetsBulkAction,
                    },
                ],
                [
                    {
                        component: DeleteFacetsBulkAction,
                    },
                ],
            ]}
            route={Route}
        >
            <ActionBarItem itemId="create-button" requiresPermission={['CreateFacet', 'CreateCatalog']}>
                <Button render={<Link to="./new" />}>
                    <PlusIcon className="mr-2 h-4 w-4" />
                    <Trans>New Facet</Trans>
                </Button>
            </ActionBarItem>
        </ListPage>
    );
}
