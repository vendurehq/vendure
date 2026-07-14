import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { ToggleGroup, ToggleGroupItem } from '@/vdb/components/ui/toggle-group.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { PageActionBar } from '@/vdb/framework/layout-engine/page-layout.js';
import { api } from '@/vdb/graphql/api.js';
import { assetFragment, AssetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { formatFileSize } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useDebounce } from '@uidotdev/usehooks';
import { ChevronRight, LayoutGrid, LayoutList, Loader2, Search, Upload, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { tagListDocument } from '../../../../app/routes/_authenticated/_assets/assets.graphql.js';
import { AssetTagFilter } from '../../../../app/routes/_authenticated/_assets/components/asset-tag-filter.js';
import { AssetBulkAction, AssetBulkActions } from './asset-bulk-actions.js';

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

export const createAssetsDocument = graphql(
    `
        mutation CreateAssets($input: [CreateAssetInput!]!) {
            createAssets(input: $input) {
                ...Asset
                ... on Asset {
                    tags {
                        id
                        createdAt
                        updatedAt
                        value
                    }
                }
                ... on ErrorResult {
                    message
                }
            }
        }
    `,
    [assetFragment],
);

const AssetType = {
    ALL: 'ALL',
    IMAGE: 'IMAGE',
    VIDEO: 'VIDEO',
    BINARY: 'BINARY',
} as const;

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
    bulkActions?: AssetBulkAction[];
    /**
     * @description
     * Whether the gallery should display bulk actions.
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
    const [search, setSearch] = useState('');
    const debouncedSearch = useDebounce(search, 500);
    const [assetType, setAssetType] = useState<string>(AssetType.ALL);
    const [selected, setSelected] = useState<Asset[]>(initialSelectedAssets || []);
    const [selectedTags, setSelectedTags] = useState<string[]>([]);
    const queryClient = useQueryClient();

    const queryKey = ['AssetGallery', page, pageSize, debouncedSearch, assetType, selectedTags];

    // Query for available tags to check if we should show the filter
    const { data: tagsData } = useQuery({
        queryKey: ['tags-check'],
        queryFn: () => api.query(tagListDocument, { options: { take: 1 } }),
        staleTime: 1000 * 60 * 5,
    });

    const hasTags = (tagsData?.tags.items?.length || 0) > 0;

    // Query for assets
    const { data, isLoading, refetch } = useQuery({
        queryKey,
        queryFn: () => {
            const filter: Record<string, any> = {};

            if (debouncedSearch) {
                filter.name = { contains: debouncedSearch };
            }

            if (assetType !== AssetType.ALL) {
                filter.type = { eq: assetType };
            }

            const options: any = {
                skip: (page - 1) * pageSize,
                take: pageSize,
                filter: Object.keys(filter).length > 0 ? filter : undefined,
                sort: { createdAt: 'DESC' },
            };

            // Add tag filtering if tags are provided
            if (selectedTags && selectedTags.length > 0) {
                options.tags = selectedTags;
                options.tagsOperator = 'AND';
            }

            return api.query(getAssetListDocument, { options });
        },
    });

    const assets = (data?.assets.items ?? []) as Asset[];

    const { mutate: createAssets } = useMutation({
        mutationFn: api.mutate(createAssetsDocument),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey });
        },
    });

    // Setup dropzone
    const onDrop = useCallback(
        (acceptedFiles: File[]) => {
            createAssets({ input: acceptedFiles.map(file => ({ file })) });
        },
        [createAssets],
    );

    const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, noClick: true });

    // Calculate total pages
    const totalItems = data?.assets.totalItems || 0;
    const totalPages = Math.ceil(totalItems / pageSize);

    // Toggle a single asset in the selection
    const toggleAssetSelection = useCallback(
        (asset: Asset) => {
            const isCurrentlySelected = selected.some(a => a.id === asset.id);
            const newSelected = isCurrentlySelected
                ? selected.filter(a => a.id !== asset.id)
                : [...selected, asset];
            setSelected(newSelected);
            onSelect?.(newSelected);
        },
        [selected, onSelect],
    );

    // Handle selection
    const handleSelect = (asset: Asset, event: React.MouseEvent | React.KeyboardEvent) => {
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
            setSelected([asset]);
            onSelect?.([asset]);
        }
    };

    // Check if an asset is selected
    const isSelected = (asset: Asset) => selected.some(a => a.id === asset.id);

    // Handle tag changes
    const handleTagsChange = (tags: string[]) => {
        setSelectedTags(tags);
        setPage(1); // Reset to page 1 when tags change
    };

    // Clear filters
    const clearFilters = () => {
        setSearch('');
        setAssetType(AssetType.ALL);
        setSelectedTags([]);
        setPage(1);
    };

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
                const filesList = Array.from(target.files);
                onDrop(filesList);
            }
        });
        fileInput.click();
    };

    return (
        <div className={`relative flex flex-col w-full ${fixedHeight ? 'h-[600px]' : 'h-full'} ${className}`}>
            {showHeader && (
                <div className="space-y-4 mb-4 flex-shrink-0">
                    <div className="flex flex-col md:flex-row gap-2">
                        <div className="relative flex-grow flex items-center gap-2">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={t`Search assets...`}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                className="pl-8"
                            />
                            {(search || assetType !== AssetType.ALL || selectedTags.length > 0) && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={clearFilters}
                                    className="absolute right-0"
                                >
                                    <X className="h-4 w-4 mr-1" /> <Trans>Clear filters</Trans>
                                </Button>
                            )}
                        </div>
                        <Select
                            items={{
                                [AssetType.ALL]: t`All types`,
                                [AssetType.IMAGE]: t`Images`,
                                [AssetType.VIDEO]: t`Video`,
                                [AssetType.BINARY]: t`Binary`,
                            }}
                            value={assetType}
                            onValueChange={value => value != null && setAssetType(value)}
                        >
                            <SelectTrigger className="w-full md:w-[180px]">
                                <SelectValue placeholder={t`Asset type`} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={AssetType.ALL}><Trans>All types</Trans></SelectItem>
                                <SelectItem value={AssetType.IMAGE}><Trans>Images</Trans></SelectItem>
                                <SelectItem value={AssetType.VIDEO}><Trans>Video</Trans></SelectItem>
                                <SelectItem value={AssetType.BINARY}><Trans>Binary</Trans></SelectItem>
                            </SelectContent>
                        </Select>
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
                                <Button onClick={openFileDialog} className="whitespace-nowrap">
                                    <Upload className="h-4 w-4 mr-2" /> <Trans>Upload</Trans>
                                </Button>
                            </ActionBarItem>
                        </PageActionBar>
                    </div>

                    {hasTags && (
                        <div className="flex items-center -mt-2">
                            <AssetTagFilter selectedTags={selectedTags} onTagsChange={handleTagsChange} />
                        </div>
                    )}
                </div>
            )}

            {/* Bulk actions bar */}
            {displayBulkActions ? (
                <AssetBulkActions selection={selected} bulkActions={bulkActions} refetch={refetch} />
            ) : null}

            <div
                {...getRootProps()}
                className={`
                    ${fixedHeight ? 'flex-grow overflow-y-auto' : ''}
                    ${isDragActive ? 'ring-2 ring-primary bg-primary/5' : ''}
                    relative rounded-md transition-all
                `}
            >
                <input {...getInputProps()} />

                {isDragActive && (
                    <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center rounded-md">
                        <Upload className="h-12 w-12 text-primary mb-2" />
                        <p className="text-center font-medium"><Trans>Drop files here to upload</Trans></p>
                    </div>
                )}

                {viewMode === 'list' ? (
                    <AssetListView
                        assets={assets}
                        isLoading={isLoading}
                        selectable={selectable}
                        isSelected={isSelected}
                        handleSelect={handleSelect}
                        toggleAssetSelection={toggleAssetSelection}
                    />
                ) : (
                    <AssetGridView
                        assets={assets}
                        isLoading={isLoading}
                        selectable={selectable}
                        isSelected={isSelected}
                        handleSelect={handleSelect}
                        toggleAssetSelection={toggleAssetSelection}
                    />
                )}
            </div>

            <div className="flex flex-col md:flex-row items-center md:justify-between gap-4 mt-4 flex-shrink-0">
                <div className="mt-2 text-xs text-muted-foreground flex-shrink-0">
                    <Trans>
                        {totalItems} {totalItems === 1 ? 'asset' : 'assets'} found
                    </Trans>
                    {selected.length > 0 && (
                        <Trans>, {selected.length} selected</Trans>
                    )}
                </div>
                <div className="flex-1"></div>
                {/* Items per page selector */}
                {onPageSizeChange && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground"><Trans>Items per page</Trans></span>
                        <Select
                            items={Object.fromEntries([12, 24, 48, 96].map(size => [`${size}`, size]))}
                            value={pageSize.toString()}
                            onValueChange={value => {
                                if (value == null) return;
                                const newPageSize = Number.parseInt(value, 10);
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
        </div>
    );
}

interface AssetViewProps {
    assets: Asset[];
    isLoading: boolean;
    selectable: boolean;
    isSelected: (asset: Asset) => boolean;
    handleSelect: (asset: Asset, event: React.MouseEvent | React.KeyboardEvent) => void;
    toggleAssetSelection: (asset: Asset) => void;
}

function AssetEmptyState() {
    return (
        <div className="text-center py-12 text-muted-foreground">
            <Trans>No assets found. Try adjusting your filters.</Trans>
        </div>
    );
}

function AssetGridView({
    assets,
    isLoading,
    selectable,
    isSelected,
    handleSelect,
    toggleAssetSelection,
}: Readonly<AssetViewProps>) {
    if (isLoading) {
        return (
            <div data-asset-gallery className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (assets.length === 0) {
        return <div data-asset-gallery><AssetEmptyState /></div>;
    }

    return (
        <div
            data-asset-gallery
            className="grid grid-cols-2 xs:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-1"
        >
            {assets.map(asset => (
                <button
                    type="button"
                    key={asset.id}
                    className={`
                        group cursor-pointer transition-all overflow-hidden rounded-xl
                        bg-card text-card-foreground ring-1 text-left
                        hover:ring-primary/40
                        ${isSelected(asset) ? 'ring-2 ring-primary' : 'ring-foreground/10'}
                    `}
                    onClick={e => handleSelect(asset, e)}
                >
                    <div className="relative aspect-square bg-muted/30 overflow-hidden">
                        <VendureImage
                            asset={asset}
                            preset="thumb"
                            className="w-full h-full object-cover"
                        />
                        {selectable && (
                            <div className="absolute top-1.5 left-1.5">
                                <Checkbox
                                    checked={isSelected(asset)}
                                    onClick={e => {
                                        e.stopPropagation();
                                        toggleAssetSelection(asset);
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
                                className="p-0.5 rounded-sm text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
                            >
                                <ChevronRight className="h-3.5 w-3.5" />
                            </Link>
                        </div>
                    </div>
                </button>
            ))}
        </div>
    );
}

function AssetListView({
    assets,
    isLoading,
    selectable,
    isSelected,
    handleSelect,
    toggleAssetSelection,
}: Readonly<AssetViewProps>) {
    const { formatDate } = useLocalFormat();

    if (isLoading) {
        return (
            <div data-asset-gallery className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    if (assets.length === 0) {
        return <div data-asset-gallery><AssetEmptyState /></div>;
    }

    return (
        <div data-asset-gallery>
            <Table>
                <TableHeader>
                    <TableRow>
                        {selectable && <TableHead className="w-10" />}
                        <TableHead className="w-12" />
                        <TableHead><Trans>Name</Trans></TableHead>
                        <TableHead><Trans>Type</Trans></TableHead>
                        <TableHead><Trans>Size</Trans></TableHead>
                        <TableHead><Trans>Dimensions</Trans></TableHead>
                        <TableHead><Trans>Created</Trans></TableHead>
                        <TableHead className="w-10" />
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {assets.map(asset => (
                        <TableRow
                            key={asset.id}
                            data-state={isSelected(asset) ? 'selected' : undefined}
                            className="cursor-pointer"
                            onClick={e => handleSelect(asset, e)}
                        >
                            {selectable && (
                                <TableCell>
                                    <Checkbox
                                        checked={isSelected(asset)}
                                        onClick={e => {
                                            e.stopPropagation();
                                            toggleAssetSelection(asset);
                                        }}
                                    />
                                </TableCell>
                            )}
                            <TableCell className="p-1.5">
                                <VendureImage
                                    asset={asset}
                                    preset="tiny"
                                    className="h-9 w-9 rounded object-cover"
                                />
                            </TableCell>
                            <TableCell className="font-medium">{asset.name}</TableCell>
                            <TableCell>
                                <Badge variant="secondary" className="text-xs font-normal">
                                    {asset.type.toLowerCase()}
                                </Badge>
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                                {asset.fileSize ? formatFileSize(asset.fileSize) : '-'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                                {asset.width && asset.height
                                    ? `${asset.width} \u00d7 ${asset.height}`
                                    : '-'}
                            </TableCell>
                            <TableCell className="text-muted-foreground">
                                {formatDate(asset.createdAt)}
                            </TableCell>
                            <TableCell>
                                <Link
                                    to={`/assets/${asset.id}`}
                                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                    className="p-1 rounded-sm text-muted-foreground hover:text-foreground"
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Link>
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </div>
    );
}
