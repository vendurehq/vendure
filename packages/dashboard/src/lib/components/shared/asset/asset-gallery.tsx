import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent } from '@/vdb/components/ui/card.js';
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
import { api } from '@/vdb/graphql/api.js';
import { assetFragment, AssetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { formatFileSize } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Loader2, Search, Upload, X } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useLingui } from '@lingui/react/macro';
import { tagListDocument } from '../../../../app/routes/_authenticated/_assets/assets.graphql.js';
import { AssetTagFilter } from '../../../../app/routes/_authenticated/_assets/components/asset-tag-filter.js';
import { DetailPageButton } from '../detail-page-button.js';
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

    // Handle selection
    const handleSelect = (asset: Asset, event: React.MouseEvent) => {
        if (multiSelect === 'auto') {
            const isSelected = selected.some(a => a.id === asset.id);
            let newSelected: Asset[];

            if (isSelected) {
                newSelected = selected.filter(a => a.id !== asset.id);
            } else {
                newSelected = [...selected, asset];
            }

            setSelected(newSelected);
            onSelect?.(newSelected);
            return;
        }

        // Manual mode - check for modifier key
        const isModifierKeyPressed = event.metaKey || event.ctrlKey;

        if (multiSelect === 'manual' && isModifierKeyPressed) {
            // Toggle selection
            const isSelected = selected.some(a => a.id === asset.id);
            let newSelected: Asset[];

            if (isSelected) {
                newSelected = selected.filter(a => a.id !== asset.id);
            } else {
                newSelected = [...selected, asset];
            }

            setSelected(newSelected);
            onSelect?.(newSelected);
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
                        <Select value={assetType} onValueChange={setAssetType}>
                            <SelectTrigger className="w-full md:w-[180px]">
                                <SelectValue placeholder={t`Asset type`} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={AssetType.ALL}>
                                    <Trans>All types</Trans>
                                </SelectItem>
                                <SelectItem value={AssetType.IMAGE}>
                                    <Trans>Images</Trans>
                                </SelectItem>
                                <SelectItem value={AssetType.VIDEO}>
                                    <Trans>Video</Trans>
                                </SelectItem>
                                <SelectItem value={AssetType.BINARY}>
                                    <Trans>Binary</Trans>
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <Button onClick={openFileDialog} className="whitespace-nowrap">
                            <Upload className="h-4 w-4 mr-2" /> <Trans>Upload</Trans>
                        </Button>
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
                        <p className="text-center font-medium">
                            <Trans>Drop files here to upload</Trans>
                        </p>
                    </div>
                )}

                <div
                    data-asset-gallery
                    className="grid grid-cols-2 xs:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-1"
                >
                    {isLoading ? (
                        <div className="col-span-full flex justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-primary" />
                        </div>
                    ) : (
                        data?.assets.items.map(asset => (
                            <Card
                                key={asset.id}
                                className={`
                                    overflow-hidden cursor-pointer transition-all hover:ring-2 hover:ring-primary/20
                                    ${isSelected(asset as Asset) ? 'ring-2 ring-primary' : ''}
                                    flex flex-col min-w-[120px]
                                `}
                                onClick={e => handleSelect(asset as Asset, e)}
                            >
                                <div
                                    className="relative w-full bg-muted/30"
                                    style={{
                                        aspectRatio: '1/1',
                                        minHeight: '120px', // Ensure minimum height for the image
                                    }}
                                >
                                    <VendureImage
                                        asset={asset}
                                        preset="thumb"
                                        className="w-full h-full object-contain"
                                    />
                                    {selectable && (
                                        <div className="absolute top-2 left-2">
                                            <Checkbox
                                                checked={isSelected(asset as Asset)}
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    const isCurrentlySelected = selected.some(
                                                        a => a.id === asset.id,
                                                    );
                                                    let newSelected: Asset[];

                                                    if (isCurrentlySelected) {
                                                        newSelected = selected.filter(a => a.id !== asset.id);
                                                    } else {
                                                        newSelected = [...selected, asset as Asset];
                                                    }

                                                    setSelected(newSelected);
                                                    onSelect?.(newSelected);
                                                }}
                                            />
                                        </div>
                                    )}
                                </div>
                                <CardContent className="p-2">
                                    <p className="text-xs line-clamp-2 min-h-[2.5rem]" title={asset.name}>
                                        {asset.name}
                                    </p>
                                    <div className="flex justify-between items-center">
                                        {asset.fileSize && (
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {formatFileSize(asset.fileSize)}
                                            </p>
                                        )}
                                        <DetailPageButton
                                            href={`/assets/${asset.id}`}
                                            label={<Trans>Edit</Trans>}
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        ))
                    )}

                    {!isLoading && data?.assets.items.length === 0 && (
                        <div className="col-span-full text-center py-12 text-muted-foreground">
                            <Trans>No assets found. Try adjusting your filters.</Trans>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex flex-col md:flex-row items-center md:justify-between gap-4 mt-4 flex-shrink-0">
                <div className="mt-2 text-xs text-muted-foreground flex-shrink-0">
                    <Trans>{totalItems} {totalItems === 1 ? 'asset' : 'assets'} found</Trans>
                    {selected.length > 0 && t`, ${selected.length} selected`}
                </div>
                <div className="flex-1"></div>
                {/* Items per page selector */}
                {onPageSizeChange && (
                    <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">
                            <Trans>Items per page</Trans>
                        </span>
                        <Select
                            value={pageSize.toString()}
                            onValueChange={value => {
                                const newPageSize = parseInt(value, 10);
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
