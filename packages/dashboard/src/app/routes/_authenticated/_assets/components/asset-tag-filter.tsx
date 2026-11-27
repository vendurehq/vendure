import {
    DataTableFacetedFilterProps,
    FacetedFilterChip,
} from '@/vdb/components/data-table/data-table-faceted-filter.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    useComboboxAnchor,
} from '@/vdb/components/ui/combobox.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { Filter } from 'lucide-react';
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
        <AssetTagCombobox
            selectedTags={selectedTags}
            onTagsChange={tags => column?.setFilterValue(tags.length > 0 ? tags : undefined)}
            defaultOpen={defaultOpen}
            onOpenChange={onOpenChange}
        >
            <FacetedFilterChip
                icon={Filter}
                title={title ?? t`Tags`}
                valueLabel={
                    selectedTags.length > 2
                        ? t`${selectedTags.length} selected`
                        : selectedTags.join(', ') || undefined
                }
                onClear={() => column?.setFilterValue(undefined)}
                triggerType="combobox"
            />
        </AssetTagCombobox>
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
        <AssetTagCombobox selectedTags={selectedTags} onTagsChange={onTagsChange}>
            <ComboboxPrimitive.Trigger
                render={<Button variant="outline" aria-label={t`Filter assets by tags`} />}
            >
                <Filter className="h-4 w-4" />
                <Trans>Filter</Trans>
                {selectedTags.length > 0 && <Badge variant="default">{selectedTags.length}</Badge>}
            </ComboboxPrimitive.Trigger>
        </AssetTagCombobox>
    );
}

const pageSize = 25;

/**
 * A multi-value tag picker that searches the tags on the server and loads the next page as
 * the list scrolls. `children` is the trigger; the search input sits in the popup.
 */
function AssetTagCombobox({
    selectedTags,
    onTagsChange,
    defaultOpen,
    onOpenChange,
    children,
}: Readonly<{
    selectedTags: string[];
    onTagsChange: (tags: string[]) => void;
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    children: React.ReactNode;
}>) {
    const { t } = useLingui();
    const anchor = useComboboxAnchor();
    const [searchValue, setSearchValue] = useState('');
    const debouncedSearch = useDebounce(searchValue, 300);

    const { data, isFetching, fetchNextPage, hasNextPage } = useInfiniteQuery({
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
    });

    const availableTags = data?.pages.flatMap(page => page?.items.map(tag => tag.value) ?? []) ?? [];

    return (
        <Combobox
            items={availableTags}
            filter={null}
            multiple
            value={selectedTags}
            onValueChange={(next: string[]) => {
                onTagsChange(next);
                setSearchValue('');
            }}
            inputValue={searchValue}
            onInputValueChange={setSearchValue}
            onLoadMore={() => void fetchNextPage()}
            hasMore={hasNextPage}
            isLoading={isFetching || searchValue !== debouncedSearch}
            loadingLabel={t`Loading tags...`}
            defaultOpen={defaultOpen}
            onOpenChange={open => onOpenChange?.(open)}
        >
            <span ref={anchor} className="inline-flex">
                {children}
            </span>
            <ComboboxContent
                anchor={anchor}
                className="w-80"
                // Opened from the toolbar's Filter menu, the popup has no trigger interaction to
                // return focus to when it closes, so it returns focus to the trigger.
                finalFocus={() => anchor.current?.querySelector('button') ?? true}
            >
                <ComboboxInput
                    aria-label={t`Search tags...`}
                    placeholder={t`Search tags...`}
                    showTrigger={false}
                />
                <ComboboxEmpty>
                    <Trans>No tags found</Trans>
                </ComboboxEmpty>
                <ComboboxList>
                    {(tag: string) => (
                        <ComboboxItem key={tag} value={tag}>
                            {tag}
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
