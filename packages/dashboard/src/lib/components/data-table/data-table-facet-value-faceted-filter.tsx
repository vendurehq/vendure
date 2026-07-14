import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { Separator } from '@/vdb/components/ui/separator.js';
import { api } from '@/vdb/graphql/api.js';
import {
    type FacetValue,
    getFacetValueListDocument,
    useFacetValueBrowser,
} from '@/vdb/hooks/use-facet-value-browser.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, FilterIcon, Loader2 } from 'lucide-react';
import React, { useState } from 'react';
import { DataTableFacetedFilterProps } from './data-table-faceted-filter.js';

/**
 * @description
 * A faceted filter component for filtering by facet values. Designed to be used
 * with the `facetedFilters` prop on the `ListPage` or `PaginatedListDataTable` components.
 *
 * Unlike the standard `DataTableFacetedFilter` which uses pre-defined options, this component
 * supports server-side search and paginated browsing using the same UX as the `FacetValueSelector`.
 *
 * @example
 * ```tsx
 * <ListPage
 *   listQuery={productListDocument}
 *   additionalColumns={{
 *     facetValueId: {
 *       header: '',
 *       cell: () => null,
 *       enableSorting: false,
 *       enableHiding: false,
 *       enableColumnFilter: false,
 *     },
 *   }}
 *   facetedFilters={{
 *     facetValueId: {
 *       title: t`Facet values`,
 *       component: FacetValueFacetedFilter,
 *     },
 *   }}
 * />
 * ```
 *
 * @docsCategory components
 * @since 3.6.0
 */
export function FacetValueFacetedFilter<TData, TValue>({
    column,
    title,
}: DataTableFacetedFilterProps<TData, TValue>) {
    const { t } = useLingui();

    const {
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
        handleScroll,
    } = useFacetValueBrowser({ initialBrowseMode: true, queryKeyPrefix: 'facetValuesFilter' });

    // Track known facet values so we can display names for selected IDs
    const [knownValues, setKnownValues] = useState<Map<string, FacetValue>>(new Map());

    // Current selection from column filter state.
    // Filter value is stored as an array, but Object.values() works on arrays too,
    // which is consistent with how DataTableFacetedFilter reads filter state.
    const filterValue = column?.getFilterValue();
    const selectedIds = filterValue
        ? new Set(Object.values(filterValue as Record<string, string>))
        : new Set<string>();

    // Fetch facet value details for selected IDs not yet in knownValues (e.g. after page reload)
    const unknownSelectedIds = Array.from(selectedIds).filter(id => !knownValues.has(id));
    useQuery({
        queryKey: ['facetValuesFilter', 'resolve', unknownSelectedIds],
        queryFn: async () => {
            const result = await api.query(getFacetValueListDocument, {
                options: { filter: { id: { in: unknownSelectedIds } } },
            });
            const items = result.facetValues.items ?? [];
            setKnownValues(prev => {
                const next = new Map(prev);
                for (const fv of items) {
                    next.set(fv.id, fv as FacetValue);
                }
                return next;
            });
            return result;
        },
        enabled: unknownSelectedIds.length > 0,
    });

    const toggleValue = (fv: FacetValue) => {
        const next = new Set(selectedIds);
        if (next.has(fv.id)) {
            next.delete(fv.id);
        } else {
            next.add(fv.id);
            setKnownValues(prev => new Map(prev).set(fv.id, fv));
        }
        const arr = Array.from(next);
        column?.setFilterValue(arr.length > 0 ? arr : undefined);
    };

    const selectedLabels = Array.from(selectedIds).map(id => {
        const fv = knownValues.get(id);
        return fv ? `${fv.facet.name}: ${fv.name}` : id;
    });

    return (
        <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8" />}>
                    <FilterIcon />
                    {title}
                    {selectedIds.size > 0 && (
                        <>
                            <Separator orientation="vertical" className="mx-2" />
                            <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                                {selectedIds.size}
                            </Badge>
                            <div className="hidden space-x-1 lg:flex">
                                {selectedIds.size > 2 ? (
                                    <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                                        {selectedIds.size} selected
                                    </Badge>
                                ) : (
                                    selectedLabels.map(label => (
                                        <Badge
                                            key={label}
                                            variant="secondary"
                                            className="rounded-sm px-1 font-normal"
                                        >
                                            {label}
                                        </Badge>
                                    ))
                                )}
                            </div>
                        </>
                    )}
            </PopoverTrigger>
            <PopoverContent className="w-[400px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={t`Search facet values...`}
                        value={searchTerm}
                        onValueChange={value => {
                            setSearchTerm(value);
                            setExpandedFacetId(null);
                            if (value.length >= minSearchLength) {
                                setBrowseMode(false);
                            } else {
                                setBrowseMode(true);
                            }
                        }}
                    />
                    <CommandList className="h-[250px] overflow-y-auto" onScroll={handleScroll}>
                        <CommandEmpty>
                            {isLoading ? (
                                <div className="flex items-center justify-center py-4">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                </div>
                            ) : (
                                <div className="text-sm text-muted-foreground">
                                    <Trans>No results found</Trans>
                                </div>
                            )}
                        </CommandEmpty>

                        {expandedFacetId ? (
                            <>
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => {
                                            setExpandedFacetId(null);
                                            setBrowseMode(true);
                                        }}
                                        className="cursor-pointer"
                                    >
                                        ← <Trans>Back</Trans>
                                    </CommandItem>
                                </CommandGroup>
                                <CommandGroup heading={expandedFacetName}>
                                    {expandedFacetValues.map(fv => {
                                        const isSelected = selectedIds.has(fv.id);
                                        return (
                                            <CommandItem
                                                key={fv.id}
                                                value={fv.id}
                                                onSelect={() => toggleValue(fv)}
                                            >
                                                <FacetValueCheckbox isSelected={isSelected} />
                                                {fv.name}
                                            </CommandItem>
                                        );
                                    })}
                                </CommandGroup>
                                {(isFetchingNextPage || isLoadingExpandedFacet) && (
                                    <div className="flex items-center justify-center py-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                {facets.length > 0 && (
                                    <>
                                        <CommandGroup heading={<Trans>Facets</Trans>}>
                                            {facets.map(facet => (
                                                <CommandItem
                                                    key={facet.id}
                                                    value={`facet-${facet.id}`}
                                                    onSelect={() => setExpandedFacetId(facet.id)}
                                                    className="cursor-pointer"
                                                >
                                                    <span className="flex-1">{facet.name}</span>
                                                    <ChevronRight className="h-4 w-4" />
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                        {browseMode && isFetchingNextFacetsPage && (
                                            <div className="flex items-center justify-center py-2">
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            </div>
                                        )}
                                    </>
                                )}

                                {Object.entries(facetGroups).map(([facetId, values]) => (
                                    <CommandGroup key={facetId} heading={values[0]?.facet.name}>
                                        {values.map(fv => {
                                            const isSelected = selectedIds.has(fv.id);
                                            return (
                                                <CommandItem
                                                    key={fv.id}
                                                    value={fv.id}
                                                    onSelect={() => toggleValue(fv)}
                                                >
                                                    <FacetValueCheckbox isSelected={isSelected} />
                                                    {fv.name}
                                                </CommandItem>
                                            );
                                        })}
                                    </CommandGroup>
                                ))}
                            </>
                        )}
                    </CommandList>
                    {selectedIds.size > 0 && (
                        <>
                            <CommandSeparator />
                            <CommandGroup>
                                <CommandItem
                                    onSelect={() => column?.setFilterValue(undefined)}
                                    className="justify-center text-center"
                                >
                                    <Trans>Clear filters</Trans>
                                </CommandItem>
                            </CommandGroup>
                        </>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function FacetValueCheckbox({ isSelected }: { isSelected: boolean }) {
    return (
        <Checkbox
            checked={isSelected}
            className="mr-2 pointer-events-none"
            tabIndex={-1}
        />
    );
}
