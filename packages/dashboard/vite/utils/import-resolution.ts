import fs from 'fs-extra';
import path from 'node:path';

import { TsConfigPathsConfig } from './tsconfig-utils.js';

/**
 * Resolves a file path to an actual source file on disk, trying various
 * extensions and index files (mimicking Node.js module resolution).
 */
export async function resolveSourceFile(filePath: string): Promise<string | undefined> {
    const candidates = [
        filePath,
        filePath + '.ts',
        filePath + '.tsx',
        filePath + '.js',
        filePath + '.jsx',
        path.join(filePath, 'index.ts'),
        path.join(filePath, 'index.tsx'),
        path.join(filePath, 'index.js'),
    ];
    if (filePath.endsWith('.js')) {
        candidates.push(filePath.replace(/\.js$/, '.ts'), filePath.replace(/\.js$/, '.tsx'));
    }
    for (const candidate of candidates) {
        try {
            const stat = await fs.stat(candidate);
            if (stat.isFile()) return candidate;
        } catch {
            continue;
        }
    }
    return undefined;
}

/**
 * Given an import specifier and tsconfig path aliases, returns an array
 * of potential file paths that the import might resolve to.
 *
 * Only matches path aliases — relative imports and npm packages are not handled.
 */
export function resolvePathAliasImports(importPath: string, tsConfigInfo?: TsConfigPathsConfig): string[] {
    if (!tsConfigInfo) {
        return [];
    }
    const resolved: string[] = [];
    for (const [alias, patterns] of Object.entries(tsConfigInfo.paths)) {
        const hasWildcard = alias.includes('*');
        const prefix = hasWildcard ? alias.replace(/\*$/, '') : alias;
        const isMatch = hasWildcard ? importPath.startsWith(prefix) : importPath === alias;
        if (!isMatch) {
            continue;
        }
        const suffix = hasWildcard ? importPath.slice(prefix.length) : '';
        for (const pattern of patterns) {
            const target = hasWildcard ? pattern.replace(/\*$/, '') : pattern;
            resolved.push(path.resolve(tsConfigInfo.baseUrl, target, suffix));
        }
    }
    return resolved;
}
