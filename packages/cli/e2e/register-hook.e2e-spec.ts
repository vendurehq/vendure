/**
 * E2E tests for the `@vendure/cli/register` hook, which replaces ts-node for running
 * TypeScript files directly (`vendure dev`, `vendure migrate`, stand-alone scripts).
 *
 * These run real Node.js child processes, so the CLI must be built first.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const fixtureAppDir = path.join(__dirname, 'fixtures', 'register-project', 'app');

/**
 * Runs a script with the hook, referenced by its public package specifier. Node.js resolves
 * `@vendure/cli/register` from the cwd, which must be inside the monorepo.
 */
function runWithRegisterHook(cwd: string, script: string) {
    return spawnSync(process.execPath, ['--require', '@vendure/cli/register', script], {
        cwd,
        encoding: 'utf-8',
    });
}

describe('@vendure/cli/register', () => {
    let tempDir: string | undefined;

    beforeAll(() => {
        if (!existsSync(path.join(__dirname, '..', 'dist', 'register.js'))) {
            throw new Error('The CLI must be built before running these tests (npm run build)');
        }
    });

    afterEach(() => {
        if (tempDir) {
            rmSync(tempDir, { recursive: true, force: true });
            tempDir = undefined;
        }
    });

    it('emits decorator metadata and resolves tsconfig paths inherited through extends', () => {
        const result = runWithRegisterHook(fixtureAppDir, 'main.ts');

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual({
            // @lib/dependency is mapped in ../tsconfig.base.json and resolved relative to it
            dependencyName: 'dependency',
            // design:paramtypes is required by NestJS dependency injection
            paramTypes: ['Dependency', 'Number'],
            // design:type is required by TypeORM columns
            labelType: 'String',
        });
    });

    it('enables decorator metadata and warns when no tsconfig.json is found', () => {
        tempDir = mkdtempSync(path.join(tmpdir(), 'vendure-register-no-tsconfig-'));
        // A minimal Reflect.metadata polyfill, as reflect-metadata cannot be resolved from the temp dir
        writeFileSync(
            path.join(tempDir, 'script.ts'),
            `
            const store = new Map<unknown, unknown>();
            (Reflect as any).metadata = (key: string, value: unknown) => (target: unknown) => {
                if (key === 'design:paramtypes') store.set(target, value);
            };
            class Dependency {}
            function Injectable(): ClassDecorator { return () => undefined; }
            @Injectable()
            class Service { constructor(readonly dependency: Dependency) {} }
            const paramTypes = store.get(Service) as Array<{ name: string }> | undefined;
            process.stdout.write(JSON.stringify(paramTypes?.map(t => t.name) ?? null));
            `,
        );

        const result = spawnSync(
            process.execPath,
            ['--require', require.resolve('@vendure/cli/register'), 'script.ts'],
            { cwd: tempDir, encoding: 'utf-8' },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(['Dependency']);
        expect(result.stderr).toContain('VENDURE_TSCONFIG_NOT_FOUND');
        expect(result.stderr).toContain('No tsconfig.json found');
    });

    /**
     * Runs a file with a syntax error. The environment is controlled, because CI sets
     * FORCE_COLOR, which makes both our diagnostics and Node.js's own error output use colours.
     */
    function runBrokenFile(colorEnv: NodeJS.ProcessEnv) {
        tempDir = mkdtempSync(path.join(tmpdir(), 'vendure-register-syntax-error-'));
        writeFileSync(path.join(tempDir, 'tsconfig.json'), '{ "compilerOptions": {} }');
        writeFileSync(path.join(tempDir, 'broken.ts'), 'const value = ;\n');
        const env = { ...process.env };
        delete env.FORCE_COLOR;
        delete env.NO_COLOR;
        delete env.NODE_DISABLE_COLORS;
        return spawnSync(
            process.execPath,
            ['--require', require.resolve('@vendure/cli/register'), 'broken.ts'],
            { cwd: tempDir, encoding: 'utf-8', env: { ...env, ...colorEnv } },
        );
    }

    it('reports syntax errors without ANSI colour codes when stderr is not a TTY', () => {
        const result = runBrokenFile({});

        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('TS1109');
        // eslint-disable-next-line no-control-regex
        expect(result.stderr).not.toMatch(/\u001b\[/);
    });

    it('reports syntax errors without ANSI colour codes when NO_COLOR is set', () => {
        const result = runBrokenFile({ NO_COLOR: '1' });

        expect(result.stderr).toContain('TS1109');
        // eslint-disable-next-line no-control-regex
        expect(result.stderr).not.toMatch(/\u001b\[/);
    });

    it('colours the diagnostics when FORCE_COLOR is set, like Node.js does', () => {
        const result = runBrokenFile({ FORCE_COLOR: '1' });

        // The colourised TypeScript formatter prints the error code in colour
        // eslint-disable-next-line no-control-regex
        expect(result.stderr).toMatch(/\u001b\[[0-9;]*m[^\n]*TS1109|TS1109[^\n]*\u001b\[/);
    });
});
