/* eslint-disable no-console */
import chalk from 'chalk';
import { execSync } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';

import { STATIC_ASSETS_OUTPUT_DIR } from './constants';
import {
    AdminUiExtension,
    AdminUiExtensionWithId,
    Extension,
    GlobalStylesExtension,
    SassVariableOverridesExtension,
    StaticAssetDefinition,
    StaticAssetExtension,
    TranslationExtension,
} from './types';

export const logger = {
    log: (message: string) => console.log(chalk.green(message)),
    error: (message: string) => console.log(chalk.red(message)),
};

/**
 * Checks for the global yarn binary to determine whether to use yarn or npm.
 */
export function determinePackageManager(): 'yarn' | 'npm' {
    try {
        execSync('yarnpkg --version', { stdio: 'ignore' });
        return 'yarn';
    } catch (e: any) {
        return 'npm';
    }
}

/**
 * Returns the string path of a static asset
 */
export function getStaticAssetPath(staticAssetDef: StaticAssetDefinition): string {
    return typeof staticAssetDef === 'string' ? staticAssetDef : staticAssetDef.path;
}

/**
 * Copy the @vendure/ui-devkit files to the static assets dir.
 */
export function copyUiDevkit(outputPath: string) {
    const devkitDir = path.join(outputPath, STATIC_ASSETS_OUTPUT_DIR, 'devkit');
    fs.ensureDirSync(devkitDir);
    fs.copySync(require.resolve('@vendure/ui-devkit'), path.join(devkitDir, 'ui-devkit.js'));
}

/**
 * Copies over any files defined by the extensions' `staticAssets` array to the shared
 * static assets directory. When the app is built by the ng cli, this assets directory is
 * the copied over to the final static assets location (i.e. http://domain/admin/assets/)
 */
export async function copyStaticAsset(outputPath: string, staticAssetDef: StaticAssetDefinition) {
    const staticAssetPath = getStaticAssetPath(staticAssetDef);
    const assetBasename = path.basename(staticAssetPath);
    const assetOutputPath = path.join(outputPath, STATIC_ASSETS_OUTPUT_DIR, assetBasename);
    fs.copySync(staticAssetPath, assetOutputPath);
    if (typeof staticAssetDef !== 'string') {
        // The asset is being renamed
        const newName = path.join(path.dirname(assetOutputPath), staticAssetDef.rename);
        try {
            // We use copy, remove rather than rename due to problems with the
            // EPERM error in Windows.
            await fs.copy(assetOutputPath, newName);
            await fs.remove(assetOutputPath);
        } catch (e: any) {
            logger.log(e);
        }
    }
}

/**
 * Ensures each extension has an ID and a value for the optional properties.
 * If not defined by the user, a deterministic ID is generated
 * from a hash of the extension config.
 */
export function normalizeExtensions(extensions?: AdminUiExtension[]): AdminUiExtensionWithId[] {
    return (extensions || []).map(e => {
        let id = e.id;
        if (!id) {
            const hash = createHash('sha256');
            hash.update(JSON.stringify(e));
            id = hash.digest('hex');
        }

        return {
            staticAssets: [],
            translations: {},
            globalStyles: [],
            ...e,
            id,
        };
    });
}

export function isAdminUiExtension(input: Extension): input is AdminUiExtension {
    return input.hasOwnProperty('extensionPath');
}

export function isTranslationExtension(input: Extension): input is TranslationExtension {
    return input.hasOwnProperty('translations');
}

export function isStaticAssetExtension(input: Extension): input is StaticAssetExtension {
    return input.hasOwnProperty('staticAssets');
}

export function isGlobalStylesExtension(input: Extension): input is GlobalStylesExtension {
    return input.hasOwnProperty('globalStyles');
}

export function isSassVariableOverridesExtension(input: Extension): input is SassVariableOverridesExtension {
    return input.hasOwnProperty('sassVariableOverrides');
}
