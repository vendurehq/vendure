import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { DashboardFormComponent } from '@/vdb/framework/form-engine/form-engine-types.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// GraphQL queries
const searchProductsDocument = graphql(`
    query SearchProducts($input: SearchInput!) {
        search(input: $input) {
            totalItems
            items {
                enabled
                productId
                productName
                slug
                productAsset {
                    id
                    preview
                }
                productVariantId
                productVariantName
                productVariantAsset {
                    id
                    preview
                }
                sku
            }
            facetValues {
                count
                facetValue {
                    id
                    name
                    facet {
                        id
                        name
                    }
                }
            }
        }
    }
`);

type SearchItem = {
    enabled: boolean;
    productId: string;
    productName: string;
    slug: string;
    productAsset?: { id: string; preview: string } | null;
    productVariantId: string;
    productVariantName: string;
    productVariantAsset?: { id: string; preview: string } | null;
    sku: string;
};

// Fetch the currently-selected items by ID so the dialog can show all of them,
// even those not present in the (capped) search results. See #4832.
const productsByIdsDocument = graphql(`
    query ProductsByIds($ids: [String!]!, $take: Int!) {
        products(options: { take: $take, filter: { id: { in: $ids } } }) {
            items {
                id
                name
                slug
                featuredAsset {
                    id
                    preview
                }
            }
        }
    }
`);

const variantsByIdsDocument = graphql(`
    query ProductVariantsByIds($ids: [String!]!, $take: Int!) {
        productVariants(options: { take: $take, filter: { id: { in: $ids } } }) {
            items {
                id
                name
                sku
                featuredAsset {
                    id
                    preview
                }
            }
        }
    }
`);

// The admin list-query limit (adminListQueryLimit) is 1000; passing more throws.
const MAX_SELECTION_FETCH = 1000;

/** Maps `products` results to the SearchItem shape used by the selector UI. */
export function mapProductsToSearchItems(
    items: Array<{ id: string; name: string; slug: string; featuredAsset?: { id: string; preview: string } | null }>,
): SearchItem[] {
    return items.map(item => ({
        enabled: true,
        productId: item.id,
        productName: item.name,
        slug: item.slug,
        productAsset: item.featuredAsset ?? null,
        productVariantId: '',
        productVariantName: '',
        productVariantAsset: null,
        sku: '',
    }));
}

/** Maps `productVariants` results to the SearchItem shape used by the selector UI. */
export function mapVariantsToSearchItems(
    items: Array<{ id: string; name: string; sku: string; featuredAsset?: { id: string; preview: string } | null }>,
): SearchItem[] {
    return items.map(item => ({
        enabled: true,
        productId: '',
        productName: '',
        slug: '',
        productAsset: null,
        productVariantId: item.id,
        productVariantName: item.name,
        productVariantAsset: item.featuredAsset ?? null,
        sku: item.sku,
    }));
}

interface ProductMultiSelectorProps {
    mode: 'product' | 'variant';
    initialSelectionIds?: string[];
    onSelectionChange: (selectedIds: string[]) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function LoadingState() {
    return (
        <div className="text-center text-muted-foreground">
            <Trans>Loading...</Trans>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="text-center text-muted-foreground">
            <Trans>No items found</Trans>
        </div>
    );
}

function ProductList({
    items,
    mode,
    selectedIds,
    getItemId,
    getItemName,
    toggleSelection,
}: Readonly<{
    items: SearchItem[];
    mode: 'product' | 'variant';
    selectedIds: Set<string>;
    getItemId: (item: SearchItem) => string;
    getItemName: (item: SearchItem) => string;
    toggleSelection: (item: SearchItem) => void;
}>) {
    return (
        <>
            {items.map(item => {
                const itemId = getItemId(item);
                const isSelected = selectedIds.has(itemId);
                const asset =
                    mode === 'product' ? item.productAsset : item.productVariantAsset || item.productAsset;

                return (
                    <div
                        key={itemId}
                        role="checkbox"
                        tabIndex={0}
                        aria-checked={isSelected}
                        className={`border rounded-lg p-3 cursor-pointer transition-colors ${
                            isSelected
                                ? 'border-primary bg-primary/5'
                                : 'border-border hover:border-primary/50'
                        }`}
                        onClick={() => toggleSelection(item)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                toggleSelection(item);
                            }
                        }}
                    >
                        <div className="flex items-start gap-3">
                            <div className="flex-shrink-0">
                                <VendureImage
                                    asset={asset}
                                    preset="tiny"
                                    className="w-16 h-16 rounded object-contain bg-secondary/10"
                                    fallback={<div className="w-16 h-16 rounded bg-secondary/10" />}
                                />
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{getItemName(item)}</div>
                                {mode === 'product' ? (
                                    <div className="text-xs text-muted-foreground">{item.slug}</div>
                                ) : (
                                    <div className="text-xs text-muted-foreground">{item.sku}</div>
                                )}
                            </div>
                            <div className="flex-shrink-0">
                                <Checkbox checked={isSelected} />
                            </div>
                        </div>
                    </div>
                );
            })}
        </>
    );
}

const EMPTY_IDS: string[] = [];

export function ProductMultiSelectorDialog({
    mode,
    initialSelectionIds = EMPTY_IDS,
    onSelectionChange,
    open,
    onOpenChange,
}: Readonly<ProductMultiSelectorProps>) {
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedItems, setSelectedItems] = useState<SearchItem[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    // Add debounced search term
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    // Search input configuration
    const searchInput = useMemo(
        () => ({
            term: debouncedSearchTerm,
            groupByProduct: mode === 'product',
            take: 50,
            skip: 0,
        }),
        [debouncedSearchTerm, mode],
    );

    // Query search results
    const { data: searchData, isLoading } = useQuery({
        queryKey: ['searchProducts', searchInput],
        queryFn: () => api.query(searchProductsDocument, { input: searchInput }),
        enabled: open,
    });

    const items = searchData?.search.items || [];

    // Fetch the full set of selected items by ID when the dialog opens, so the
    // selection panel shows all of them — not just those that happen to appear
    // in the (capped) search results. See #4832.
    const { data: selectedItemsData, isFetching: isFetchingSelected } = useQuery({
        queryKey: ['productMultiSelectorSelected', mode, initialSelectionIds],
        queryFn: async () => {
            const take = Math.min(initialSelectionIds.length, MAX_SELECTION_FETCH);
            if (mode === 'product') {
                const result = await api.query(productsByIdsDocument, { ids: initialSelectionIds, take });
                return mapProductsToSearchItems(result.products.items);
            }
            const result = await api.query(variantsByIdsDocument, { ids: initialSelectionIds, take });
            return mapVariantsToSearchItems(result.productVariants.items);
        },
        enabled: open && initialSelectionIds.length > 0,
        // The query key carries the selection identity; never show a previous
        // selection's data as placeholder (the global default is keepPreviousData).
        placeholderData: undefined,
    });

    // Get the appropriate ID for an item based on mode
    const getItemId = useCallback(
        (item: SearchItem): string => {
            return mode === 'product' ? item.productId : item.productVariantId;
        },
        [mode],
    );

    // Get the appropriate name for an item based on mode
    const getItemName = useCallback(
        (item: SearchItem): string => {
            return mode === 'product' ? item.productName : item.productVariantName;
        },
        [mode],
    );

    // Toggle item selection
    const toggleSelection = useCallback(
        (item: SearchItem) => {
            const itemId = getItemId(item);
            const newSelectedIds = new Set(selectedIds);
            const newSelectedItems = [...selectedItems];

            if (selectedIds.has(itemId)) {
                newSelectedIds.delete(itemId);
                const index = newSelectedItems.findIndex(selected => getItemId(selected) === itemId);
                if (index >= 0) {
                    newSelectedItems.splice(index, 1);
                }
            } else {
                newSelectedIds.add(itemId);
                newSelectedItems.push(item);
            }

            setSelectedIds(newSelectedIds);
            setSelectedItems(newSelectedItems);
        },
        [selectedIds, selectedItems, getItemId],
    );

    // Clear all selections
    const clearSelection = useCallback(() => {
        setSelectedIds(new Set());
        setSelectedItems([]);
    }, []);

    // Handle selection confirmation
    const handleSelect = useCallback(() => {
        onSelectionChange(Array.from(selectedIds));
        onOpenChange(false);
    }, [selectedIds, onSelectionChange, onOpenChange]);

    // Tracks whether we've already hydrated the selection from the by-ID fetch
    // for the current open, so a late response can't clobber the user's edits.
    const hydratedRef = useRef(false);

    // Seed selection state from the saved IDs each time the dialog opens, and
    // clear any stale item objects / search term left from a previous session.
    useEffect(() => {
        if (open) {
            setSelectedIds(new Set(initialSelectionIds));
            setSelectedItems([]);
            setSearchTerm('');
            hydratedRef.current = false;
        }
    }, [open, initialSelectionIds]);

    // Hydrate the panel + selection from the by-ID fetch exactly once per open.
    // selectedIds is reconciled down to the resolved items so the count always
    // matches the panel: saved IDs that no longer resolve (deleted, or in another
    // channel) are dropped rather than counted but left unshown and unremovable.
    useEffect(() => {
        if (open && !hydratedRef.current && selectedItemsData) {
            hydratedRef.current = true;
            setSelectedItems(selectedItemsData);
            setSelectedIds(new Set(selectedItemsData.map(getItemId)));
        }
    }, [open, selectedItemsData, getItemId]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[95vw] md:max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>
                        <Trans>{mode === 'product' ? 'Select Products' : 'Select Variants'}</Trans>
                    </DialogTitle>
                    <DialogDescription className="sr-only">
                        <Trans>{mode === 'product' ? 'Search and select products from the catalog' : 'Search and select product variants from the catalog'}</Trans>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 min-h-0 flex flex-col">
                    {/* Search Input */}
                    <div className="flex-shrink-0 mb-4">
                        <Input
                            id="search"
                            placeholder="Search products..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Items Grid */}
                        <div className="lg:col-span-2 overflow-auto flex flex-col">
                            <div className="space-y-2 p-2">
                                {isLoading && <LoadingState />}
                                {!isLoading && items.length === 0 && <EmptyState />}
                                {!isLoading && items.length > 0 && (
                                    <ProductList
                                        items={items}
                                        mode={mode}
                                        selectedIds={selectedIds}
                                        getItemId={getItemId}
                                        getItemName={getItemName}
                                        toggleSelection={toggleSelection}
                                    />
                                )}
                            </div>
                        </div>

                        {/* Selected Items Panel */}
                        <div className="border rounded-lg p-4 overflow-auto flex flex-col">
                            <div className="flex items-center justify-between mb-4 flex-shrink-0">
                                <div className="text-sm font-medium">
                                    <Trans>Selected Items</Trans>
                                    <Badge variant="secondary" className="ml-2">
                                        {selectedIds.size}
                                    </Badge>
                                </div>
                                {selectedIds.size > 0 && (
                                    <Button variant="outline" size="sm" onClick={clearSelection}>
                                        <Trans>Clear</Trans>
                                    </Button>
                                )}
                            </div>

                            <div className="space-y-2">
                                {selectedIds.size === 0 ? (
                                    <div className="text-center text-muted-foreground text-sm">
                                        <Trans>No items selected</Trans>
                                    </div>
                                ) : selectedItems.length === 0 && isFetchingSelected ? (
                                    <div className="text-center text-muted-foreground text-sm">
                                        <Trans>Loading selected items...</Trans>
                                    </div>
                                ) : (
                                    selectedItems.map(item => (
                                        <div
                                            key={getItemId(item)}
                                            className="flex items-center justify-between p-2 border rounded"
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-medium truncate">
                                                    {getItemName(item)}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {mode === 'product' ? item.slug : item.sku}
                                                </div>
                                            </div>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                onClick={() => toggleSelection(item)}
                                            >
                                                <X className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                <DialogFooter className="mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        <Trans>Cancel</Trans>
                    </Button>
                    <Button onClick={handleSelect}>
                        <Trans>Select {selectedIds.size} Items</Trans>
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export const ProductMultiInput: DashboardFormComponent = ({ value, onChange, disabled, ...props }) => {
    const [open, setOpen] = useState(false);
    const mode = props.fieldDef?.ui?.selectionMode === 'variant' ? 'variant' : 'product';
    const selectedIds = value || [];

    const handleSelectionChange = useCallback(
        (newSelectedIds: string[]) => {
            onChange(newSelectedIds);
        },
        [onChange],
    );
    const itemType = mode === 'product' ? 'products' : 'variants';
    const buttonText = selectedIds.length > 0 ? `Change selected ${itemType}` : `Select ${itemType}`;
    return (
        <>
            <div className="space-y-2">
                <Button variant="outline" disabled={disabled} onClick={() => setOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    <Trans>{buttonText}</Trans>
                </Button>

                {selectedIds.length > 0 && (
                    <div className="text-sm text-muted-foreground">
                        <Trans>{selectedIds.length} items selected</Trans>
                    </div>
                )}
            </div>

            <ProductMultiSelectorDialog
                mode={mode}
                initialSelectionIds={selectedIds}
                onSelectionChange={handleSelectionChange}
                open={open}
                onOpenChange={setOpen}
            />
        </>
    );
};

ProductMultiInput.metadata = {
    isListInput: true,
};
