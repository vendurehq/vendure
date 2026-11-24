import { CREATE_RECORD_PATH, parseCreateRecord } from '@vendure/common/lib/create-record';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { main } from './cli.js';
import { INITIAL_COMMIT_MESSAGE } from './steps.js';

// One scenario, so the preset conflict can be checked end to end. The public registry is empty.
vi.mock('./registries.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./registries.js')>();
    const scenarios = [
        {
            name: 'demo',
            description: 'A demo',
            package: '@example/scenario-demo',
            version: '1.0.0',
            preset: { name: 'uk', options: {} },
        },
    ];
    return {
        ...actual,
        SCENARIOS: scenarios,
        findScenario: (name: string) => actual.findScenario(name, scenarios),
    };
});

const assetsDir = path.join(import.meta.dirname, '../assets');
const NOT_INSTALLED = 'the dependencies were not installed, so `vendure mcp install` could not run';

class Capture extends Writable {
    text = '';
    _write(chunk: Buffer, _encoding: string, callback: () => void) {
        this.text += chunk.toString();
        callback();
    }
}

let workDir: string;

async function create(args: string[], env: NodeJS.ProcessEnv = {}) {
    const stdout = new Capture();
    const stderr = new Capture();
    const code = await main(['node', 'create', ...args], {
        version: '4.0.0-test',
        assetsDir,
        cwd: workDir,
        env,
        stdout,
        stderr,
    });
    return { code, stdout: stdout.text, stderr: stderr.text, json: JSON.parse(stdout.text || 'null') };
}

function filesIn(dir: string): string[] {
    return fs
        .readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter(
            entry => entry.isFile() && !path.relative(dir, entry.parentPath).startsWith('.git' + path.sep),
        )
        .filter(entry => path.relative(dir, entry.parentPath) !== '.git')
        .map(entry => path.relative(dir, path.join(entry.parentPath, entry.name)))
        .sort();
}

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-create-'));
    // A git identity and no user or system config, so the initial commit works the same everywhere.
    const gitConfig = path.join(workDir, '.gitconfig-empty');
    fs.writeFileSync(gitConfig, '');
    for (const [key, value] of Object.entries({
        GIT_CONFIG_GLOBAL: gitConfig,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'Test',
        GIT_AUTHOR_EMAIL: 'test@example.com',
        GIT_COMMITTER_NAME: 'Test',
        GIT_COMMITTER_EMAIL: 'test@example.com',
    })) {
        vi.stubEnv(key, value);
    }
});

afterAll(() => {
    vi.unstubAllEnvs();
    fs.rmSync(workDir, { recursive: true, force: true });
});

describe('create --yes --json', () => {
    let result: Awaited<ReturnType<typeof create>>;
    let projectDir: string;

    beforeAll(async () => {
        result = await create(['my-shop', '--yes', '--json', '--no-install'], {
            npm_config_user_agent: 'pnpm/10.0.0 npm/? node/v22.12.0 linux x64',
        });
        projectDir = path.join(workDir, 'my-shop');
    });

    it('prints only the bare result object on stdout', () => {
        expect(result.code).toBe(0);
        expect(result.json).toEqual({
            projectDir,
            packageManager: 'pnpm',
            agentFiles: {
                written: [
                    'AGENTS.md',
                    '.agents/skills/vendure-cli/',
                    '.agents/skills/vendure-store-setup/',
                    '.agents/skills/vendure-troubleshooting/',
                    'CLAUDE.md',
                    '.claude/settings.json',
                    '.mcp.json',
                    '.cursor/mcp.json',
                    '.vscode/mcp.json',
                    '.codex/config.toml',
                ],
                // With --no-install there is no CLI to run `vendure mcp install` with.
                failed: ['claude', 'vscode', 'codex'].map(client => ({ client, reason: NOT_INSTALLED })),
            },
            git: { status: 'committed' },
            next: [
                'cd my-shop',
                'pnpm install',
                'pnpm run dev',
                'pnpm exec vendure mcp install --client claude',
                'pnpm exec vendure mcp install --client vscode',
                'pnpm exec vendure mcp install --client codex',
            ],
        });
    });

    it('writes a Cloud Config app and no self-hosted files', () => {
        expect(filesIn(projectDir).filter(file => !file.startsWith('.agents/'))).toEqual([
            '.claude/settings.json',
            '.codex/config.toml',
            '.cursor/mcp.json',
            '.gitignore',
            '.mcp.json',
            '.vendure/create.json',
            '.vscode/mcp.json',
            'AGENTS.md',
            'CLAUDE.md',
            'README.md',
            'package.json',
            'pnpm-workspace.yaml',
            'src/migrations/.gitkeep',
            'src/vendure-config.ts',
            'tsconfig.json',
        ]);
        const pkg = JSON.parse(fs.readFileSync(path.join(projectDir, 'package.json'), 'utf-8'));
        expect(pkg.name).toBe('my-shop');
        expect(Object.keys(pkg.scripts)).toEqual(['dev', 'build', 'typecheck']);
        expect(fs.readFileSync(path.join(projectDir, 'src/vendure-config.ts'), 'utf-8')).toContain(
            'defineCloudConfig(',
        );
    });

    it('ignores local Vendure state but keeps the create record', () => {
        expect(fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf-8')).toContain(
            '.vendure/*\n!.vendure/create.json\n',
        );
    });

    it('writes a create record that the shared contract parses', () => {
        const parsed = parseCreateRecord(
            JSON.parse(fs.readFileSync(path.join(projectDir, CREATE_RECORD_PATH), 'utf-8')),
        );
        expect(parsed).toEqual({
            result: 'ok',
            record: {
                version: 1,
                createdWith: '4.0.0-test',
                packageManager: 'pnpm',
                preset: null,
                scenario: null,
                features: [],
                storefront: null,
                // Only Cursor's file is complete without `vendure mcp install`.
                agents: ['cursor'],
            },
        });
    });

    it('makes a git repository with one commit holding every file', () => {
        const git = (...args: string[]) =>
            execFileSync('git', args, { cwd: projectDir, encoding: 'utf-8' }).trim();
        expect(git('log', '--format=%s')).toBe(INITIAL_COMMIT_MESSAGE);
        expect(git('ls-files').split('\n').sort()).toEqual(filesIn(projectDir));
        expect(git('status', '--porcelain')).toBe('');
    });

    it('refuses a directory that already has files', async () => {
        const again = await create(['my-shop', '--yes', '--json', '--no-install']);
        expect(again.code).toBe(1);
        expect(again.json.error.code).toBe('create.project-directory-not-empty');
    });
});

describe('create choices', () => {
    it("records a scenario's preset, and the other choices", async () => {
        const result = await create([
            'with-scenario',
            '--json',
            '--no-install',
            '--no-git',
            '--scenario',
            'demo',
            '--package-manager',
            'bun',
            '--agents',
            'none',
        ]);
        expect(result.code).toBe(0);
        expect(result.json.git).toEqual({ status: 'skipped', reason: '--no-git was given' });
        const recordPath = path.join(workDir, 'with-scenario', CREATE_RECORD_PATH);
        expect(JSON.parse(fs.readFileSync(recordPath, 'utf-8'))).toMatchObject({
            packageManager: 'bun',
            preset: { name: 'uk', options: {} },
            scenario: { name: 'demo', package: '@example/scenario-demo', version: '1.0.0' },
            agents: [],
        });
        const pkg = JSON.parse(fs.readFileSync(path.join(workDir, 'with-scenario/package.json'), 'utf-8'));
        expect(pkg.devDependencies['@example/scenario-demo']).toBe('1.0.0');
        expect(pkg.trustedDependencies).toEqual(['bcrypt', 'esbuild', 'sharp']);
    });

    it('refuses a preset that conflicts with the scenario, before writing anything', async () => {
        const result = await create(['conflict', '--json', '--scenario', 'demo', '--preset', 'us']);
        expect(result.code).toBe(1);
        expect(result.json.error).toMatchObject({ code: 'create.preset-conflicts-with-scenario' });
        expect(fs.existsSync(path.join(workDir, 'conflict'))).toBe(false);
    });

    it('reports an unknown flag as a coded error', async () => {
        const result = await create(['x', '--json', '--bogus']);
        expect(result.code).toBe(1);
        expect(result.json.error.code).toBe('create.invalid-arguments');
    });

    it('names the replacement of a flag the v3 create had', async () => {
        const result = await create(['x', '--json', '--use-npm']);
        expect(result.code).toBe(1);
        expect(result.json.error).toEqual({
            code: 'create.flag-removed',
            message: '--use-npm was removed in Vendure 4.',
            fix: 'Use --package-manager npm.',
        });
        const db = await create(['x', '--json', '--db=postgres']);
        expect(db.json.error.code).toBe('create.flag-removed');
    });

    it('skips git when the project is inside a repository', async () => {
        execFileSync('git', ['init', '--quiet', path.join(workDir, 'outer')]);
        const result = await create(['outer/inner', '--json', '--no-install']);
        expect(result.code).toBe(0);
        expect(result.json.git).toEqual({
            status: 'skipped',
            reason: 'the project directory is already inside a git repository',
        });
    });
});
