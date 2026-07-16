import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolveDevelopmentNetwork } from './dev-network-config.mjs';
import { claimDevStatus } from './dev-state.mjs';
import {
    createWatcherReadiness,
    resolvePackageBin,
    RestartableProcess,
    RestartReadinessCoordinator,
} from './dev-workflow-utils.mjs';

const require = createRequire(import.meta.url);
const devServerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(devServerDir, '../..');
const cliPath = path.resolve(devServerDir, '../cli/dist/cli.js');
const portlessCliPath = resolvePackageBin(import.meta.resolve('portless'), 'portless', 'portless');
const typescriptCliPath = require.resolve('typescript/bin/tsc');
const packageManager = process.env.npm_execpath || 'bun';
const mode = process.argv[2] ?? 'portless';
const agentMode = process.argv.includes('--agent');
const watcherEnvironment = {
    ...process.env,
    // The readiness detector consumes a stable TypeScript watch message. Force English and also
    // enforce a deadline below so an upstream output change fails clearly instead of hanging.
    LC_ALL: 'C',
    LANG: 'C',
};
const HTTP_READINESS_TIMEOUT_MS = 180_000;
const HTTP_RETRY_INTERVAL_MS = 500;

if (!['portless', 'direct'].includes(mode)) {
    console.error(`Unknown development mode "${mode}". Expected "portless" or "direct".`);
    process.exit(1);
}

const {
    usePortless,
    apiOrigin,
    dashboardUrl,
    serverDashboardUrl,
    sharedEnv: sharedDevelopmentEnv,
    serverEnv,
    dashboardEnv,
} = resolveDevelopmentNetwork({
    mode,
    ensurePortlessProxy,
    getPortlessUrl,
});

let shuttingDown = false;
const processes = new Set();
let lifecycle;

if (agentMode) {
    try {
        lifecycle = claimDevStatus({
            cwd: devServerDir,
            initialStatus: {
                status: 'building',
                mode,
                apiUrl: apiOrigin,
                dashboardUrl: `${dashboardUrl}/`,
                serverDashboardUrl,
                ...(process.env.DB ? { database: process.env.DB } : {}),
            },
        });
    } catch (error) {
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

const restartReadiness = lifecycle
    ? new RestartReadinessCoordinator({
          updateStatus(changes) {
              lifecycle.update(changes);
              emitAgentEvent(lifecycle.status);
          },
      })
    : undefined;

process.once('exit', () => lifecycle?.remove());
process.once('SIGINT', () => shutdown(130, 'SIGINT'));
process.once('SIGTERM', () => shutdown(143, 'SIGTERM'));

emitAgentEvent(lifecycle?.status);

try {
    await buildPrerequisites(sharedDevelopmentEnv);
} catch (error) {
    if (shuttingDown) {
        process.exit(process.exitCode ?? 1);
    }
    recordFailure(error);
    console.error(error);
    process.exit(1);
}

console.log('\nStarting development processes...');
console.log(`API:       ${apiOrigin}`);
console.log(`Dashboard: ${dashboardUrl}/\n`);
lifecycle?.update({ status: 'starting' });
emitAgentEvent(lifecycle?.status);

function onUnexpectedExit(label, code, signal) {
    if (shuttingDown) {
        return;
    }
    const exitDescription = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`\n[${label}] exited unexpectedly with ${exitDescription}.`);
    recordFailure(new Error(`${label} exited unexpectedly with ${exitDescription}`));
    shutdown(signal === 'SIGINT' ? 130 : 1);
}

const server = new RestartableProcess({
    label: 'server',
    spawnProcess: onClose =>
        spawnPrefixed({
            label: 'server',
            command: process.execPath,
            args: usePortless
                ? [
                      portlessCliPath,
                      'run',
                      '--name',
                      'vendure',
                      process.execPath,
                      cliPath,
                      'dev',
                      'server',
                      '--server-entry',
                      './index.ts',
                  ]
                : [cliPath, 'dev', 'server', '--server-entry', './index.ts'],
            env: { ...sharedDevelopmentEnv, ...serverEnv },
            onClose,
        }),
    onUnexpectedExit,
    shouldRestart: () => !shuttingDown,
    onRestarting: beginRestart,
    onRestarted: (_label, token) =>
        restartReadiness?.complete('server', token, () =>
            Promise.all([
                waitForHttp(`${apiOrigin}/health`, 'API health endpoint'),
                waitForHttp(serverDashboardUrl, 'server-served Dashboard'),
            ]),
        ),
    onRestartFailure: handleReadinessFailure,
});

const dashboard = new RestartableProcess({
    label: 'dashboard',
    spawnProcess: onClose =>
        spawnPrefixed({
            label: 'dashboard',
            command: process.execPath,
            args: usePortless
                ? [
                      portlessCliPath,
                      'run',
                      '--name',
                      'dashboard.vendure',
                      process.execPath,
                      cliPath,
                      'dev',
                      'dashboard',
                      '--vite-config',
                      './vite.config.mts',
                  ]
                : [cliPath, 'dev', 'dashboard', '--vite-config', './vite.config.mts'],
            env: { ...sharedDevelopmentEnv, ...dashboardEnv },
            onClose,
        }),
    onUnexpectedExit,
    shouldRestart: () => !shuttingDown,
    onRestarting: beginRestart,
    onRestarted: (_label, token) =>
        restartReadiness?.complete('dashboard', token, () =>
            waitForHttp(`${dashboardUrl}/`, 'Dashboard Vite server'),
        ),
    onRestartFailure: handleReadinessFailure,
});

const watchers = [
    startWatcher({
        label: 'common',
        command: packageManager,
        args: ['run', '--cwd', path.join(repoRoot, 'packages/common'), 'watch'],
        env: watcherEnvironment,
        onSuccessfulRebuild: () => server.restart(),
    }),
    startWatcher({
        label: 'core',
        command: packageManager,
        args: ['run', '--cwd', path.join(repoRoot, 'packages/core'), 'watch'],
        env: watcherEnvironment,
        onSuccessfulRebuild: () => server.restart(),
    }),
    startWatcher({
        label: 'dashboard-vite',
        command: process.execPath,
        args: [
            typescriptCliPath,
            '--project',
            path.join(repoRoot, 'packages/dashboard/tsconfig.vite.json'),
            '--watch',
            '--preserveWatchOutput',
            '--locale',
            'en',
        ],
        env: watcherEnvironment,
        onSuccessfulRebuild: () => dashboard.restart(),
    }),
    startWatcher({
        label: 'dashboard-plugin',
        command: process.execPath,
        args: [
            typescriptCliPath,
            '--project',
            path.join(repoRoot, 'packages/dashboard/tsconfig.plugin.json'),
            '--watch',
            '--preserveWatchOutput',
            '--locale',
            'en',
        ],
        env: watcherEnvironment,
        onSuccessfulRebuild: () => server.restart(),
    }),
];

for (const watcher of watchers) {
    processes.add(watcher);
}
processes.add(server);
processes.add(dashboard);

server.start();
dashboard.start();

if (lifecycle) {
    const initialReadinessToken = restartReadiness.begin('initial');
    restartReadiness
        .complete('initial', initialReadinessToken, () => waitForReadiness(watchers))
        .catch(handleReadinessFailure);
} else {
    for (const watcher of watchers) {
        watcher.ready.catch(() => undefined);
    }
}

function getPortlessUrl(name) {
    const result = spawnSync(process.execPath, [portlessCliPath, 'get', name], {
        cwd: devServerDir,
        env: process.env,
        encoding: 'utf8',
    });
    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || `Could not resolve the Portless URL for ${name}`);
    }
    return result.stdout.trim().replace(/\/$/, '');
}

function ensurePortlessProxy() {
    const result = spawnSync(process.execPath, [portlessCliPath, 'proxy', 'start'], {
        cwd: devServerDir,
        env: process.env,
        stdio: 'inherit',
    });
    if (result.status !== 0) {
        throw new Error('Could not start the Portless proxy');
    }
}

async function buildPrerequisites(env) {
    const builds = [
        ['@vendure/common', path.join(repoRoot, 'packages/common')],
        ['@vendure/core', path.join(repoRoot, 'packages/core')],
        ['@vendure/cli', path.join(repoRoot, 'packages/cli')],
        ['@vendure/asset-server-plugin', path.join(repoRoot, 'packages/asset-server-plugin')],
        ['@vendure/email-plugin', path.join(repoRoot, 'packages/email-plugin')],
        ['@vendure/graphiql-plugin', path.join(repoRoot, 'packages/graphiql-plugin')],
        ['@vendure/telemetry-plugin', path.join(repoRoot, 'packages/telemetry-plugin')],
        ['@vendure/dashboard', path.join(repoRoot, 'packages/dashboard')],
    ];

    console.log('Building dev-server prerequisites...');
    for (const [label, cwd] of builds) {
        console.log(`\nBuilding ${label}...`);
        await runForeground(packageManager, ['run', '--cwd', cwd, 'build']);
    }

    console.log('\nBuilding a clean server-served Dashboard...');
    rmSync(path.join(devServerDir, 'dist'), { recursive: true, force: true });
    await runForeground(packageManager, ['run', 'build:dashboard'], env);
}

function runForeground(command, args, env = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: devServerDir,
            env: { ...process.env, ...env },
            stdio: 'inherit',
        });
        const runningProcess = {
            stop(signal = 'SIGTERM') {
                if (child.exitCode === null && child.signalCode === null) {
                    child.kill(signal);
                }
            },
        };
        processes.add(runningProcess);
        child.once('error', error => {
            processes.delete(runningProcess);
            reject(error);
        });
        child.once('close', (code, signal) => {
            processes.delete(runningProcess);
            if (code === 0) {
                resolve();
            } else {
                reject(
                    new Error(
                        `${command} ${args.join(' ')} failed with ${
                            signal ? `signal ${signal}` : `code ${code ?? 1}`
                        }`,
                    ),
                );
            }
        });
    });
}

function startWatcher({ label, command, args, env, onSuccessfulRebuild }) {
    const child = spawn(command, args, {
        cwd: devServerDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const readiness = createWatcherReadiness({
        label,
        onSuccessfulRebuild,
    });
    pipePrefixed(child.stdout, label, readiness.handleLine);
    pipePrefixed(child.stderr, label, readiness.handleLine);
    child.once('error', error => {
        readiness.fail(error);
        console.error(`[${label}] ${error.message}`);
        onUnexpectedExit(label, 1);
    });
    child.once('close', (code, signal) => {
        if (!readiness.isReady) {
            readiness.fail(new Error(`${label} exited before its initial build completed`));
        }
        onUnexpectedExit(label, code, signal);
    });
    return {
        ready: readiness.ready,
        stop(signal = 'SIGTERM') {
            if (child.exitCode === null && child.signalCode === null) {
                child.kill(signal);
            }
        },
    };
}

function pipePrefixed(stream, label, onLine = () => undefined) {
    let buffered = '';
    stream?.on('data', data => {
        buffered += data.toString();
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            onLine(line);
            process.stdout.write(line ? `[${label}] ${line}\n` : '\n');
        }
    });
    stream?.on('end', () => {
        if (buffered) {
            onLine(buffered);
            process.stdout.write(`[${label}] ${buffered}\n`);
        }
    });
}

function shutdown(exitCode, signal = 'SIGTERM') {
    if (shuttingDown) {
        return;
    }
    shuttingDown = true;
    if (lifecycle?.status.status !== 'failed') {
        lifecycle?.update({ status: 'stopping' });
        emitAgentEvent(lifecycle?.status);
    }
    for (const runningProcess of processes) {
        runningProcess.stop(signal);
    }
    process.exitCode = exitCode;
}

async function waitForReadiness(activeWatchers) {
    await Promise.all([
        ...activeWatchers.map(watcher => watcher.ready),
        waitForHttp(`${apiOrigin}/health`, 'API health endpoint'),
        waitForHttp(`${dashboardUrl}/`, 'Dashboard Vite server'),
        waitForHttp(serverDashboardUrl, 'server-served Dashboard'),
    ]);
}

function waitForHttp(url, label, timeoutMs = HTTP_READINESS_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
        const check = () => {
            if (shuttingDown) {
                reject(new Error(`Stopped while waiting for ${label}`));
                return;
            }

            const client = url.startsWith('https:') ? httpsGet : httpGet;
            const request = client(
                url,
                {
                    rejectUnauthorized: false,
                    timeout: 2_000,
                },
                response => {
                    response.resume();
                    if (response.statusCode && response.statusCode >= 200 && response.statusCode < 400) {
                        resolve();
                    } else {
                        retry(`${label} returned HTTP ${response.statusCode ?? 'unknown'}`);
                    }
                },
            );
            request.once('timeout', () => request.destroy(new Error(`${label} request timed out`)));
            request.once('error', error => retry(error.message));
        };

        const retry = lastError => {
            if (Date.now() >= deadline) {
                reject(new Error(`Timed out waiting for ${label}: ${lastError}`));
                return;
            }
            setTimeout(check, HTTP_RETRY_INTERVAL_MS);
        };

        check();
    });
}

function recordFailure(error) {
    if (!lifecycle || lifecycle.status.status === 'failed') {
        return;
    }
    lifecycle.update({
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
    });
    emitAgentEvent(lifecycle.status);
}

function emitAgentEvent(status) {
    if (status) {
        console.log(`VENDURE_DEV_EVENT=${JSON.stringify(status)}`);
    }
}

function beginRestart(label) {
    if (shuttingDown) {
        return undefined;
    }
    console.log(`[${label}] Dependency rebuild complete. Restarting...`);
    return restartReadiness?.begin(label);
}

function handleReadinessFailure(error) {
    if (shuttingDown) {
        return;
    }
    recordFailure(error);
    console.error(`[readiness] ${error.message}`);
    shutdown(1);
}

function spawnPrefixed({ label, command, args, env, onClose }) {
    const child = spawn(command, args, {
        cwd: devServerDir,
        env: { ...process.env, ...env },
        stdio: ['inherit', 'pipe', 'pipe'],
    });
    pipePrefixed(child.stdout, label);
    pipePrefixed(child.stderr, label);
    child.once('error', error => {
        console.error(`[${label}] ${error.message}`);
        onClose(1);
    });
    child.once('close', onClose);
    return child;
}
