import { setupI18n } from '@lingui/core';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { compile } from '../utils/compiler.js';
import { debugLogger, noopLogger } from '../utils/logger.js';
import { translationsPlugin } from '../vite-plugin-translations.js';

describe('detecting plugins with translations', () => {
    it('should detect plugins with translations', { timeout: 60_000 }, async () => {
        const tempDir = join(__dirname, './__temp/with-translations');
        await rm(tempDir, { recursive: true, force: true });
        const result = await compile({
            outputPath: tempDir,
            vendureConfigPath: join(__dirname, 'fixtures-with-translations', 'vendure-config.ts'),
            logger: process.env.LOG ? debugLogger : noopLogger,
        });

        expect(result.pluginInfo).toHaveLength(1);
        expect(result.pluginInfo[0].name).toBe('MyPlugin');
        expect(result.pluginInfo[0].dashboardEntryPath).toBe('./dashboard/index.tsx');
        expect(result.pluginInfo[0].sourcePluginPath).toBe(
            join(__dirname, 'fixtures-with-translations', 'src', 'my.plugin.ts'),
        );
        expect(result.pluginInfo[0].pluginPath).toBe(join(tempDir, 'src', 'my.plugin.js'));
    });
});

// #5131 — plugin (extension) catalogs assembled into `virtual:plugin-translations` must be
// compiled to Lingui's runtime message format. `@lingui/core` only registers a message
// compiler when `NODE_ENV !== 'production'`, so raw ICU source in that virtual module
// renders literally in a production dashboard build: `Hello {name}` instead of `Hello Bob`.
describe('plugin translation catalogs in virtual:plugin-translations', () => {
    const packageRoot = join(__dirname, '..', '..');
    const fixtureRoot = join(__dirname, 'fixtures-plugin-translations');

    async function loadVirtualModule(root: string = fixtureRoot): Promise<string> {
        const plugin = translationsPlugin({ packageRoot }) as any;
        const configLoaderStub = {
            name: 'vendure:config-loader',
            api: {
                getVendureConfig: () =>
                    Promise.resolve({
                        vendureConfig: {},
                        pluginInfo: [
                            {
                                name: 'TranslatedPlugin',
                                pluginPath: join(root, 'src', 'my.plugin.js'),
                                dashboardEntryPath: './dashboard/index.tsx',
                            },
                        ],
                    }),
            },
        };
        plugin.configResolved.call({}, { plugins: [configLoaderStub] });
        const ctx = {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            // Rollup's `PluginContext.error` throws; the plugin relies on that to abort.
            error: (message: string) => {
                throw new Error(message);
            },
        };
        const result = await plugin.load.call(ctx, '\0virtual:plugin-translations');
        expect(typeof result).toBe('string');
        return result as string;
    }

    function evaluateVirtualModule(code: string): Record<string, Record<string, unknown>> {
        // eslint-disable-next-line @typescript-eslint/no-implied-eval
        return new Function(code.replace('export default translations;', 'return translations;'))();
    }

    it('emits messages in the compiled Lingui format, not raw ICU source', async () => {
        const translations = evaluateVirtualModule(await loadVirtualModule());

        expect(translations.en['extension.greeting']).not.toBe('Hello {name}');
        expect(translations.en['extension.greeting']).toEqual(['Hello ', ['name']]);
        expect(translations.en['extension.itemCount']).toEqual([
            ['count', 'plural', { one: ['#', ' item'], other: ['#', ' items'] }],
        ]);
    });

    it('interpolates and pluralises in a production @lingui/core runtime', async () => {
        const translations = evaluateVirtualModule(await loadVirtualModule());

        const previousNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        try {
            // Constructed under NODE_ENV=production, so no runtime message compiler is
            // registered — exactly the state of a built dashboard bundle.
            const i18n = setupI18n();
            i18n.loadAndActivate({ locale: 'en', messages: translations.en as any });

            expect(i18n._('extension.greeting', { name: 'Bob' })).toBe('Hello Bob');
            expect(i18n._('extension.itemCount', { count: 1 })).toBe('1 item');
            expect(i18n._('extension.itemCount', { count: 3 })).toBe('3 items');
        } finally {
            process.env.NODE_ENV = previousNodeEnv;
        }
    });

    it('fails the build on malformed plugin ICU instead of emitting it silently', async () => {
        await expect(
            loadVirtualModule(join(__dirname, 'fixtures-plugin-translations-malformed')),
        ).rejects.toThrow(/extension\.broken/);
    });
});
