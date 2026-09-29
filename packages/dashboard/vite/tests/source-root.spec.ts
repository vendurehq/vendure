import fs from 'fs-extra';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path, { posix, win32 } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import type { Logger } from '../types.js';
import { commonAncestorDir, compile, resolveDefaultSourceRoot } from '../utils/compiler.js';

// #5086 — the source root defaulted to the config's own directory, so a config
// importing from above it produced a relative path with a leading `..` and the
// compiled file was written outside outputPath, past the package.json the
// compiler writes there to declare the module type.

interface RecordingLogger extends Logger {
    errors: string[];
    warns: string[];
}

function createRecordingLogger(): RecordingLogger {
    const logger = { errors: [], warns: [] };
    return {
        ...logger,
        info: () => undefined,
        debug: () => undefined,
        warn: (message: string) => logger.warns.push(message),
        error: (message: string) => logger.errors.push(message),
    };
}

function listFiles(dir: string): string[] {
    if (!fs.existsSync(dir)) {
        return [];
    }
    const files: string[] = [];
    const walk = (current: string) => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const entryPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                walk(entryPath);
            } else {
                files.push(path.relative(dir, entryPath).split(path.sep).join('/'));
            }
        }
    };
    walk(dir);
    return files.sort();
}

// Plugin discovery can log unrelated resolution notes on some setups; what
// must stay silent is the #5086 load-time symptom an escaped emit produces.
function expectNoEscapeSymptom(logger: RecordingLogger): void {
    expect(logger.errors.join('\n')).not.toMatch(/exports is not defined|Error loading config/);
}

async function removeDirs(...dirs: string[]): Promise<void> {
    for (const dir of dirs) {
        await fs.remove(dir);
    }
}

async function createProject(imported: 'above' | 'below', options?: { alias?: boolean }) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-'));
    const importPath = imported === 'above' ? '../shared/util.js' : './lib/util.js';
    const utilPath =
        imported === 'above'
            ? path.join(root, 'shared', 'util.ts')
            : path.join(root, 'src', 'lib', 'util.ts');

    // Alias fixture: the tsconfig lives next to the config and maps an alias
    // into a sibling directory of itself, the standard setup whose resolution
    // depends on where baseUrl lands in the emitted layout.
    if (options?.alias) {
        await fs.outputFile(
            path.join(root, 'src', 'plugins', 'foo.ts'),
            'export const pluginName = "foo-plugin";\n',
        );
        await fs.outputJson(path.join(root, 'src', 'tsconfig.json'), {
            compilerOptions: { baseUrl: '.', paths: { '@plugins/*': ['plugins/*'] } },
        });
    }

    await fs.outputFile(utilPath, 'export const hostname = "shop.example.com";\n');
    await fs.outputFile(
        path.join(root, 'src', 'vendure-config.ts'),
        [
            `import type { VendureConfig } from '@vendure/core';`,
            ...(options?.alias ? [`import { pluginName } from '@plugins/foo';`] : []),
            `import { hostname } from '${importPath}';`,
            options?.alias
                ? `export const config: VendureConfig = { apiOptions: { port: 3000, hostname }, pluginName } as any;`
                : `export const config: VendureConfig = { apiOptions: { port: 3000, hostname } } as any;`,
        ].join('\n'),
    );

    return { root, configPath: path.join(root, 'src', 'vendure-config.ts') };
}

async function compileProject(configPath: string, options?: { sourceRoot?: string; id?: string }) {
    const id = options?.id ?? randomUUID();
    const outputRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-out-'));
    // Nested, as in production: <tempCompilationDir>/compiler/<id>
    const outputPath = path.join(outputRoot, 'compiler', id);
    // An ESM scope above outputPath is what makes an escaped emit fail to
    // load in production (#5086). Without it, an escaped file resolves as
    // CommonJS and only the layout assertions would catch the escape.
    await fs.outputFile(path.join(outputRoot, 'compiler', 'package.json'), '{"type":"module"}');

    const logger = createRecordingLogger();
    try {
        const result = await compile({
            vendureConfigPath: configPath,
            outputPath,
            logger,
            ...(options?.sourceRoot ? { pathAdapter: { sourceRoot: options.sourceRoot } } : {}),
        });
        return { outputRoot, outputPath, result, logger };
    } catch (error) {
        await removeDirs(outputRoot);
        throw error;
    }
}

describe('commonAncestorDir', () => {
    it('returns the deepest shared directory', () => {
        expect(commonAncestorDir(['/projects/shop/src', '/projects/shop/shared'], posix)).toBe(
            '/projects/shop',
        );
    });

    it('returns the filesystem root when that is all the paths share', () => {
        expect(commonAncestorDir(['/alpha', '/beta'], posix)).toBe('/');
    });

    it('returns undefined for an empty list', () => {
        expect(commonAncestorDir([])).toBeUndefined();
    });

    // Windows path casing is not stable in practice: process.cwd(), a resolved
    // relative import and a tsconfig path alias can each report a different
    // drive letter or segment casing for the same directory. Passing win32
    // explicitly keeps these covered when the suite runs on Linux.
    describe('with Windows paths', () => {
        it('ignores drive letter casing', () => {
            expect(commonAncestorDir(['C:\\repo\\app\\src', 'c:\\repo\\shared'], win32)).toBe('C:\\repo');
        });

        it('ignores segment casing rather than widening to the drive root', () => {
            expect(commonAncestorDir(['C:\\Repo\\app\\src', 'C:\\repo\\shared'], win32)).toBe('C:\\Repo');
        });

        it('returns the drive root when that is all the paths share', () => {
            expect(commonAncestorDir(['C:\\alpha', 'C:\\beta'], win32)).toBe('C:\\');
        });

        it('returns undefined across different drives', () => {
            expect(commonAncestorDir(['C:\\a', 'D:\\b'], win32)).toBeUndefined();
        });
    });
});

describe('resolveDefaultSourceRoot', () => {
    it('fails with a dedicated error when the files span multiple roots', () => {
        // Cross-drive layouts cannot be constructed portably on a POSIX CI,
        // so the win32 implementation is injected instead.
        expect(() => resolveDefaultSourceRoot('C:\\repo\\app\\src', ['D:\\shared'], win32)).toThrow(
            /multiple filesystem roots/,
        );
    });
});

describe('#5086 compiler source root', () => {
    it(
        'keeps a config importing from above its directory inside outputPath',
        { timeout: 60_000 },
        async () => {
            const { root, configPath } = await createProject('above');
            let outputRoot: string | undefined;
            try {
                const { outputRoot: outRoot, outputPath, result, logger } = await compileProject(configPath);
                outputRoot = outRoot;

                expect(listFiles(outputPath)).toEqual([
                    'package.json',
                    'shared/util.js',
                    'src/vendure-config.js',
                ]);
                // Reaching a loaded config proves the compiled config was imported
                // from its nested emit location rather than the output root.
                expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');
                expectNoEscapeSymptom(logger);
            } finally {
                await removeDirs(outputRoot ?? '', root);
            }
        },
    );

    // tsconfig path patterns resolve relative to the tsconfig's own baseUrl.
    // Once the root widens, that directory sits deeper inside the emit, so the
    // runtime registration must re-express baseUrl in emitted coordinates or
    // every alias import fails to load ("Cannot find module '@plugins/foo'").
    it(
        'resolves tsconfig path aliases against the emitted layout when the root widens',
        { timeout: 60_000 },
        async () => {
            const { root, configPath } = await createProject('above', { alias: true });
            let outputRoot: string | undefined;
            try {
                const { outputRoot: outRoot, outputPath, result, logger } = await compileProject(configPath);
                outputRoot = outRoot;

                expect(listFiles(outputPath)).toEqual([
                    'package.json',
                    'shared/util.js',
                    'src/plugins/foo.js',
                    'src/vendure-config.js',
                ]);
                // Loading through the alias proves the remapped baseUrl resolved
                // '@plugins/foo' to its nested emit location.
                expect(result.vendureConfig.pluginName).toBe('foo-plugin');
                expectNoEscapeSymptom(logger);
            } finally {
                await removeDirs(outputRoot ?? '', root);
            }
        },
    );

    it(
        'leaves the layout unchanged when every import is at or below the config',
        { timeout: 60_000 },
        async () => {
            const { root, configPath } = await createProject('below');
            let outputRoot: string | undefined;
            try {
                const { outputRoot: outRoot, outputPath, result, logger } = await compileProject(configPath);
                outputRoot = outRoot;

                expect(listFiles(outputPath)).toEqual(['lib/util.js', 'package.json', 'vendure-config.js']);
                expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');
                expectNoEscapeSymptom(logger);
                expect(logger.warns.filter(w => w.includes('widened'))).toEqual([]);
            } finally {
                await removeDirs(outputRoot ?? '', root);
            }
        },
    );

    it(
        'logs a warning when the default root widens above the config directory',
        { timeout: 60_000 },
        async () => {
            const { root, configPath } = await createProject('above');
            let outputRoot: string | undefined;
            try {
                const { outputRoot: outRoot, logger } = await compileProject(configPath);
                outputRoot = outRoot;

                expect(logger.warns.filter(w => w.includes('widened'))).toHaveLength(1);
                expect(logger.warns.find(w => w.includes('widened'))).toContain('Source root widened');
            } finally {
                await removeDirs(outputRoot ?? '', root);
            }
        },
    );

    it('still honours an explicit pathAdapter.sourceRoot', { timeout: 60_000 }, async () => {
        const { root, configPath } = await createProject('above');
        let outputRoot: string | undefined;
        try {
            const {
                outputRoot: outRoot,
                outputPath,
                result,
                logger,
            } = await compileProject(configPath, {
                sourceRoot: root,
            });
            outputRoot = outRoot;

            expect(listFiles(outputPath)).toEqual([
                'package.json',
                'shared/util.js',
                'src/vendure-config.js',
            ]);
            expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');
            // An explicit root is the adapter author's deliberate layout
            // choice, so it must not be reported as an implicit widening.
            expect(logger.warns.filter(w => w.includes('widened'))).toEqual([]);
        } finally {
            await removeDirs(outputRoot ?? '', root);
        }
    });

    it("honours a custom adapter's compiled-config path alongside an explicit widened root", async () => {
        const { root, configPath } = await createProject('above');
        let outputRoot: string | undefined;
        try {
            const {
                outputRoot: outRoot,
                outputPath,
                result,
            } = await compileProject(configPath, {
                sourceRoot: root,
            });
            outputRoot = outRoot;

            // A custom adapter owns where the config is imported from; the
            // compiler must call it instead of deriving the nested default.
            const getCompiledConfigPath = vi.fn(
                ({ outputPath: out, configFileName }: { outputPath: string; configFileName: string }) =>
                    path.join(out, 'src', configFileName),
            );
            const adapted = await compile({
                vendureConfigPath: configPath,
                outputPath,
                logger: createRecordingLogger(),
                pathAdapter: { sourceRoot: root, getCompiledConfigPath },
            });

            expect(getCompiledConfigPath).toHaveBeenCalledTimes(1);
            expect(getCompiledConfigPath.mock.calls[0][0]).toEqual({
                inputRootDir: path.dirname(configPath),
                outputPath,
                configFileName: 'vendure-config.ts',
            });
            // The adapter's return value is what gets imported: pointing it
            // at the emitted file loads the real config through the branch.
            expect(adapted.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');
            expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');
        } finally {
            await removeDirs(outputRoot ?? '', root);
        }
    });

    it('does not mistake a leading-dot filename for an escape', { timeout: 60_000 }, async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-'));
        let outputRoot: string | undefined;
        try {
            await fs.outputFile(
                path.join(root, 'src', '..util.ts'),
                'export const hostname = "shop.example.com";\n',
            );
            await fs.outputFile(
                path.join(root, 'src', 'vendure-config.ts'),
                [
                    `import type { VendureConfig } from '@vendure/core';`,
                    `import { hostname } from './..util.js';`,
                    `export const config: VendureConfig = { apiOptions: { port: 3000, hostname } } as any;`,
                ].join('\n'),
            );

            const {
                outputRoot: outRoot,
                outputPath,
                result,
            } = await compileProject(path.join(root, 'src', 'vendure-config.ts'));
            outputRoot = outRoot;

            expect(listFiles(outputPath)).toEqual(['..util.js', 'package.json', 'vendure-config.js']);
            expect(result.vendureConfig.apiOptions?.hostname).toBe('shop.example.com');
        } finally {
            await removeDirs(outputRoot ?? '', root);
        }
    });

    it(
        'rejects an explicit sourceRoot excluding an imported file and writes nothing outside outputPath',
        { timeout: 60_000 },
        async () => {
            const { root, configPath } = await createProject('above');
            let outputRoot: string | undefined;
            try {
                const id = 'rejected-case';
                const outputRootTmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vendure-source-root-out-'));
                outputRoot = outputRootTmp;
                const outputPath = path.join(outputRootTmp, 'compiler', id);
                await fs.outputFile(
                    path.join(outputRootTmp, 'compiler', 'package.json'),
                    '{"type":"module"}',
                );
                const logger = createRecordingLogger();

                await expect(
                    compile({
                        vendureConfigPath: configPath,
                        outputPath,
                        logger,
                        pathAdapter: { sourceRoot: path.join(root, 'src') },
                    }),
                ).rejects.toThrow(/outside the output directory/);

                // Rejecting is only half of it: nothing may be written on the way
                // to the error. Only the ESM guard fixture remains beside outputPath.
                expect(listFiles(path.dirname(outputPath))).toEqual(['package.json']);
                expect(listFiles(outputPath)).toEqual([]);
            } finally {
                await removeDirs(outputRoot ?? '', root);
            }
        },
    );
});
