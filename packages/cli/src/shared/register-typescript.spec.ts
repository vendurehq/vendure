import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ScriptTarget } from 'typescript/ast';
import type { CompilerOptions } from 'typescript/sync';
import { ModuleKind } from 'typescript/sync';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    findNearestTsConfig,
    getTranspileCompilerOptions,
    getTsConfigPathMappings,
} from './register-typescript';
import { getTypeScriptApi } from './typescript-api';

describe('register-typescript', () => {
    let tempDir: string;

    beforeEach(() => {
        // realpath because the TypeScript API returns resolved paths (e.g. /tmp on macOS is a symlink)
        tempDir = realpathSync(mkdtempSync(path.join(tmpdir(), 'vendure-cli-register-')));
    });

    afterEach(() => {
        rmSync(tempDir, { recursive: true, force: true });
    });

    function writeJson(filePath: string, value: unknown) {
        mkdirSync(path.dirname(filePath), { recursive: true });
        writeFileSync(filePath, JSON.stringify(value, null, 2));
    }

    describe('getTranspileCompilerOptions()', () => {
        it('removes options which do not apply to transpiling a single file', () => {
            const result = getTranspileCompilerOptions({
                outDir: '/project/dist',
                rootDir: '/project/src',
                declaration: true,
                composite: true,
                noEmit: true,
                sourceMap: true,
                paths: { '@x/*': ['./x/*'] },
                moduleResolution: 99,
                verbatimModuleSyntax: true,
                target: 9,
                strict: true,
            });

            expect(result).not.toHaveProperty('outDir');
            expect(result).not.toHaveProperty('rootDir');
            expect(result).not.toHaveProperty('declaration');
            expect(result).not.toHaveProperty('composite');
            expect(result).not.toHaveProperty('noEmit');
            expect(result).not.toHaveProperty('sourceMap');
            expect(result).not.toHaveProperty('paths');
            expect(result).not.toHaveProperty('moduleResolution');
            expect(result).not.toHaveProperty('verbatimModuleSyntax');
            expect(result.target).toBe(9);
            expect(result.strict).toBe(true);
        });

        it('always emits CommonJS with inline source maps', () => {
            const result = getTranspileCompilerOptions({ module: ModuleKind.NodeNext });

            expect(result.module).toBe(ModuleKind.CommonJS);
            expect(result.inlineSourceMap).toBe(true);
            expect(result.inlineSources).toBe(true);
        });

        it('enables decorators with metadata by default', () => {
            const result = getTranspileCompilerOptions({});

            expect(result.experimentalDecorators).toBe(true);
            expect(result.emitDecoratorMetadata).toBe(true);
        });

        it('respects decorator options set explicitly in the tsconfig', () => {
            const result = getTranspileCompilerOptions({
                experimentalDecorators: false,
                emitDecoratorMetadata: false,
            });

            expect(result.experimentalDecorators).toBe(false);
            expect(result.emitDecoratorMetadata).toBe(false);
        });
    });

    describe('class fields', () => {
        // Mirrors VendureEntity, whose constructor copies its input onto the instance
        const source = `
            class VendureEntity {
                constructor(input?: any) {
                    if (input) {
                        Object.assign(this, input);
                    }
                }
            }
            class Product extends VendureEntity {
                name: string;
            }
            module.exports = new Product({ name: 'kept' });
        `;

        function construct(compilerOptions: CompilerOptions): { name?: string } {
            const { outputText } = getTypeScriptApi().transpileModule(source, {
                fileName: path.join(tempDir, 'entity.ts'),
                compilerOptions: getTranspileCompilerOptions(compilerOptions),
            });
            const module = { exports: {} as { name?: string } };
            // eslint-disable-next-line @typescript-eslint/no-implied-eval
            new Function('module', 'exports', outputText)(module, module.exports);
            return module.exports;
        }

        it('keeps the constructor input of entity subclasses without a tsconfig target', () => {
            expect(construct({}).name).toBe('kept');
        });

        it('keeps the constructor input of entity subclasses with an ES2022 target', () => {
            expect(construct({ target: ScriptTarget.ES2022 }).name).toBe('kept');
        });

        it('respects useDefineForClassFields when the tsconfig sets it', () => {
            expect(
                getTranspileCompilerOptions({ useDefineForClassFields: true }).useDefineForClassFields,
            ).toBe(true);
            expect(construct({ useDefineForClassFields: true }).name).toBeUndefined();
        });
    });

    describe('findNearestTsConfig()', () => {
        it('finds a tsconfig.json in the start directory', () => {
            writeJson(path.join(tempDir, 'tsconfig.json'), {});

            expect(findNearestTsConfig(tempDir)).toBe(path.join(tempDir, 'tsconfig.json'));
        });

        it('finds the nearest tsconfig.json in a parent directory', () => {
            writeJson(path.join(tempDir, 'tsconfig.json'), {});
            writeJson(path.join(tempDir, 'packages', 'server', 'tsconfig.json'), {});
            const nestedDir = path.join(tempDir, 'packages', 'server', 'src', 'plugins');
            mkdirSync(nestedDir, { recursive: true });

            expect(findNearestTsConfig(nestedDir)).toBe(
                path.join(tempDir, 'packages', 'server', 'tsconfig.json'),
            );
        });

        it('ignores tsconfig files with other names', () => {
            writeJson(path.join(tempDir, 'tsconfig.json'), {});
            const appDir = path.join(tempDir, 'app');
            writeJson(path.join(appDir, 'tsconfig.build.json'), {});

            expect(findNearestTsConfig(appDir)).toBe(path.join(tempDir, 'tsconfig.json'));
        });
    });

    describe('getTsConfigPathMappings()', () => {
        it('returns undefined when the tsconfig has no paths', () => {
            const tsconfigPath = path.join(tempDir, 'tsconfig.json');
            writeJson(tsconfigPath, { compilerOptions: {} });

            expect(getTsConfigPathMappings(tsconfigPath)).toBeUndefined();
        });

        it('resolves paths relative to the tsconfig that declares them', () => {
            const tsconfigPath = path.join(tempDir, 'server', 'tsconfig.json');
            writeJson(tsconfigPath, { compilerOptions: { paths: { '@plugins/*': ['./src/plugins/*'] } } });

            expect(getTsConfigPathMappings(tsconfigPath)).toEqual({
                baseUrl: path.join(tempDir, 'server'),
                paths: { '@plugins/*': ['./src/plugins/*'] },
            });
        });

        it('resolves paths inherited through extends relative to the base config', () => {
            writeJson(path.join(tempDir, 'tsconfig.base.json'), {
                compilerOptions: { paths: { '@shared/*': ['./libs/shared/*'] } },
            });
            const tsconfigPath = path.join(tempDir, 'apps', 'server', 'tsconfig.json');
            writeJson(tsconfigPath, { extends: '../../tsconfig.base.json', compilerOptions: {} });

            expect(getTsConfigPathMappings(tsconfigPath)).toEqual({
                baseUrl: tempDir,
                paths: { '@shared/*': ['./libs/shared/*'] },
            });
        });

        it('uses the paths of the extending config, which replace the base paths', () => {
            writeJson(path.join(tempDir, 'tsconfig.base.json'), {
                compilerOptions: { paths: { '@shared/*': ['./libs/shared/*'] } },
            });
            const tsconfigPath = path.join(tempDir, 'apps', 'server', 'tsconfig.json');
            writeJson(tsconfigPath, {
                extends: '../../tsconfig.base.json',
                compilerOptions: { paths: { '@local/*': ['./src/*'] } },
            });

            expect(getTsConfigPathMappings(tsconfigPath)).toEqual({
                baseUrl: path.join(tempDir, 'apps', 'server'),
                paths: { '@local/*': ['./src/*'] },
            });
        });
    });
});
