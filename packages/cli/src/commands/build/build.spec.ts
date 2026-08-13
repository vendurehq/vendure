import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    buildCommand,
    getBuildCleanPathsForTarget,
    getBuildProcessDefinitions,
    getBuildProcessGroupsForTarget,
    getBuildProcessesForTarget,
    getBuildTsConfigsForTarget,
    getTsConfigOutDir,
    normalizeBuildTarget,
    resolveBuildTsConfigs,
    shouldUseMultiBuildSpinner,
    shouldUseProgress,
    validateTsConfig,
} from './build';

const originalCwd = process.cwd();
const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function createTempDir() {
    return mkdtempSync(path.join(tmpdir(), 'vendure-cli-build-'));
}

function writeJsonFile(filePath: string, value: unknown) {
    writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writePackageBin(projectDir: string, packageName: string, binName: string, script: string) {
    const packageDir = path.join(projectDir, 'node_modules', ...packageName.split('/'));
    mkdirSync(packageDir, { recursive: true });
    writeJsonFile(path.join(packageDir, 'package.json'), {
        name: packageName,
        version: '0.0.0',
        bin: {
            [binName]: `./${binName}.js`,
        },
    });
    writeFileSync(path.join(packageDir, `${binName}.js`), script);
}

function setStdoutIsTTY(isTTY: boolean) {
    Object.defineProperty(process.stdout, 'isTTY', {
        configurable: true,
        value: isTTY,
    });
}

afterEach(() => {
    process.chdir(originalCwd);
    if (stdoutIsTTYDescriptor) {
        Object.defineProperty(process.stdout, 'isTTY', stdoutIsTTYDescriptor);
    } else {
        delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY;
    }
    vi.unstubAllEnvs();
});

describe('build command', () => {
    describe('buildCommand()', () => {
        it('preserves the first failing target exit code when stopping remaining builds', async () => {
            const dir = createTempDir();
            try {
                writeJsonFile(path.join(dir, 'package.json'), {
                    dependencies: {
                        '@vendure/core': '0.0.0',
                    },
                });
                writeFileSync(path.join(dir, 'index.ts'), 'export const value = 1;\n');
                writeJsonFile(path.join(dir, 'tsconfig.server.json'), {
                    compilerOptions: {},
                    include: ['index.ts'],
                });
                writeJsonFile(path.join(dir, 'tsconfig.worker.json'), {
                    compilerOptions: {},
                    include: ['index.ts'],
                });
                writePackageBin(
                    dir,
                    'typescript',
                    'tsc',
                    [
                        "if (process.argv.includes('./tsconfig.server.json')) {",
                        '    setTimeout(() => process.exit(2), 20);',
                        '} else {',
                        "    process.on('SIGTERM', () => process.exit(0));",
                        '    setTimeout(() => process.exit(0), 30000);',
                        '}',
                    ].join('\n'),
                );
                writePackageBin(dir, 'vite', 'vite', 'process.exit(0);\n');

                process.chdir(dir);

                await expect(buildCommand('all', { noProgress: true })).resolves.toBe(2);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('builds the dashboard before TypeScript outputs can be emitted to the same directory', async () => {
            const dir = createTempDir();
            try {
                writeJsonFile(path.join(dir, 'package.json'), {
                    dependencies: {
                        '@vendure/core': '0.0.0',
                    },
                });
                writeFileSync(path.join(dir, 'index.ts'), 'export const value = 1;\n');
                writeJsonFile(path.join(dir, 'tsconfig.json'), {
                    compilerOptions: {
                        outDir: './dist',
                    },
                    include: ['index.ts'],
                });
                writePackageBin(
                    dir,
                    'typescript',
                    'tsc',
                    [
                        "const fs = require('node:fs');",
                        "const path = require('node:path');",
                        "const outDir = path.join(process.cwd(), 'dist');",
                        'fs.mkdirSync(outDir, { recursive: true });',
                        "fs.writeFileSync(path.join(outDir, 'index.js'), 'server');",
                        'process.exit(0);',
                    ].join('\n'),
                );
                writePackageBin(
                    dir,
                    'vite',
                    'vite',
                    [
                        "const fs = require('node:fs');",
                        "const path = require('node:path');",
                        'setTimeout(() => {',
                        "    const outDir = path.join(process.cwd(), 'dist');",
                        '    fs.rmSync(outDir, { recursive: true, force: true });',
                        '    fs.mkdirSync(outDir, { recursive: true });',
                        "    fs.writeFileSync(path.join(outDir, 'dashboard.html'), 'dashboard');",
                        '    process.exit(0);',
                        '}, 20);',
                    ].join('\n'),
                );

                process.chdir(dir);

                await expect(buildCommand('all', { noProgress: true })).resolves.toBe(0);
                expect(existsSync(path.join(dir, 'dist', 'index.js'))).toBe(true);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('getBuildProcessDefinitions()', () => {
        it('uses tsc by default', () => {
            const definitions = getBuildProcessDefinitions();

            expect(definitions.server.packageName).toBe('typescript');
            expect(definitions.server.binName).toBe('tsc');
            expect(definitions.server.args).toEqual(['-p', './tsconfig.json', '--noEmitOnError']);
            expect(definitions.dashboard.args).toEqual(['build', '--logLevel', 'warn']);
        });

        it('uses watch mode for server, worker and Dashboard builds', () => {
            const definitions = getBuildProcessDefinitions({
                watch: true,
            });

            expect(definitions.server.args).toEqual(['-p', './tsconfig.json', '--noEmitOnError', '--watch']);
            expect(definitions.worker.args).toEqual(['-p', './tsconfig.json', '--noEmitOnError', '--watch']);
            expect(definitions.dashboard.args).toEqual(['build', '--watch', '--logLevel', 'warn']);
            expect(definitions.server.captureOutput).toBe(false);
            expect(definitions.dashboard.captureOutput).toBe(false);
        });

        it('passes emptyOutDir to Vite when cleaning Dashboard builds', () => {
            const definitions = getBuildProcessDefinitions({
                clean: true,
            });

            expect(definitions.dashboard.args).toEqual(['build', '--emptyOutDir', '--logLevel', 'warn']);
        });

        it('uses tsgo when experimentalTsgo is enabled', () => {
            const definitions = getBuildProcessDefinitions({
                experimentalTsgo: true,
                tsconfig: './tsconfig.server.json',
            });

            expect(definitions.server.packageName).toBe('@typescript/native-preview');
            expect(definitions.server.binName).toBe('tsgo');
            expect(definitions.server.args).toEqual(['-p', './tsconfig.server.json', '--noEmitOnError']);
        });

        it('uses a custom worker TypeScript config for worker builds', () => {
            const definitions = getBuildProcessDefinitions({
                tsconfig: './tsconfig.server.json',
                workerTsconfig: './tsconfig.worker.json',
            });

            expect(definitions.server.args).toEqual(['-p', './tsconfig.server.json', '--noEmitOnError']);
            expect(definitions.worker.args).toEqual(['-p', './tsconfig.worker.json', '--noEmitOnError']);
        });

        it('passes a custom Vite config to the dashboard build', () => {
            const definitions = getBuildProcessDefinitions({
                viteConfig: './config/vite.dashboard.mts',
            });

            expect(definitions.dashboard.args).toEqual([
                'build',
                '--config',
                './config/vite.dashboard.mts',
                '--logLevel',
                'warn',
            ]);
        });

        it('shows full Vite output in verbose mode', () => {
            const definitions = getBuildProcessDefinitions({
                verbose: true,
            });

            expect(definitions.dashboard.args).toEqual(['build']);
        });
    });

    describe('getBuildProcessesForTarget()', () => {
        it('builds server, worker and dashboard for all without duplicate TypeScript compiles', () => {
            const definitions = getBuildProcessDefinitions();
            const processes = getBuildProcessesForTarget('all', definitions);

            expect(processes).toHaveLength(2);
            expect(processes[0]).toMatchObject({
                target: 'server',
                displayLabel: 'server and worker',
                prefixLabel: 'server/worker',
            });
            expect(processes[1].target).toBe('dashboard');
        });

        it('builds the worker target directly when requested', () => {
            const definitions = getBuildProcessDefinitions();

            expect(getBuildProcessesForTarget('worker', definitions)).toEqual([definitions.worker]);
        });

        it('runs separate server and worker builds for all when their tsconfigs differ', () => {
            const definitions = getBuildProcessDefinitions({
                tsconfig: './tsconfig.server.json',
                workerTsconfig: './tsconfig.worker.json',
            });
            const processes = getBuildProcessesForTarget('all', definitions);

            expect(processes.map(process => process.target)).toEqual(['server', 'worker', 'dashboard']);
            expect(processes[0].args).toEqual(['-p', './tsconfig.server.json', '--noEmitOnError']);
            expect(processes[1].args).toEqual(['-p', './tsconfig.worker.json', '--noEmitOnError']);
        });
    });

    describe('getBuildProcessGroupsForTarget()', () => {
        it('runs dashboard builds before server output can be emitted', () => {
            const definitions = getBuildProcessDefinitions();
            const groups = getBuildProcessGroupsForTarget('all', definitions);

            expect(groups.map(group => group.map(process => process.target))).toEqual([
                ['dashboard'],
                ['server'],
            ]);
        });
    });

    describe('getBuildTsConfigsForTarget()', () => {
        it('uses the server tsconfig for server builds', () => {
            expect(
                getBuildTsConfigsForTarget('server', {
                    serverTsconfig: './tsconfig.server.json',
                    workerTsconfig: './tsconfig.worker.json',
                }),
            ).toEqual(['./tsconfig.server.json']);
        });

        it('uses the worker tsconfig for worker builds', () => {
            expect(
                getBuildTsConfigsForTarget('worker', {
                    serverTsconfig: './tsconfig.server.json',
                    workerTsconfig: './tsconfig.worker.json',
                }),
            ).toEqual(['./tsconfig.worker.json']);
        });

        it('validates both TypeScript configs for all when they differ', () => {
            expect(
                getBuildTsConfigsForTarget('all', {
                    serverTsconfig: './tsconfig.server.json',
                    workerTsconfig: './tsconfig.worker.json',
                }),
            ).toEqual(['./tsconfig.server.json', './tsconfig.worker.json']);
        });

        it('validates the shared TypeScript config only once for all', () => {
            expect(
                getBuildTsConfigsForTarget('all', {
                    serverTsconfig: './tsconfig.server.json',
                    workerTsconfig: './tsconfig.server.json',
                }),
            ).toEqual(['./tsconfig.server.json']);
        });
    });

    describe('getBuildCleanPathsForTarget()', () => {
        it('returns unique TypeScript outDirs for the selected target', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'index.ts'), 'export const value = 1;\n');
                writeFileSync(
                    path.join(dir, 'tsconfig.server.json'),
                    JSON.stringify({ compilerOptions: { outDir: './dist/server' } }),
                );
                writeFileSync(
                    path.join(dir, 'tsconfig.worker.json'),
                    JSON.stringify({ compilerOptions: { outDir: './dist/worker' } }),
                );

                expect(
                    getBuildCleanPathsForTarget(dir, 'all', {
                        serverTsconfig: './tsconfig.server.json',
                        workerTsconfig: './tsconfig.worker.json',
                    }).map(cleanPath => path.relative(dir, cleanPath)),
                ).toEqual(['dist/server', 'dist/worker']);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('deduplicates shared TypeScript outDirs', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'index.ts'), 'export const value = 1;\n');
                writeFileSync(
                    path.join(dir, 'tsconfig.build.json'),
                    JSON.stringify({ compilerOptions: { outDir: './dist' } }),
                );

                expect(
                    getBuildCleanPathsForTarget(dir, 'all', {
                        serverTsconfig: './tsconfig.build.json',
                        workerTsconfig: './tsconfig.build.json',
                    }).map(cleanPath => path.relative(dir, cleanPath)),
                ).toEqual(['dist']);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('getTsConfigOutDir()', () => {
        it('resolves an outDir from a tsconfig file', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'index.ts'), 'export const value = 1;\n');
                writeFileSync(
                    path.join(dir, 'tsconfig.json'),
                    JSON.stringify({ compilerOptions: { outDir: './dist' } }),
                );

                expect(getTsConfigOutDir(dir, './tsconfig.json')).toBe(path.join(dir, 'dist'));
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('resolveBuildTsConfigs()', () => {
        it('prefers server and worker specific configs', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
                writeFileSync(path.join(dir, 'tsconfig.build.json'), '{}');
                writeFileSync(path.join(dir, 'tsconfig.server.json'), '{}');
                writeFileSync(path.join(dir, 'tsconfig.worker.json'), '{}');

                expect(resolveBuildTsConfigs(dir)).toEqual({
                    serverTsconfig: './tsconfig.server.json',
                    workerTsconfig: './tsconfig.worker.json',
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('falls back to tsconfig.build.json before tsconfig.json', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'tsconfig.json'), '{}');
                writeFileSync(path.join(dir, 'tsconfig.build.json'), '{}');

                expect(resolveBuildTsConfigs(dir)).toEqual({
                    serverTsconfig: './tsconfig.build.json',
                    workerTsconfig: './tsconfig.build.json',
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('falls back to tsconfig.json when no build-specific config exists', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'tsconfig.json'), '{}');

                expect(resolveBuildTsConfigs(dir)).toEqual({
                    serverTsconfig: './tsconfig.json',
                    workerTsconfig: './tsconfig.json',
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('uses explicit TypeScript config options before discovered configs', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'tsconfig.server.json'), '{}');
                writeFileSync(path.join(dir, 'tsconfig.worker.json'), '{}');

                expect(
                    resolveBuildTsConfigs(dir, {
                        tsconfig: './custom-server.json',
                        workerTsconfig: './custom-worker.json',
                    }),
                ).toEqual({
                    serverTsconfig: './custom-server.json',
                    workerTsconfig: './custom-worker.json',
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('uses an explicit server TypeScript config as the worker default', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'tsconfig.worker.json'), '{}');

                expect(
                    resolveBuildTsConfigs(dir, {
                        tsconfig: './custom-server.json',
                    }),
                ).toEqual({
                    serverTsconfig: './custom-server.json',
                    workerTsconfig: './custom-server.json',
                });
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    describe('shouldUseMultiBuildSpinner()', () => {
        it('uses multi-build spinners for quiet multi-process builds', () => {
            const definitions = getBuildProcessDefinitions();
            const processes = getBuildProcessesForTarget('all', definitions);

            expect(shouldUseMultiBuildSpinner(processes)).toBe(true);
        });

        it('does not use multi-build spinners for verbose multi-process builds', () => {
            const definitions = getBuildProcessDefinitions({ verbose: true });
            const processes = getBuildProcessesForTarget('all', definitions);

            expect(shouldUseMultiBuildSpinner(processes)).toBe(false);
        });
    });

    describe('shouldUseProgress()', () => {
        it('honors both Commander and direct API progress-disabling options', () => {
            setStdoutIsTTY(true);
            vi.stubEnv('CI', 'false');

            expect(shouldUseProgress({})).toBe(true);
            expect(shouldUseProgress({ progress: false })).toBe(false);
            expect(shouldUseProgress({ noProgress: true })).toBe(false);
            expect(shouldUseProgress({ watch: true })).toBe(false);
        });

        it('disables progress for any non-empty CI value except false', () => {
            setStdoutIsTTY(true);

            vi.stubEnv('CI', '1');
            expect(shouldUseProgress({})).toBe(false);

            vi.stubEnv('CI', 'false');
            expect(shouldUseProgress({})).toBe(true);
        });
    });

    describe('normalizeBuildTarget()', () => {
        it('defaults to all', () => {
            expect(normalizeBuildTarget()).toBe('all');
        });

        it('accepts known targets', () => {
            expect(normalizeBuildTarget('all')).toBe('all');
            expect(normalizeBuildTarget('server')).toBe('server');
            expect(normalizeBuildTarget('worker')).toBe('worker');
            expect(normalizeBuildTarget('dashboard')).toBe('dashboard');
        });

        it('rejects unknown targets', () => {
            expect(() => normalizeBuildTarget('api')).toThrow('Unknown build target');
        });
    });

    describe('validateTsConfig()', () => {
        it('accepts a valid tsconfig file with comments', () => {
            const dir = createTempDir();
            try {
                mkdirSync(path.join(dir, 'src'), { recursive: true });
                writeFileSync(path.join(dir, 'src', 'index.ts'), 'export const value = 1;\n');
                writeFileSync(
                    path.join(dir, 'tsconfig.json'),
                    `{
                        // comments are valid in tsconfig files
                        "compilerOptions": {
                            "target": "ES2021",
                            "module": "CommonJS",
                        },
                        "include": ["src/**/*.ts"],
                    }`,
                );

                expect(() => validateTsConfig(dir)).not.toThrow();
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('rejects a missing tsconfig file', () => {
            const dir = createTempDir();
            try {
                expect(() => validateTsConfig(dir, './missing.json')).toThrow(
                    'Could not find TypeScript config file',
                );
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        it('rejects an invalid tsconfig file', () => {
            const dir = createTempDir();
            try {
                writeFileSync(path.join(dir, 'tsconfig.json'), '{ invalid json');

                expect(() => validateTsConfig(dir)).toThrow(/TS1005/);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
});
