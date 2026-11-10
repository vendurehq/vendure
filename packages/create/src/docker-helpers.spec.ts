import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cleanUpDockerResources,
    isDockerAvailable,
    probeDockerDaemon,
    startPostgresDatabase,
} from './helpers';
import { log } from './logger';

// Short budgets so a hanging fake `docker` costs each test about a second instead of minutes.
vi.mock('./constants', async importOriginal => ({
    ...(await importOriginal<typeof import('./constants')>()),
    DOCKER_PROBE_TIMEOUT_MS: 1_000,
    DOCKER_START_WAIT_MS: 2_000,
    DOCKER_COMPOSE_TIMEOUT_MS: 1_000,
    DOCKER_COMMAND_TIMEOUT_MS: 1_000,
    PG_READY_MAX_ATTEMPTS: 2,
    PG_READY_POLL_INTERVAL_MS: 10,
}));

vi.mock('./logger', () => ({ log: vi.fn() }));

vi.mock('@clack/prompts', async importOriginal => ({
    ...(await importOriginal<typeof import('@clack/prompts')>()),
    spinner: () => ({ start: () => undefined, stop: () => undefined, message: () => undefined }),
}));

/**
 * A fake `docker` on PATH. FAKE_DOCKER_DAEMON picks how the daemon behaves:
 * `up` answers, `down` refuses at once (like a stopped daemon), `hang` never answers
 * (like the unresponsive Docker Desktop in CLO-1224). Fake `open` and `systemctl`
 * record that an auto-start was attempted instead of starting the real Docker.
 */
const FAKE_DOCKER = `#!/bin/sh
case "$1" in
  -v) echo "Docker version 99.0.0"; exit 0 ;;
esac
[ -n "$FAKE_DOCKER_CALLS" ] && echo "$*" >> "$FAKE_DOCKER_CALLS"
case "$FAKE_DOCKER_DAEMON" in
  up) exit 0 ;;
  boot) [ -e "$FAKE_DOCKER_READY_MARKER" ] && exit 0; echo "Cannot connect to the Docker daemon" >&2; exit 1 ;;
  down) echo "Cannot connect to the Docker daemon" >&2; exit 1 ;;
  hang) exec /bin/sleep 30 ;;
esac
`;
const FAKE_START = `#!/bin/sh
/usr/bin/touch "$FAKE_DOCKER_START_MARKER"
`;

describe('Docker helpers with an unresponsive daemon', () => {
    const originalPath = process.env.PATH;
    let workDir: string;
    let binDir: string;
    let startMarker: string;

    beforeAll(() => {
        workDir = mkdtempSync(path.join(tmpdir(), 'vendure-create-docker-'));
        binDir = path.join(workDir, 'bin');
        mkdirSync(binDir);
        for (const [name, script] of [
            ['docker', FAKE_DOCKER],
            ['open', FAKE_START],
            ['systemctl', FAKE_START],
        ]) {
            writeFileSync(path.join(binDir, name), script);
            chmodSync(path.join(binDir, name), 0o755);
        }
        startMarker = path.join(workDir, 'start-attempted');
    });

    beforeEach(() => {
        process.env.PATH = binDir;
        process.env.FAKE_DOCKER_START_MARKER = startMarker;
        rmSync(startMarker, { force: true });
        vi.mocked(log).mockClear();
    });

    afterEach(() => {
        process.env.PATH = originalPath;
        delete process.env.FAKE_DOCKER_DAEMON;
        delete process.env.FAKE_DOCKER_START_MARKER;
        delete process.env.FAKE_DOCKER_CALLS;
        delete process.env.FAKE_DOCKER_READY_MARKER;
    });

    afterAll(() => {
        rmSync(workDir, { recursive: true, force: true });
    });

    const loggedText = () =>
        vi
            .mocked(log)
            .mock.calls.map(([message]) => message)
            .join('\n');

    describe('probeDockerDaemon', () => {
        it('reports a daemon that answers as running', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'up';
            expect(await probeDockerDaemon()).toBe('running');
        });

        it('reports a daemon that refuses the connection as not running', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'down';
            expect(await probeDockerDaemon()).toBe('not-running');
        });

        // CLO-1224 - `docker` hung for minutes when Docker Desktop's daemon did not answer.
        it('gives up on a daemon that does not answer within the probe timeout', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'hang';
            const started = Date.now();
            expect(await probeDockerDaemon()).toBe('not-responding');
            expect(Date.now() - started).toBeLessThan(5_000);
        });
    });

    describe('isDockerAvailable', () => {
        it('reports Docker as not found when there is no docker binary', async () => {
            process.env.PATH = path.join(workDir, 'empty');
            expect(await isDockerAvailable()).toEqual({ result: 'not-found' });
        });

        it('tries to start a daemon that is not running', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'down';
            expect(await isDockerAvailable()).toEqual({ result: 'not-running' });
            expect(existsSync(startMarker)).toBe(true);
        });

        // A started daemon can take most of DOCKER_START_WAIT_MS to answer. The checks while it
        // boots are spaced out rather than run back to back.
        it('waits for a started daemon without probing it in a tight loop', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'boot';
            const calls = path.join(workDir, 'calls');
            const readyMarker = path.join(workDir, 'ready');
            rmSync(calls, { force: true });
            rmSync(readyMarker, { force: true });
            process.env.FAKE_DOCKER_CALLS = calls;
            process.env.FAKE_DOCKER_READY_MARKER = readyMarker;
            const timer = setTimeout(() => writeFileSync(readyMarker, ''), 600);

            expect(await isDockerAvailable()).toEqual({ result: 'running' });

            clearTimeout(timer);
            expect(existsSync(startMarker)).toBe(true);
            const probes = readFileSync(calls, 'utf8').trim().split('\n');
            expect(probes.length).toBeLessThanOrEqual(4);
        });

        // CLO-1224 - Docker Desktop's processes run, so starting it again does nothing.
        it('reports an unresponsive daemon as not responding without trying to start it', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'hang';
            const started = Date.now();
            expect(await isDockerAvailable()).toEqual({ result: 'not-responding' });
            expect(Date.now() - started).toBeLessThan(5_000);
            expect(existsSync(startMarker)).toBe(false);
        });
    });

    describe('cleanUpDockerResources', () => {
        it('returns when the daemon does not answer', () => {
            process.env.FAKE_DOCKER_DAEMON = 'hang';
            const started = Date.now();
            cleanUpDockerResources('my-shop');
            expect(Date.now() - started).toBeLessThan(5_000);
        });
    });

    describe('startPostgresDatabase', () => {
        // CLO-1224 - `docker compose up -d` hung with no output and no timeout.
        it('stops waiting for docker compose and says how to continue', async () => {
            process.env.FAKE_DOCKER_DAEMON = 'hang';
            const root = path.join(workDir, 'my-shop');
            const started = Date.now();

            expect(await startPostgresDatabase(root, 'my-shop')).toBe(false);

            expect(Date.now() - started).toBeLessThan(5_000);
            const output = loggedText();
            expect(output).toContain(
                `docker compose -f "${path.join(root, 'docker-compose.yml')}" up -d postgres_db`,
            );
            expect(output).toContain('remove the project directory and run the create command again');
        });
    });
});
