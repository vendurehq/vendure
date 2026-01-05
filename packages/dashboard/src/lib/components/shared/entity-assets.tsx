import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import {
    closestCenter,
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    horizontalListSortingStrategy,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { EllipsisIcon, ImageIcon, PaperclipIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { AssetPickerDialog } from './asset/asset-picker-dialog.js';
import { AssetPreviewDialog } from './asset/asset-preview-dialog.js';
import { VendureImage } from './vendure-image.js';
import { Trans } from '@lingui/react/macro';

type Asset = AssetFragment;

export interface EntityAssetValue {
    assetIds?: string[] | null;
    featuredAssetId?: string | null;
}

interface EntityAssetsProps {
    assets?: Asset[];
    featuredAsset?: Asset | null;
    compact?: boolean;
    updatePermissions?: boolean;
    multiSelect?: boolean;
    value?: EntityAssetValue;
    onBlur?: () => void;
    onChange?: (change: EntityAssetValue) => void;
}

// FeaturedAsset component
interface FeaturedAssetProps {
    featuredAsset?: Asset | null;
    compact?: boolean;
    onSelectAssets: () => void;
    onPreviewAsset: (asset: Asset) => void;
}

function FeaturedAsset({
    featuredAsset,
    compact = false,
    onSelectAssets,
    onPreviewAsset,
}: FeaturedAssetProps) {
    return (
        <div
            className={`flex items-center justify-center ${compact ? 'h-40' : 'h-64'} border border-dashed rounded-md`}
        >
            {featuredAsset ? (
                <VendureImage
                    asset={featuredAsset}
                    mode="crop"
                    preset="small"
                    onClick={() => onPreviewAsset(featuredAsset)}
                    className="max-w-full max-h-full object-contain cursor-pointer"
                />
            ) : (
                <div
                    className="flex flex-col items-center justify-center text-muted-foreground cursor-pointer"
                    onKeyDown={e => e.key === 'Enter' && onSelectAssets()}
                    tabIndex={0}
                    onClick={onSelectAssets}
                >
                    <ImageIcon className={compact ? 'h-10 w-10' : 'h-16 w-16'} />
                    {!compact && <div className="mt-2">No featured asset</div>}
                </div>
            )}
        </div>
    );
}

// Sortable asset item component
function SortableAsset({
    asset,
    compact,
    isFeatured,
    updatePermissions,
    onPreview,
    onSetAsFeatured,
    onRemove,
}: {
    asset: Asset;
    compact: boolean;
    isFeatured: boolean;
    updatePermissions: boolean;
    onPreview: (asset: Asset) => void;
    onSetAsFeatured: (asset: Asset) => void;
    onRemove: (asset: Asset) => void;
}) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: asset.id,
        disabled: !updatePermissions,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="relative group" {...attributes}>
            {/* Draggable Image Area */}
            <div
                {...listeners}
                className={`
                    flex items-center justify-center
                    ${compact ? 'w-12 h-12' : 'w-16 h-16'}
                    border rounded-md overflow-hidden cursor-grab
                    ${isFeatured ? 'border-primary ring-1 ring-primary/30' : 'border-border'}
                    ${updatePermissions ? 'hover:border-muted-foreground' : ''}
                    ${isDragging ? 'opacity-50 cursor-grabbing' : ''}
                `}
            >
                <VendureImage asset={asset} mode="crop" preset="tiny" />
            </div>

            {/* Menu Trigger */}
            {updatePermissions && (
                <div className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="secondary"
                                size="icon"
                                className="h-6 w-6 rounded-full shadow-md"
                            >
                                <EllipsisIcon className="h-4 w-4" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onPreview(asset)}>Preview</DropdownMenuItem>
                            <DropdownMenuItem disabled={isFeatured} onClick={() => onSetAsFeatured(asset)}>
                                Set as featured asset
                            </DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => onRemove(asset)}>
                                Remove asset
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </div>
    );
}

export function EntityAssets({
    assets: initialAssets = [],
    featuredAsset: initialFeaturedAsset,
    compact = false,
    updatePermissions = true,
    multiSelect = true,
    onChange,
}: EntityAssetsProps) {
    const [assets, setAssets] = useState<Asset[]>([...initialAssets]);
    const [featuredAsset, setFeaturedAsset] = useState<Asset | undefined | null>(initialFeaturedAsset);
    const [isPickerOpen, setIsPickerOpen] = useState(false);
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

    // Setup sensors for drag and drop
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
        }),
    );

    // Update internal state when props change
    useEffect(() => {
        if (initialAssets.length) {
            setAssets([...initialAssets]);
        }
    }, [initialAssets]);

    useEffect(() => {
        setFeaturedAsset(initialFeaturedAsset);
    }, [initialFeaturedAsset]);

    const emitChange = useCallback(
        (newAssets: Asset[], newFeaturedAsset: Asset | undefined | null) => {
            onChange?.({
                assetIds: newAssets.map(a => a.id),
                featuredAssetId: newFeaturedAsset?.id ?? undefined,
            });
        },
        [onChange],
    );

    const handleSelectAssets = useCallback(() => {
        setIsPickerOpen(true);
    }, []);

    const handleAssetsPicked = useCallback(
        (selectedAssets: Asset[]) => {
            if (selectedAssets.length) {
                // Remove duplicates
                const uniqueAssets = multiSelect
                    ? [...new Map([...assets, ...selectedAssets].map(item => [item.id, item])).values()]
                    : selectedAssets;

                const newFeaturedAsset = !featuredAsset || !multiSelect ? selectedAssets[0] : featuredAsset;

                setAssets(uniqueAssets);
                setFeaturedAsset(newFeaturedAsset);
                emitChange(uniqueAssets, newFeaturedAsset);
            }
            setIsPickerOpen(false);
        },
        [assets, featuredAsset, multiSelect, emitChange],
    );

    const handleSetAsFeatured = useCallback(
        (asset: Asset) => {
            setFeaturedAsset(asset);
            emitChange(assets, asset);
        },
        [assets, emitChange],
    );

    const handleRemoveAsset = useCallback(
        (asset: Asset) => {
            const newAssets = assets.filter(a => a.id !== asset.id);
            let newFeaturedAsset = featuredAsset;

            if (featuredAsset && featuredAsset.id === asset.id) {
                newFeaturedAsset = newAssets.length > 0 ? newAssets[0] : undefined;
            }

            setAssets(newAssets);
            setFeaturedAsset(newFeaturedAsset);
            emitChange(newAssets, newFeaturedAsset);
        },
        [assets, featuredAsset, emitChange],
    );

    const handleDragEnd = useCallback(
        (event: DragEndEvent) => {
            const { active, over } = event;

            if (over && active.id !== over.id) {
                setAssets(items => {
                    const oldIndex = items.findIndex(item => item.id === active.id);
                    const newIndex = items.findIndex(item => item.id === over.id);

                    const newAssets = arrayMove(items, oldIndex, newIndex);
                    emitChange(newAssets, featuredAsset);
                    return newAssets;
                });
            }
        },
        [emitChange, featuredAsset],
    );

    const isFeatured = useCallback(
        (asset: Asset) => {
            return !!featuredAsset && featuredAsset.id === asset.id;
        },
        [featuredAsset],
    );
    // AddAssetButton component
    const AddAssetButton = () =>
        updatePermissions && (
            <Button
                variant="outline"
                size={compact ? 'sm' : 'default'}
                className={compact ? 'w-full' : ''}
                onClick={handleSelectAssets}
            >
                <PaperclipIcon className="mr-2 h-4 w-4" />
                <Trans>Add asset</Trans>
            </Button>
        );

    return (
        <>
            {compact ? (
                <div className="flex flex-col gap-3">
                    <FeaturedAsset
                        featuredAsset={featuredAsset}
                        compact={compact}
                        onSelectAssets={handleSelectAssets}
                        onPreviewAsset={setPreviewAsset}
                    />
                    <AssetList
                        assets={assets}
                        compact={compact}
                        sensors={sensors}
                        updatePermissions={updatePermissions}
                        isFeatured={isFeatured}
                        onPreview={setPreviewAsset}
                        onSetAsFeatured={handleSetAsFeatured}
                        onRemove={handleRemoveAsset}
                        onDragEnd={handleDragEnd}
                    />
                    <AddAssetButton />
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-[256px_1fr] gap-4">
                    <FeaturedAsset
                        featuredAsset={featuredAsset}
                        compact={compact}
                        onSelectAssets={handleSelectAssets}
                        onPreviewAsset={setPreviewAsset}
                    />
                    <div className="flex flex-col gap-4">
                        <AssetList
                            assets={assets}
                            compact={compact}
                            sensors={sensors}
                            updatePermissions={updatePermissions}
                            isFeatured={isFeatured}
                            onPreview={setPreviewAsset}
                            onSetAsFeatured={handleSetAsFeatured}
                            onRemove={handleRemoveAsset}
                            onDragEnd={handleDragEnd}
                        />
                        <AddAssetButton />
                    </div>
                </div>
            )}

            {/* Dialogs - moved outside conditional rendering */}
            {isPickerOpen && (
                <AssetPickerDialog
                    multiSelect={multiSelect}
                    onSelect={handleAssetsPicked}
                    onClose={() => setIsPickerOpen(false)}
                    open={isPickerOpen}
                />
            )}

            {previewAsset && (
                <AssetPreviewDialog
                    asset={previewAsset}
                    assets={assets}
                    onOpenChange={() => setPreviewAsset(null)}
                    open={!!previewAsset}
                />
            )}
        </>
    );
}

// AssetList component
interface AssetListProps {
    assets: Asset[];
    compact: boolean;
    sensors: ReturnType<typeof useSensors>;
    updatePermissions: boolean;
    isFeatured: (asset: Asset) => boolean;
    onPreview: (asset: Asset) => void;
    onSetAsFeatured: (asset: Asset) => void;
    onRemove: (asset: Asset) => void;
    onDragEnd: (event: DragEndEvent) => void;
}

function AssetList({
    assets,
    compact,
    sensors,
    updatePermissions,
    isFeatured,
    onPreview,
    onSetAsFeatured,
    onRemove,
    onDragEnd,
}: AssetListProps) {
    return (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <div className={`${compact ? 'max-h-32' : ''} overflow-auto p-1`}>
                <SortableContext
                    items={assets.map(asset => asset.id)}
                    strategy={horizontalListSortingStrategy}
                >
                    <div className="flex flex-wrap gap-2">
                        {assets.map(asset => (
                            <SortableAsset
                                key={asset.id}
                                asset={asset}
                                compact={compact}
                                isFeatured={isFeatured(asset)}
                                updatePermissions={updatePermissions}
                                onPreview={onPreview}
                                onSetAsFeatured={onSetAsFeatured}
                                onRemove={onRemove}
                            />
                        ))}
                    </div>
                </SortableContext>
            </div>
        </DndContext>
    );
}
