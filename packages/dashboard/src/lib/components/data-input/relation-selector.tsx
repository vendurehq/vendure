import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import {
    Command,
    CommandEmpty,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { getQueryName } from '@/vdb/framework/document-introspection/get-document-structure.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import type { DocumentNode } from 'graphql';
import { CheckIcon, Loader2, Plus, X } from 'lucide-react';
import React, { useState } from 'react';

export interface RelationSelectorConfig<T = any> {
    /** The GraphQL query document for fetching items */
    listQuery: DocumentNode;
    /** The property key for the entity ID */
    idKey: keyof T;
    /** The property key for the display label */
    labelKey: keyof T;
    /** Number of items to load per page */
    pageSize?: number;
    /** Placeholder text for the search input */
    placeholder?: string;
    /** Whether to enable multi-select mode */
    multiple?: boolean;
    /** Custom filter function for search */
    buildSearchFilter?: (searchTerm: string) => any;
    /** Custom filter function for fetching by IDs */
    buildIdsFilter?: (ids: string[]) => any;
    /** Custom label renderer function for rich display */
    label?: (item: T) => React.ReactNode;
}

export interface RelationSelectorProps<T = any> {
    config: RelationSelectorConfig<T>;
    /**
     * @description
     * The label for the selector trigger. Default is
     * "Select item" for single select and "Select items" for multi select.
     */
    selectorLabel?: React.ReactNode;
    value?: string | string[];
    onChange: (value: string | string[] | null) => void;
    disabled?: boolean;
    className?: string;
}

export interface RelationSelectorItemProps<T = any> {
    item: T;
    config: RelationSelectorConfig<T>;
    isSelected: boolean;
    onSelect: () => void;
    showCheckbox?: boolean;
}

/**
 * Abstract relation selector item component
 */
export function RelationSelectorItem<T>({
    item,
    config,
    isSelected,
    onSelect,
    showCheckbox = false,
}: Readonly<RelationSelectorItemProps<T>>) {
    const id = String(item[config.idKey]);
    const label = config.label ? config.label(item) : String(item[config.labelKey]);

    return (
        <CommandItem key={id} value={id} onSelect={onSelect} className="flex items-center gap-2">
            {showCheckbox && (
                <Checkbox
                    checked={isSelected}
                    onChange={onSelect}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                />
            )}
            {isSelected && !showCheckbox && <CheckIcon className="h-4 w-4" />}
            <span className="flex-1">{label}</span>
        </CommandItem>
    );
}

/**
 * Hook for managing relation selector state and queries
 */
export function useRelationSelector<T>(config: RelationSelectorConfig<T>) {
    const [searchTerm, setSearchTerm] = useState('');
    const debouncedSearch = useDebounce(searchTerm, 300);

    const pageSize = config.pageSize ?? 25;

    // Build the default search filter if none provided
    const buildFilter =
        config.buildSearchFilter ??
        ((term: string) => ({
            [config.labelKey]: { contains: term },
        }));

    // Build the default IDs filter if none provided
    const buildIdsFilter = React.useCallback(
        (ids: string[]) => {
            if (config.buildIdsFilter) {
                return config.buildIdsFilter(ids);
            }
            return {
                [config.idKey]: { in: ids },
            };
        },
        [config.idKey, config.buildIdsFilter],
    );

    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage, error } = useInfiniteQuery({
        queryKey: ['relationSelector', getQueryName(config.listQuery), debouncedSearch],
        queryFn: async ({ pageParam = 0 }) => {
            const variables: any = {
                options: {
                    skip: pageParam * pageSize,
                    take: pageSize,
                    sort: { [config.labelKey]: 'ASC' },
                },
            };

            // Add search filter if there's a search term
            if (debouncedSearch.trim().length > 0) {
                variables.options.filter = buildFilter(debouncedSearch.trim());
            }

            const response = (await api.query(config.listQuery, variables)) as any;
            return response[getQueryName(config.listQuery)];
        },
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage) return undefined;
            const totalFetched = allPages.length * pageSize;
            return totalFetched < lastPage.totalItems ? allPages.length : undefined;
        },
        initialPageParam: 0,
    });

    const items = data?.pages.flatMap(page => page?.items ?? []) ?? [];

    // Function to fetch items by IDs
    const fetchItemsByIds = React.useCallback(
        async (ids: string[]): Promise<T[]> => {
            if (ids.length === 0) return [];

            const variables: any = {
                options: {
                    take: ids.length,
                    filter: buildIdsFilter(ids),
                },
            };

            try {
                const response = (await api.query(config.listQuery, variables)) as any;
                const result = response[getQueryName(config.listQuery)];
                return result?.items ?? [];
            } catch (error) {
                console.error('Error fetching items by IDs:', error);
                return [];
            }
        },
        [buildIdsFilter, config.listQuery],
    );

    return {
        items,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        error,
        searchTerm,
        setSearchTerm,
        fetchItemsByIds,
    };
}

/**
 * Abstract relation selector component
 */
export function RelationSelector<T>({
    config,
    value,
    onChange,
    disabled,
    className,
    selectorLabel,
}: Readonly<RelationSelectorProps<T>>) {
    const [open, setOpen] = useState(false);
    const [selectedItemsCache, setSelectedItemsCache] = useState<T[]>([]);
    const fetchedIdsRef = React.useRef<Set<string>>(new Set());
    const fetchingIdsRef = React.useRef<Set<string>>(new Set());
    const isMultiple = config.multiple ?? false;

    const {
        items,
        isLoading,
        fetchNextPage,
        hasNextPage,
        isFetchingNextPage,
        searchTerm,
        setSearchTerm,
        fetchItemsByIds,
    } = useRelationSelector(config);

    // Store a stable reference to fetchItemsByIds
    const fetchItemsByIdsRef = React.useRef(fetchItemsByIds);
    fetchItemsByIdsRef.current = fetchItemsByIds;

    // Normalize value to always be an array for easier handling
    const selectedIds = React.useMemo(() => {
        if (isMultiple) {
            return Array.isArray(value) ? value : value ? [value] : [];
        }
        // For single select, ensure we only have at most one ID
        const singleValue = Array.isArray(value) ? value[0] : value;
        return singleValue ? [String(singleValue)] : [];
    }, [value, isMultiple]);

    // Fetch selected items by IDs on mount and when selectedIds change
    React.useEffect(() => {
        const fetchSelectedItems = async () => {
            if (selectedIds.length === 0) {
                setSelectedItemsCache([]);
                fetchedIdsRef.current.clear();
                fetchingIdsRef.current.clear();
                return;
            }

            // Find which selected IDs we haven't fetched yet and aren't currently fetching
            const missingIds = selectedIds.filter(
                id => !fetchedIdsRef.current.has(id) && !fetchingIdsRef.current.has(id),
            );

            if (missingIds.length > 0) {
                // Mark these IDs as being fetched
                missingIds.forEach(id => fetchingIdsRef.current.add(id));

                try {
                    const fetchedItems = await fetchItemsByIdsRef.current(missingIds);

                    // Mark these IDs as fetched and remove from fetching
                    missingIds.forEach(id => {
                        fetchedIdsRef.current.add(id);
                        fetchingIdsRef.current.delete(id);
                    });

                    setSelectedItemsCache(prev => {
                        if (!isMultiple) {
                            // For single select, replace the entire cache
                            return fetchedItems;
                        }
                        // For multi-select, filter and append
                        const stillSelected = prev.filter(item =>
                            selectedIds.includes(String(item[config.idKey])),
                        );
                        return [...stillSelected, ...fetchedItems];
                    });
                } catch (error) {
                    // Remove from fetching set on error
                    missingIds.forEach(id => fetchingIdsRef.current.delete(id));
                    console.error('Error fetching items by IDs:', error);
                }
            } else {
                // Just filter out items that are no longer selected
                setSelectedItemsCache(prev => {
                    if (!isMultiple) {
                        // For single select, if no items need fetching but we have a selection,
                        // keep only items that are in the current selection
                        return prev.filter(item => selectedIds.includes(String(item[config.idKey])));
                    }
                    // For multi-select, normal filtering
                    return prev.filter(item => selectedIds.includes(String(item[config.idKey])));
                });
            }

            // Clean up fetched IDs that are no longer selected
            const selectedIdsSet = new Set(selectedIds);
            for (const fetchedId of fetchedIdsRef.current) {
                if (!selectedIdsSet.has(fetchedId)) {
                    fetchedIdsRef.current.delete(fetchedId);
                }
            }
        };

        fetchSelectedItems();
    }, [selectedIds, config.idKey, isMultiple]);

    const handleSelect = (item: T) => {
        const itemId = String(item[config.idKey]);

        if (isMultiple) {
            const isCurrentlySelected = selectedIds.includes(itemId);
            const newSelectedIds = isCurrentlySelected
                ? selectedIds.filter(id => id !== itemId)
                : [...selectedIds, itemId];

            // Update cache: add item if selecting, remove if deselecting
            setSelectedItemsCache(prev => {
                if (isCurrentlySelected) {
                    return prev.filter(prevItem => String(prevItem[config.idKey]) !== itemId);
                } else {
                    // Only add if not already in cache
                    const alreadyInCache = prev.some(prevItem => String(prevItem[config.idKey]) === itemId);
                    return alreadyInCache ? prev : [...prev, item];
                }
            });

            // Mark the item as fetched to prevent duplicate fetching
            if (!isCurrentlySelected) {
                fetchedIdsRef.current.add(itemId);
            } else {
                fetchedIdsRef.current.delete(itemId);
            }

            onChange(newSelectedIds);
        } else {
            // For single select, update cache with the new item
            setSelectedItemsCache([item]);
            // Mark as fetched for single select too
            fetchedIdsRef.current.clear();
            fetchedIdsRef.current.add(itemId);
            onChange(itemId);
            setOpen(false);
            setSearchTerm('');
        }
    };

    const handleRemove = (itemId: string) => {
        if (isMultiple) {
            const newSelectedIds = selectedIds.filter(id => id !== itemId);
            // Remove from cache as well
            setSelectedItemsCache(prev => prev.filter(prevItem => String(prevItem[config.idKey]) !== itemId));
            onChange(newSelectedIds);
        } else {
            // Clear cache for single select
            setSelectedItemsCache([]);
            onChange(null);
        }
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const scrolledToBottom = Math.abs(target.scrollHeight - target.clientHeight - target.scrollTop) < 1;

        if (scrolledToBottom && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    // Get selected items for display from cache, filtered by current selection
    const selectedItems = React.useMemo(() => {
        const filteredItems = selectedItemsCache.filter(item =>
            selectedIds.includes(String(item[config.idKey])),
        );
        // For single select, ensure we only display one item
        return isMultiple ? filteredItems : filteredItems.slice(0, 1);
    }, [selectedItemsCache, selectedIds, config.idKey, isMultiple]);

    return (
        <div className={cn('overflow-auto', className)}>
            {/* Display selected items */}
            {selectedItems.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-2">
                    {selectedItems.map(item => {
                        const itemId = String(item[config.idKey]);
                        const label = config.label ? config.label(item) : String(item[config.labelKey]);
                        return (
                            <div
                                key={itemId}
                                className="inline-flex items-center gap-1 bg-secondary text-secondary-foreground px-2 py-1 rounded-md text-sm max-w-full min-w-0"
                            >
                                <div className="min-w-0 flex-1">{label}</div>
                                {!disabled && (
                                    <button
                                        type="button"
                                        onClick={() => handleRemove(itemId)}
                                        className="text-secondary-foreground/70 hover:text-secondary-foreground"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Selector trigger */}
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" type="button" disabled={disabled} className="gap-2">
                        <Plus className="h-4 w-4" />
                        <Trans>
                            {isMultiple
                                ? selectedItems.length > 0
                                    ? `Add more (${selectedItems.length} selected)`
                                    : (selectorLabel ?? <Trans>Select items</Trans>)
                                : selectedItems.length > 0
                                  ? 'Change selection'
                                  : (selectorLabel ?? <Trans>Select item</Trans>)}
                        </Trans>
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="p-0 w-[400px]" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder={config.placeholder ?? 'Search...'}
                            value={searchTerm}
                            onValueChange={setSearchTerm}
                            disabled={disabled}
                        />
                        <CommandList className="h-[300px] overflow-y-auto" onScroll={handleScroll}>
                            <CommandEmpty>
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        <Trans>Loading...</Trans>
                                    </div>
                                ) : (
                                    <Trans>No results found</Trans>
                                )}
                            </CommandEmpty>

                            {items.map(item => {
                                const itemId = String(item[config.idKey]);
                                const isSelected = selectedIds.includes(itemId);

                                return (
                                    <RelationSelectorItem
                                        key={itemId}
                                        item={item}
                                        config={config}
                                        isSelected={isSelected}
                                        onSelect={() => handleSelect(item)}
                                        showCheckbox={isMultiple}
                                    />
                                );
                            })}

                            {(isFetchingNextPage || isLoading) && (
                                <div className="flex items-center justify-center py-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            )}

                            {!hasNextPage && items.length > 0 && (
                                <div className="text-center py-2 text-sm text-muted-foreground">
                                    <Trans>No more items</Trans>
                                </div>
                            )}
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}

/**
 * Utility function to create a relation selector configuration
 */
export function createRelationSelectorConfig<T>(
    config: Readonly<RelationSelectorConfig<T>>,
): RelationSelectorConfig<T> {
    return config;
}
