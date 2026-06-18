import { BrandingOptions, StaticAssetDefinition, StaticAssetExtension } from './types';

/**
 * @description
 * A helper function to simplify the process of setting custom branding images.
 *
 * @example
 * ```ts
 * compileUiExtensions({
 *   outputPath: path.join(__dirname, '../admin-ui'),
 *   extensions: [
 *     setBranding({
 *       // This is used as the branding in the top-left above the navigation
 *       smallLogoPath: path.join(__dirname, 'images/my-logo-sm.png'),
 *       // This is used on the login page
 *       largeLogoPath: path.join(__dirname, 'images/my-logo-lg.png'),
 *       faviconPath: path.join(__dirname, 'images/my-favicon.ico'),
 *     }),
 *   ],
 * });
 * ```
 *
 * @docsCategory UiDevkit
 * @docsPage helpers
 */
export function setBranding(options: BrandingOptions): StaticAssetExtension {
    const staticAssets: StaticAssetDefinition[] = [];
    if (options.smallLogoPath) {
        staticAssets.push({
            path: options.smallLogoPath,
            rename: 'logo-top.webp',
        });
    }
    if (options.largeLogoPath) {
        staticAssets.push({
            path: options.largeLogoPath,
            rename: 'logo-login.webp',
        });
    }
    if (options.faviconPath) {
        staticAssets.push({
            path: options.faviconPath,
            rename: 'favicon.ico',
        });
    }
    return { staticAssets };
}
