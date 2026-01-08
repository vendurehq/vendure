import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Button } from '@/vdb/components/ui/button.js';
import { PageActionBarRight } from '@/vdb/framework/layout-engine/page-layout.js';
import { ListPage } from '@/vdb/framework/page/list-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ExpandedState, getExpandedRowModel } from '@tanstack/react-table';
import { TableOptions } from '@tanstack/table-core';
import { ResultOf } from 'gql.tada';
import { Folder, FolderOpen, PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { RichTextDescriptionCell } from '@/vdb/components/shared/table-cell/order-table-cell-components.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import {
    calculateDragTargetPosition,
    calculateSiblingIndex,
    getItemParentId,
    isCircularReference,
} from '@/vdb/components/data-table/data-table-utils.js';
import { collectionListDocument, moveCollectionDocument } from './collections.graphql.js';
import {
    AssignCollectionsToChannelBulkAction,
    DeleteCollectionsBulkAction,
    DuplicateCollectionsBulkAction,
    MoveCollectionsBulkAction,
    RemoveCollectionsFromChannelBulkAction,
} from './components/collection-bulk-actions.js';
import { CollectionContentsSheet } from './components/collection-contents-sheet.js';


export const Route = createFileRoute('/_authenticated/_collections/collections')({
    component: CollectionListPage,
    loader: () => ({ breadcrumb: () => <Trans>Collections</Trans> }),
});


type Collection = ResultOf<typeof collectionListDocument>['collections']['items'][number];

function CollectionListPage() {
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const [expanded, setExpanded] = useState<ExpandedState>({});
    const [searchTerm, setSearchTerm] = useState<string>('');

    const expandedIds = Object.entries(expanded)
        .filter(([_, isExpanded]) => isExpanded === true)
        .map(([id, _]) => id);

    const { data: childCollectionsData } = useQuery({
        queryKey: ['childCollections', ...expandedIds.sort((a, b) => a.localeCompare(b))],
        queryFn: () =>
            api.query(collectionListDocument, {
                options: {
                    filter: expandedIds.length > 0
                        ? { parentId: { in: expandedIds } }
                        : undefined,
                },
            }),
        enabled: expandedIds.length > 0,
        staleTime: 1000 * 60 * 5,
    });

    // Memoize child collections grouped by parent ID
    const childCollectionsByParentId = useMemo(
        () => (childCollectionsData?.collections.items || []).reduce(
            (acc: Record<string, Collection[]>, collection: Collection) => {
                const parentId = collection.parentId;
                if (parentId) {
                    if (!acc[parentId]) {
                        acc[parentId] = [];
                    }
                    acc[parentId].push(collection);
                }
                return acc;
            },
            {} as Record<string, Collection[]>,
        ),
        [childCollectionsData?.collections.items]
    );

    const addSubCollections = (data: Collection[]) => {
        const allRows = [] as Collection[];
        const addSubRows = (row: Collection) => {
            const subRows = childCollectionsByParentId[row.id] || [];
            if (subRows.length) {
                for (const subRow of subRows) {
                    allRows.push(subRow);
                    addSubRows(subRow);
                }
            }
        };
        data.forEach(row => {
            allRows.push(row);
            addSubRows(row);
        });
        return allRows;
    };

    const handleReorder = async (oldIndex: number, newIndex: number, item: Collection, allItems?: Collection[]) => {
        try {
            const items = allItems || [];
            const sourceParentId = getItemParentId(item);

            if (!sourceParentId) {
                throw new Error('Unable to determine parent collection ID');
            }

            // Calculate target position (parent and index)
            const { targetParentId, adjustedIndex: initialIndex } = calculateDragTargetPosition({
                item,
                oldIndex,
                newIndex,
                items,
                sourceParentId,
                expanded,
            });

            // Validate no circular references when moving to different parent
            if (targetParentId !== sourceParentId && isCircularReference(item, targetParentId, items)) {
                toast.error(t`Cannot move a collection into its own descendant`);
                throw new Error('Circular reference detected');
            }

            // Calculate final index (adjust for same-parent moves)
            const adjustedIndex = targetParentId === sourceParentId
                ? calculateSiblingIndex({ item, oldIndex, newIndex, items, parentId: sourceParentId })
                : initialIndex;

            // Perform the move
            await api.mutate(moveCollectionDocument, {
                input: {
                    collectionId: item.id,
                    parentId: targetParentId,
                    index: adjustedIndex,
                },
            });

            // Invalidate queries and show success message
            // Invalidate all child collection queries since we use a single query for all expanded collections
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['childCollections'] }),
                queryClient.invalidateQueries({ queryKey: ['PaginatedListDataTable'] }),
            ]);

            if (targetParentId === sourceParentId) {
                toast.success(t`Collection position updated`);
            } else {
                toast.success(t`Collection moved to new parent`);
            }
        } catch (error) {
            console.error('Failed to reorder collection:', error);
            if (error instanceof Error && error.message !== 'Circular reference detected') {
                toast.error(t`Failed to update collection position`);
            }
            throw error;
        }
    };

    return (
        <ListPage
            pageId="collection-list"
            title={<Trans>Collections</Trans>}
            listQuery={collectionListDocument}
            transformVariables={input => {
                const filterTerm = input.options?.filter?.name?.contains;
                const isFiltering = !!filterTerm;
                return {
                    options: {
                        ...input.options,
                        topLevelOnly: !isFiltering,
                    },
                };
            }}
            customizeColumns={{
                name: {
                    meta: {
                        dependencies: ['children', 'breadcrumbs'],
                    },
                    cell: ({ row }) => {
                        const isExpanded = row.getIsExpanded();
                        const hasChildren = !!row.original.children?.length;
                        return (
                            <div
                                style={{ marginLeft: (row.original.breadcrumbs?.length - 2) * 20 + 'px' }}
                                className="flex gap-2 items-center"
                            >
                                <Button
                                    size="icon"
                                    variant="secondary"
                                    onClick={row.getToggleExpandedHandler()}
                                    disabled={!hasChildren}
                                    className={!hasChildren ? 'opacity-20' : ''}
                                >
                                    {isExpanded ? <FolderOpen /> : <Folder />}
                                </Button>
                                <DetailPageButton id={row.original.id} label={row.original.name} />
                            </div>
                        );
                    },
                },
                description: {
                    cell: RichTextDescriptionCell,
                },
                breadcrumbs: {
                    cell: ({ cell }) => {
                        const value = cell.getValue();
                        if (!Array.isArray(value)) {
                            return null;
                        }
                        return (
                            <div>
                                {value
                                    .slice(1)
                                    .map(breadcrumb => breadcrumb.name)
                                    .join(' / ')}
                            </div>
                        );
                    },
                },
                productVariants: {
                    header: () => <Trans>Contents</Trans>,
                    cell: ({ row }) => {
                        return (
                            <CollectionContentsSheet
                                collectionId={row.original.id}
                                collectionName={row.original.name}
                            >
                                <Trans>{row.original.productVariants?.totalItems} variants</Trans>
                            </CollectionContentsSheet>
                        );
                    },
                },
                children: {
                    cell: ({ row }) => {
                        const children = row.original.children ?? [];
                        const count = children.length;
                        const maxDisplay = 5;
                        const leftOver = Math.max(count - maxDisplay, 0);
                        return (
                            <div className="flex flex-wrap gap-2">
                                {children.slice(0, maxDisplay).map(child => (
                                    <Badge key={child.id} variant="outline">{child.name}</Badge>
                                ))}
                                {leftOver > 0 ? (
                                    <Badge variant="outline">
                                        <Trans>+ {leftOver} more</Trans>
                                    </Badge>
                                ) : null}
                            </div>
                        );
                    },
                },
            }}
            defaultColumnOrder={[
                'featuredAsset',
                'name',
                'slug',
                'breadcrumbs',
                'productVariants',
            ]}
            transformData={data => {
                return addSubCollections(data);
            }}
            setTableOptions={(options: TableOptions<any>) => {
                options.state = {
                    ...options.state,
                    expanded: expanded,
                };
                options.onExpandedChange = setExpanded;
                options.getExpandedRowModel = getExpandedRowModel();
                options.getRowCanExpand = () => true;
                options.getRowId = row => {
                    return row.id;
                };
                options.meta = {
                    ...options.meta,
                    resetExpanded: () => setExpanded({}),
                };
                return options;
            }}
            defaultVisibility={{
                id: false,
                createdAt: false,
                updatedAt: false,
                position: false,
                parentId: false,
                children: false,
                description: false,
                isPrivate: false,
            }}
            onSearchTermChange={searchTerm => {
                setSearchTerm(searchTerm);
                return {
                    name: { contains: searchTerm },
                };
            }}
            route={Route}
            bulkActions={[
                {
                    component: AssignCollectionsToChannelBulkAction,
                    order: 100,
                },
                {
                    component: RemoveCollectionsFromChannelBulkAction,
                    order: 200,
                },
                {
                    component: DuplicateCollectionsBulkAction,
                    order: 300,
                },
                {
                    component: MoveCollectionsBulkAction,
                    order: 400,
                },
                {
                    component: DeleteCollectionsBulkAction,
                    order: 500,
                },
            ]}
            onReorder={handleReorder}
            disableDragAndDrop={!!searchTerm} // Disable dragging while searching
        >
            <PageActionBarRight>
                <PermissionGuard requires={['CreateCollection', 'CreateCatalog']}>
                    <Button asChild>
                        <Link to="./new">
                            <PlusIcon className="mr-2 h-4 w-4" />
                            <Trans>New Collection</Trans>
                        </Link>
                    </Button>
                </PermissionGuard>
            </PageActionBarRight>
        </ListPage>
    );
}

