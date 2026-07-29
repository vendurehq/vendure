import spawn from 'cross-spawn';
import fs from 'fs-extra';
import Handlebars from 'handlebars';
import { EventEmitter } from 'node:events';
import { Socket, createServer, type Server } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerEscapeSingleHelper } from './gather-user-responses';
import {
    checkNodeVersion,
    detectPackageManager,
    findAvailablePort,
    getInstallCommand,
    getMonorepoRootPackageJson,
    getNativeBuildDependencies,
    getPackageManagerInfo,
    getPnpmWorkspaceYaml,
    getServerPackageScripts,
    getSingleProjectPackageJson,
    getYarnDependenciesMeta,
    getYarnRcYml,
    installPackages,
    isServerPortInUse,
    registerTemplateHelpers,
    toComposeProjectName,
} from './helpers';
import { log } from './logger';
import { PackageManager } from './types';

// Replace the project's logger with a spy so we can assert on warning calls
// without coupling to its console-printing behaviour.
vi.mock('./logger', () => ({
    log: vi.fn(),
}));

// Mocked so installPackages can be exercised without spawning real package managers.
vi.mock('cross-spawn', () => {
    const spawnMock = vi.fn();
    (spawnMock as any).sync = vi.fn();
    return { default: spawnMock };
});

/**
 * Binds an ephemeral port on 127.0.0.1 and returns both the server and its
 * port. The caller is responsible for closing the server (or relying on
 * `afterEach` cleanup).
 */
function listenOnEphemeralPort(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (typeof address === 'object' && address !== null) {
                resolve({ server, port: address.port });
            } else {
                reject(new Error('Could not determine ephemeral port'));
            }
        });
    });
}

function closeServer(server: Server): Promise<void> {
    return new Promise((resolve, reject) => {
        server.close(err => (err ? reject(err) : resolve()));
    });
}

describe('isServerPortInUse', () => {
    let openServers: Server[] = [];

    afterEach(async () => {
        for (const server of openServers) {
            await closeServer(server).catch(() => undefined);
        }
        openServers = [];
        vi.restoreAllMocks();
        vi.mocked(log).mockClear();
    });

    it('returns true when a server is listening on the port', async () => {
        const { server, port } = await listenOnEphemeralPort();
        openServers.push(server);

        await expect(isServerPortInUse(port)).resolves.toBe(true);
    });

    it('returns false when no server is listening on the port', async () => {
        // Reserve and release an ephemeral port so we know it's currently free.
        const { server, port } = await listenOnEphemeralPort();
        await closeServer(server);

        await expect(isServerPortInUse(port)).resolves.toBe(false);
    });

    it('returns false again once the server stops listening', async () => {
        const { server, port } = await listenOnEphemeralPort();
        openServers.push(server);
        await expect(isServerPortInUse(port)).resolves.toBe(true);

        await closeServer(server);
        openServers = [];
        await expect(isServerPortInUse(port)).resolves.toBe(false);
    });

    it.each([0, -1, 70000, 3.14, NaN, Number.POSITIVE_INFINITY])(
        'rejects with "Invalid port" for invalid input %s',
        async invalid => {
            await expect(isServerPortInUse(invalid)).rejects.toThrow(/Invalid port/);
        },
    );

    it('times out rather than hanging when the SYN is silently dropped', async () => {
        // Simulate a firewall that drops SYN packets: connect() neither resolves
        // nor emits ECONNREFUSED. Without a setTimeout guard the promise would
        // hang for the OS-level connect timeout (~75s macOS, ~127s Linux).
        const connectSpy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
            // Intentionally never emit anything — let the socket's own timeout fire.
            return this;
        });

        await expect(isServerPortInUse(12345)).rejects.toThrow(/Timed out/);
        expect(connectSpy).toHaveBeenCalledOnce();
    });

    it('rejects with the underlying error on non-ECONNREFUSED socket failures', async () => {
        // Intercept Socket.connect so the next call emits a synthetic
        // EHOSTUNREACH error instead of actually opening a connection. This
        // covers the production code path that surfaces "real" socket
        // failures (e.g. EACCES on privileged ports, EHOSTUNREACH on DNS
        // misconfiguration) without needing elevated privileges or DNS
        // tricks at test time.
        const connectSpy = vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
            queueMicrotask(() => {
                const err = new Error('Host unreachable') as NodeJS.ErrnoException;
                err.code = 'EHOSTUNREACH';
                this.emit('error', err);
            });
            return this;
        });

        await expect(isServerPortInUse(12345)).rejects.toMatchObject({ code: 'EHOSTUNREACH' });
        expect(connectSpy).toHaveBeenCalledOnce();
        expect(log).toHaveBeenCalledWith(expect.stringContaining('could not determine'));
    });
});

describe('findAvailablePort', () => {
    let openServers: Server[] = [];

    afterEach(async () => {
        for (const server of openServers) {
            await closeServer(server).catch(() => undefined);
        }
        openServers = [];
        vi.restoreAllMocks();
    });

    it('returns the first available port when the start port is free', async () => {
        const { server, port } = await listenOnEphemeralPort();
        await closeServer(server);

        await expect(findAvailablePort(port, 5)).resolves.toBe(port);
    });

    it('skips occupied ports until it finds a free one', async () => {
        const { server: busy, port: busyPort } = await listenOnEphemeralPort();
        openServers.push(busy);

        const next = await findAvailablePort(busyPort, 100);
        expect(next).toBeGreaterThan(busyPort);
    });

    it('surfaces probe failures with a useful message rather than masking them', async () => {
        // Make every probe reject with EACCES so the loop can't paper over it.
        vi.spyOn(Socket.prototype, 'connect').mockImplementation(function (this: Socket) {
            queueMicrotask(() => {
                const err = new Error('Permission denied') as NodeJS.ErrnoException;
                err.code = 'EACCES';
                this.emit('error', err);
            });
            return this;
        });

        await expect(findAvailablePort(3000, 1)).rejects.toThrow(/Could not probe port/);
    });
});

// #4390 — `bunx @vendure/create` failed with `spawn npm ENOENT` because the
// installer hard-coded `npm`. These cover the package-manager detection and the
// per-manager install command used to fix it.
describe('detectPackageManager', () => {
    it('detects each package manager from its npm_config_user_agent', () => {
        expect(detectPackageManager('npm/10.2.4 node/v20.11.0 linux x64')).toBe('npm');
        expect(detectPackageManager('yarn/1.22.19 npm/? node/v20.11.0 linux x64')).toBe('yarn');
        expect(detectPackageManager('pnpm/8.15.1 npm/? node/v20.11.0 linux x64')).toBe('pnpm');
        expect(detectPackageManager('bun/1.3.5 npm/? node/v20.11.0 linux x64')).toBe('bun');
    });

    it('detects a bare manager name with no version segment', () => {
        expect(detectPackageManager('pnpm')).toBe('pnpm');
    });

    it('falls back to npm for empty or unknown user agents', () => {
        expect(detectPackageManager('')).toBe('npm');
        expect(detectPackageManager('deno/1.40.0')).toBe('npm');
    });

    it('falls back to npm when no user agent env var is set', () => {
        const original = process.env.npm_config_user_agent;
        delete process.env.npm_config_user_agent;
        try {
            expect(detectPackageManager()).toBe('npm');
        } finally {
            if (original !== undefined) {
                process.env.npm_config_user_agent = original;
            }
        }
    });
});

describe('getInstallCommand', () => {
    const deps = ['@vendure/core@3.0.0', 'dotenv'];

    it('builds npm install with exact versions', () => {
        const { command, args } = getInstallCommand('npm', { dependencies: deps, logLevel: 'silent' });
        expect(command).toBe('npm');
        expect(args).toEqual([
            'install',
            '--save',
            '--save-exact',
            '--loglevel',
            'error',
            '@vendure/core@3.0.0',
            'dotenv',
        ]);
    });

    it('adds --save-dev for npm dev dependencies and --verbose when verbose', () => {
        const { args } = getInstallCommand('npm', {
            dependencies: deps,
            isDevDependencies: true,
            logLevel: 'verbose',
        });
        expect(args).toContain('--save-dev');
        expect(args).toContain('--verbose');
    });

    it('uses `add --exact` for yarn and bun', () => {
        for (const pm of ['yarn', 'bun'] as const) {
            const prod = getInstallCommand(pm, { dependencies: deps, logLevel: 'silent' });
            expect(prod.command).toBe(pm);
            expect(prod.args).toEqual(['add', '--exact', '@vendure/core@3.0.0', 'dotenv']);

            const dev = getInstallCommand(pm, {
                dependencies: deps,
                isDevDependencies: true,
                logLevel: 'silent',
            });
            expect(dev.args).toEqual(['add', '--exact', '--dev', '@vendure/core@3.0.0', 'dotenv']);
        }
    });

    it('uses `add --save-exact` / `--save-dev` for pnpm', () => {
        const prod = getInstallCommand('pnpm', { dependencies: deps, logLevel: 'silent' });
        expect(prod).toEqual({
            command: 'pnpm',
            args: ['add', '--save-exact', '@vendure/core@3.0.0', 'dotenv'],
        });
        const dev = getInstallCommand('pnpm', {
            dependencies: deps,
            isDevDependencies: true,
            logLevel: 'silent',
        });
        expect(dev.args).toContain('--save-dev');
    });

    // #4390 — with no explicit packages (e.g. installing the downloaded storefront from
    // its own manifest), `<pm> add` with no args errors for yarn/pnpm/bun, so we fall
    // back to the plain `install` subcommand which all four managers accept.
    it('installs from the manifest with a bare `install` when there are no dependencies', () => {
        for (const pm of ['npm', 'yarn', 'pnpm', 'bun'] as const) {
            expect(getInstallCommand(pm, { dependencies: [], logLevel: 'silent' })).toEqual({
                command: pm,
                args: ['install'],
            });
        }
    });
});

describe('getPackageManagerInfo', () => {
    it('provides run/exec/install/ci-install/lockfile per manager', () => {
        const expected: Record<
            PackageManager,
            { runScript: string; exec: string; install: string; ciInstall: string; lockfile: string }
        > = {
            npm: {
                runScript: 'npm run',
                exec: 'npx',
                install: 'npm install',
                ciInstall: 'npm ci',
                lockfile: 'package-lock.json',
            },
            yarn: {
                runScript: 'yarn run',
                exec: 'yarn',
                install: 'yarn install',
                // No --immutable/--frozen-lockfile: those differ between Yarn Classic and Berry.
                ciInstall: 'yarn install',
                lockfile: 'yarn.lock',
            },
            pnpm: {
                runScript: 'pnpm run',
                exec: 'pnpm exec',
                install: 'pnpm install',
                ciInstall: 'pnpm install --frozen-lockfile',
                lockfile: 'pnpm-lock.yaml',
            },
            bun: {
                runScript: 'bun run',
                exec: 'bunx',
                install: 'bun install',
                ciInstall: 'bun install --frozen-lockfile',
                lockfile: 'bun.lock',
            },
        };
        for (const pm of Object.keys(expected) as PackageManager[]) {
            const info = getPackageManagerInfo(pm);
            expect(info.name).toBe(pm);
            expect(info.runScript).toBe(expected[pm].runScript);
            expect(info.exec).toBe(expected[pm].exec);
            expect(info.install).toBe(expected[pm].install);
            expect(info.ciInstall).toBe(expected[pm].ciInstall);
            expect(info.lockfile).toBe(expected[pm].lockfile);
        }
    });

    it('builds workspace run commands in each manager’s syntax', () => {
        expect(getPackageManagerInfo('npm').workspaceScript('server', 'dev')).toBe('npm run dev -w server');
        expect(getPackageManagerInfo('yarn').workspaceScript('server', 'dev')).toBe(
            'yarn workspace server dev',
        );
        expect(getPackageManagerInfo('pnpm').workspaceScript('server', 'dev')).toBe(
            'pnpm --filter server dev',
        );
        expect(getPackageManagerInfo('bun').workspaceScript('server', 'dev')).toBe(
            'bun run --filter server dev',
        );
    });

    it('flags pnpm as needing pnpm-workspace.yaml rather than the package.json workspaces field', () => {
        expect(getPackageManagerInfo('npm').usesPackageJsonWorkspaces).toBe(true);
        expect(getPackageManagerInfo('yarn').usesPackageJsonWorkspaces).toBe(true);
        expect(getPackageManagerInfo('bun').usesPackageJsonWorkspaces).toBe(true);
        expect(getPackageManagerInfo('pnpm').usesPackageJsonWorkspaces).toBe(false);
    });
});

describe('getServerPackageScripts', () => {
    it('delegates dev/build/start to the package-manager-agnostic vendure CLI', () => {
        const scripts = getServerPackageScripts();
        expect(scripts.dev).toBe('vendure dev all');
        expect(scripts.build).toBe('vendure build all');
        expect(scripts.start).toBe('vendure start all');
    });
});

describe('getMonorepoRootPackageJson', () => {
    it('writes workspace scripts in each manager’s syntax', () => {
        const npm = getMonorepoRootPackageJson('my-shop', getPackageManagerInfo('npm'), 'sqlite');
        expect((npm.scripts as Record<string, string>)['dev:server']).toBe('npm run dev -w server');

        const pnpm = getMonorepoRootPackageJson('my-shop', getPackageManagerInfo('pnpm'), 'sqlite');
        expect((pnpm.scripts as Record<string, string>)['dev:server']).toBe('pnpm --filter server dev');

        const bun = getMonorepoRootPackageJson('my-shop', getPackageManagerInfo('bun'), 'sqlite');
        expect((bun.scripts as Record<string, string>)['build:storefront']).toBe(
            'bun run --filter storefront build',
        );
    });

    it('only declares the package.json workspaces field for managers that read it', () => {
        expect(getMonorepoRootPackageJson('x', getPackageManagerInfo('npm'), 'sqlite').workspaces).toEqual([
            'apps/*',
        ]);
        expect(getMonorepoRootPackageJson('x', getPackageManagerInfo('bun'), 'sqlite').workspaces).toEqual([
            'apps/*',
        ]);
        // pnpm uses pnpm-workspace.yaml instead, so the field must be absent.
        expect(
            getMonorepoRootPackageJson('x', getPackageManagerInfo('pnpm'), 'sqlite').workspaces,
        ).toBeUndefined();
    });

    // #4932 — pnpm v11 no longer reads the package.json `pnpm` field; the build-script
    // allowlist lives in pnpm-workspace.yaml instead, so the field must never be written.
    it('does not write a package.json pnpm field for any manager', () => {
        for (const pm of ['npm', 'yarn', 'pnpm', 'bun'] as const) {
            expect(getMonorepoRootPackageJson('x', getPackageManagerInfo(pm), 'sqlite').pnpm).toBeUndefined();
        }
    });

    // #4932 — yarn ≥4.14 does not run dependency build scripts unless allowlisted.
    it('adds dependenciesMeta with built: true only for yarn, driver-aware', () => {
        expect(
            getMonorepoRootPackageJson('x', getPackageManagerInfo('yarn'), 'sqlite').dependenciesMeta,
        ).toEqual({
            bcrypt: { built: true },
            'better-sqlite3': { built: true },
            esbuild: { built: true },
            sharp: { built: true },
        });
        expect(
            getMonorepoRootPackageJson('x', getPackageManagerInfo('npm'), 'sqlite').dependenciesMeta,
        ).toBeUndefined();
        expect(
            getMonorepoRootPackageJson('x', getPackageManagerInfo('pnpm'), 'sqlite').dependenciesMeta,
        ).toBeUndefined();
    });
});

describe('getSingleProjectPackageJson', () => {
    it('writes the unified vendure CLI scripts and stays private', () => {
        const pkg = getSingleProjectPackageJson('my-shop', getPackageManagerInfo('npm'), 'postgres');
        expect(pkg.name).toBe('my-shop');
        expect(pkg.private).toBe(true);
        expect((pkg.scripts as Record<string, string>).dev).toBe('vendure dev all');
    });

    // #4932 — pnpm settings live in pnpm-workspace.yaml; yarn build scripts need allowlisting.
    it('writes manager-specific build-script config fields', () => {
        expect(
            getSingleProjectPackageJson('x', getPackageManagerInfo('pnpm'), 'sqlite').pnpm,
        ).toBeUndefined();
        expect(
            getSingleProjectPackageJson('x', getPackageManagerInfo('yarn'), 'postgres').dependenciesMeta,
        ).toEqual({
            bcrypt: { built: true },
            esbuild: { built: true },
            sharp: { built: true },
        });
        expect(
            getSingleProjectPackageJson('x', getPackageManagerInfo('npm'), 'sqlite').dependenciesMeta,
        ).toBeUndefined();
    });
});

// #4891 — pnpm and yarn do not run dependency build scripts unless allowlisted, so
// e.g. better-sqlite3's native binding never compiles.
describe('getNativeBuildDependencies', () => {
    it('always includes the native deps a Vendure scaffold installs', () => {
        for (const dbType of ['postgres', 'mysql', 'mariadb'] as const) {
            expect(getNativeBuildDependencies(dbType)).toEqual(['bcrypt', 'esbuild', 'sharp']);
        }
    });

    it('adds better-sqlite3 for the SQLite driver', () => {
        expect(getNativeBuildDependencies('sqlite')).toEqual([
            'bcrypt',
            'better-sqlite3',
            'esbuild',
            'sharp',
        ]);
    });
});

// #4932 — pnpm v10 reads `onlyBuiltDependencies`, pnpm v11 replaced it with `allowBuilds`
// and ignores both the old key and the package.json `pnpm` field. Both keys are written
// so the scaffold works under either version.
describe('getPnpmWorkspaceYaml', () => {
    it('declares both the v10 and v11 build-script allowlists', () => {
        const yaml = getPnpmWorkspaceYaml('sqlite');
        expect(yaml).toContain('onlyBuiltDependencies:');
        expect(yaml).toContain('    - better-sqlite3');
        expect(yaml).toContain('allowBuilds:');
        expect(yaml).toContain('    better-sqlite3: true');
        expect(yaml).not.toContain('packages:');
    });

    // pnpm v11 defaults strictDepBuilds to true, which hard-fails the install for any
    // script-bearing dep not covered by allowBuilds (e.g. @apollo/protobufjs, msw).
    it('disables strictDepBuilds so uncovered build scripts warn instead of failing', () => {
        expect(getPnpmWorkspaceYaml('sqlite')).toContain('strictDepBuilds: false');
    });

    it('includes the workspace packages globs when provided (monorepo)', () => {
        const yaml = getPnpmWorkspaceYaml('postgres', ['apps/*']);
        expect(yaml).toContain("packages:\n    - 'apps/*'");
        expect(yaml).toContain('    - bcrypt');
        expect(yaml).not.toContain('better-sqlite3');
    });
});

describe('getYarnDependenciesMeta', () => {
    it('marks each native build dependency as built', () => {
        expect(getYarnDependenciesMeta('sqlite')).toEqual({
            bcrypt: { built: true },
            'better-sqlite3': { built: true },
            esbuild: { built: true },
            sharp: { built: true },
        });
    });
});

describe('getYarnRcYml', () => {
    it('disables Plug’n’Play in favour of a physical node_modules tree', () => {
        expect(getYarnRcYml()).toContain('nodeLinker: node-modules');
    });
});

// #4932 — in monorepo mode the compose file lives in apps/server, so without an explicit
// project name every created project collides on the Compose project "server": the second
// `docker compose up` then hangs forever on an unanswerable "Recreate volume?" prompt.
describe('toComposeProjectName', () => {
    it('passes through already-valid names', () => {
        expect(toComposeProjectName('my-shop')).toBe('my-shop');
        expect(toComposeProjectName('shop_2')).toBe('shop_2');
        expect(toComposeProjectName('123')).toBe('123');
    });

    it('sanitizes disallowed characters and appends a stable suffix', () => {
        expect(toComposeProjectName('My Shop!')).toMatch(/^my-shop-[0-9a-f]{8}$/);
        expect(toComposeProjectName('shop.name')).toMatch(/^shop-name-[0-9a-f]{8}$/);
        expect(toComposeProjectName('--shop')).toMatch(/^shop-[0-9a-f]{8}$/);
        expect(toComposeProjectName('...')).toMatch(/^vendure-[0-9a-f]{8}$/);
        // Deterministic: re-running create over the same directory must yield the same project.
        expect(toComposeProjectName('My Shop!')).toBe(toComposeProjectName('My Shop!'));
    });

    it('keeps distinct names distinct after sanitization', () => {
        const names = ['shop.v1', 'shop v1', 'shop-v1', 'shopv1', 'SHOP-V1'];
        const projects = names.map(toComposeProjectName);
        expect(new Set(projects).size).toBe(names.length);
    });
});

// The Dockerfile template is rendered with helpers registered by registerTemplateHelpers.
// A misspelled helper name renders an empty string silently, so assert real output.
describe('registerTemplateHelpers + Dockerfile template', () => {
    const dockerfileTemplate = fs.readFileSync(path.join(__dirname, '../templates/Dockerfile.hbs'), 'utf-8');

    function renderDockerfile(pm: PackageManager): string {
        registerTemplateHelpers(getPackageManagerInfo(pm));
        return Handlebars.compile(dockerfileTemplate)({
            packageManager: pm,
            isBun: pm === 'bun',
            needsCorepack: pm === 'pnpm' || pm === 'yarn',
        });
    }

    it('renders a bun Dockerfile against the oven/bun base with a frozen install', () => {
        const out = renderDockerfile('bun');
        expect(out).toContain('FROM oven/bun:1');
        expect(out).toContain('COPY package.json bun.lock ./');
        expect(out).toContain('RUN bun install --frozen-lockfile');
        expect(out).toContain('RUN bun run build');
        expect(out).not.toContain('corepack');
    });

    it('renders a pnpm Dockerfile on node with corepack and a frozen install', () => {
        const out = renderDockerfile('pnpm');
        expect(out).toContain('FROM node:20');
        expect(out).toContain('RUN corepack enable');
        expect(out).toContain('COPY package.json pnpm-lock.yaml ./');
        expect(out).toContain('RUN pnpm install --frozen-lockfile');
        expect(out).toContain('RUN pnpm run build');
    });
});

// #4932 — the compose file must pin its own project name so containers/volumes never
// collide across projects (the monorepo layout puts the file in apps/server for everyone).
describe('docker-compose template', () => {
    function renderComposeTemplate(projectName: string): string {
        // Registered by generateSources() in production; needed for the labels/env sections.
        registerEscapeSingleHelper();
        const template = fs.readFileSync(path.join(__dirname, '../templates/docker-compose.hbs'), 'utf-8');
        return Handlebars.compile(template)({
            composeProjectName: toComposeProjectName(projectName),
            dbName: 'vendure',
            dbUserName: 'vendure',
            dbPassword: 'secret',
            name: projectName,
        });
    }

    it('renders the sanitized compose project name', () => {
        expect(renderComposeTemplate('My Shop')).toMatch(/^name: 'my-shop-[0-9a-f]{8}'$/m);
    });

    // Numeric or boolean-looking directory names must stay YAML strings — Compose
    // rejects a non-string project name.
    it('quotes the project name so numeric-looking names stay strings', () => {
        expect(renderComposeTemplate('123')).toContain("name: '123'");
        expect(renderComposeTemplate('true')).toContain("name: 'true'");
    });
});

// #4932 — native deps (e.g. better-sqlite3) stop publishing prebuilt binaries for EOL
// Node versions, so users on them hit cryptic install failures without this heads-up.
describe('checkNodeVersion', () => {
    afterEach(() => {
        vi.mocked(log).mockClear();
    });

    it('warns when running on an EOL Node version', () => {
        checkNodeVersion('>=20.0.0', 'v20.20.2');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('end-of-life'));
    });

    it('does not warn on a maintained Node version', () => {
        checkNodeVersion('>=20.0.0', 'v22.15.0');
        expect(log).not.toHaveBeenCalled();
    });
});

// #4932 — failed installs used to run with stdio: 'ignore' and reject with a generic
// message, hiding the actual package-manager error (npm reports on stderr; yarn and
// pnpm largely on stdout). These pin the captured-output failure messages.
describe('installPackages', () => {
    function fakeChild() {
        const child = new EventEmitter() as any;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        return child;
    }

    afterEach(() => {
        vi.mocked(spawn).mockReset();
    });

    it('resolves when the install exits 0', async () => {
        vi.mocked(spawn).mockImplementation((() => {
            const child = fakeChild();
            setImmediate(() => child.emit('close', 0));
            return child;
        }) as any);

        await expect(
            installPackages({ dependencies: ['dotenv'], logLevel: 'info', packageManager: 'npm' }),
        ).resolves.toBeUndefined();
    });

    it('rejects with the command and captured output tail from both streams', async () => {
        vi.mocked(spawn).mockImplementation((() => {
            const child = fakeChild();
            setImmediate(() => {
                child.stdout.emit('data', Buffer.from('ERR_PNPM_IGNORED_BUILDS Ignored build scripts\n'));
                child.stderr.emit('data', Buffer.from('some stderr detail\n'));
                child.emit('close', 1);
            });
            return child;
        }) as any);

        await expect(
            installPackages({ dependencies: ['dotenv'], logLevel: 'info', packageManager: 'pnpm' }),
        ).rejects.toThrow(
            expect.objectContaining({
                message: expect.stringMatching(
                    /`pnpm add --save-exact dotenv` failed with exit code 1[\s\S]*ERR_PNPM_IGNORED_BUILDS[\s\S]*some stderr detail/,
                ),
            }),
        );
    });

    it('suggests verbose logging when the install produced no output', async () => {
        vi.mocked(spawn).mockImplementation((() => {
            const child = fakeChild();
            setImmediate(() => child.emit('close', 1));
            return child;
        }) as any);

        await expect(
            installPackages({ dependencies: ['dotenv'], logLevel: 'info', packageManager: 'npm' }),
        ).rejects.toThrow(/--log-level verbose/);
    });

    it('rejects with a PATH hint when the package manager cannot be spawned', async () => {
        vi.mocked(spawn).mockImplementation((() => {
            const child = fakeChild();
            setImmediate(() => child.emit('error', new Error('spawn yarn ENOENT')));
            return child;
        }) as any);

        await expect(
            installPackages({ dependencies: ['dotenv'], logLevel: 'info', packageManager: 'yarn' }),
        ).rejects.toThrow(/Is yarn installed and on your PATH\?/);
    });
});
