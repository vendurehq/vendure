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
    useComboboxAnchor,
} from '@/vdb/components/ui/combobox.js';
import { api } from '@/vdb/graphql/api.js';
import {
    type Facet,
    type FacetValue,
    getFacetValueListDocument,
    useFacetValueBrowser,
} from '@/vdb/hooks/use-facet-value-browser.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import {
    DataTableFacetedFilterProps,
    FacetedFilterChip,
    facetedFilterFinalFocus,
    useReportValueLabel,
} from './data-table-faceted-filter.js';

type Entry =
    | { kind: 'back'; id: 'back' }
    | { kind: 'facet'; id: string; facet: Facet }
    | { kind: 'value'; id: string; facetValue: FacetValue };

type EntryGroup = { value: string; label?: string; items: Entry[] };

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
    icon,
    defaultOpen,
    onOpenChange,
    anchor: externalAnchor,
    open,
    onValueLabelChange,
}: DataTableFacetedFilterProps<TData, TValue>) {
    const { t } = useLingui();
    const ownAnchor = useComboboxAnchor();
    const anchor = externalAnchor ?? ownAnchor;

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

    // The selected values as entries. A value that is not in the loaded pages still needs
    // a label, so it comes from knownValues, or shows its id until that resolves.
    const selectedEntries: Entry[] = Array.from(selectedIds).map(id => ({
        kind: 'value',
        id,
        facetValue: knownValues.get(id) ?? { id, name: id, code: id, facet: { id: '', name: '', code: '' } },
    }));

    const selectedLabels = Array.from(selectedIds).map(id => {
        const fv = knownValues.get(id);
        return fv ? `${fv.facet.name}: ${fv.name}` : id;
    });
    let valueLabel: string | undefined;
    if (selectedIds.size > 0) {
        valueLabel = selectedIds.size > 2 ? t`${selectedIds.size} selected` : selectedLabels.join(', ');
    }
    useReportValueLabel(valueLabel, onValueLabelChange);

    const groups: EntryGroup[] = [];
    if (expandedFacetId) {
        groups.push({ value: 'back', items: [{ kind: 'back', id: 'back' }] });
        groups.push({
            value: expandedFacetId,
            label: expandedFacetName,
            items: expandedFacetValues.map(fv => ({ kind: 'value', id: fv.id, facetValue: fv })),
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
                items: values.map(fv => ({ kind: 'value', id: fv.id, facetValue: fv })),
            });
        }
    }

    return (
        <Combobox
            items={groups}
            filter={null}
            multiple
            value={selectedEntries}
            onValueChange={(next: Entry[], eventDetails) => {
                const picked = next.find(entry => !selectedIds.has(entry.id));
                if (picked && picked.kind !== 'value') {
                    // Opening a facet or going back selects nothing.
                    eventDetails.cancel();
                    if (picked.kind === 'facet') {
                        setExpandedFacetId(picked.facet.id);
                    } else {
                        setExpandedFacetId(null);
                        setBrowseMode(true);
                    }
                    return;
                }
                if (picked?.kind === 'value') {
                    setKnownValues(prev => new Map(prev).set(picked.id, picked.facetValue));
                }
                const ids = next.filter(entry => entry.kind === 'value').map(entry => entry.id);
                column?.setFilterValue(ids.length > 0 ? ids : undefined);
            }}
            inputValue={searchTerm}
            onInputValueChange={value => {
                setSearchTerm(value);
                setExpandedFacetId(null);
                setBrowseMode(value.length < minSearchLength);
            }}
            itemToStringLabel={(entry: Entry) => entryLabel(entry)}
            isItemEqualToValue={(a: Entry, b: Entry) => a.id === b.id}
            onLoadMore={loadMore}
            hasMore={expandedFacetId ? hasNextPage : browseMode && hasNextFacetsPage}
            isLoading={
                isLoading || isFetchingNextPage || isFetchingNextFacetsPage || searchTerm !== debouncedSearch
            }
            loadingLabel={t`Loading facet values`}
            defaultOpen={defaultOpen}
            {...(externalAnchor ? { open: !!open } : {})}
            onOpenChange={next => onOpenChange?.(next)}
        >
            {!externalAnchor && (
                <span ref={ownAnchor} className="inline-flex">
                    <FacetedFilterChip
                        icon={icon}
                        title={title}
                        valueLabel={valueLabel}
                        onClear={() => column?.setFilterValue(undefined)}
                        triggerType="combobox"
                    />
                </span>
            )}
            {/* The popup has no trigger interaction to return focus to when it closes,
                so it returns focus to the chip. */}
            <ComboboxContent anchor={anchor} className="w-100" finalFocus={facetedFilterFinalFocus(anchor)}>
                <ComboboxInput
                    aria-label={t`Search facet values...`}
                    placeholder={t`Search facet values...`}
                    showTrigger={false}
                />
                <ComboboxEmpty>
                    <Trans>No results found</Trans>
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
                {selectedIds.size > 0 && (
                    <div className="border-t p-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={() => column?.setFilterValue(undefined)}
                        >
                            <Trans>Clear filters</Trans>
                        </Button>
                    </div>
                )}
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
                <Trans>Back</Trans>
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
