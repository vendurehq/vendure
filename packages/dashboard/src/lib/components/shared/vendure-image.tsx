import { cn } from '@/vdb/lib/utils.js';
import { Image } from 'lucide-react';
import React from 'react';

/**
 * @description
 * The type of object that can be used as an asset in the {@link VendureImage} component.
 *
 * @docsCategory components
 * @docsPage VendureImage
 * @since 3.4.0
 */
export interface AssetLike {
    id: string;
    preview: string; // Base URL of the asset
    name?: string | null;
    focalPoint?: { x: number; y: number } | null;
}

/**
 * @description
 * The presets that can be used for the {@link VendureImage} component.
 *
 * @docsCategory components
 * @docsPage VendureImage
 * @since 3.4.0
 */
export type ImagePreset = 'tiny' | 'thumb' | 'small' | 'medium' | 'large' | 'full' | null;

/**
 * @description
 * The formats that can be used for the {@link VendureImage} component.
 *
 * @docsCategory components
 * @docsPage VendureImage
 * @since 3.4.0
 */
export type ImageFormat = 'jpg' | 'jpeg' | 'png' | 'webp' | 'avif' | null;

/**
 * @description
 * The modes that can be used for the {@link VendureImage} component.
 *
 * @docsCategory components
 * @docsPage VendureImage
 * @since 3.4.0
 */
export type ImageMode = 'crop' | 'resize' | null;

/**
 * @description
 * The props for the {@link VendureImage} component.
 *
 * @docsCategory components
 * @docsPage VendureImage
 * @docsWeight 1
 * @since 3.4.0
 */
export interface VendureImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    /**
     * @description
     * The asset to display.
     */
    asset: AssetLike | null | undefined;
    /**
     * @description
     * The preset to use for the image.
     */
    preset?: ImagePreset;
    /**
     * @description
     * The crop/resize mode to use for the image.
     */
    mode?: ImageMode;
    /**
     * @description
     * The width of the image.
     */
    width?: number;
    /**
     * @description
     * The height of the image.
     */
    height?: number;
    /**
     * @description
     * The format of the image.
     */
    format?: ImageFormat;
    /**
     * @description
     * The quality of the image.
     */
    quality?: number;
    /**
     * @description
     * Whether to use the asset's focal point in crop mode.
     */
    useFocalPoint?: boolean;
    /**
     * @description
     * The fallback to show if no asset is provided. If no fallback is provided,
     * a default placeholder will be shown.
     */
    fallback?: React.ReactNode;
    /**
     * @description
     * The ref to the image element.
     */
    ref?: React.Ref<HTMLImageElement>;
}

/**
 * @description
 * A component for displaying an image from a Vendure asset.
 *
 * Supports the following features:
 *
 * * Presets
 * * Cropping
 * * Resizing
 * * Formatting
 * * Quality
 * * Focal point
 * * Fallback
 *
 * @example
 * ```tsx
 *  <VendureImage
 *      asset={asset}
 *      preset="thumb"
 *      className="w-full h-full object-contain"
 *  />
 * ```
 *
 * @docsCategory components
 * @docsPage VendureImage
 * @docsWeight 0
 * @since 3.4.0
 */
export function VendureImage({
    asset,
    preset = null,
    mode = null,
    width,
    height,
    format = null,
    quality,
    useFocalPoint = true,
    fallback = null,
    alt,
    className,
    style,
    ref,
    ...imgProps
}: VendureImageProps) {
    if (!asset?.preview) {
        return fallback ? (
            <>{fallback}</>
        ) : (
            <PlaceholderImage preset={preset} width={width} height={height} className={className} />
        );
    }
    // Build the URL with query parameters
    const url = new URL(asset.preview);

    // Handle preset if specified
    if (preset) {
        url.searchParams.set('preset', preset);
    } else {
        // Or handle custom dimensions and mode
        if (width) url.searchParams.set('w', width.toString());
        if (height) url.searchParams.set('h', height.toString());
        if (mode) url.searchParams.set('mode', mode);
    }

    // Add format if specified
    if (format) {
        url.searchParams.set('format', format);
    }

    // Add quality if specified
    if (quality) {
        url.searchParams.set('q', quality.toString());
    }

    // Apply focal point if available and requested
    if (useFocalPoint && asset.focalPoint) {
        url.searchParams.set('fpx', asset.focalPoint.x.toString());
        url.searchParams.set('fpy', asset.focalPoint.y.toString());
    }

    const minDimensions = getMinDimensions(preset, width, height);

    return (
        <img
            src={url.toString()}
            alt={alt || asset.name || ''}
            className={cn(className, 'rounded-sm')}
            width={minDimensions.width}
            height={minDimensions.height}
            style={style}
            loading="lazy"
            ref={ref}
            {...imgProps}
        />
    );
}

function getMinDimensions(preset?: ImagePreset, width?: number, height?: number) {
    if (preset) {
        switch (preset) {
            case 'tiny':
                return { width: 50, height: 50 };
            case 'thumb':
                return { width: 150, height: 150 };
            case 'small':
                return { width: 300, height: 300 };
            case 'medium':
                return { width: 500, height: 500 };
            case 'large':
                return { width: 800, height: 800 };
            case 'full':
                return { width: undefined, height: undefined };
        }
    }

    if (width && height) {
        return { width, height };
    }

    return { width: 100, height: 100 };
}

export function PlaceholderImage({
    width = 100,
    height = 100,
    preset = null,
    className,
    ...props
}: React.ImgHTMLAttributes<HTMLImageElement> & { preset?: ImagePreset }) {
    if (preset) {
        switch (preset) {
            case 'tiny':
                width = 50;
                height = 50;
                break;
            case 'thumb':
                width = 150;
                height = 150;
                break;
            case 'small':
                width = 300;
                height = 300;
                break;
            case 'medium':
                width = 500;
                height = 500;
                break;
            case 'large':
                width = 800;
                height = 800;
                break;
            case 'full':
                width = 1200;
                height = 1200;
                break;
            default:
                break;
        }
    }
    return (
        <div className={cn(className, 'rounded-sm bg-muted')} style={{ width, height }} {...props}>
            <Image className="w-full h-full text-muted-foreground" />
        </div>
    );
}

// Convenience components for common use cases
export function Thumbnail({
    asset,
    size = 'thumb',
    ...props
}: Omit<VendureImageProps, 'preset'> & { size?: ImagePreset }) {
    return <VendureImage asset={asset} preset={size} {...props} />;
}

export function CroppedImage({ asset, width, height, ...props }: Omit<VendureImageProps, 'mode'>) {
    return <VendureImage asset={asset} mode="crop" width={width} height={height} {...props} />;
}

export function ResponsiveImage({
    asset,
    sizes = '100vw',
    ...props
}: VendureImageProps & { sizes?: string }) {
    // Setup srcset with multiple sizes
    const srcSet = [
        `${asset?.preview}?w=320&mode=resize 320w`,
        `${asset?.preview}?w=480&mode=resize 480w`,
        `${asset?.preview}?w=640&mode=resize 640w`,
        `${asset?.preview}?w=1024&mode=resize 1024w`,
        `${asset?.preview}?w=1280&mode=resize 1280w`,
    ].join(', ');

    return <VendureImage asset={asset} srcSet={srcSet} sizes={sizes} {...props} />;
}
