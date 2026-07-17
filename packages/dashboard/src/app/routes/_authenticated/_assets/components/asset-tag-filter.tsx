import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { LoadingState } from '@/vdb/components/ui/state-views.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import {
    DataTableFacetedFilterProps,
    FacetedFilterChip,
} from '@/vdb/components/data-table/data-table-faceted-filter.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Check, Filter, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { tagListDocument } from '../assets.graphql.js';

/**
 * The Asset API exposes tags as a list option rather than a filterable Asset
 * field, so this faceted filter uses a synthetic table column. The list table
 * translates the selected values to `AssetListOptions.tags` before querying.
 */
export function AssetTagFacetedFilter<TData, TValue>({
    column,
    title,
    defaultOpen,
    onOpenChange,
}: Readonly<DataTableFacetedFilterProps<TData, TValue>>) {
    const { t } = useLingui();
    const filterValue = column?.getFilterValue();
    const selectedTags = Array.isArray(filterValue) ? filterValue.map(String) : [];

    return (
        <Popover defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
            <FacetedFilterChip
                icon={Filter}
                title={title ?? t`Tags`}
                valueLabel={
                    selectedTags.length > 2
                        ? t`${selectedTags.length} selected`
                        : selectedTags.join(', ') || undefined
                }
                onClear={() => column?.setFilterValue(undefined)}
            />
            <PopoverContent className="w-80 p-0" align="start">
                <AssetTagFilterOptions
                    selectedTags={selectedTags}
                    onTagsChange={tags => column?.setFilterValue(tags.length > 0 ? tags : undefined)}
                />
            </PopoverContent>
        </Popover>
    );
}

export function AssetGridTagFilter({
    selectedTags,
    onTagsChange,
}: Readonly<{
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
}>) {
    const { t } = useLingui();

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button variant="outline" aria-label={t`Filter assets by tags`} />
                }
            >
                <Filter className="h-4 w-4" />
                <Trans>Filter</Trans>
                {selectedTags.length > 0 && <Badge variant="default">{selectedTags.length}</Badge>}
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0" align="start">
                <AssetTagFilterOptions selectedTags={selectedTags} onTagsChange={onTagsChange} />
            </PopoverContent>
        </Popover>
    );
}

function AssetTagFilterOptions({
    selectedTags,
    onTagsChange,
}: Readonly<{
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
}>) {
    const { t } = useLingui();
    const [searchValue, setSearchValue] = useState('');
    const debouncedSearch = useDebounce(searchValue, 300);
    const pageSize = 25;

    // Fetch available tags with infinite query
    const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
        queryKey: ['tags', debouncedSearch],
        queryFn: async ({ pageParam = 0 }) => {
            const options: any = {
                skip: pageParam * pageSize,
                take: pageSize,
                sort: { value: 'ASC' },
            };

            if (debouncedSearch.trim()) {
                options.filter = {
                    value: { contains: debouncedSearch.trim() },
                };
            }

            const response = await api.query(tagListDocument, { options });
            return response.tags;
        },
        getNextPageParam: (lastPage, allPages) => {
            if (!lastPage) return undefined;
            const totalFetched = allPages.length * pageSize;
            return totalFetched < lastPage.totalItems ? allPages.length : undefined;
        },
        initialPageParam: 0,
        staleTime: 1000 * 60 * 5,
    });

    const availableTags = data?.pages.flatMap(page => page?.items ?? []) ?? [];
    const totalTags = data?.pages[0]?.totalItems ?? 0;

    // Tags are already filtered server-side, so use them directly
    const filteredTags = availableTags;

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const scrolledToBottom = Math.abs(target.scrollHeight - target.clientHeight - target.scrollTop) < 1;

        if (scrolledToBottom && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    return (
        <Command shouldFilter={false}>
            <CommandInput placeholder={t`Search tags...`} value={searchValue} onValueChange={setSearchValue} />
            <CommandList className="max-h-[300px] overflow-y-auto" onScroll={handleScroll}>
                <CommandEmpty>
                    {isLoading ? (
                        <LoadingState variant="spinner" className="py-6" />
                    ) : (
                        <div className="p-2 text-sm">
                            <Trans>No tags found</Trans>
                        </div>
                    )}
                </CommandEmpty>
                <CommandGroup>
                    {filteredTags.map(tag => {
                        const isSelected = selectedTags.includes(tag.value);
                        return (
                            <CommandItem
                                key={tag.id}
                                onSelect={() => {
                                    const next = new Set(selectedTags);
                                    if (isSelected) {
                                        next.delete(tag.value);
                                    } else {
                                        next.add(tag.value);
                                    }
                                    onTagsChange(Array.from(next));
                                    setSearchValue('');
                                }}
                            >
                                <Check
                                    className={cn(
                                        'mr-2 h-4 w-4',
                                        isSelected ? 'opacity-100' : 'opacity-0',
                                    )}
                                />
                                {tag.value}
                            </CommandItem>
                        );
                    })}

                    {(isFetchingNextPage || isLoading) && (
                        <div className="flex items-center justify-center py-2">
                            <Loader2 className="h-4 w-4 animate-spin" />
                        </div>
                    )}

                    {!hasNextPage &&
                        filteredTags.length > 0 &&
                        totalTags > filteredTags.length && (
                            <div className="text-center py-2 text-xs text-muted-foreground">
                                <Trans>Showing all {filteredTags.length} results</Trans>
                            </div>
                        )}
                </CommandGroup>
            </CommandList>
        </Command>
    );
}
