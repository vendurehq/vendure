import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runTypeScriptCheck } from './typescript-check';

describe('typescript-check', () => {
    let projectDir: string;

    beforeEach(() => {
        projectDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-ts-check-'));
        writeFileSync(
            path.join(projectDir, 'package.json'),
            JSON.stringify({ name: 'test', dependencies: { '@vendure/core': '4.0.0' } }),
        );
        mkdirSync(path.join(projectDir, 'src'));
        writeFileSync(path.join(projectDir, 'src', 'index.ts'), 'export const value = 1;\n');
    });

    afterEach(() => {
        rmSync(projectDir, { recursive: true, force: true });
    });

    /** A TypeScript 7 compatible tsconfig with a target below ES2022, like the create template. */
    const COMPATIBLE_OPTIONS = { module: 'nodenext', target: 'es2019', outDir: './dist', rootDir: './src' };

    function installTypeScript(version: string) {
        const packageDir = path.join(projectDir, 'node_modules', 'typescript');
        mkdirSync(packageDir, { recursive: true });
        writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify({ name: 'typescript', version }));
    }

    function writeTsConfig(fileName: string, compilerOptions: Record<string, unknown>) {
        writeFileSync(
            path.join(projectDir, fileName),
            JSON.stringify({ compilerOptions, include: ['src/**/*.ts'] }),
        );
    }

    it('skips instead of throwing when the project is ambiguous', () => {
        const workspaceDir = mkdtempSync(path.join(tmpdir(), 'vendure-cli-ts-check-ws-'));
        try {
            writeFileSync(
                path.join(workspaceDir, 'package.json'),
                JSON.stringify({ workspaces: ['server', 'other'] }),
            );
            for (const member of ['server', 'other']) {
                mkdirSync(path.join(workspaceDir, member));
                writeFileSync(
                    path.join(workspaceDir, member, 'package.json'),
                    JSON.stringify({ dependencies: { '@vendure/core': '*' } }),
                );
            }

            const result = runTypeScriptCheck(workspaceDir);

            expect(result.status).toBe('skip');
            expect(result.message).toContain('Multiple Vendure projects found');
        } finally {
            rmSync(workspaceDir, { recursive: true, force: true });
        }
    });

    it('fails when there is no tsconfig.json', () => {
        const result = runTypeScriptCheck(projectDir);

        expect(result.status).toBe('fail');
        expect(result.message).toContain('No tsconfig.json found');
    });

    it('fails for a v3 tsconfig with baseUrl, moduleResolution node and no rootDir', () => {
        writeTsConfig('tsconfig.json', {
            module: 'commonjs',
            moduleResolution: 'node',
            baseUrl: './',
            outDir: './dist',
        });

        const result = runTypeScriptCheck(projectDir);

        expect(result.status).toBe('fail');
        expect(result.message).toBe('tsconfig.json not compatible with TypeScript 7');
        const details = result.details?.join('\n') ?? '';
        expect(details).toContain('TS5102');
        expect(details).toContain('TS5108');
        expect(details).toContain('TS5011');
        expect(details).toContain('remove "baseUrl"');
    });

    it('checks the other tsconfig files used by vendure build', () => {
        writeTsConfig('tsconfig.json', COMPATIBLE_OPTIONS);
        writeTsConfig('tsconfig.build.json', { module: 'nodenext', baseUrl: './' });

        const result = runTypeScriptCheck(projectDir);

        expect(result.status).toBe('fail');
        expect(result.message).toBe('tsconfig.build.json not compatible with TypeScript 7');
    });

    it('does not fail for a TypeScript 7 compatible tsconfig', () => {
        writeTsConfig('tsconfig.json', COMPATIBLE_OPTIONS);

        const result = runTypeScriptCheck(projectDir);

        // "warn" because the temp project has no typescript package installed
        expect(result.status).toBe('warn');
        expect(result.details).toContain('tsconfig.json is compatible with TypeScript 7');
        expect(result.details?.join('\n')).toContain('"typescript" package is not installed');
        expect(result.details?.join('\n')).toContain('typescript@7.1.0-beta || ~7.1.0');
    });

    it('passes with a supported TypeScript version installed', () => {
        writeTsConfig('tsconfig.json', COMPATIBLE_OPTIONS);
        installTypeScript('7.1.0-beta');

        const result = runTypeScriptCheck(projectDir);

        expect(result.status).toBe('pass');
        expect(result.details).toContain('TypeScript 7.1.0-beta');
    });

    it.each(['5.4.5', '5.8.2', '6.0.3'])(
        'warns that TypeScript 7 is recommended when TypeScript %s is installed',
        version => {
            writeTsConfig('tsconfig.json', COMPATIBLE_OPTIONS);
            installTypeScript(version);

            const result = runTypeScriptCheck(projectDir);

            expect(result.status).toBe('warn');
            expect(result.message).toBe(`TypeScript ${version} is installed; TypeScript 7 is recommended`);
            expect(result.details?.join('\n')).toContain('updating/#typescript-7');
        },
    );

    it('only warns about a v3 tsconfig when the project compiles with TypeScript 5.x', () => {
        writeTsConfig('tsconfig.json', {
            module: 'commonjs',
            moduleResolution: 'node',
            baseUrl: './',
            outDir: './dist',
            target: 'es2019',
        });
        installTypeScript('5.8.2');

        const result = runTypeScriptCheck(projectDir);

        // `vendure build` succeeds with TypeScript 5.x, so this must not fail the doctor run
        expect(result.status).toBe('warn');
        expect(result.message).toContain('tsconfig.json need changes before upgrading to TypeScript 7');
        expect(result.details?.join('\n')).toContain('TS5102');
    });

    it('fails for a v3 tsconfig when the project compiles with TypeScript 7', () => {
        writeTsConfig('tsconfig.json', { module: 'commonjs', moduleResolution: 'node', outDir: './dist' });
        installTypeScript('7.1.0-beta');

        expect(runTypeScriptCheck(projectDir).status).toBe('fail');
    });

    it('does not warn about useDefineForClassFields without a target on TypeScript 5.x', () => {
        // TypeScript 5.x defaults to an ES5 target, which keeps the old class field semantics
        writeTsConfig('tsconfig.json', { ...COMPATIBLE_OPTIONS, target: undefined });
        installTypeScript('5.8.2');

        const result = runTypeScriptCheck(projectDir);

        expect(result.message).not.toContain('useDefineForClassFields');
    });

    it('warns about useDefineForClassFields with an ES2022 target on TypeScript 5.x', () => {
        writeTsConfig('tsconfig.json', {
            module: 'commonjs',
            moduleResolution: 'node',
            baseUrl: './',
            target: 'es2022',
        });
        installTypeScript('5.8.2');

        const result = runTypeScriptCheck(projectDir);

        expect(result.status).toBe('warn');
        expect(result.message).toContain('tsconfig.json enables useDefineForClassFields');
    });

    it.each(['7.0.2', '7.1.0-dev.20261105.1', '7.2.0'])(
        'warns when TypeScript %s is installed, which is outside the supported range',
        version => {
            writeTsConfig('tsconfig.json', COMPATIBLE_OPTIONS);
            installTypeScript(version);

            const result = runTypeScriptCheck(projectDir);

            expect(result.status).toBe('warn');
            expect(result.message).toBe(`TypeScript ${version} is not supported`);
        },
    );

    it.each([
        ['explicitly enabled', { useDefineForClassFields: true, target: 'es2019' }],
        ['enabled by an ES2022 target', { target: 'es2022' }],
        ['enabled by the default target', {}],
    ])('warns when useDefineForClassFields is %s', (_, options) => {
        writeTsConfig('tsconfig.json', { ...COMPATIBLE_OPTIONS, target: undefined, ...options });
        installTypeScript('7.1.0-beta');

        const result = runTypeScriptCheck(projectDir);

        expect(result.status).toBe('warn');
        expect(result.message).toBe('tsconfig.json enables useDefineForClassFields');
        expect(result.details?.join('\n')).toContain('Set "useDefineForClassFields": false');
    });

    it('does not warn when useDefineForClassFields is disabled despite a modern target', () => {
        writeTsConfig('tsconfig.json', {
            ...COMPATIBLE_OPTIONS,
            target: 'es2022',
            useDefineForClassFields: false,
        });
        installTypeScript('7.1.0-beta');

        expect(runTypeScriptCheck(projectDir).status).toBe('pass');
    });

    it('reports tsconfig errors without ANSI colour codes', () => {
        writeTsConfig('tsconfig.json', { module: 'nodenext', baseUrl: './' });

        const result = runTypeScriptCheck(projectDir);

        // eslint-disable-next-line no-control-regex
        expect(result.details?.join('\n')).not.toMatch(/\u001b\[/);
    });
});
