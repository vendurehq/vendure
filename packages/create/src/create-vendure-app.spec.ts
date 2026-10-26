import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { events, projectRequireStub } = vi.hoisted(() => {
    const hoistedEvents: string[] = [];
    // One object stands in for everything the scaffold requires from the new project: ts-node,
    // @vendure/core's populate and bootstrap entry points, and the generated vendure-config.
    const stub = {
        register: () => undefined,
        populate: () => Promise.resolve({ close: () => Promise.resolve(undefined) }),
        bootstrap: () => Promise.resolve(undefined),
        generateMigration: () => Promise.resolve('init-migration'),
        runMigrations: () => Promise.resolve(undefined),
        DefaultLogger: class {},
        LogLevel: { Error: 0, Info: 1, Verbose: 2 },
        JobQueueService: class {},
        config: { authOptions: { superadminCredentials: undefined }, dbConnectionOptions: {} },
    };
    return { events: hoistedEvents, projectRequireStub: stub };
});

// Records the order of the closing output: the "Setup complete!" note, the hint, then the outro.
vi.mock('@clack/prompts', async importOriginal => ({
    ...(await importOriginal<typeof import('@clack/prompts')>()),
    intro: () => undefined,
    select: () => Promise.resolve('quick'),
    spinner: () => ({ start: () => undefined, stop: () => undefined, message: () => undefined }),
    cancel: () => undefined,
    note: (_message: string, title: string) => events.push(`note: ${title}`),
    outro: (message: string) => events.push(`outro: ${message}`),
    log: { info: (message: string) => events.push(`hint: ${message}`) },
}));
// Skips the installs, the database check and the real project require, which need a real project.
vi.mock('./helpers', async importOriginal => {
    const actual = await importOriginal<typeof import('./helpers')>();
    return {
        ...actual,
        findAvailablePort: () => Promise.resolve(3000),
        checkThatNpmCanReadCwd: () => true,
        installPackages: () => Promise.resolve(undefined),
        checkDbConnection: () => Promise.resolve(undefined),
        createProjectRequire: () => () => projectRequireStub,
        resolvePackageRootDir: () => path.join(tmpdir(), 'vendure-create-missing-package'),
    };
});
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve(undefined) }));

describe('createVendureApp() Console hint', () => {
    const originalArgv = process.argv;
    let workDir: string;

    beforeAll(() => {
        workDir = mkdtempSync(path.join(tmpdir(), 'vendure-create-hint-'));
        mkdirSync(path.join(workDir, 'app'));
        vi.stubEnv('FORCE_HYPERLINK', '0');
        // Importing the module runs it once without a project directory. process.exit must not stop the test run.
        process.argv = ['node', 'create'];
        vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
        vi.spyOn(process, 'chdir').mockImplementation(() => undefined);
    });

    afterAll(() => {
        process.argv = originalArgv;
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
        rmSync(workDir, { recursive: true, force: true });
    });

    // OSS-882 - the hint appears once, between "Setup complete!" and "Happy hacking!".
    it('prints the hint once between the Setup complete note and the outro', async () => {
        const { createVendureApp } = await import('./create-vendure-app');
        const { getConsoleHint } = await import('./console-hint');
        events.length = 0;

        await createVendureApp(path.join(workDir, 'app'), false, 'silent', true);

        expect(events.map(event => event.split(':')[0])).toEqual(['note', 'hint', 'outro']);
        expect(events[0]).toContain('Setup complete!');
        expect(events[1]).toBe(`hint: ${getConsoleHint(false)}`);
        expect(events[2]).toContain('Happy hacking!');
    }, 30000);
});
