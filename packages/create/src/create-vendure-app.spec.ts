import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const { probeDockerDaemonMock, cleanUpDockerResourcesMock } = vi.hoisted(() => ({
    probeDockerDaemonMock: vi.fn(),
    cleanUpDockerResourcesMock: vi.fn(),
}));

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
        probeDockerDaemon: probeDockerDaemonMock,
        cleanUpDockerResources: cleanUpDockerResourcesMock,
    };
});
vi.mock('node:timers/promises', () => ({ setTimeout: () => Promise.resolve(undefined) }));

describe('createVendureApp()', () => {
    const originalArgv = process.argv;
    let workDir: string;

    beforeAll(() => {
        workDir = mkdtempSync(path.join(tmpdir(), 'vendure-create-hint-'));
        mkdirSync(path.join(workDir, 'app'));
        mkdirSync(path.join(workDir, 'ci-postgres-app'));
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

    // OSS-932 - a failed email template copy stops create with a non-zero exit code.
    it('exits with code 1 when the email templates cannot be copied', async () => {
        const { createVendureApp } = await import('./create-vendure-app');
        mkdirSync(path.join(workDir, 'app-templates'));
        // Importing the module already called process.exit(1), so drop that call first.
        const exitSpy = vi.mocked(process.exit);
        exitSpy.mockClear();

        // resolvePackageRootDir points at a missing package, so the template copy fails first.
        await createVendureApp(path.join(workDir, 'app-templates'), false, 'silent', true);

        expect(exitSpy.mock.calls[0]).toEqual([1]);
    }, 30000);

    // CLO-1224 - --ci never ran the Docker check, so an unresponsive daemon hung the
    // cleanup and `docker compose up` that follow.
    it('stops before calling Docker when the daemon does not respond in --ci postgres mode', async () => {
        const { createVendureApp } = await import('./create-vendure-app');
        const { DOCKER_NOT_RESPONDING_MESSAGE } = await import('./helpers');
        events.length = 0;
        probeDockerDaemonMock.mockResolvedValue('not-responding');
        // A failed template copy also exits with code 1, so give it a source to copy. Then only
        // the Docker check can produce the exit(1) under test.
        const templateDir = path.join(tmpdir(), 'vendure-create-missing-package', 'templates');
        mkdirSync(templateDir, { recursive: true });
        const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: string | number | null) => {
            if (code === 1) {
                throw new Error('process.exit');
            }
        }) as never);

        const outcome = await createVendureApp(
            path.join(workDir, 'ci-postgres-app'),
            false,
            'silent',
            true,
            undefined,
            'postgres',
        )
            .then(
                () => 'returned',
                (e: Error) => e.message,
            )
            .finally(() => rmSync(path.dirname(templateDir), { recursive: true, force: true }));

        expect(outcome).toBe('process.exit');
        expect(exit).toHaveBeenCalledWith(1);
        expect(events.at(-1)).toContain(DOCKER_NOT_RESPONDING_MESSAGE);
        expect(cleanUpDockerResourcesMock).not.toHaveBeenCalled();
    }, 30000);
});
