import { internal_getRequestContext } from '@vendure/core';
import { Request } from 'express';

import { AssetServerOptions, ImageTransformFormat } from './types';

export function getAssetUrlPrefixFn(options: AssetServerOptions) {
    const { assetUrlPrefix, route } = options;
    if (assetUrlPrefix == null) {
        return (request: Request, identifier: string) => {
            const protocol = getFirstHeaderValue(request.headers['x-forwarded-proto']) ?? request.protocol;
            const host =
                getFirstHeaderValue(request.headers['x-forwarded-host']) ??
                request.get('host') ??
                'could-not-determine-host';
            return `${protocol}://${host}/${route}/`;
        };
    }
    if (typeof assetUrlPrefix === 'string') {
        return (...args: any[]) => assetUrlPrefix;
    }
    if (typeof assetUrlPrefix === 'function') {
        return (request: Request, identifier: string) => {
            const ctx = internal_getRequestContext(request);
            return assetUrlPrefix(ctx, identifier);
        };
    }
    throw new Error(`The assetUrlPrefix option was of an unexpected type: ${JSON.stringify(assetUrlPrefix)}`);
}

function getFirstHeaderValue(value: string | string[] | undefined): string | undefined {
    const firstValue = Array.isArray(value) ? value[0] : value;
    return firstValue?.split(',')[0]?.trim();
}

export function getValidFormat(format?: unknown): ImageTransformFormat | undefined {
    if (typeof format !== 'string') {
        return undefined;
    }
    switch (format) {
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'webp':
        case 'avif':
            return format;
        default:
            return undefined;
    }
}

/**
 * Validates and normalizes a background color hex string.
 * Accepts 3, 4, 6, or 8 character hex strings (with or without `#` prefix).
 * Returns the normalized hex string with `#` prefix, or `undefined` if invalid.
 */
export function getValidBackgroundColor(input?: unknown): string | undefined {
    if (typeof input !== 'string' || input.length === 0) {
        return undefined;
    }
    const hex = input.startsWith('#') ? input.slice(1) : input;
    if (/^[0-9a-fA-F]{3,4}$|^[0-9a-fA-F]{6}$|^[0-9a-fA-F]{8}$/.test(hex)) {
        return `#${hex.toLowerCase()}`;
    }
    return undefined;
}
