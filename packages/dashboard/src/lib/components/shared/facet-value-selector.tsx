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
import { useFacetValueBrowser } from '@/vdb/hooks/use-facet-value-browser.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ChevronRight, Loader2, Plus } from 'lucide-react';
import { useState } from 'react';

// Re-export types for backward compatibility — these are part of the public API
export type { FacetValue, Facet } from '@/vdb/hooks/use-facet-value-browser.js';

/**
 * @description
 * A component for selecting facet values.
 *
 * @docsCategory components
 * @docsPage FacetValueSelector
 * @since 3.4.0
 */
interface FacetValueSelectorProps {
    /**
     * @description
     * The function to call when a facet value is selected.
     *
     * The `value` will have the following structure:
     *
     * ```ts
     * {
     *     id: string;
     *     name: string;
     *     code: string;
     *     facet: {
     *         id: string;
     *         name: string;
     *         code: string;
     *     };
     * }
     * ```
     */
    onValueSelect: (value: { id: string; name: string; code: string; facet: { id: string; name: string; code: string } }) => void;
    /**
     * @description
     * Whether the selector is disabled.
     */
    disabled?: boolean;
    /**
     * @description
     * The placeholder text for the selector.
     */
    placeholder?: string;
    /**
     * @description
     * The number of facet values to display per page.
     *
     * @default 10
     */
    pageSize?: number;
}

/**
 * @description
 * A component for selecting facet values.
 *
 * @example
 * ```tsx
 * <FacetValueSelector onValueSelect={onValueSelectHandler} disabled={disabled} />
 * ```
 *
 * @docsCategory components
 * @docsPage FacetValueSelector
 * @docsWeight 0
 * @since 3.4.0
 */
export function FacetValueSelector({
    onValueSelect,
    disabled,
    placeholder,
    pageSize = 10,
}: FacetValueSelectorProps) {
    const [open, setOpen] = useState(false);
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
        hasNextPage,
        hasNextFacetsPage,
        handleScroll,
        reset,
    } = useFacetValueBrowser({ pageSize, initialBrowseMode: false });

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger render={<Button variant="outline" size="sm" type="button" disabled={disabled} className="gap-2" />}>
                    <Plus className="h-4 w-4" />
                    <Trans>Add facet values</Trans>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[400px]" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder={placeholder ?? t`Search facet values...`}
                        value={searchTerm}
                        onValueChange={value => {
                            setSearchTerm(value);
                            setExpandedFacetId(null);
                            setBrowseMode(false);
                        }}
                        onKeyDown={e => {
                            if (
                                e.key === 'ArrowDown' &&
                                !browseMode &&
                                debouncedSearch.length < minSearchLength
                            ) {
                                e.preventDefault();
                                setBrowseMode(true);
                            }
                        }}
                        disabled={disabled}
                    />
                    <CommandList className="h-[200px] overflow-y-auto" onScroll={handleScroll}>
                        <CommandEmpty>
                            {debouncedSearch.length < 2 && !browseMode ? (
                                <div className="flex flex-col items-center gap-2 py-4">
                                    <div className="text-sm text-muted-foreground">
                                        <Trans>Type at least 2 characters to search...</Trans>
                                    </div>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setBrowseMode(true)}
                                        type="button"
                                    >
                                        <Trans>Browse facets</Trans>
                                    </Button>
                                </div>
                            ) : isLoading ? (
                                <Trans>Loading...</Trans>
                            ) : (
                                <div className="flex flex-col items-center gap-2 py-4">
                                    <div className="text-sm text-muted-foreground">
                                        <Trans>No results found</Trans>
                                    </div>
                                    {!browseMode && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => setBrowseMode(true)}
                                            type="button"
                                        >
                                            <Trans>Browse facets</Trans>
                                        </Button>
                                    )}
                                </div>
                            )}
                        </CommandEmpty>

                        {expandedFacetId ? (
                            <>
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => {
                                            setExpandedFacetId(null);
                                            setBrowseMode(false);
                                        }}
                                        className="cursor-pointer"
                                    >
                                        ← <Trans>Back to search</Trans>
                                    </CommandItem>
                                </CommandGroup>
                                <CommandGroup heading={expandedFacetName}>
                                    {expandedFacetValues.map(facetValue => (
                                        <CommandItem
                                            key={facetValue.id}
                                            value={facetValue.id}
                                            onSelect={() => {
                                                onValueSelect(facetValue);
                                                reset();
                                                setOpen(false);
                                            }}
                                        >
                                            {facetValue.name}
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                {(isFetchingNextPage || isLoadingExpandedFacet) && (
                                    <div className="flex items-center justify-center py-2">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    </div>
                                )}
                                {!hasNextPage && expandedFacetValues.length > 0 && (
                                    <div className="text-center py-2 text-sm text-muted-foreground">
                                        <Trans>No more items</Trans>
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
                                        {browseMode && !hasNextFacetsPage && facets.length > 0 && (
                                            <div className="text-center py-2 text-sm text-muted-foreground">
                                                <Trans>No more facets</Trans>
                                            </div>
                                        )}
                                    </>
                                )}

                                {Object.entries(facetGroups).map(([facetId, values]) => (
                                    <CommandGroup key={facetId} heading={values[0]?.facet.name}>
                                        {values.map(facetValue => (
                                            <CommandItem
                                                key={facetValue.id}
                                                value={facetValue.id}
                                                onSelect={() => {
                                                    onValueSelect(facetValue);
                                                    reset();
                                                    setOpen(false);
                                                }}
                                            >
                                                {facetValue.name}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                ))}
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
