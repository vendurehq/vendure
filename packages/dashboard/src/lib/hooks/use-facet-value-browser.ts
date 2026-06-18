import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import React, { useState } from 'react';

export interface FacetValue {
    id: string;
    name: string;
    code: string;
    facet: Facet;
}

export interface Facet {
    id: string;
    name: string;
    code: string;
}

const getFacetValueListDocument = graphql(`
    query GetFacetValueList($options: FacetValueListOptions) {
        facetValues(options: $options) {
            items {
                id
                name
                code
                facet {
                    id
                    name
                    code
                }
            }
            totalItems
        }
    }
`);

const getFacetListDocument = graphql(`
    query GetFacetList($options: FacetListOptions) {
        facets(options: $options) {
            items {
                id
                name
                code
            }
            totalItems
        }
    }
`);

const getFacetValuesForFacetDocument = graphql(`
    query GetFacetValuesForFacet($options: FacetValueListOptions) {
        facetValues(options: $options) {
            items {
                id
                name
                code
                facet {
                    id
                    name
                    code
                }
            }
            totalItems
        }
    }
`);

export { getFacetValueListDocument };

export interface UseFacetValueBrowserOptions {
    /** Number of items per page for infinite scroll. @default 10 */
    pageSize?: number;
    /** Whether to start in browse mode. @default false */
    initialBrowseMode?: boolean;
    /** Query key prefix to avoid cache collisions between consumers. @default 'facetValues' */
    queryKeyPrefix?: string;
}

export interface UseFacetValueBrowserReturn {
    // Search state
    searchTerm: string;
    setSearchTerm: (value: string) => void;
    debouncedSearch: string;
    minSearchLength: number;

    // Browse/expand state
    browseMode: boolean;
    setBrowseMode: (value: boolean) => void;
    expandedFacetId: string | null;
    setExpandedFacetId: (id: string | null) => void;

    // Derived data
    facetValues: FacetValue[];
    facets: Facet[];
    expandedFacetValues: FacetValue[];
    expandedFacetName: string | undefined;
    facetGroups: Record<string, FacetValue[]>;

    // Loading states
    isLoading: boolean;
    isFetchingNextPage: boolean;
    isFetchingNextFacetsPage: boolean;
    isLoadingExpandedFacet: boolean;

    // Pagination
    hasNextPage: boolean;
    hasNextFacetsPage: boolean;

    // Infinite scroll
    handleScroll: (e: React.UIEvent<HTMLDivElement>) => void;

    // Reset all state
    reset: () => void;
}

/**
 * @description
 * A hook that encapsulates the data-fetching, pagination, search, and browse-mode logic
 * for navigating facets and facet values. Used by both `FacetValueSelector` (single-select)
 * and `FacetValueFacetedFilter` (multi-select for list filtering).
 *
 * @docsCategory hooks
 * @since 3.6.0
 */
export function useFacetValueBrowser(options?: UseFacetValueBrowserOptions): UseFacetValueBrowserReturn {
    const { pageSize = 10, initialBrowseMode = false, queryKeyPrefix = 'facetValues' } = options ?? {};
    const minSearchLength = 1;

    const [searchTerm, setSearchTerm] = useState('');
    const [expandedFacetId, setExpandedFacetId] = useState<string | null>(null);
    const [browseMode, setBrowseMode] = useState(initialBrowseMode);
    const debouncedSearch = useDebounce(searchTerm, 200);

    // Search facet values by name
    const { data: facetValueData, isLoading: isLoadingFacetValues } = useQuery({
        queryKey: [queryKeyPrefix, debouncedSearch],
        queryFn: () => {
            if (debouncedSearch.length < minSearchLength) {
                return { facetValues: { items: [], totalItems: 0 } };
            }
            return api.query(getFacetValueListDocument, {
                options: {
                    filter: { name: { contains: debouncedSearch } },
                    take: 100,
                },
            });
        },
        enabled: debouncedSearch.length >= minSearchLength && !expandedFacetId,
    });

    // Search facets by name
    const { data: facetSearchData, isLoading: isLoadingFacetSearch } = useQuery({
        queryKey: [queryKeyPrefix, 'facets', debouncedSearch],
        queryFn: () => {
            if (debouncedSearch.length < minSearchLength) {
                return { facets: { items: [], totalItems: 0 } };
            }
            return api.query(getFacetListDocument, {
                options: {
                    filter: { name: { contains: debouncedSearch } },
                    take: 100,
                },
            });
        },
        enabled: !browseMode && debouncedSearch.length >= minSearchLength && !expandedFacetId,
    });

    // Browse facets with pagination
    const {
        data: facetBrowseData,
        isLoading: isLoadingFacetBrowse,
        fetchNextPage: fetchNextFacetsPage,
        hasNextPage: hasNextFacetsPage,
        isFetchingNextPage: isFetchingNextFacetsPage,
    } = useInfiniteQuery({
        queryKey: [queryKeyPrefix, 'facets', 'browse'],
        queryFn: async ({ pageParam = 0 }) => {
            const response = await api.query(getFacetListDocument, {
                options: {
                    filter: {},
                    sort: { name: 'ASC' },
                    skip: pageParam * pageSize,
                    take: pageSize,
                },
            });
            return response.facets;
        },
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage) return undefined;
            const totalFetched = allPages.length * pageSize;
            return totalFetched < lastPage.totalItems ? allPages.length : undefined;
        },
        enabled: browseMode && !expandedFacetId,
        initialPageParam: 0,
    });

    // Browse facet values within a specific facet
    const {
        data: expandedFacetData,
        isLoading: isLoadingExpandedFacet,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
    } = useInfiniteQuery({
        queryKey: [queryKeyPrefix, expandedFacetId, 'infinite'],
        queryFn: async ({ pageParam = 0 }) => {
            if (!expandedFacetId) return null;
            const response = await api.query(getFacetValuesForFacetDocument, {
                options: {
                    filter: { facetId: { eq: expandedFacetId } },
                    sort: { code: 'ASC' },
                    skip: pageParam * pageSize,
                    take: pageSize,
                },
            });
            return response.facetValues;
        },
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage) return undefined;
            const totalFetched = allPages.length * pageSize;
            return totalFetched < lastPage.totalItems ? allPages.length : undefined;
        },
        enabled: !!expandedFacetId,
        initialPageParam: 0,
    });

    // Derived data
    const facetValues = (facetValueData?.facetValues.items ?? []) as FacetValue[];
    const facets = browseMode
        ? ((facetBrowseData?.pages.flatMap(page => page?.items ?? []) ?? []) as Facet[])
        : ((facetSearchData?.facets.items ?? []) as Facet[]);
    const expandedFacetValues = (expandedFacetData?.pages.flatMap(page => page?.items ?? []) ??
        []) as FacetValue[];
    const expandedFacetName = expandedFacetValues[0]?.facet.name;

    // Group search results by facet
    const facetGroups = facetValues.reduce<Record<string, FacetValue[]>>((groups, fv) => {
        const facetId = fv.facet.id;
        if (!groups[facetId]) {
            groups[facetId] = [];
        }
        groups[facetId].push(fv);
        return groups;
    }, {});

    const isLoading =
        isLoadingFacetValues || isLoadingFacetSearch || isLoadingFacetBrowse || isLoadingExpandedFacet;

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const scrolledToBottom = Math.abs(target.scrollHeight - target.clientHeight - target.scrollTop) < 1;
        if (scrolledToBottom && !isFetchingNextPage) {
            if (expandedFacetId && hasNextPage) {
                void fetchNextPage();
            }
            if (browseMode && !expandedFacetId && hasNextFacetsPage) {
                void fetchNextFacetsPage();
            }
        }
    };

    const reset = () => {
        setSearchTerm('');
        setExpandedFacetId(null);
        setBrowseMode(initialBrowseMode);
    };

    return {
        searchTerm,
        setSearchTerm,
        debouncedSearch,
        minSearchLength,
        browseMode,
        setBrowseMode,
        expandedFacetId,
        setExpandedFacetId,
        facetValues,
        facets,
        expandedFacetValues,
        expandedFacetName,
        facetGroups,
        isLoading,
        isFetchingNextPage,
        isFetchingNextFacetsPage,
        isLoadingExpandedFacet,
        hasNextPage: hasNextPage ?? false,
        hasNextFacetsPage: hasNextFacetsPage ?? false,
        handleScroll,
        reset,
    };
}
