import { CREATE_RECORD_PATH } from '@vendure/common/lib/create-record';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CreateError } from './errors.js';
import { Reporter, runCreate } from './run-create.js';
import { commitAll, initGitRepository } from './steps.js';
import { CreateOptions } from './types.js';

const install = vi.hoisted(() => ({ fail: false }));

// The storefront download needs the network, and the install needs a registry. Both are stubbed.
vi.mock('./storefront-starters.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./storefront-starters.js')>();
    return {
        ...actual,
        downloadAndExtractStorefront: (targetDir: string) => {
            fs.mkdirSync(targetDir, { recursive: true });
            fs.writeFileSync(path.join(targetDir, 'package.json'), JSON.stringify({ name: 'starter' }));
            return Promise.resolve();
        },
    };
});
vi.mock('./steps.js', async importOriginal => {
    const actual = await importOriginal<typeof import('./steps.js')>();
    return {
        ...actual,
        installDependencies: () =>
            install.fail
                ? Promise.reject(new CreateError('create.install-failed', '`npm install` failed', 'Fix it.'))
                : Promise.resolve(),
    };
});

const assetsDir = path.join(import.meta.dirname, '../assets');
let workDir: string;

function recordingReporter() {
    const events: string[] = [];
    const reporter: Reporter = {
        start: message => events.push(`start: ${message}`),
        stop: message => events.push(`stop: ${message}`),
        fail: message => events.push(`fail: ${message}`),
    };
    return { events, reporter };
}

function optionsFor(name: string, overrides: Partial<CreateOptions> = {}): CreateOptions {
    return {
        projectDir: path.join(workDir, name),
        name,
        packageManager: 'npm',
        storefront: null,
        preset: { name: 'uk', options: {} },
        scenario: null,
        features: [],
        // Agent files have their own spec; these tests cover the project files.
        agents: [],
        install: true,
        git: false,
        ...overrides,
    };
}

function readJson(file: string) {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vendure-run-create-'));
});

afterAll(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
});

beforeEach(() => {
    install.fail = false;
});

describe('runCreate() with a storefront', () => {
    it('writes a workspace with the server in apps/server and the record beside it', async () => {
        const { reporter } = recordingReporter();
        const options = optionsFor('with-storefront', { storefront: 'nextjs' });
        await runCreate(options, {
            createVersion: '4.0.0',
            assetsDir,
            logLevel: 'silent',
            reporter,
            projectDirArg: 'x',
        });

        const root = options.projectDir;
        expect(readJson(path.join(root, 'package.json'))).toMatchObject({
            name: 'with-storefront',
            workspaces: ['apps/*'],
            allowScripts: { bcrypt: true },
        });
        const server = readJson(path.join(root, 'apps/server/package.json'));
        expect(server.name).toBe('server');
        expect(server.allowScripts).toBeUndefined();
        expect(fs.existsSync(path.join(root, 'apps/server/src/vendure-config.ts'))).toBe(true);
        expect(readJson(path.join(root, 'apps/server', CREATE_RECORD_PATH))).toMatchObject({
            storefront: 'nextjs',
        });
        expect(fs.existsSync(path.join(root, CREATE_RECORD_PATH))).toBe(false);
        expect(readJson(path.join(root, 'apps/storefront/package.json')).name).toBe('storefront');
        expect(fs.readFileSync(path.join(root, 'apps/storefront/.env.local'), 'utf-8')).toContain(
            "VENDURE_SHOP_API_URL='http://localhost:3000/shop-api'",
        );
        expect(fs.readFileSync(path.join(root, '.gitignore'), 'utf-8')).toContain('.env.local');
    });
});

describe('runCreate() when the install fails', () => {
    it('keeps the record, stops the running step and names the git commands', async () => {
        install.fail = true;
        const { events, reporter } = recordingReporter();
        const options = optionsFor('failed-install', { git: true });
        const error = await runCreate(options, {
            createVersion: '4.0.0',
            assetsDir,
            logLevel: 'silent',
            reporter,
            projectDirArg: 'x',
        }).then(
            () => undefined,
            (e: unknown) => e as CreateError,
        );

        expect(error).toBeInstanceOf(CreateError);
        expect(error?.code).toBe('create.install-failed');
        expect(error?.fix).toContain('git init');
        expect(error?.fix).toContain(
            'Your choices are kept in .vendure/create.json, and the agent files are written.',
        );
        expect(readJson(path.join(options.projectDir, CREATE_RECORD_PATH))).toMatchObject({
            preset: { name: 'uk', options: {} },
        });
        expect(events.slice(0, 3)).toEqual([
            'start: Writing the project in ' + options.projectDir,
            'stop: Wrote the project files',
            'start: Installing dependencies with npm',
        ]);
        expect(events).toContain('fail: The install failed');
        expect(fs.existsSync(path.join(options.projectDir, '.git'))).toBe(false);
    });

    it('still writes the agent files, which need no install', async () => {
        install.fail = true;
        const options = optionsFor('failed-install-agents', { agents: ['claude'] });
        const error = await runCreate(options, {
            createVersion: '4.0.0',
            assetsDir,
            logLevel: 'silent',
            reporter: recordingReporter().reporter,
            projectDirArg: 'x',
        }).then(
            () => undefined,
            (e: unknown) => e as CreateError,
        );

        expect(error?.fix).toContain('After the install, run `npx vendure mcp install --client <client>`');
        for (const file of ['AGENTS.md', 'CLAUDE.md', '.mcp.json', '.agents/skills/vendure-cli/SKILL.md']) {
            expect(fs.existsSync(path.join(options.projectDir, file))).toBe(true);
        }
        expect(readJson(path.join(options.projectDir, CREATE_RECORD_PATH)).agents).toEqual(['claude']);
    });

    it('names git init before vendure mcp install, which writes at the git root', async () => {
        install.fail = true;
        const options = optionsFor('failed-install-git', {
            agents: ['claude'],
            git: true,
            storefront: 'nextjs',
        });
        const error = await runCreate(options, {
            createVersion: '4.0.0',
            assetsDir,
            logLevel: 'silent',
            reporter: recordingReporter().reporter,
            projectDirArg: 'x',
        }).then(
            () => undefined,
            (e: unknown) => e as CreateError,
        );
        expect(error?.fix).toContain(
            'After the install, run `git init`, then `npx vendure mcp install --client <client>` for each agent client, then `git add -A` and `git commit`.',
        );
        expect(fs.existsSync(path.join(options.projectDir, 'apps/server/.mcp.json'))).toBe(false);
    });

    it('says why the configs need more without git in a workspace', async () => {
        install.fail = true;
        const options = optionsFor('failed-install-no-git', { agents: ['claude'], storefront: 'nextjs' });
        const error = await runCreate(options, {
            createVersion: '4.0.0',
            assetsDir,
            logLevel: 'silent',
            reporter: recordingReporter().reporter,
            projectDirArg: 'x',
        }).then(
            () => undefined,
            (e: unknown) => e as CreateError,
        );
        expect(error?.fix).toContain('The agent configs need more: the project has no git repository');
    });
});

describe('runCreate() when vendure mcp install cannot complete the configs', () => {
    const run = (options: CreateOptions) =>
        runCreate(options, {
            createVersion: '4.0.0',
            assetsDir,
            logLevel: 'silent',
            reporter: recordingReporter().reporter,
            projectDirArg: 'x',
        });

    it('does not install into apps/server when the workspace has no git repository', async () => {
        const result = await run(
            optionsFor('no-git-workspace', { storefront: 'nextjs', agents: ['claude'] }),
        );
        expect(result.agentFiles.failed).toEqual([
            { client: 'claude', reason: expect.stringContaining('would write into apps/server') },
        ]);
        expect(result.next.some(line => line.includes('mcp install'))).toBe(false);
        expect(fs.existsSync(path.join(workDir, 'no-git-workspace/apps/server/.mcp.json'))).toBe(false);
    });

    it('names no command for a project inside another repository', async () => {
        const outer = path.join(workDir, 'outer-repo');
        fs.mkdirSync(outer);
        execFileSync('git', ['init', '--quiet', outer]);
        const result = await run({
            ...optionsFor('outer-repo/inner', { agents: ['claude'], git: true }),
            projectDir: path.join(outer, 'inner'),
        });
        expect(result.git).toEqual({
            status: 'skipped',
            reason: 'the project directory is already inside a git repository',
        });
        expect(result.agentFiles.failed).toEqual([
            { client: 'claude', reason: expect.stringContaining('inside another git repository') },
        ]);
        expect(result.next.some(line => line.includes('mcp install'))).toBe(false);
    });
});

describe('initGitRepository() and commitAll()', () => {
    it('reports a failed commit without throwing', async () => {
        const dir = path.join(workDir, 'git-fails');
        fs.mkdirSync(dir);
        fs.writeFileSync(path.join(dir, 'file.txt'), 'x');
        // No identity, and git told not to guess one, so the commit fails.
        const emptyConfig = path.join(workDir, 'empty-gitconfig');
        fs.writeFileSync(emptyConfig, '[user]\n\tuseConfigOnly = true\n');
        vi.stubEnv('GIT_CONFIG_GLOBAL', emptyConfig);
        vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
        for (const key of [
            'GIT_AUTHOR_NAME',
            'GIT_AUTHOR_EMAIL',
            'GIT_COMMITTER_NAME',
            'GIT_COMMITTER_EMAIL',
            'EMAIL',
        ]) {
            vi.stubEnv(key, undefined);
        }
        try {
            expect(await initGitRepository(dir)).toEqual({ status: 'initialised' });
            const result = await commitAll(dir);
            expect(result.status).toBe('failed');
            expect(result.status === 'failed' && result.reason).toMatch(/^`git commit` failed/);
        } finally {
            vi.unstubAllEnvs();
        }
    });
});
