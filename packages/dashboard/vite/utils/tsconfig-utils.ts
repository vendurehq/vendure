import fs from 'fs-extra';
import path from 'node:path';
import stripJsonComments from 'strip-json-comments';
import { CompilerOptions } from 'typescript';

import { Logger, TransformTsConfigPathMappingsFn } from '../types.js';

export interface TsConfigPathsConfig {
    baseUrl: string;
    paths: Record<string, string[]>;
}

interface RawTsConfigResult {
    dir: string;
    rawPaths: Required<CompilerOptions>['paths'];
    baseUrl: string;
}

const rawTsConfigCache = new Map<string, RawTsConfigResult | undefined>();

/** Clears the internal tsconfig cache. Intended for test isolation. */
export function clearRawTsConfigCache() {
    rawTsConfigCache.clear();
}

/**
 * Finds the raw tsconfig data (directory traversal + file reading) and caches
 * the result so repeated calls with the same configPath skip the filesystem work.
 */
async function findRawTsConfig(configPath: string, logger: Logger): Promise<RawTsConfigResult | undefined> {
    if (rawTsConfigCache.has(configPath)) {
        return rawTsConfigCache.get(configPath);
    }

    let currentDir = path.dirname(configPath);

    while (currentDir !== path.parse(currentDir).root) {
        try {
            const files = await fs.readdir(currentDir);
            const tsConfigFiles = files.filter(file => /^tsconfig(\..*)?\.json$/.test(file));

            for (const fileName of tsConfigFiles) {
                const tsConfigFilePath = path.join(currentDir, fileName);
                try {
                    const { paths, baseUrl } = await getCompilerOptionsFromFile(tsConfigFilePath);
                    if (paths) {
                        const result: RawTsConfigResult = {
                            dir: currentDir,
                            rawPaths: paths,
                            baseUrl: baseUrl || '.',
                        };
                        rawTsConfigCache.set(configPath, result);
                        return result;
                    }
                } catch (e) {
                    logger.warn(
                        `Could not read or parse tsconfig file ${tsConfigFilePath}: ${e instanceof Error ? e.message : String(e)}`,
                    );
                }
            }
        } catch (e) {
            logger.warn(
                `Could not read directory ${currentDir}: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        currentDir = path.dirname(currentDir);
    }

    rawTsConfigCache.set(configPath, undefined);
    return undefined;
}

/**
 * Finds and parses tsconfig files in the given directory and its parent directories.
 */
export async function findTsConfigPaths(
    configPath: string,
    logger: Logger,
    phase: 'compiling' | 'loading',
    transformTsConfigPathMappings: TransformTsConfigPathMappingsFn,
): Promise<TsConfigPathsConfig | undefined> {
    const raw = await findRawTsConfig(configPath, logger);
    if (!raw) {
        return undefined;
    }
    const tsConfigBaseUrl = path.resolve(raw.dir, raw.baseUrl);
    const pathMappings = getTransformedPathMappings(raw.rawPaths, phase, transformTsConfigPathMappings);
    return { baseUrl: tsConfigBaseUrl, paths: pathMappings };
}

async function getCompilerOptionsFromFile(tsConfigFilePath: string): Promise<CompilerOptions> {
    const tsConfigContent = await fs.readFile(tsConfigFilePath, 'utf-8');
    const tsConfig = JSON.parse(stripJsonComments(tsConfigContent));
    return tsConfig.compilerOptions || {};
}

function getTransformedPathMappings(
    paths: Required<CompilerOptions>['paths'],
    phase: 'compiling' | 'loading',
    transformTsConfigPathMappings: TransformTsConfigPathMappingsFn,
) {
    const pathMappings: Record<string, string[]> = {};

    for (const [alias, patterns] of Object.entries(paths)) {
        const normalizedPatterns = patterns.map(pattern => pattern.replace(/\\/g, '/'));
        pathMappings[alias] = transformTsConfigPathMappings({
            phase,
            alias,
            patterns: normalizedPatterns,
        });
    }
    return pathMappings;
}
