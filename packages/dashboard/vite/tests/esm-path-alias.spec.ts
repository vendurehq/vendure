import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';

describe('handling ESM projects with tsconfig path aliases', () => {
    it('should compile ESM project with path aliases', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/esm-path-alias');
        await rm(tempDir, { recursive: true, force: true });
        const result = await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-esm-path-alias', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
            module: 'esm',
            pathAdapter: {
                transformTsConfigPathMappings: ({ phase, patterns }) => {
                    if (phase === 'loading') {
                        // For loading phase, strip the fixtures directory prefix and convert extensions
                        return patterns.map(pattern => {
                            let transformed = pattern.replace(/\.\/fixtures-esm-path-alias\//, './');
                            transformed = transformed.replace(/.ts$/, '.js');
                            return transformed;
                        });
                    }
                    // For compiling phase, return patterns unchanged —
                    // the path transformer now uses original paths with path.relative()
                    return patterns;
                },
            },
        });

        expect(result.pluginInfo).toHaveLength(1);
        expect(result.pluginInfo[0].name).toBe('MyPlugin');
        expect(result.pluginInfo[0].dashboardEntryPath).toBe('./dashboard/index.tsx');
        // sourcePluginPath is resolved because the original tsconfig paths allow
        // the plugin discovery to follow the path alias to the source file
        expect(result.pluginInfo[0].sourcePluginPath).toBeDefined();
        expect(result.pluginInfo[0].pluginPath).toBe(join(tempDir, 'my-plugin', 'src', 'my.plugin.js'));
    });

    it('should resolve correct relative paths for nested files', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/esm-path-alias');
        await rm(tempDir, { recursive: true, force: true });
        await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-esm-path-alias', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
            module: 'esm',
            pathAdapter: {
                transformTsConfigPathMappings: ({ phase, patterns }) => {
                    if (phase === 'loading') {
                        return patterns.map(pattern => {
                            let transformed = pattern.replace(/\.\/fixtures-esm-path-alias\//, './');
                            transformed = transformed.replace(/.ts$/, '.js');
                            return transformed;
                        });
                    }
                    return patterns;
                },
            },
        });

        // Read the compiled helper.js from the nested services directory
        const helperJs = await readFile(join(tempDir, 'services', 'helper.js'), 'utf-8');

        // A file at services/helper.js importing @esm-plugins/my-plugin should resolve to
        // ../my-plugin/index.js (going up one level from services/), not ./my-plugin/index.js
        expect(helperJs).toContain('../my-plugin/index.js');
    });
});
