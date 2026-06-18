import { VendureImage } from '@/vdb/components/shared/vendure-image.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { AssetFragment } from '@/vdb/graphql/fragments.js';
import { cn } from '@/vdb/lib/utils.js';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AssetPreviewSelector } from './asset-preview-selector.js';
import { AssetProperties } from './asset-properties.js';

export type PreviewPreset = 'tiny' | 'thumb' | 'small' | 'medium' | 'large' | '';

export type AssetWithTags = AssetFragment & { tags?: { value: string }[] };

interface AssetPreviewProps {
    asset: AssetWithTags;
    assets?: AssetWithTags[];
    customFields?: any[];
}

export function AssetPreview({ asset, assets, customFields = [] }: Readonly<AssetPreviewProps>) {
    const [size, setSize] = useState<PreviewPreset>('medium');
    const [width, setWidth] = useState(0);
    const [height, setHeight] = useState(0);
    const [centered, setCentered] = useState(true);
    const [assetIndex, setAssetIndex] = useState(assets?.indexOf(asset) || 0);

    const imageRef = useRef<HTMLImageElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    const activeAsset = assets?.[assetIndex] ?? asset;

    useEffect(() => {
        if (assets?.length) {
            const index = assets.findIndex(a => a.id === asset.id);
            setAssetIndex(index === -1 ? 0 : index);
        }
    }, [assets, asset.id]);

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

    return (
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-4 h-full">
            <div className="space-y-4">
                <Card>
                    <CardContent className="pt-6 space-y-4">
                        <AssetProperties asset={activeAsset} />
                        <AssetPreviewSelector size={size} setSize={setSize} width={width} height={height} />
                    </CardContent>
                </Card>
            </div>

            <div className="relative flex items-center justify-center bg-muted/30 rounded-lg">
                {assets && assets.length > 1 && (
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
                    <VendureImage
                        ref={imageRef}
                        asset={activeAsset}
                        preset={size || undefined}
                        mode="resize"
                        onLoad={updateDimensions}
                        className="max-w-full max-h-full object-contain"
                    />
                </div>
            </div>
        </div>
    );
}
