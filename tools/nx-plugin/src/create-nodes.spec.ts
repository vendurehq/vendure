import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, matchesGlob } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createNodesV2, createTargets } from './create-nodes';
import { readPluginPackage } from './package-schema';

const nxJson = JSON.parse(readFileSync(join(__dirname, '../../../nx.json'), 'utf-8'));

let workspaceRoot: string;

function writeFiles(files: Record<string, string>) {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(workspaceRoot, path)), { recursive: true });
        writeFileSync(join(workspaceRoot, path), content);
    }
}

function fsReader() {
    const abs = (path: string) => join(workspaceRoot, path);
    return {
        exists: (path: string) => existsSync(abs(path)),
        isFile: (path: string) => existsSync(abs(path)) && statSync(abs(path)).isFile(),
        read: (path: string) => readFileSync(abs(path), 'utf-8'),
        children: (path: string) => (existsSync(abs(path)) ? readdirSync(abs(path)) : []),
    };
}

async function runCreateNodes(files: string[]) {
    const [, createNodes] = createNodesV2;
    return createNodes(files, undefined, { workspaceRoot, nxJsonConfiguration: {} });
}

/**
 * Expands the inputs of a target with the named inputs of the repository's nx.json, and
 * returns true when a change to `file` changes the hash of the target.
 */
function inputsInclude(inputs: Array<string | object>, projectRoot: string, file: string): boolean {
    const patterns: string[] = [];
    const expand = (input: string | object) => {
        if (typeof input !== 'string' || input.startsWith('^')) {
            return;
        }
        if (nxJson.namedInputs[input]) {
            nxJson.namedInputs[input].forEach(expand);
        } else {
            patterns.push(input.replace('{projectRoot}', projectRoot).replace('{workspaceRoot}/', ''));
        }
    };
    inputs.forEach(expand);
    const included = patterns.filter(p => !p.startsWith('!')).some(p => matchesGlob(file, p));
    const excluded = patterns.filter(p => p.startsWith('!')).some(p => matchesGlob(file, p.slice(1)));
    return included && !excluded;
}

beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'nx-plugin-'));
});

afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true });
});

describe('createNodesV2', () => {
    it('creates one project per package, also when it has more than one plugin file', async () => {
        writeFiles({
            'packages/foo-plugin/package.json': '{"name":"@vendure/foo-plugin","main":"lib/index.js"}',
            'packages/foo-plugin/src/index.ts': '',
            'packages/foo-plugin/src/foo.plugin.ts': '',
            'packages/foo-plugin/src/bar/plugin.ts': '',
        });

        const results = await runCreateNodes([
            'packages/foo-plugin/src/bar/plugin.ts',
            'packages/foo-plugin/src/foo.plugin.ts',
        ]);

        expect(results).toHaveLength(1);
        const [file, result] = results[0];
        expect(file).toBe('packages/foo-plugin/src/bar/plugin.ts');
        expect(Object.keys(result.projects ?? {})).toEqual(['packages/foo-plugin']);
        expect(result.projects?.['packages/foo-plugin'].implicitDependencies).toEqual(['nx-plugin']);
    });

    it('ignores a plugin file that is not in a package', async () => {
        writeFiles({ 'packages/foo/src/plugin.ts': '' });

        expect(await runCreateNodes(['packages/foo/src/plugin.ts'])).toEqual([]);
    });

    it('ignores a file deeper in src that is named plugin.ts', async () => {
        writeFiles({
            'packages/foo/package.json': '{}',
            'packages/foo/src/a/b/plugin.ts': '',
        });

        expect(await runCreateNodes(['packages/foo/src/a/b/plugin.ts'])).toEqual([]);
    });
});

describe('createTargets', () => {
    const files = {
        'packages/foo-plugin/package.json': '{"name":"@vendure/foo-plugin","main":"lib/index.js"}',
        'packages/foo-plugin/src/index.ts': '',
        'packages/foo-plugin/src/foo.plugin.ts': '',
    };

    function targetsFor(extraFiles: Record<string, string> = {}) {
        writeFiles({ ...files, ...extraFiles });
        return createTargets(readPluginPackage('packages/foo-plugin', fsReader()));
    }

    it('creates build, watch and lint for every package', () => {
        const targets = targetsFor();

        expect(Object.keys(targets)).toEqual(['build', 'watch', 'lint']);
        expect(targets.build).toEqual({
            executor: 'nx:run-commands',
            options: { command: 'rimraf lib && tsc -p ./tsconfig.build.json', cwd: '{projectRoot}' },
        });
        expect(targets.watch).toEqual({
            executor: 'nx:run-commands',
            options: { command: 'tsc -p ./tsconfig.build.json --watch', cwd: '{projectRoot}' },
        });
        expect(targets.lint.options).toEqual({ command: 'eslint --fix .', cwd: '{projectRoot}' });
    });

    it('builds to the folder of `main`', () => {
        const targets = targetsFor({
            'packages/foo-plugin/package.json': '{"name":"@vendure/foo-plugin","main":"./dist/index.js"}',
        });

        expect(targets.build.options.command).toBe('rimraf dist && tsc -p ./tsconfig.build.json');
        expect(nxJson.targetDefaults.build.outputs).toContain('{projectRoot}/dist');
    });

    it('creates test when there is a unit test', () => {
        const targets = targetsFor({ 'packages/foo-plugin/src/foo.spec.ts': '' });

        expect(targets.test).toEqual({
            executor: 'nx:run-commands',
            options: {
                command: 'vitest --config ../../tools/nx-plugin/vitest.package.config.mts --run',
                cwd: '{projectRoot}',
            },
        });
    });

    it('runs type-level tests when there is a spec-d file', () => {
        const targets = targetsFor({
            'packages/foo-plugin/src/foo.spec.ts': '',
            'packages/foo-plugin/src/foo.spec-d.ts': '',
        });

        expect(targets.test.options.command).toBe(
            'vitest --config ../../tools/nx-plugin/vitest.package.config.mts --run --typecheck',
        );
    });

    it('creates e2e when there is an e2e spec', () => {
        const targets = targetsFor({ 'packages/foo-plugin/e2e/foo.e2e-spec.ts': '' });

        expect(targets.e2e).toEqual({
            executor: 'nx:run-commands',
            options: {
                command:
                    'cross-env PACKAGE=foo-plugin vitest --config ../../e2e-common/vitest.config.mts --run',
                cwd: '{projectRoot}',
            },
        });
    });

    it('does not create test or e2e without spec files', () => {
        const targets = targetsFor({ 'packages/foo-plugin/e2e/fixtures/data.csv': '' });

        expect(targets.test).toBeUndefined();
        expect(targets.e2e).toBeUndefined();
    });

    // The inferred targets only set the command, so Nx uses the `targetDefaults` of nx.json.
    describe('cache inputs in nx.json', () => {
        const root = 'packages/foo-plugin';
        const inputsOf = (target: string): string[] => nxJson.targetDefaults[target].inputs;

        it.each([
            ['schema-admin.graphql'],
            ['schema-shop.graphql'],
            ['src/dashboard/index.tsx'],
            ['src/foo.plugin.ts'],
        ])('a change to %s invalidates build, test and e2e', file => {
            for (const target of ['build', 'test', 'e2e']) {
                expect(inputsInclude(inputsOf(target), root, `${root}/${file}`)).toBe(true);
            }
        });

        it('a change to a spec file does not invalidate build', () => {
            expect(inputsInclude(inputsOf('build'), root, `${root}/src/foo.spec.ts`)).toBe(false);
            expect(inputsInclude(inputsOf('test'), root, `${root}/src/foo.spec.ts`)).toBe(true);
        });

        it('a change to the shared Vitest config invalidates test', () => {
            expect(inputsInclude(inputsOf('test'), root, 'tools/nx-plugin/vitest.package.config.mts')).toBe(
                true,
            );
        });

        it('a change to e2e-common invalidates e2e', () => {
            expect(inputsInclude(inputsOf('e2e'), root, 'e2e-common/test-config.ts')).toBe(true);
        });
    });
});
