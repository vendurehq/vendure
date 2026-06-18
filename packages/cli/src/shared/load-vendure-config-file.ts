import { VendureConfig } from '@vendure/core';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { register } from 'ts-node';

import { selectTsConfigFile } from '../utilities/ast-utils';
import { isRunningInTsNode } from '../utilities/utils';

import { VendureConfigRef } from './vendure-config-ref';

/**
 * Finds the nearest tsconfig.json file by walking up the directory tree from the given file path.
 * This ensures we use the package-level tsconfig that would actually be used to compile the file,
 * which is especially important in monorepo structures where each package may have its own tsconfig
 * that extends a base config with path mappings.
 */
function findNearestTsConfig(startPath: string): string | null {
    let currentDir = path.dirname(startPath);
    const root = path.parse(currentDir).root;

    while (currentDir !== root) {
        const tsConfigPath = path.join(currentDir, 'tsconfig.json');
        if (existsSync(tsConfigPath)) {
            return tsConfigPath;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            // Reached filesystem root
            break;
        }
        currentDir = parentDir;
    }

    return null;
}

/**
 * Recursively resolves a tsconfig file, following the `extends` chain and merging configurations.
 * This ensures that path mappings and other compiler options from base configs are properly included.
 */
async function resolveTsConfigWithExtends(tsConfigPath: string): Promise<any> {
    let tsConfigFileContent: string;
    let tsConfigJson: any;

    try {
        tsConfigFileContent = readFileSync(tsConfigPath, 'utf-8');
    } catch (error: unknown) {
        throw new Error(
            `Failed to read TypeScript config file at ${tsConfigPath}: ${getErrorMessage(error)}`,
        );
    }

    try {
        const { default: stripJsonComments } = await import('strip-json-comments');
        tsConfigJson = JSON.parse(stripJsonComments(tsConfigFileContent));
    } catch (error: unknown) {
        throw new Error(
            `Failed to parse TypeScript config file at ${tsConfigPath}: ${getErrorMessage(error)}`,
        );
    }

    // If this config extends another, recursively resolve the base config(s)
    if (tsConfigJson.extends) {
        const extendsArray = Array.isArray(tsConfigJson.extends)
            ? tsConfigJson.extends
            : [tsConfigJson.extends];

        let mergedBaseConfig: any = {};

        for (const extendsPath of extendsArray) {
            // Resolve the base config path relative to the current config's directory
            const baseConfigPath = path.resolve(path.dirname(tsConfigPath), extendsPath);
            const baseConfig = await resolveTsConfigWithExtends(baseConfigPath);

            // Merge base configs (later extends take precedence over earlier ones)
            mergedBaseConfig = deepMergeConfigs(mergedBaseConfig, baseConfig);
        }

        // Merge the base config with the current config (current config takes precedence)
        return deepMergeConfigs(mergedBaseConfig, tsConfigJson);
    }

    return tsConfigJson;
}

/**
 * Deep merges two tsconfig objects, with special handling for compilerOptions.paths.
 * The `current` config takes precedence over the `base` config.
 */
function deepMergeConfigs(base: any, current: any): any {
    const result = { ...base };

    for (const key of Object.keys(current)) {
        if (key === 'compilerOptions' && base.compilerOptions) {
            result.compilerOptions = {
                ...base.compilerOptions,
                ...current.compilerOptions,
            };

            // Special handling for paths: merge both base and current paths
            if (base.compilerOptions?.paths || current.compilerOptions?.paths) {
                result.compilerOptions.paths = {
                    ...base.compilerOptions?.paths,
                    ...current.compilerOptions?.paths,
                };
            }
        } else if (key !== 'extends') {
            // Don't include 'extends' in the merged result
            result[key] = current[key];
        }
    }

    return result;
}

export async function loadVendureConfigFile(
    vendureConfig: VendureConfigRef,
    providedTsConfigPath?: string,
): Promise<VendureConfig> {
    await import('dotenv/config');
    if (!isRunningInTsNode()) {
        // Find the nearest tsconfig to the actual VendureConfig file.
        // This is important in monorepos where each package has its own tsconfig
        // that may extend a base config with path mappings.
        const configFilePath = vendureConfig.sourceFile.getFilePath();
        const nearestTsConfig = findNearestTsConfig(configFilePath);

        let tsConfigPath: string;
        if (nearestTsConfig) {
            // Prefer the nearest tsconfig (package-level config)
            tsConfigPath = nearestTsConfig;
        } else if (providedTsConfigPath) {
            // Fall back to provided path
            tsConfigPath = providedTsConfigPath;
        } else {
            // Last resort: select from cwd
            const tsConfigFile = selectTsConfigFile();
            tsConfigPath = path.join(process.cwd(), tsConfigFile);
        }

        const tsConfigJson = await resolveTsConfigWithExtends(tsConfigPath);
        const compilerOptions = tsConfigJson.compilerOptions;

        register({
            compilerOptions: { ...compilerOptions, moduleResolution: 'NodeNext', module: 'NodeNext' },
            transpileOnly: true,
        });

        if (compilerOptions.paths) {
            const tsConfigPaths = await import('tsconfig-paths');
            tsConfigPaths.register({
                baseUrl: './',
                paths: compilerOptions.paths,
            });
        }
    }
    const exportedVarName = vendureConfig.getConfigObjectVariableName();
    if (!exportedVarName) {
        throw new Error('Could not find the exported variable name in the VendureConfig file');
    }
    const configModule = await import(vendureConfig.sourceFile.getFilePath());
    return configModule[exportedVarName];
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
