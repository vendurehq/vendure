import { useQueries } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export interface ChildCollectionsPage<T> {
    items: T[];
    totalItems: number;
}

export interface UsePaginatedChildCollectionsOptions<T> {
    /** ids of the parent collections whose children should be loaded */
    expandedIds: string[];
    pageSize: number;
    /** prefix for the react-query query keys used by this hook's queries */
    queryKeyPrefix: string;
    fetchChildren: (parentId: string, take: number, skip: number) => Promise<ChildCollectionsPage<T>>;
}

/**
 * Loads child collections for a set of expanded parent ids one page at a time, with a
 * "load more" affordance, instead of fetching every descendant of an expanded node in a
 * single unbounded request. Shared between the main collection list and the
 * move-collections dialog.
 */
export function usePaginatedChildCollections<T>({
    expandedIds,
    pageSize,
    queryKeyPrefix,
    fetchChildren,
}: Readonly<UsePaginatedChildCollectionsOptions<T>>) {
    const [accumulatedChildren, setAccumulatedChildren] = useState<Record<string, ChildCollectionsPage<T>>>(
        {},
    );
    const [nextPageToFetch, setNextPageToFetch] = useState<Record<string, number>>({});

    const childQueryKey = (parentId: string, page: number) => [queryKeyPrefix, parentId, 'page', page];

    // NOTE: queryFn must be pure (no setState side effects). With the global
    // `keepPreviousData`, a re-mounted component is served the cached data on its
    // first render before the refetch lands, and TanStack Query skips the queryFn
    // entirely for that cache-hit render. If we called setAccumulatedChildren inside
    // queryFn, those cache-hit renders would never populate accumulatedChildren, so
    // children wouldn't render. Instead we sync via the effects below, which fire for
    // both cache hits and fresh fetches.
    const firstPageChildQueries = useQueries({
        queries: expandedIds
            .filter(collectionId => !accumulatedChildren[collectionId])
            .map(collectionId => ({
                queryKey: childQueryKey(collectionId, 0),
                queryFn: async () => {
                    const { items, totalItems } = await fetchChildren(collectionId, pageSize, 0);
                    return { collectionId, items, totalItems };
                },
            })),
    });

    useEffect(() => {
        const newChildren: Record<string, ChildCollectionsPage<T>> = {};
        let hasNew = false;
        for (const query of firstPageChildQueries) {
            if (query.data && !accumulatedChildren[query.data.collectionId]) {
                newChildren[query.data.collectionId] = {
                    items: query.data.items,
                    totalItems: query.data.totalItems,
                };
                hasNew = true;
            }
        }
        if (hasNew) {
            setAccumulatedChildren(prev => ({ ...prev, ...newChildren }));
        }
    }, [firstPageChildQueries]);

    const pagedChildEntries = Object.entries(nextPageToFetch).filter(([, page]) => page > 0);
    const pagedChildQueries = useQueries({
        queries: pagedChildEntries.map(([collectionId, page]) => ({
            queryKey: childQueryKey(collectionId, page),
            queryFn: async () => {
                const { items, totalItems } = await fetchChildren(collectionId, pageSize, page * pageSize);
                return { collectionId, items, totalItems };
            },
        })),
    });
    // Keyed by parent collection id so a failed page fetch (which exhausts react-query's
    // retries and leaves `nextPageToFetch` pointing at the same page/queryKey) can be
    // retried directly via `refetch()`, since re-requesting the same page number alone
    // won't trigger a new fetch attempt.
    const pagedQueryByParentId = new Map(
        pagedChildEntries.map(([collectionId], index) => [collectionId, pagedChildQueries[index]]),
    );

    useEffect(() => {
        let hasUpdates = false;
        const childUpdates: Record<string, ChildCollectionsPage<T>> = {};
        const fetchedPages: string[] = [];
        for (const query of pagedChildQueries) {
            if (!query.data) continue;
            const { collectionId, items, totalItems } = query.data;
            if (accumulatedChildren[collectionId]) {
                childUpdates[collectionId] = {
                    items: [...accumulatedChildren[collectionId].items, ...items],
                    totalItems,
                };
                fetchedPages.push(collectionId);
                hasUpdates = true;
            }
        }
        if (hasUpdates) {
            setAccumulatedChildren(prev => ({ ...prev, ...childUpdates }));
            setNextPageToFetch(prev => {
                const next = { ...prev };
                for (const id of fetchedPages) {
                    delete next[id];
                }
                return next;
            });
        }
    }, [pagedChildQueries]);

    const handleLoadMoreChildren = (parentId: string) => {
        const pendingQuery = pagedQueryByParentId.get(parentId);
        if (pendingQuery?.isError) {
            pendingQuery.refetch();
            return;
        }
        const currentItems = accumulatedChildren[parentId]?.items.length ?? 0;
        const nextPage = Math.floor(currentItems / pageSize);
        setNextPageToFetch(prev => ({
            ...prev,
            [parentId]: nextPage,
        }));
    };

    /** Clears accumulated children for the given parent ids, or for all parents if omitted. */
    const resetChildren = (parentIds?: string[]) => {
        if (!parentIds) {
            setAccumulatedChildren({});
            setNextPageToFetch({});
            return;
        }
        setAccumulatedChildren(prev => {
            const next = { ...prev };
            parentIds.forEach(id => delete next[id]);
            return next;
        });
        setNextPageToFetch(prev => {
            const next = { ...prev };
            parentIds.forEach(id => delete next[id]);
            return next;
        });
    };

    return { accumulatedChildren, handleLoadMoreChildren, resetChildren };
}
