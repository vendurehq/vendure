import type { VendureConfig } from '@vendure/core';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { register } from 'ts-node';

import { selectTsConfigFile } from '../utilities/ast-utils.js';
import { isRunningInTsNode } from '../utilities/utils.js';

import { VendureConfigRef } from './vendure-config-ref.js';

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
    const configFilePath = vendureConfig.sourceFile.getFilePath();
    await prepareToRequireConfig(configFilePath, providedTsConfigPath);
    const exportedVarName = vendureConfig.getConfigObjectVariableName();
    if (!exportedVarName) {
        throw new Error('Could not find the exported variable name in the VendureConfig file');
    }
    // The ts-node hook registered above applies to `require` only, not to `import()`.
    const configModule = createRequire(import.meta.url)(configFilePath);
    return configModule[exportedVarName];
}

/**
 * Loads `.env`, and registers ts-node with the project's tsconfig and its path mappings, so the
 * project's TypeScript files, such as its migrations, can be required.
 */
export async function prepareToRequireProjectFiles(projectDir: string): Promise<void> {
    await prepareToRequireConfig(path.join(projectDir, 'package.json'));
}

/**
 * Requires a TypeScript or JavaScript module the way a config file is required: it loads `.env`,
 * and registers ts-node with the tsconfig nearest the file and its path mappings, first. Returns
 * the module's exports.
 */
export async function requireProjectModule(filePath: string): Promise<Record<string, unknown>> {
    await prepareToRequireConfig(filePath);
    return createRequire(import.meta.url)(filePath) as Record<string, unknown>;
}

/**
 * Loads the Vendure config from a known file, without parsing the project with ts-morph, which
 * takes seconds. The config is the export named `config`, or else the only export that has
 * `dbConnectionOptions`. Returns `undefined` when that does not identify one export, so the caller
 * can fall back to {@link loadVendureConfigFile}.
 */
export async function loadVendureConfigFromPath(configFilePath: string): Promise<VendureConfig | undefined> {
    const configModule = await requireProjectModule(configFilePath);
    if (isVendureConfig(configModule.config)) {
        return configModule.config;
    }
    const configs = Object.values(configModule).filter(isVendureConfig);
    return configs.length === 1 ? configs[0] : undefined;
}

/**
 * Whether a value is taken to be a `VendureConfig`: an object with a `dbConnectionOptions`
 * property. Nothing else is checked.
 */
export function isVendureConfig(value: unknown): value is VendureConfig {
    return typeof value === 'object' && value !== null && 'dbConnectionOptions' in value;
}

/**
 * Loads `.env`, and registers ts-node with the compiler options of the tsconfig nearest to the
 * config file, so the config can be required.
 */
async function prepareToRequireConfig(configFilePath: string, providedTsConfigPath?: string) {
    await import('dotenv/config');
    if (isRunningInTsNode()) {
        return;
    }
    // Find the nearest tsconfig to the actual VendureConfig file.
    // This is important in monorepos where each package has its own tsconfig
    // that may extend a base config with path mappings.
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

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
