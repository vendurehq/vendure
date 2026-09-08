import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import {
    PaginatedListDataTable,
    PaginatedListDataTableKey,
} from '@/vdb/components/shared/paginated-list-data-table.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import { EmptyMediaIllustration, ErrorIllustration, NoResultsIllustration } from '@/vdb/components/ui/illustrations.js';
import { Input } from '@/vdb/components/ui/input.js';
import {
    Pagination,
    PaginationContent,
    PaginationEllipsis,
    PaginationItem,
    PaginationLink,
    PaginationNext,
    PaginationPrevious,
} from '@/vdb/components/ui/pagination.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { EmptyState, ErrorState, LoadingState } from '@/vdb/components/ui/state-views.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { ToggleGroup, ToggleGroupItem } from '@/vdb/components/ui/toggle-group.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { PageActionBar } from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { assetFragment, AssetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { formatFileSize } from '@/vdb/lib/utils.js';
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ColumnFiltersState, SortingState } from '@tanstack/react-table';
import { Link } from '@tanstack/react-router';
import { useDebounce } from '@uidotdev/usehooks';
import { ChevronRight, LayoutGrid, LayoutList, Search, Upload, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { DragEvent, memo, useCallback, useMemo, useRef, useState } from 'react';
import { AssetUploadModal } from './asset-upload-modal.js';
import { useDropzone } from 'react-dropzone';
import {
    AssetGridTagFilter,
    AssetTagFacetedFilter,
} from '../../../../app/routes/_authenticated/_assets/components/asset-tag-filter.js';
import {
    adaptAssetBulkActions,
    AssetBulkActions,
    type AssetBulkActionsInput,
    type BulkActionsInput,
} from './asset-bulk-actions.js';

const getAssetListDocument = graphql(
    `
        query GetAssetList($options: AssetListOptions) {
            assets(options: $options) {
                items {
                    ...Asset
                }
                totalItems
            }
        }
    `,
    [assetFragment],
);

// Mirrors the @vendure-io/ui data-table band swap: while assets are selected
// the bulk bar takes the search bar's place. Fade out then in, 100ms per
// phase; mode="wait" keeps the rows sequential so they never stack.
const headerRowFade = {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: 0.1, ease: 'easeOut' },
} as const;

const AssetType = {
    ALL: 'ALL',
    IMAGE: 'IMAGE',
    VIDEO: 'VIDEO',
    BINARY: 'BINARY',
} as const;

function AssetTypeLabel({ type }: Readonly<{ type: string }>) {
    switch (type) {
        case AssetType.IMAGE:
            return <Trans>Images</Trans>;
        case AssetType.VIDEO:
            return <Trans>Video</Trans>;
        case AssetType.BINARY:
            return <Trans>Binary</Trans>;
        default:
            return type;
    }
}

export type Asset = AssetFragment;

export type AssetViewMode = 'grid' | 'list';

/**
 * @description
 * Props for the {@link AssetGallery} component.
 *
 * @docsCategory components
 * @docsPage AssetGallery
 */
export interface AssetGalleryProps {
    onSelect?: (assets: Asset[]) => void;
    selectable?: boolean;
    /**
     * @description
     * Defines whether multiple assets can be selected.
     *
     * If set to 'auto', the asset selection will be toggled when the user clicks on an asset.
     * If set to 'manual', multiple selection will occur only if the user holds down the control/cmd key.
     */
    multiSelect?: 'auto' | 'manual';
    /**
     * @description
     * The initial assets that should be selected.
     */
    initialSelectedAssets?: Asset[];
    /**
     * @description
     * The number of assets to display per page.
     */
    pageSize?: number;
    /**
     * @description
     * Whether the gallery should have a fixed height.
     */
    fixedHeight?: boolean;
    /**
     * @description
     * Whether the gallery should show a header.
     */
    showHeader?: boolean;
    /**
     * @description
     * The class name to apply to the gallery.
     */
    className?: string;
    /**
     * @description
     * The function to call when files are dropped.
     */
    onFilesDropped?: (files: File[]) => void;
    /**
     * @description
     * The bulk actions to display in the gallery.
     */
    bulkActions?: AssetBulkActionsInput;
    /**
     * @description
     * Whether the gallery should display the bulk-action toolbar. Asset
     * selection stays enabled when this is `false` — in list view this maps
     * to the data table's `bulkActions={false}` mode.
     */
    displayBulkActions?: boolean;
    /**
     * @description
     * The function to call when the page size changes.
     */
    onPageSizeChange?: (pageSize: number) => void;
    /**
     * @description
     * The current view mode for the gallery. Defaults to 'grid'.
     */
    viewMode?: AssetViewMode;
    /**
     * @description
     * The function to call when the view mode changes.
     * When provided, a toggle will be rendered in the header bar.
     */
    onViewModeChange?: (mode: AssetViewMode) => void;
}

/**
 * @description
 * A component for displaying a gallery of assets.
 *
 * @example
 * ```tsx
 *  <AssetGallery
 *   onSelect={handleAssetSelect}
 *   multiSelect="manual"
 *   initialSelectedAssets={initialSelectedAssets}
 *   fixedHeight={false}
 *   displayBulkActions={false}
 *   />
 * ```
 *
 * @docsCategory components
 * @docsPage AssetGallery
 * @docsWeight 0
 */
export function AssetGallery({
    onSelect,
    selectable = true,
    multiSelect = undefined,
    initialSelectedAssets = [],
    pageSize = 24,
    fixedHeight = false,
    showHeader = true,
    className = '',
    onFilesDropped,
    bulkActions,
    displayBulkActions = true,
    onPageSizeChange,
    viewMode = 'grid',
    onViewModeChange,
}: AssetGalleryProps) {
    const { t } = useLingui();

    // State
    const [page, setPage] = useState(1);
    const [itemsPerPage, setItemsPerPage] = useState(pageSize);
    const [lastPageSizeProp, setLastPageSizeProp] = useState(pageSize);
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 500);
    const [assetType, setAssetType] = useState<string>(AssetType.ALL);
    const [gridSelectedTags, setGridSelectedTags] = useState<string[]>([]);
    const [selected, setSelected] = useState<Asset[]>(initialSelectedAssets || []);
    const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
    const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
    const queryClient = useQueryClient();

    // Latest-value refs keep the selection callbacks below referentially stable,
    // so the adapted bulk actions and memoized asset cards don't churn when a
    // consumer passes inline props.
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;

    const handleSelectionChange = useCallback((nextSelected: Asset[]) => {
        setSelected(nextSelected);
        onSelectRef.current?.(nextSelected);
    }, []);
    const clearSelection = useCallback(() => handleSelectionChange([]), [handleSelectionChange]);

    const refetchAssets = useCallback(() => {
        clearSelection();
        void queryClient.invalidateQueries({ queryKey: ['AssetGallery'] });
        void queryClient.invalidateQueries({ queryKey: [PaginatedListDataTableKey] });
    }, [clearSelection, queryClient]);

    // Invalidated by prefix (not the fully-parameterised queryKey above) so this
    // stays correct even if page/search/sort changed while the upload was running.
    // Skipped entirely when nothing succeeded, since there's nothing new to show.
    const handleUploadComplete = useCallback(
        (summary: { succeededCount: number; failedCount: number }) => {
            if (summary.succeededCount > 0) {
                void queryClient.invalidateQueries({ queryKey: ['AssetGallery'] });
                void queryClient.invalidateQueries({ queryKey: [PaginatedListDataTableKey] });
            }
        },
        [queryClient],
    );
    const adaptedBulkActions = useMemo(
        () => adaptAssetBulkActions(bulkActions, refetchAssets),
        [bulkActions, refetchAssets],
    );

    if (lastPageSizeProp !== pageSize) {
        setLastPageSizeProp(pageSize);
        setItemsPerPage(pageSize);
        setPage(1);
    }

    const queryKey = ['AssetGallery', page, itemsPerPage, debouncedSearch, assetType, gridSelectedTags, sorting];

    // Query for assets
    const { data, isLoading, isError, error, refetch } = useQuery({
        queryKey,
        enabled: viewMode === 'grid',
        queryFn: () => {
            const filter: Record<string, any> = {};

            if (debouncedSearch) {
                filter.name = { contains: debouncedSearch };
            }

            if (assetType !== AssetType.ALL) {
                filter.type = { eq: assetType };
            }

            const options: any = {
                skip: (page - 1) * itemsPerPage,
                take: itemsPerPage,
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                sort: sorting[0]
                    ? { [sorting[0].id]: sorting[0].desc ? 'DESC' : 'ASC' }
                    : undefined,
            };

            if (gridSelectedTags.length > 0) {
                options.tags = gridSelectedTags;
                options.tagsOperator = 'AND';
            }

            return api.query(getAssetListDocument, { options });
        },
    });

    const assets = (data?.assets.items ?? []) as Asset[];

    const [pendingFiles, setPendingFiles] = useState<File[]>([]);
    const [uploadModalOpen, setUploadModalOpen] = useState(false);

    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            if (acceptedFiles.length === 0) {
                return;
            }
            if (onFilesDropped) {
                onFilesDropped(acceptedFiles);
                return;
            }
            setPendingFiles(acceptedFiles);
            setUploadModalOpen(true);
        },
        [onFilesDropped],
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true });
    const listDragDepth = useRef(0);
    const [isListDragActive, setIsListDragActive] = useState(false);

    const isFileDrag = (event: DragEvent<HTMLDivElement>) => event.dataTransfer.types.includes('Files');

    const handleListDragEnter = (event: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        listDragDepth.current += 1;
        setIsListDragActive(true);
    };

    const handleListDragOver = (event: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };

    const handleListDragLeave = (event: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        listDragDepth.current = Math.max(0, listDragDepth.current - 1);
        if (listDragDepth.current === 0) {
            setIsListDragActive(false);
        }
    };

    const handleListDrop = (event: DragEvent<HTMLDivElement>) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        listDragDepth.current = 0;
        setIsListDragActive(false);
        onDrop(Array.from(event.dataTransfer.files));
    };

    // Calculate total pages
    const totalItems = data?.assets.totalItems || 0;
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    // Toggle a single asset in the selection
    const toggleAssetSelection = useCallback(
        (asset: Asset) => {
            const current = selectedRef.current;
            const isCurrentlySelected = current.some(a => a.id === asset.id);
            const newSelected = isCurrentlySelected
                ? current.filter(a => a.id !== asset.id)
                : [...current, asset];
            handleSelectionChange(newSelected);
        },
        [handleSelectionChange],
    );

    // Handle selection
    const handleSelect = useCallback(
        (asset: Asset, event: React.MouseEvent | React.KeyboardEvent) => {
            if (multiSelect === 'auto') {
                toggleAssetSelection(asset);
                return;
            }

            // Manual mode - check for modifier key
            const isModifierKeyPressed = event.metaKey || event.ctrlKey;

            if (multiSelect === 'manual' && isModifierKeyPressed) {
                toggleAssetSelection(asset);
            } else {
                // No modifier key - single select
                handleSelectionChange([asset]);
            }
        },
        [multiSelect, toggleAssetSelection, handleSelectionChange],
    );

    const selectedIds = useMemo(() => new Set(selected.map(a => a.id)), [selected]);

    // Clear filters
    const clearFilters = () => {
        setSearch('');
        setAssetType(AssetType.ALL);
        setGridSelectedTags([]);
        setPage(1);
    };

    const hasActiveFilters = search.trim().length > 0 || assetType !== AssetType.ALL || gridSelectedTags.length > 0;
    const isAssetDropActive = viewMode === 'grid' ? isDragActive : isListDragActive;

    // Go to specific page
    const goToPage = (newPage: number) => {
        if (newPage < 1 || newPage > totalPages) return;
        setPage(newPage);
    };

    // Create a function to open the file dialog
    const openFileDialog = () => {
        // This will trigger the file input's click event
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.addEventListener('change', event => {
            const target = event.target as HTMLInputElement;
            if (target.files) {
                onDrop(Array.from(target.files));
            }
        });
        fileInput.click();
    };

    return (
        <>
            <div className={`relative flex flex-col w-full ${fixedHeight ? 'h-[600px]' : 'h-full'} ${className}`}>
            {showHeader && (
                <div className="space-y-4 mb-4 flex-shrink-0">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                        {viewMode === 'grid' && (
                            <div className="min-w-0 flex-1">
                                {/* Replace-on-select: while assets are selected the bulk
                                    bar takes the search bar's place, matching the data
                                    table's list-view treatment. */}
                                <AnimatePresence initial={false} mode="wait">
                                    {displayBulkActions && selected.length > 0 ? (
                                        <motion.div key="bulk-actions" {...headerRowFade}>
                                            <AssetBulkActions
                                                selection={selected}
                                                bulkActions={adaptedBulkActions}
                                                clearSelection={clearSelection}
                                                frame="plain"
                                            />
                                        </motion.div>
                                    ) : (
                                        <motion.div key="search" {...headerRowFade} className="relative">
                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                            <Input
                                                placeholder={t`Search assets...`}
                                                value={search}
                                                onChange={e => {
                                                    setSearch(e.target.value);
                                                    setPage(1);
                                                }}
                                                className="pl-8 pr-9"
                                            />
                                            {hasActiveFilters && (
                                                <Tooltip>
                                                    <TooltipTrigger
                                                        render={
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="icon-sm"
                                                                onClick={clearFilters}
                                                                className="absolute right-1 top-1"
                                                                aria-label={t`Clear filters`}
                                                            />
                                                        }
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <Trans>Clear filters</Trans>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
                            {viewMode === 'grid' && (
                                <Select
                                    items={{
                                        [AssetType.ALL]: t`All types`,
                                        [AssetType.IMAGE]: t`Images`,
                                        [AssetType.VIDEO]: t`Video`,
                                        [AssetType.BINARY]: t`Binary`,
                                    }}
                                    value={assetType}
                                    onValueChange={value => {
                                        if (value != null) {
                                            setAssetType(value);
                                            setPage(1);
                                        }
                                    }}
                                >
                                    <SelectTrigger className="w-[150px]">
                                        <SelectValue placeholder={t`Asset type`} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value={AssetType.ALL}><Trans>All types</Trans></SelectItem>
                                        <SelectItem value={AssetType.IMAGE}><Trans>Images</Trans></SelectItem>
                                        <SelectItem value={AssetType.VIDEO}><Trans>Video</Trans></SelectItem>
                                        <SelectItem value={AssetType.BINARY}><Trans>Binary</Trans></SelectItem>
                                    </SelectContent>
                                </Select>
                            )}
                            {viewMode === 'grid' && (
                                <AssetGridTagFilter
                                    selectedTags={gridSelectedTags}
                                    onTagsChange={tags => {
                                        setGridSelectedTags(tags);
                                        setPage(1);
                                    }}
                                />
                            )}
                            {onViewModeChange && (
                                <ToggleGroup
                                    value={[viewMode]}
                                    onValueChange={values => {
                                        if (values.length > 0) {
                                            onViewModeChange(values[0] as AssetViewMode);
                                        }
                                    }}
                                    variant="outline"
                                >
                                    <ToggleGroupItem value="grid" aria-label={t`Grid view`}>
                                        <LayoutGrid className="h-4 w-4" />
                                    </ToggleGroupItem>
                                    <ToggleGroupItem value="list" aria-label={t`List view`}>
                                        <LayoutList className="h-4 w-4" />
                                    </ToggleGroupItem>
                                </ToggleGroup>
                            )}
                            <PageActionBar>
                                <ActionBarItem itemId="upload-assets-button">
                                    <Button type="button" onClick={openFileDialog} className="whitespace-nowrap">
                                        <Upload className="h-4 w-4 mr-2" />
                                        <Trans>Upload</Trans>
                                    </Button>
                                </ActionBarItem>
                            </PageActionBar>
                        </div>
                    </div>
                </div>
            )}

            {/* Grid selection is gallery-owned; list selection is owned by DataTable.
                With the header shown, the bulk bar swaps into the search bar's slot
                above; this standalone bar covers headerless galleries. */}
            {viewMode === 'grid' && displayBulkActions && !showHeader ? (
                <AssetBulkActions
                    selection={selected}
                    bulkActions={adaptedBulkActions}
                    clearSelection={clearSelection}
                />
            ) : null}

            <div
                {...(viewMode === 'grid'
                    ? getRootProps()
                    : {
                          onDragEnter: handleListDragEnter,
                          onDragOver: handleListDragOver,
                          onDragLeave: handleListDragLeave,
                          onDrop: handleListDrop,
                      })}
                className={`
                    ${fixedHeight ? 'flex-grow overflow-y-auto' : ''}
                    ${isAssetDropActive ? 'ring-2 ring-primary bg-primary/5' : ''}
                    relative rounded-md transition-all
                `}
            >
                {viewMode === 'grid' && <input {...getInputProps()} />}

                {isAssetDropActive && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-md">
                        <Upload className="h-12 w-12 text-primary mb-2" />
                        <p className="text-center font-medium"><Trans>Drop files here to upload</Trans></p>
                    </div>
                )}

                {viewMode === 'list' ? (
                    <AssetListDataTable
                        selectable={selectable}
                        displayBulkActions={displayBulkActions}
                        bulkActions={adaptedBulkActions}
                        page={page}
                        itemsPerPage={itemsPerPage}
                        sorting={sorting}
                        columnFilters={columnFilters}
                        selectedItems={selected}
                        onPageChange={(nextPage, nextPageSize) => {
                            setPage(nextPage);
                            if (nextPageSize !== itemsPerPage) {
                                setItemsPerPage(nextPageSize);
                                onPageSizeChange?.(nextPageSize);
                            }
                        }}
                        onSortChange={setSorting}
                        onFilterChange={setColumnFilters}
                        onSelectionChange={handleSelectionChange}
                    />
                ) : (
                    <AssetGridView
                        assets={assets}
                        isLoading={isLoading}
                        isError={isError}
                        error={error}
                        retry={refetch}
                        selectable={selectable}
                        hasActiveFilters={hasActiveFilters}
                        clearFilters={clearFilters}
                        openFileDialog={openFileDialog}
                        selectedIds={selectedIds}
                        onSelectAsset={handleSelect}
                        onToggleAsset={toggleAssetSelection}
                    />
                )}
            </div>

            {viewMode === 'grid' && (
                <div className="flex flex-col md:flex-row items-center md:justify-between gap-4 mt-4 flex-shrink-0">
                <div className="mt-2 text-xs text-muted-foreground flex-shrink-0">
                    <Plural
                        value={totalItems}
                        one={`${totalItems} asset found`}
                        other={`${totalItems} assets found`}
                    />
                    {selected.length > 0 && (
                        <Trans>, {selected.length} selected</Trans>
                    )}
                </div>
                <div className="flex-1"></div>
                {/* Grid pagination is gallery-owned. The data table renders its own footer controls. */}
                {onPageSizeChange && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground"><Trans>Items per page</Trans></span>
                        <Select
                            items={Object.fromEntries([12, 24, 48, 96].map(size => [`${size}`, `${size}`]))}
                            value={itemsPerPage.toString()}
                            onValueChange={value => {
                                if (value == null) return;
                                const newPageSize = Number.parseInt(value, 10);
                                setItemsPerPage(newPageSize);
                                onPageSizeChange(newPageSize);
                                setPage(1); // Reset to first page when changing page size
                            }}
                        >
                            <SelectTrigger className="h-8 w-[70px]">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent side="top">
                                {[12, 24, 48, 96].map(size => (
                                    <SelectItem key={size} value={`${size}`}>
                                        {size}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <Pagination className="w-auto">
                        <PaginationContent>
                            <PaginationItem>
                                <PaginationPrevious
                                    href="#"
                                    size="default"
                                    onClick={e => {
                                        e.preventDefault();
                                        goToPage(page - 1);
                                    }}
                                    className={page === 1 ? 'pointer-events-none opacity-50' : ''}
                                />
                            </PaginationItem>

                            {/* First page */}
                            {page > 2 && (
                                <PaginationItem>
                                    <PaginationLink
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            goToPage(1);
                                        }}
                                    >
                                        1
                                    </PaginationLink>
                                </PaginationItem>
                            )}

                            {/* Ellipsis if needed */}
                            {page > 3 && (
                                <PaginationItem>
                                    <PaginationEllipsis />
                                </PaginationItem>
                            )}

                            {/* Previous page */}
                            {page > 1 && (
                                <PaginationItem>
                                    <PaginationLink
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            goToPage(page - 1);
                                        }}
                                    >
                                        {page - 1}
                                    </PaginationLink>
                                </PaginationItem>
                            )}

                            {/* Current page */}
                            <PaginationItem>
                                <PaginationLink href="#" isActive>
                                    {page}
                                </PaginationLink>
                            </PaginationItem>

                            {/* Next page */}
                            {page < totalPages && (
                                <PaginationItem>
                                    <PaginationLink
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            goToPage(page + 1);
                                        }}
                                    >
                                        {page + 1}
                                    </PaginationLink>
                                </PaginationItem>
                            )}

                            {/* Ellipsis if needed */}
                            {page < totalPages - 2 && (
                                <PaginationItem>
                                    <PaginationEllipsis />
                                </PaginationItem>
                            )}

                            {/* Last page */}
                            {page < totalPages - 1 && (
                                <PaginationItem>
                                    <PaginationLink
                                        href="#"
                                        onClick={e => {
                                            e.preventDefault();
                                            goToPage(totalPages);
                                        }}
                                    >
                                        {totalPages}
                                    </PaginationLink>
                                </PaginationItem>
                            )}

                            <PaginationItem>
                                <PaginationNext
                                    href="#"
                                    onClick={e => {
                                        e.preventDefault();
                                        goToPage(page + 1);
                                    }}
                                    className={page === totalPages ? 'pointer-events-none opacity-50' : ''}
                                />
                            </PaginationItem>
                        </PaginationContent>
                    </Pagination>
                )}
                </div>
            )}
        </div>

        <AssetUploadModal
            files={pendingFiles}
            open={uploadModalOpen}
            onComplete={handleUploadComplete}
            onClose={() => setUploadModalOpen(false)}
        />
        </>
    );
}

interface AssetViewProps {
    assets: Asset[];
    isLoading: boolean;
    isError: boolean;
    error: Error | null;
    retry: () => void;
    selectable: boolean;
    hasActiveFilters: boolean;
    clearFilters: () => void;
    openFileDialog: () => void;
    selectedIds: Set<string>;
    onSelectAsset: (asset: Asset, event: React.MouseEvent | React.KeyboardEvent) => void;
    onToggleAsset: (asset: Asset) => void;
}

function AssetEmptyState({
    hasActiveFilters,
    clearFilters,
    openFileDialog,
}: Readonly<Pick<AssetViewProps, 'hasActiveFilters' | 'clearFilters' | 'openFileDialog'>>) {
    return (
        <EmptyState
            className="border-0 bg-transparent py-16"
            illustration={hasActiveFilters ? <NoResultsIllustration /> : <EmptyMediaIllustration />}
            title={hasActiveFilters ? <Trans>No assets match these filters</Trans> : <Trans>No assets yet</Trans>}
            description={
                hasActiveFilters ? (
                    <Trans>Try changing your search, asset type, or selected tags.</Trans>
                ) : (
                    <Trans>Upload images, videos, or files to start building your asset library.</Trans>
                )
            }
        >
            {hasActiveFilters ? (
                <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                    <X className="h-4 w-4 mr-2" />
                    <Trans>Clear filters</Trans>
                </Button>
            ) : (
                <Button type="button" size="sm" onClick={openFileDialog}>
                    <Upload className="h-4 w-4 mr-2" />
                    <Trans>Upload assets</Trans>
                </Button>
            )}
        </EmptyState>
    );
}

function AssetGridView({
    assets,
    isLoading,
    isError,
    error,
    retry,
    selectable,
    hasActiveFilters,
    clearFilters,
    openFileDialog,
    selectedIds,
    onSelectAsset,
    onToggleAsset,
}: Readonly<AssetViewProps>) {
    if (isLoading) {
        return (
            <div data-asset-gallery className="py-12">
                <LoadingState variant="spinner" />
            </div>
        );
    }

    if (isError) {
        return (
            <div data-asset-gallery>
                <ErrorState
                    className="border-0 bg-transparent py-16"
                    illustration={<ErrorIllustration />}
                    title={<Trans>We couldn't load assets</Trans>}
                    description={error?.message}
                    onRetry={retry}
                />
            </div>
        );
    }

    if (assets.length === 0) {
        return (
            <div data-asset-gallery>
                <AssetEmptyState
                    hasActiveFilters={hasActiveFilters}
                    clearFilters={clearFilters}
                    openFileDialog={openFileDialog}
                />
            </div>
        );
    }

    return (
        <div
            data-asset-gallery
            className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-3 p-1"
        >
            {assets.map(asset => (
                <AssetCard
                    key={asset.id}
                    asset={asset}
                    isSelected={selectedIds.has(asset.id)}
                    selectable={selectable}
                    onSelectAsset={onSelectAsset}
                    onToggleAsset={onToggleAsset}
                />
            ))}
        </div>
    );
}

interface AssetCardProps {
    asset: Asset;
    isSelected: boolean;
    selectable: boolean;
    onSelectAsset: AssetViewProps['onSelectAsset'];
    onToggleAsset: AssetViewProps['onToggleAsset'];
}

// Memoized so a selection change only re-renders the cards whose selected
// state changed, not every thumbnail in the grid.
const AssetCard = memo(function AssetCard({
    asset,
    isSelected,
    selectable,
    onSelectAsset,
    onToggleAsset,
}: Readonly<AssetCardProps>) {
    const { t } = useLingui();

    return (
        <div
            className={`
                group relative transition-all overflow-hidden rounded-lg
                bg-card text-card-foreground ring-1 text-left
                hover:ring-primary/40
                ${isSelected ? 'ring-2 ring-primary' : 'ring-foreground/10'}
            `}
        >
            <button
                type="button"
                className="absolute inset-0 z-10 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={t`Select ${asset.name}`}
                onClick={e => onSelectAsset(asset, e)}
            />
            <div className="relative aspect-square bg-muted/30 overflow-hidden">
                <VendureImage
                    asset={asset}
                    preset="thumb"
                    className="w-full h-full object-cover"
                />
                {selectable && (
                    <div className="absolute top-1.5 left-1.5 z-20">
                        <Checkbox
                            checked={isSelected}
                            aria-label={t`Toggle selection for ${asset.name}`}
                            onClick={e => {
                                e.stopPropagation();
                                onToggleAsset(asset);
                            }}
                        />
                    </div>
                )}
            </div>
            <div className="px-2 py-1.5">
                <p
                    className="text-sm font-medium leading-tight line-clamp-1"
                    title={asset.name}
                >
                    {asset.name}
                </p>
                <div className="flex items-center justify-between mt-0.5">
                    <span className="text-xs text-muted-foreground">
                        {asset.fileSize ? formatFileSize(asset.fileSize) : ''}
                    </span>
                    <Link
                        to={`/assets/${asset.id}`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        aria-label={t`Open ${asset.name}`}
                        className="relative z-20 inline-flex items-center gap-1 rounded-sm px-1 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                        <Trans>Open</Trans>
                        <ChevronRight className="h-3 w-3" />
                    </Link>
                </div>
            </div>
        </div>
    );
});

interface AssetListDataTableProps {
    selectable: boolean;
    displayBulkActions: boolean;
    bulkActions?: BulkActionsInput;
    selectedItems: Asset[];
    page: number;
    itemsPerPage: number;
    sorting: SortingState;
    columnFilters: ColumnFiltersState;
    onPageChange: (page: number, itemsPerPage: number) => void;
    onSortChange: (sorting: SortingState) => void;
    onFilterChange: (filters: ColumnFiltersState) => void;
    onSelectionChange: (selection: Asset[]) => void;
}

function AssetListDataTable({
    selectable,
    displayBulkActions,
    bulkActions,
    selectedItems,
    page,
    itemsPerPage,
    sorting,
    columnFilters,
    onPageChange,
    onSortChange,
    onFilterChange,
    onSelectionChange,
}: Readonly<AssetListDataTableProps>) {
    const { t } = useLingui();

    return (
        <div data-asset-gallery>
            <PaginatedListDataTable
                listQuery={getAssetListDocument}
                transformVariables={variables => {
                    const filter = variables.options?.filter;
                    const conditions = filter?._and ?? [];
                    const tagFilter = conditions.find((condition: Record<string, any>) => condition.assetTags);
                    if (!tagFilter) {
                        return variables;
                    }

                    const tags = tagFilter.assetTags.in ?? [];
                    const remainingConditions = conditions.filter((condition: Record<string, any>) => !condition.assetTags);
                    const { _and, ...filterWithoutConditions } = filter;
                    let nextFilter;
                    if (remainingConditions.length > 0) {
                        nextFilter = { ...filterWithoutConditions, _and: remainingConditions };
                    } else if (Object.keys(filterWithoutConditions).length > 0) {
                        nextFilter = filterWithoutConditions;
                    }

                    return {
                        ...variables,
                        options: {
                            ...variables.options,
                            filter: nextFilter,
                            ...(tags.length > 0 ? { tags, tagsOperator: 'AND' as const } : {}),
                        },
                    };
                }}
                customizeColumns={{
                    name: {
                        header: t`Name`,
                        cell: ({ row }) => (
                            <Link
                                to={`/assets/${row.original.id}`}
                                className="block max-w-[20rem] truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                title={row.original.name}
                            >
                                {row.original.name}
                            </Link>
                        ),
                    },
                    type: {
                        header: t`Type`,
                        enableSorting: false,
                        cell: ({ row }) => (
                            <span className="text-muted-foreground">
                                <AssetTypeLabel type={row.original.type} />
                            </span>
                        ),
                    },
                    fileSize: {
                        header: t`Size`,
                        cell: ({ row }) => (
                            <span className="text-muted-foreground">
                                {row.original.fileSize ? formatFileSize(row.original.fileSize) : '-'}
                            </span>
                        ),
                    },
                    createdAt: { header: t`Created` },
                }}
                additionalColumns={{
                    previewImage: {
                        header: '',
                        enableSorting: false,
                        meta: { dependencies: ['preview', 'focalPoint'] },
                        cell: ({ row }) => (
                            <VendureImage
                                asset={row.original}
                                preset="tiny"
                                className="h-10 w-10 rounded-md object-cover"
                            />
                        ),
                    },
                    dimensions: {
                        header: t`Dimensions`,
                        enableSorting: false,
                        meta: { dependencies: ['width', 'height'] },
                        cell: ({ row }) => (
                            <span className="text-muted-foreground">
                                {row.original.width && row.original.height
                                    ? `${row.original.width} \u00d7 ${row.original.height}`
                                    : '-'}
                            </span>
                        ),
                    },
                    assetTags: {
                        header: '',
                        cell: () => null,
                        enableSorting: false,
                        enableHiding: false,
                        enableColumnFilter: false,
                    },
                    openAsset: {
                        header: '',
                        enableSorting: false,
                        cell: ({ row }) => (
                            <Link
                                to={`/assets/${row.original.id}`}
                                aria-label={t`Open ${row.original.name}`}
                                className="inline-flex items-center gap-1 rounded-sm px-2 py-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                            >
                                <Trans>Open</Trans>
                                <ChevronRight className="h-4 w-4" />
                            </Link>
                        ),
                    },
                }}
                defaultColumnOrder={[
                    'previewImage',
                    'name',
                    'type',
                    'fileSize',
                    'dimensions',
                    'createdAt',
                    'openAsset',
                ]}
                defaultVisibility={{
                    id: false,
                    updatedAt: false,
                    languageCode: false,
                    mimeType: false,
                    preview: false,
                    source: false,
                    width: false,
                    height: false,
                    focalPoint: false,
                    translations: false,
                    assetTags: false,
                }}
                page={page}
                itemsPerPage={itemsPerPage}
                sorting={sorting}
                onPageChange={(_, nextPage, nextItemsPerPage) => onPageChange(nextPage, nextItemsPerPage)}
                onSortChange={(_, nextSorting) => onSortChange(nextSorting)}
                columnFilters={columnFilters}
                onFilterChange={(_, nextColumnFilters) => onFilterChange(nextColumnFilters)}
                selectedItems={selectedItems}
                onSelectionChange={onSelectionChange}
                onSearchTermChange={searchTerm => ({ name: { contains: searchTerm } })}
                searchPlaceholder={t`Search assets...`}
                facetedFilters={{
                    assetTags: {
                        title: t`Tags`,
                        component: AssetTagFacetedFilter,
                    },
                }}
                bulkActions={displayBulkActions ? bulkActions : false}
                includeSelectionColumn={selectable}
            />
        </div>
    );
}
