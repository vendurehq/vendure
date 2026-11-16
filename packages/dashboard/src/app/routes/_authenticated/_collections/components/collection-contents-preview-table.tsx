import { PaginatedListDataTable } from '@/vdb/components/shared/paginated-list-data-table.js';
import { Alert, AlertDescription, AlertTitle } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { PreviewCollectionVariantsInput } from '@vendure/common/lib/generated-types';
import { Eye, Loader2 } from 'lucide-react';
import { ReactNode, useState } from 'react';
import { getCollectionFiltersQueryOptions } from '../collections.graphql.js';

export const previewCollectionContentsDocument = graphql(`
    query PreviewCollectionContents(
        $input: PreviewCollectionVariantsInput!
        $options: ProductVariantListOptions
    ) {
        previewCollectionVariants(input: $input, options: $options) {
            items {
                id
                createdAt
                updatedAt
                productId
                name
                sku
            }
            totalItems
        }
    }
`);

export type CollectionContentsPreviewTableProps = PreviewCollectionVariantsInput & {
    title?: ReactNode;
    /**
     * When true, the collection filters have been saved and the `apply-collection-filters`
     * job is running. We keep showing the preview but swap the alert for an in-progress one.
     */
    applying?: boolean;
};

export function CollectionContentsPreviewTable({
    parentId,
    filters: collectionFilters,
    inheritFilters,
    title,
    applying,
}: CollectionContentsPreviewTableProps) {
    const { t } = useLingui();
    const [sorting, setSorting] = useState<SortingState>([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [filters, setFilters] = useState<ColumnFiltersState>([]);
    const { data: filterDefs } = useQuery(getCollectionFiltersQueryOptions);

    const effectiveFilters = collectionFilters.filter(f => {
        // ensure that every filter has all required arguments
        const filterDef = filterDefs?.collectionFilters.find(fd => fd.code === f.code);
        if (!filterDef) {
            return false;
        }
        for (const arg of filterDef.args) {
            const argPair = f.arguments.find(a => a.name === arg.name);
            const argValue = argPair?.value ?? arg.defaultValue;
            let isValidValue = true;
            if (arg.list) {
                try {
                    JSON.parse(argValue);
                } catch (e) {
                    isValidValue = false;
                }
            }
            if (!isValidValue || (arg.required && argValue == null)) {
                return false;
            }
        }
        return true;
    });

    const hasFilters = effectiveFilters.length > 0;

    return (
        <div>
            {applying ? (
                <Alert className="mb-4">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <AlertTitle>
                        <Trans>Applying filters…</Trans>
                    </AlertTitle>
                    <AlertDescription>
                        <Trans>The collection contents will refresh once the update has finished.</Trans>
                    </AlertDescription>
                </Alert>
            ) : hasFilters ? (
                <Alert className="mb-4">
                    <Eye className="h-4 w-4" />
                    <AlertTitle>
                        <Trans>Preview</Trans>
                    </AlertTitle>
                    <AlertDescription>
                        <Trans>
                            This is a preview of the collection contents based on the current filter settings.
                            Once you save the collection, the contents will be updated to reflect the new
                            filter settings.
                        </Trans>
                    </AlertDescription>
                </Alert>
            ) : (
                <Alert className="mb-4">
                    <Eye className="h-4 w-4" />
                    <AlertTitle>
                        <Trans>Preview</Trans>
                    </AlertTitle>
                    <AlertDescription>
                        <Trans>Add filters to preview the collection contents.</Trans>
                    </AlertDescription>
                </Alert>
            )}
            {hasFilters && (
                <PaginatedListDataTable
                    title={title}
                    listQuery={addCustomFields(previewCollectionContentsDocument)}
                    transformQueryKey={queryKey => {
                        return [...queryKey, JSON.stringify(effectiveFilters), inheritFilters];
                    }}
                    transformVariables={variables => {
                        return {
                            options: variables.options,
                            input: {
                                parentId,
                                filters: effectiveFilters,
                                inheritFilters,
                            },
                        };
                    }}
                    customizeColumns={{
                        name: {
                            header: 'Variant name',
                            cell: ({ row }) => {
                                return (
                                    <Button
                                        render={<Link to={`../../product-variants/${row.original.id}`} />}
                                        variant="ghost"
                                    >
                                        {row.original.name}{' '}
                                    </Button>
                                );
                            },
                        },
                    }}
                    page={page}
                    itemsPerPage={pageSize}
                    sorting={sorting}
                    columnFilters={filters}
                    onPageChange={(_, page, perPage) => {
                        setPage(page);
                        setPageSize(perPage);
                    }}
                    onSortChange={(_, sorting) => {
                        setSorting(sorting);
                    }}
                    onFilterChange={(_, filters) => {
                        setFilters(filters);
                    }}
                    searchPlaceholder={t`Search variants...`}
                    onSearchTermChange={searchTerm => {
                        return {
                            name: {
                                contains: searchTerm,
                            },
                        };
                    }}
                />
            )}
        </div>
    );
}
