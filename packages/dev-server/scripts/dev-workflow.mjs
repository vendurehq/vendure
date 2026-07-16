import { spawn, spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const devServerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(devServerDir, '../..');
const cliPath = path.resolve(devServerDir, '../cli/dist/cli.js');
const portlessCliPath = path.join(path.dirname(fileURLToPath(import.meta.resolve('portless'))), 'cli.js');
const typescriptCliPath = require.resolve('typescript/bin/tsc');
const packageManager = process.env.npm_execpath || 'bun';
const mode = process.argv[2] ?? 'portless';
const usePortless = mode !== 'direct';

if (!['portless', 'direct'].includes(mode)) {
    console.error(`Unknown development mode "${mode}". Expected "portless" or "direct".`);
    process.exit(1);
}

const apiOrigin = usePortless ? getPortlessUrl('vendure') : 'http://localhost:3000';
const dashboardOrigin = usePortless ? getPortlessUrl('dashboard.vendure') : 'http://localhost:5173';
const dashboardUrl = `${dashboardOrigin}/dashboard`;
const sharedDevelopmentEnv = {
    VENDURE_DASHBOARD_URL: dashboardUrl,
    ...(usePortless
        ? {
              VENDURE_TRUST_PROXY: 'true',
              VITE_ADMIN_API_HOST: apiOrigin,
              VITE_ADMIN_API_PORT: 'auto',
          }
        : {
              VITE_ADMIN_API_HOST: 'http://localhost',
              VITE_ADMIN_API_PORT: '3000',
          }),
};

await buildPrerequisites(sharedDevelopmentEnv);

console.log('\nStarting development processes...');
console.log(`API:       ${apiOrigin}`);
console.log(`Dashboard: ${dashboardUrl}/\n`);

let shuttingDown = false;
const processes = new Set();

function onUnexpectedExit(label, code, signal) {
    if (shuttingDown) {
        return;
    }
    const exitDescription = signal ? `signal ${signal}` : `code ${code ?? 1}`;
    console.error(`\n[${label}] exited unexpectedly with ${exitDescription}.`);
    shutdown(signal === 'SIGINT' ? 130 : 1);
}

class RestartableProcess {
    constructor({ label, command, args, env, onUnexpectedExit }) {
        this.label = label;
        this.command = command;
        this.args = args;
        this.env = env;
        this.onUnexpectedExit = onUnexpectedExit;
    }

    start() {
        if (shuttingDown) {
            return;
        }
        this.child = spawnPrefixed({
            label: this.label,
            command: this.command,
            args: this.args,
            env: this.env,
            onClose: (code, signal) => {
                if (this.restarting && !shuttingDown) {
                    this.restarting = false;
                    this.start();
                } else {
                    this.onUnexpectedExit(this.label, code, signal);
                }
            },
        });
    }

    restart() {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
            if (shuttingDown) {
                return;
            }
            console.log(`[${this.label}] Dependency rebuild complete. Restarting...`);
            if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
                this.start();
                return;
            }
            this.restarting = true;
            this.child.kill('SIGTERM');
        }, 200);
    }

    stop(signal = 'SIGTERM') {
        clearTimeout(this.restartTimer);
        if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
            this.child.kill(signal);
        }
    }
}

const server = new RestartableProcess({
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
    env: sharedDevelopmentEnv,
    onUnexpectedExit,
});

const dashboard = new RestartableProcess({
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
    env: sharedDevelopmentEnv,
    onUnexpectedExit,
});

const watchers = [
    startWatcher({
        label: 'common',
        command: packageManager,
        args: ['run', '--cwd', path.join(repoRoot, 'packages/common'), 'watch'],
        onSuccessfulRebuild: () => server.restart(),
    }),
    startWatcher({
        label: 'core',
        command: packageManager,
        args: ['run', '--cwd', path.join(repoRoot, 'packages/core'), 'watch'],
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
        ],
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
        ],
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

process.once('SIGINT', () => shutdown(130, 'SIGINT'));
process.once('SIGTERM', () => shutdown(143, 'SIGTERM'));

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
        child.once('error', reject);
        child.once('close', (code, signal) => {
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

function startWatcher({ label, command, args, onSuccessfulRebuild }) {
    let successfulBuildCount = 0;
    const child = spawn(command, args, {
        cwd: devServerDir,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const handleLine = line => {
        if (line.includes('Found 0 errors. Watching for file changes.')) {
            successfulBuildCount++;
            if (successfulBuildCount > 1) {
                onSuccessfulRebuild();
            }
        }
    };
    pipePrefixed(child.stdout, label, handleLine);
    pipePrefixed(child.stderr, label, handleLine);
    child.once('error', error => {
        console.error(`[${label}] ${error.message}`);
        onUnexpectedExit(label, 1);
    });
    child.once('close', (code, signal) => onUnexpectedExit(label, code, signal));
    return {
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
    for (const runningProcess of processes) {
        runningProcess.stop(signal);
    }
    process.exitCode = exitCode;
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
