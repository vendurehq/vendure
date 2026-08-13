import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { Label } from '@/vdb/components/ui/label.js';
import { api } from '@/vdb/graphql/api.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, FocusIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AssetFocalPointEditor, Point } from './asset-focal-point-editor.js';
import { AssetPreviewSelector } from './asset-preview-selector.js';
import { AssetProperties } from './asset-properties.js';

export type PreviewPreset = 'tiny' | 'thumb' | 'small' | 'medium' | 'large' | '';

export type AssetWithTags = AssetFragment & { tags?: { value: string }[] };

// Editor seed position when the asset has no persisted focal point.
const DEFAULT_FOCAL_POINT: Point = { x: 0.5, y: 0.5 };

interface AssetPreviewProps {
    asset: AssetWithTags;
    assets?: AssetWithTags[];
    customFields?: any[];
    // Lets a parent (e.g. EntityAssets) sync its local asset state after a save,
    // so a re-opened dialog or cropped thumbnail doesn't show the stale value.
    onAssetUpdated?: (asset: Pick<AssetWithTags, 'id'> & { focalPoint: Point | null }) => void;
}

// Defined here rather than imported from the assets route so this shared
// component doesn't depend on a route module.
const updateAssetFocalPointDocument = graphql(`
    mutation UpdateAssetFocalPoint($input: UpdateAssetInput!) {
        updateAsset(input: $input) {
            id
            focalPoint {
                x
                y
            }
        }
    }
`);

export function AssetPreview({
    asset,
    assets,
    customFields = [],
    onAssetUpdated,
}: Readonly<AssetPreviewProps>) {
    const { t } = useLingui();
    const [size, setSize] = useState<PreviewPreset>('medium');
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    const [centered, setCentered] = useState(true);
    const initialIndex = assets?.findIndex(a => a.id === asset.id) ?? -1;
    const [assetIndex, setAssetIndex] = useState(initialIndex === -1 ? 0 : initialIndex);
    const [settingFocalPoint, setSettingFocalPoint] = useState(false);
    // Reflects a just-saved focal point without refetching; cleared on asset change.
    const [focalPointOverride, setFocalPointOverride] = useState<Point | null>(null);

    const imageRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const activeAsset = assets?.[assetIndex] ?? asset;
    // Undefined when unset (shown as "Not set"); the editor always needs a start position.
    const persistedFocalPoint: Point | undefined = focalPointOverride ?? activeAsset.focalPoint ?? undefined;
    const editorFocalPoint: Point = persistedFocalPoint ?? DEFAULT_FOCAL_POINT;

    useEffect(() => {
        if (assets?.length) {
            const index = assets.findIndex(a => a.id === asset.id);
            setAssetIndex(index === -1 ? 0 : index);
        }
    }, [assets, asset.id]);

    // On asset change, reset to the new asset's persisted state.
    useEffect(() => {
        setFocalPointOverride(null);
        setSettingFocalPoint(false);
    }, [activeAsset.id]);

    useEffect(() => {
        const handleResize = () => {
            updateDimensions();
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const updateDimensions = () => {
        if (!imageRef.current || !containerRef.current) return;

        const img = imageRef.current;
        const container = containerRef.current;
        const imgWidth = img.naturalWidth;
        const imgHeight = img.naturalHeight;
        const containerWidth = container.offsetWidth;
        const containerHeight = container.offsetHeight;
        setWidth(imgWidth);
        setHeight(imgHeight);
        setCentered(imgWidth <= containerWidth && imgHeight <= containerHeight);
    };

    const updateFocalPointMutation = useMutation({
        // The parent is always notified (keyed by id), but the local override is
        // only applied if the response still matches the on-screen asset, so a
        // late response can't paint one asset's focal point onto another.
        mutationFn: ({ assetId, focalPoint }: { assetId: string; focalPoint: Point }) =>
            api.mutate(updateAssetFocalPointDocument, {
                input: { id: assetId, focalPoint },
            }),
        onSuccess: (_data, { assetId, focalPoint }) => {
            onAssetUpdated?.({ id: assetId, focalPoint });
            if (assetId === activeAsset.id) {
                setFocalPointOverride(focalPoint);
                setSettingFocalPoint(false);
            }
            toast.success(t`Focal point updated`);
        },
        onError: error => {
            toast.error(t`Failed to update focal point`, {
                description: error instanceof Error ? error.message : t`Unknown error`,
            });
        },
    });

    return (
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-full">
            <div className="space-y-4">
                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <AssetProperties asset={activeAsset} />
                        <AssetPreviewSelector size={size} setSize={setSize} width={width} height={height} />
                        <div className="flex items-center gap-2">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={() => setSettingFocalPoint(true)}
                                disabled={settingFocalPoint || updateFocalPointMutation.isPending}
                                aria-label={t`Edit focal point`}
                                data-testid="asset-preview-set-focal-point"
                            >
                                <FocusIcon className="h-4 w-4" />
                            </Button>
                            <div className="text-sm">
                                <Label>
                                    <Trans>Focal Point</Trans>
                                </Label>
                                <div
                                    className="text-muted-foreground"
                                    data-testid="asset-preview-focal-point-value"
                                >
                                    {persistedFocalPoint ? (
                                        `${persistedFocalPoint.x.toFixed(2)}, ${persistedFocalPoint.y.toFixed(2)}`
                                    ) : (
                                        <Trans>Not set</Trans>
                                    )}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="relative flex items-center justify-center bg-muted/30 rounded-lg">
                {assets && assets.length > 1 && !settingFocalPoint && (
                    <>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute left-4 z-10"
                            onClick={() => setAssetIndex(i => i - 1)}
                            disabled={assetIndex === 0}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-4 z-10"
                            onClick={() => setAssetIndex(i => i + 1)}
                            disabled={assetIndex === assets.length - 1}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </>
                )}
                <div
                    ref={containerRef}
                    className={cn('relative', centered && 'flex items-center justify-center')}
                >
                    <AssetFocalPointEditor
                        // Remount on asset/edit-session change to re-seed the editor's
                        // drag state; otherwise it could submit the previous asset's coordinates.
                        key={`${activeAsset.id}:${settingFocalPoint ? 'edit' : 'view'}`}
                        width={width}
                        height={height}
                        settingFocalPoint={settingFocalPoint}
                        focalPoint={editorFocalPoint}
                        onFocalPointChange={point =>
                            updateFocalPointMutation.mutate({ assetId: activeAsset.id, focalPoint: point })
                        }
                        onCancel={() => setSettingFocalPoint(false)}
                    >
                        <VendureImage
                            ref={imageRef}
                            asset={activeAsset}
                            preset={size || undefined}
                            mode="resize"
                            onLoad={updateDimensions}
                            className="max-w-full max-h-full object-contain"
                        />
                    </AssetFocalPointEditor>
                </div>
            </div>
        </div>
    );
}
