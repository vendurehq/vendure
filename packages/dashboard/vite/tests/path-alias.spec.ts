import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';
import { clearRawTsConfigCache } from '../utils/tsconfig-utils.js';

const tempRoot = join(__dirname, './__temp');

beforeEach(() => {
    clearRawTsConfigCache();
});

describe('detecting plugins using tsconfig path aliases', () => {
    it('should detect plugins using tsconfig path aliases', { timeout: 60_000 }, async () => {
        const tempDir = join(tempRoot, 'path-alias');
        await rm(tempDir, { recursive: true, force: true });

        const result = await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-path-alias', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
            pathAdapter: {
                transformTsConfigPathMappings: ({ phase, patterns }) => {
                    if (phase === 'loading') {
                        return patterns.map(pattern => {
                            return pattern.replace(/\/fixtures-path-alias/, '').replace(/.ts$/, '.js');
                        });
                    } else {
                        return patterns;
                    }
                },
            },
        });

        const plugins = result.pluginInfo.sort((a, b) => a.name.localeCompare(b.name));

        expect(plugins).toHaveLength(3);

        expect(plugins[0].name).toBe('JsAliasedPlugin');
        expect(plugins[0].dashboardEntryPath).toBe('./dashboard/index.tsx');
        expect(plugins[0].sourcePluginPath).toBe(
            join(__dirname, 'fixtures-path-alias', 'js-aliased', 'src', 'js-aliased.plugin.ts'),
        );
        expect(plugins[0].pluginPath).toBe(join(tempDir, 'js-aliased', 'src', 'js-aliased.plugin.js'));

        expect(plugins[1].name).toBe('StarAliasedPlugin');
        expect(plugins[1].dashboardEntryPath).toBe('./dashboard/index.tsx');
        expect(plugins[1].sourcePluginPath).toBe(
            join(__dirname, 'fixtures-path-alias', 'star-aliased', 'src', 'star-aliased.plugin.ts'),
        );
        expect(plugins[1].pluginPath).toBe(join(tempDir, 'star-aliased', 'src', 'star-aliased.plugin.js'));

        expect(plugins[2].name).toBe('TsAliasedPlugin');
        expect(plugins[2].dashboardEntryPath).toBe('./dashboard/index.tsx');
        expect(plugins[2].sourcePluginPath).toBe(
            join(__dirname, 'fixtures-path-alias', 'ts-aliased', 'src', 'ts-aliased.plugin.ts'),
        );
        expect(plugins[2].pluginPath).toBe(join(tempDir, 'ts-aliased', 'src', 'ts-aliased.plugin.js'));
    });
});

describe('compile() invokes PathAdapter for both phases', () => {
    it(
        'should call transformTsConfigPathMappings with both compiling and loading phases',
        { timeout: 60_000 },
        async () => {
            const tempDir = join(tempRoot, 'path-alias-phases');
            await rm(tempDir, { recursive: true, force: true });

            const transform = vi.fn(({ phase, patterns }) => {
                if (phase === 'loading') {
                    return patterns.map((pattern: string) => {
                        return pattern.replace(/\/fixtures-path-alias/, '').replace(/.ts$/, '.js');
                    });
                }
                return patterns;
            });

            await compile({
                outputPath: tempDir,
                vendureConfigPath: join(__dirname, 'fixtures-path-alias', 'vendure-config.ts'),
                logger: process.env.LOG ? debugLogger : noopLogger,
                pathAdapter: { transformTsConfigPathMappings: transform },
            });

            const phases = new Set(transform.mock.calls.map(call => call[0].phase));
            expect(phases).toContain('compiling');
            expect(phases).toContain('loading');
        },
    );
});
