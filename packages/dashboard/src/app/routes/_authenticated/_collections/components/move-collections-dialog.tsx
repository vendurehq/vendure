import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { api } from '@/vdb/graphql/api.js';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
    ListRow,
    ListRowContent,
    ListRowLeading,
    ListRowLink,
    ListRowMeta,
    ListRowTitle,
    ListRowTrailing,
} from '@vendure-io/ui/components/molecules/list-row';
import { Check, ChevronRight, Folder, FolderOpen, Search } from 'lucide-react';

import { collectionListForMoveDocument, moveCollectionDocument } from '../collections.graphql.js';
import { usePaginatedChildCollections } from '../hooks/use-paginated-child-collections.js';

const CHILDREN_PAGE_SIZE = 20;

type Collection = {
    id: string;
    name: string;
    slug: string;
    children?: { id: string }[] | null;
    breadcrumbs: Array<{ id: string; name: string; slug: string }>;
    parentId?: string;
};

interface MoveCollectionsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    collectionsToMove: Collection[];
    onSuccess?: () => void;
    onResetExpanded?: () => void;
}

interface CollectionTreeNodeProps {
    collection: Collection;
    depth: number;
    expanded: Record<string, boolean>;
    onToggleExpanded: (id: string) => void;
    onSelect: (collection: Collection) => void;
    selectedCollectionId?: string;
    collectionsToMove: Collection[];
    childCollectionsByParentId: Record<string, Collection[]>;
    childTotalsByParentId: Record<string, number>;
    onLoadMoreChildren: (parentId: string) => void;
}

interface TargetAlertProps {
    selectedCollectionId?: string;
    collectionsToMove: Collection[];
    topLevelCollectionId?: string;
    collectionNameCache: React.MutableRefObject<Map<string, string>>;
}

interface MoveToTopLevelProps {
    selectedCollectionId?: string;
    topLevelCollectionId?: string;
    onSelect: (id?: string) => void;
}

function TargetAlert({
    selectedCollectionId,
    collectionsToMove,
    topLevelCollectionId,
    collectionNameCache,
}: Readonly<TargetAlertProps>) {
    const destination = selectedCollectionId && collectionNameCache.current.get(selectedCollectionId);
    return (
        <Alert className={selectedCollectionId ? 'border-primary/30 bg-primary/10' : 'opacity-50'}>
            <Folder className="h-4 w-4" />
            <AlertDescription>
                {!selectedCollectionId ? (
                    <Trans>Select a destination collection</Trans>
                ) : selectedCollectionId === topLevelCollectionId ? (
                    <Plural
                        value={collectionsToMove.length}
                        one="Moving # collection to the top level"
                        other="Moving # collections to the top level"
                    />
                ) : destination ? (
                    <Plural
                        value={collectionsToMove.length}
                        one={`Moving # collection into ${destination}`}
                        other={`Moving # collections into ${destination}`}
                    />
                ) : (
                    <Plural
                        value={collectionsToMove.length}
                        one="Moving # collection into the selected collection"
                        other="Moving # collections into the selected collection"
                    />
                )}
            </AlertDescription>
        </Alert>
    );
}

function MoveToTopLevel({
    selectedCollectionId,
    topLevelCollectionId,
    onSelect,
}: Readonly<MoveToTopLevelProps>) {
    const isSelected = selectedCollectionId === topLevelCollectionId;
    return (
        <ListRow role="listitem">
            <TreeIndent depth={0} />
            <ListRowLeading>
                <Folder />
            </ListRowLeading>
            <ListRowContent>
                <ListRowLink aria-pressed={isSelected} onClick={() => onSelect(topLevelCollectionId)}>
                    <Trans>Move to the top level</Trans>
                </ListRowLink>
            </ListRowContent>
            {isSelected && <SelectedMark />}
        </ListRow>
    );
}

/** Indents a tree row by its depth, and holds the expand button's place on a row without children. */
function TreeIndent({ depth, children }: Readonly<{ depth: number; children?: React.ReactNode }>) {
    return (
        <div className="flex shrink-0 items-center" style={{ paddingInlineStart: depth * 20 }}>
            {children ?? <div className="size-6" />}
        </div>
    );
}

function SelectedMark() {
    return (
        <ListRowTrailing>
            <Check className="size-4 text-primary" aria-hidden="true" />
        </ListRowTrailing>
    );
}

function CollectionTreeNode({
    collection,
    depth,
    expanded,
    onToggleExpanded,
    onSelect,
    selectedCollectionId,
    collectionsToMove,
    childCollectionsByParentId,
    childTotalsByParentId,
    onLoadMoreChildren,
}: Readonly<CollectionTreeNodeProps>) {
    const { t } = useLingui();
    const hasChildren = collection.children && collection.children.length > 0;
    const isExpanded = expanded[collection.id];
    const isSelected = selectedCollectionId === collection.id;
    const isBeingMoved = collectionsToMove.some(c => c.id === collection.id);
    const isChildOfBeingMoved = collectionsToMove.some(c => collection.breadcrumbs.some(b => b.id === c.id));

    // Don't allow selecting collections that are being moved or are children of collections being moved
    const isSelectable = !isBeingMoved && !isChildOfBeingMoved;

    const childCollections = childCollectionsByParentId[collection.id] || [];
    const hasMoreChildren = (childTotalsByParentId[collection.id] ?? 0) > childCollections.length;

    return (
        <>
            <ListRow role="listitem">
                <TreeIndent depth={depth}>
                    {hasChildren && (
                        <Button
                            type="button"
                            size="icon-xs"
                            variant="ghost"
                            onClick={() => onToggleExpanded(collection.id)}
                            aria-label={isExpanded ? t`Collapse ${collection.name}` : t`Expand ${collection.name}`}
                            aria-expanded={isExpanded}
                        >
                            <ChevronRight className={isExpanded ? 'rotate-90' : undefined} />
                        </Button>
                    )}
                </TreeIndent>
                <ListRowLeading>{isExpanded ? <FolderOpen /> : <Folder />}</ListRowLeading>
                <ListRowContent className={isSelectable ? undefined : 'opacity-50'}>
                    {isSelectable ? (
                        <ListRowLink aria-pressed={isSelected} onClick={() => onSelect(collection)}>
                            {collection.name}
                        </ListRowLink>
                    ) : (
                        <ListRowTitle>{collection.name}</ListRowTitle>
                    )}
                    {collection.breadcrumbs.length > 1 && (
                        <ListRowMeta>
                            {collection.breadcrumbs
                                .slice(1)
                                .map(b => b.name)
                                .join(' / ')}
                        </ListRowMeta>
                    )}
                </ListRowContent>
                {isSelected && <SelectedMark />}
            </ListRow>
            {hasChildren && isExpanded && (
                <>
                    {childCollections.map((childCollection: Collection) => (
                        <CollectionTreeNode
                            key={childCollection.id}
                            collection={childCollection}
                            depth={depth + 1}
                            expanded={expanded}
                            onToggleExpanded={onToggleExpanded}
                            onSelect={onSelect}
                            selectedCollectionId={selectedCollectionId}
                            collectionsToMove={collectionsToMove}
                            childCollectionsByParentId={childCollectionsByParentId}
                            childTotalsByParentId={childTotalsByParentId}
                            onLoadMoreChildren={onLoadMoreChildren}
                        />
                    ))}
                    {hasMoreChildren && (
                        <ListRow role="listitem">
                            <TreeIndent depth={depth + 1} />
                            <Button
                                type="button"
                                variant="link"
                                size="sm"
                                onClick={() => onLoadMoreChildren(collection.id)}
                            >
                                <Trans>Load more</Trans>
                            </Button>
                        </ListRow>
                    )}
                </>
            )}
        </>
    );
}

export function MoveCollectionsDialog({
    open,
    onOpenChange,
    collectionsToMove,
    onSuccess,
    onResetExpanded,
}: Readonly<MoveCollectionsDialogProps>) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [selectedCollectionId, setSelectedCollectionId] = useState<string>();
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearchTerm = useDebounce(searchTerm, 300);
    const collectionNameCache = useRef<Map<string, string>>(new Map());
    const queryClient = useQueryClient();
    const { t } = useLingui();
    const collectionForMoveKey = ['collectionsForMove', debouncedSearchTerm];

    const { data: collectionsData, isLoading } = useQuery({
        queryKey: collectionForMoveKey,
        queryFn: () =>
            api.query(collectionListForMoveDocument, {
                options: {
                    take: 100,
                    topLevelOnly: !debouncedSearchTerm,
                    ...(debouncedSearchTerm && {
                        filter: {
                            name: { contains: debouncedSearchTerm },
                        },
                    }),
                },
            }),
        enabled: open,
    });

    const topLevelCollectionId = collectionsData?.collections.items[0]?.parentId;
    const selectionHasTopLevelParent = collectionsToMove.some(c => c.parentId === topLevelCollectionId);

    // Loads child collections for expanded nodes one page (CHILDREN_PAGE_SIZE) at a time.
    // Expanding a node with many children (common in deeply nested trees) would otherwise
    // fetch every descendant - and compute breadcrumbs for each - in a single unbounded
    // request.
    const { accumulatedChildren, handleLoadMoreChildren, resetChildren } = usePaginatedChildCollections<
        Collection
    >({
        expandedIds: Object.entries(expanded)
            .filter(([, isExpanded]) => isExpanded)
            .map(([collectionId]) => collectionId),
        pageSize: CHILDREN_PAGE_SIZE,
        queryKeyPrefix: 'childCollectionsForMove',
        fetchChildren: async (parentId, take, skip) => {
            const result = await api.query(collectionListForMoveDocument, {
                options: {
                    filter: {
                        parentId: { eq: parentId },
                    },
                    take,
                    skip,
                },
            });
            return {
                items: result.collections.items as Collection[],
                totalItems: result.collections.totalItems,
            };
        },
    });

    const childCollectionsByParentId: Record<string, Collection[]> = {};
    const childTotalsByParentId: Record<string, number> = {};
    for (const [collectionId, { items, totalItems }] of Object.entries(accumulatedChildren)) {
        // Populate the name cache with these collections
        items.forEach(collection => {
            collectionNameCache.current.set(collection.id, collection.name);
        });
        childCollectionsByParentId[collectionId] = items;
        childTotalsByParentId[collectionId] = totalItems;
    }

    const moveCollectionsMutation = useMutation({
        mutationFn: api.mutate(moveCollectionDocument),
        onSuccess: () => {
            toast.success(t`Collections moved successfully`);
            queryClient.invalidateQueries({ queryKey: collectionForMoveKey });
            queryClient.removeQueries({ queryKey: ['childCollectionsForMove'] });
            resetChildren();
            // Remove child caches BEFORE invalidating the main list to prevent
            // stale cached children from being synced back (same race as drag-reorder).
            onResetExpanded?.();
            onSuccess?.();
            onOpenChange(false);
        },
        onError: error => {
            toast.error(t`Failed to move collections`);
            console.error('Move collections error:', error);
        },
    });

    const handleToggleExpanded = (id: string) => {
        setExpanded(prev => ({
            ...prev,
            [id]: !prev[id],
        }));
    };

    const handleSelect = (collection: Collection) => {
        setSelectedCollectionId(collection.id);
    };

    const handleMove = () => {
        if (!selectedCollectionId) {
            toast.error(t`Please select a target collection`);
            return;
        }
        // Move to a specific parent using moveCollection
        const movePromises = collectionsToMove.map((collection: Collection) =>
            moveCollectionsMutation.mutateAsync({
                input: {
                    collectionId: collection.id,
                    parentId: selectedCollectionId,
                    index: 0, // Move to the beginning of the target collection
                },
            }),
        );
        Promise.all(movePromises);
    };

    const collections = (collectionsData?.collections.items as Collection[]) || [];

    // Populate the name cache with top-level collections
    collections.forEach(collection => {
        collectionNameCache.current.set(collection.id, collection.name);
    });

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="sm:max-w-[600px] h-[90vh] flex flex-col p-0 gap-0"
                // The "Move" menu item keeps its DropdownMenu open (closeOnClick={false}) so
                // this dialog can open on top of it. React bubbles synthetic keyboard events
                // through the component tree, not the DOM tree. Without stopping propagation
                // here, the still-open menu's own keydown handling (typeahead and roving
                // focus) intercepts every keystroke typed into this dialog, including the
                // filter input below (#5393). Escape-to-close is unaffected: Base UI merges
                // its own dismiss handler onto this same element, and that handler still runs.
                onKeyDown={e => e.stopPropagation()}
            >
                <DialogHeader className="px-6 pt-6 pb-4">
                    <DialogTitle>
                        <Trans>Move Collections</Trans>
                    </DialogTitle>
                    <DialogDescription>
                        <Plural
                            value={collectionsToMove.length}
                            _1="Select a target collection to move this collection to."
                            other="Select a target collection to move # collections to."
                        />
                    </DialogDescription>
                </DialogHeader>
                <div className="px-6 py-3 bg-muted/50 border-y shrink-0">
                    <div className="flex flex-wrap gap-2">
                        {collectionsToMove.map(collection => (
                            <div
                                key={collection.id}
                                className="flex items-center gap-2 px-3 py-1 bg-background border rounded-md text-sm"
                            >
                                <Folder className="h-3 w-3 text-muted-foreground" />
                                <span>{collection.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="flex-1 min-h-0 overflow-auto px-6 py-4">
                    <div className="h-full flex flex-col gap-3">
                        <div className="relative shrink-0">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t`Filter by collection name`}
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                className="pl-10"
                            />
                        </div>
                        <div>
                            {isLoading ? (
                                <div className="flex items-center justify-center py-8">
                                    <Trans>Loading collections...</Trans>
                                </div>
                            ) : (
                                <div role="list">
                                    {!debouncedSearchTerm && !selectionHasTopLevelParent && (
                                        <MoveToTopLevel
                                            selectedCollectionId={selectedCollectionId}
                                            topLevelCollectionId={topLevelCollectionId}
                                            onSelect={setSelectedCollectionId}
                                        />
                                    )}
                                    {collections.map((collection: Collection) => (
                                        <CollectionTreeNode
                                            key={collection.id}
                                            collection={collection}
                                            depth={0}
                                            expanded={expanded}
                                            onToggleExpanded={handleToggleExpanded}
                                            onSelect={handleSelect}
                                            selectedCollectionId={selectedCollectionId}
                                            collectionsToMove={collectionsToMove}
                                            childCollectionsByParentId={childCollectionsByParentId}
                                            childTotalsByParentId={childTotalsByParentId}
                                            onLoadMoreChildren={handleLoadMoreChildren}
                                        />
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="shrink-0">
                            <TargetAlert
                                selectedCollectionId={selectedCollectionId}
                                collectionsToMove={collectionsToMove}
                                topLevelCollectionId={topLevelCollectionId}
                                collectionNameCache={collectionNameCache}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter className="px-6 pb-6 pt-4 shrink-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button
                        onClick={handleMove}
                        disabled={!selectedCollectionId || moveCollectionsMutation.isPending}
                    >
                        {moveCollectionsMutation.isPending ? (
                            <Trans>Moving...</Trans>
                        ) : (
                            <Trans>Move Collections</Trans>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
