import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Check, Filter, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { tagListDocument } from '../assets.graphql.js';

interface AssetTagFilterProps {
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
}

export function AssetTagFilter({ selectedTags, onTagsChange }: Readonly<AssetTagFilterProps>) {
    const [open, setOpen] = useState(false);
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

    const handleSelectTag = (tagValue: string) => {
        if (!selectedTags.includes(tagValue)) {
            onTagsChange([...selectedTags, tagValue]);
        }
        setSearchValue('');
    };

    const handleRemoveTag = (tagToRemove: string) => {
        onTagsChange(selectedTags.filter(tag => tag !== tagToRemove));
    };

    const handleClearAll = () => {
        onTagsChange([]);
        setOpen(false);
    };

    const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const target = e.currentTarget;
        const scrolledToBottom = Math.abs(target.scrollHeight - target.clientHeight - target.scrollTop) < 1;

        if (scrolledToBottom && hasNextPage && !isFetchingNextPage) {
            fetchNextPage();
        }
    };

    return (
        <div className="flex items-center gap-2">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger render={<Button
                        variant="outline"
                        size="sm"
                        role="combobox"
                        aria-expanded={open}
                        className="justify-start"
                    />}>
                        <Filter className="h-4 w-4 mr-2" />
                        <Trans>Filter by tags</Trans>
                        {selectedTags.length > 0 && (
                            <Badge variant="secondary" className="ml-2">
                                {selectedTags.length}
                            </Badge>
                        )}
                </PopoverTrigger>
                <PopoverContent className="w-80 p-0" align="start">
                    <Command shouldFilter={false}>
                        <CommandInput
                            placeholder="Search tags..."
                            value={searchValue}
                            onValueChange={setSearchValue}
                        />
                        <CommandList className="max-h-[300px] overflow-y-auto" onScroll={handleScroll}>
                            <CommandEmpty>
                                {isLoading ? (
                                    <div className="flex items-center justify-center py-6">
                                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                        <Trans>Loading...</Trans>
                                    </div>
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
                                                if (isSelected) {
                                                    handleRemoveTag(tag.value);
                                                } else {
                                                    handleSelectTag(tag.value);
                                                }
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
                        {selectedTags.length > 0 && (
                            <div className="border-t p-2">
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="w-full justify-start"
                                    onClick={handleClearAll}
                                >
                                    <Trans>Clear all</Trans>
                                </Button>
                            </div>
                        )}
                    </Command>
                </PopoverContent>
            </Popover>

            {/* Display selected tags */}
            {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                    {selectedTags.map(tag => (
                        <Badge key={tag} variant="secondary" className="text-xs">
                            {tag}
                            <button
                                onClick={() => handleRemoveTag(tag)}
                                className="ml-1 hover:bg-destructive/20 rounded-full p-0.5 transition-colors"
                            >
                                <X className="h-3 w-3" />
                            </button>
                        </Badge>
                    ))}
                </div>
            )}
        </div>
    );
}
