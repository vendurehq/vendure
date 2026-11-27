import { Button } from '@/vdb/components/ui/button.js';
import {
    Combobox,
    ComboboxCollection,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxGroup,
    ComboboxInput,
    ComboboxItem,
    ComboboxLabel,
    ComboboxList,
} from '@/vdb/components/ui/combobox.js';
import { type Facet, type FacetValue, useFacetValueBrowser } from '@/vdb/hooks/use-facet-value-browser.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { useId, useRef, useState } from 'react';

// Re-export types for backward compatibility — these are part of the public API
export type { Facet, FacetValue } from '@/vdb/hooks/use-facet-value-browser.js';

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
    onValueSelect: (value: {
        id: string;
        name: string;
        code: string;
        facet: { id: string; name: string; code: string };
    }) => void;
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

type Entry =
    | { kind: 'back'; id: 'back' }
    | { kind: 'facet'; id: string; facet: Facet }
    | { kind: 'value'; id: string; facetValue: FacetValue };

type EntryGroup = { value: string; label?: string; items: Entry[] };

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
    const anchor = useRef<HTMLButtonElement>(null);
    const labelId = useId();

    const {
        searchTerm,
        setSearchTerm,
        debouncedSearch,
        minSearchLength,
        browseMode,
        setBrowseMode,
        expandedFacetId,
        setExpandedFacetId,
        facets,
        expandedFacetValues,
        expandedFacetName,
        facetGroups,
        isLoading,
        isFetchingNextPage,
        isFetchingNextFacetsPage,
        hasNextPage,
        hasNextFacetsPage,
        loadMore,
        reset,
    } = useFacetValueBrowser({ pageSize, initialBrowseMode: false });

    const groups: EntryGroup[] = [];
    if (expandedFacetId) {
        groups.push({ value: 'back', items: [{ kind: 'back', id: 'back' }] });
        groups.push({
            value: expandedFacetId,
            label: expandedFacetName,
            items: expandedFacetValues.map(facetValue => ({ kind: 'value', id: facetValue.id, facetValue })),
        });
    } else {
        if (facets.length > 0) {
            groups.push({
                value: 'facets',
                label: t`Facets`,
                items: facets.map(facet => ({ kind: 'facet', id: `facet-${facet.id}`, facet })),
            });
        }
        for (const [facetId, values] of Object.entries(facetGroups)) {
            groups.push({
                value: facetId,
                label: values[0]?.facet.name,
                items: values.map(facetValue => ({ kind: 'value', id: facetValue.id, facetValue })),
            });
        }
    }

    const searching = debouncedSearch.length >= minSearchLength;
    const browseButton = (
        <Button variant="outline" size="sm" onClick={() => setBrowseMode(true)} type="button">
            <Trans>Browse facets</Trans>
        </Button>
    );

    return (
        <Combobox
            items={groups}
            filter={null}
            value={null}
            onValueChange={(entry: Entry | null, eventDetails) => {
                if (!entry) return;
                if (entry.kind === 'value') {
                    onValueSelect(entry.facetValue);
                    reset();
                    setOpen(false);
                    return;
                }
                // Opening a facet or going back keeps the popup open and selects nothing.
                eventDetails.cancel();
                if (entry.kind === 'facet') {
                    setExpandedFacetId(entry.facet.id);
                } else {
                    setExpandedFacetId(null);
                    setBrowseMode(false);
                }
            }}
            open={open}
            onOpenChange={next => {
                setOpen(next);
                if (!next) reset();
            }}
            inputValue={searchTerm}
            onInputValueChange={value => {
                setSearchTerm(value);
                setExpandedFacetId(null);
                setBrowseMode(false);
            }}
            itemToStringLabel={(entry: Entry) => entryLabel(entry)}
            isItemEqualToValue={(a: Entry, b: Entry) => a.id === b.id}
            onLoadMore={loadMore}
            hasMore={expandedFacetId ? hasNextPage : browseMode && hasNextFacetsPage}
            isLoading={
                isLoading ||
                isFetchingNextPage ||
                isFetchingNextFacetsPage ||
                (searchTerm.length >= minSearchLength && searchTerm !== debouncedSearch)
            }
            loadingLabel={t`Loading facet values`}
            disabled={disabled}
        >
            <ComboboxPrimitive.Trigger
                ref={anchor}
                aria-labelledby={labelId}
                render={<Button variant="outline" size="sm" type="button" />}
            >
                <Plus />
                <span id={labelId}>
                    <Trans>Add facet values</Trans>
                </span>
            </ComboboxPrimitive.Trigger>
            <ComboboxContent anchor={anchor} className="w-100">
                <ComboboxInput
                    aria-label={placeholder ?? t`Search facet values...`}
                    placeholder={placeholder ?? t`Search facet values...`}
                    showTrigger={false}
                    onKeyDown={e => {
                        if (e.key === 'ArrowDown' && !browseMode && !searching) {
                            e.preventDefault();
                            setBrowseMode(true);
                        }
                    }}
                />
                <ComboboxEmpty>
                    {!searching && !browseMode ? (
                        <div className="flex flex-col items-center gap-2 py-2">
                            <Trans>Type at least 2 characters to search...</Trans>
                            {browseButton}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center gap-2 py-2">
                            <Trans>No results found</Trans>
                            {!browseMode && browseButton}
                        </div>
                    )}
                </ComboboxEmpty>
                <ComboboxList>
                    {(group: EntryGroup) => (
                        <ComboboxGroup key={group.value} items={group.items}>
                            {group.label && <ComboboxLabel>{group.label}</ComboboxLabel>}
                            <ComboboxCollection>
                                {(entry: Entry) => <FacetEntryItem key={entry.id} entry={entry} />}
                            </ComboboxCollection>
                        </ComboboxGroup>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}

function entryLabel(entry: Entry) {
    if (entry.kind === 'facet') return entry.facet.name;
    if (entry.kind === 'value') return entry.facetValue.name;
    return '';
}

function FacetEntryItem({ entry }: Readonly<{ entry: Entry }>) {
    if (entry.kind === 'back') {
        return (
            <ComboboxItem value={entry}>
                <ArrowLeft />
                <Trans>Back to search</Trans>
            </ComboboxItem>
        );
    }
    if (entry.kind === 'facet') {
        return (
            <ComboboxItem value={entry}>
                <span className="flex-1">{entry.facet.name}</span>
                <ChevronRight />
            </ComboboxItem>
        );
    }
    return <ComboboxItem value={entry}>{entry.facetValue.name}</ComboboxItem>;
}
