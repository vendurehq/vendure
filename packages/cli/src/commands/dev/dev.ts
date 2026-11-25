import { log } from '@clack/prompts';
import chokidar from 'chokidar';
import { ChildProcess, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Dirent, existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import ts from 'typescript';

import {
    forEachLine,
    getProcessPrefix,
    resolvePackageBin,
    signalToExitCode,
    writePrefixedLines,
} from '../../shared/cli-process-utils.js';
import { showConsoleHintIfUnlinked } from '../../shared/console-hint.js';
import { showStarPromptOnce } from '../../shared/star-prompt.js';
import { resolveCoreProjectDirectory } from '../../utilities/monorepo-utils.js';

import { DevChildMonitor, DevRun, DEVSERVER_DETACHED_ENV_VAR } from './dev-run.js';

export type DevTarget = 'all' | 'server' | 'worker' | 'dashboard';

interface DevProcessDefinition {
    target: Exclude<DevTarget, 'all'>;
    packageName: string;
    binName: string;
    nodeArgs: string[];
    args: string[];
    requiredFile?: string;
    reloadOnChange: boolean;
    color: (text: string) => string;
}

export interface DevOptions {
    project?: string;
    serverEntry?: string;
    workerEntry?: string;
    viteConfig?: string;
    inspect?: boolean | string;
    inspectBrk?: boolean | string;
    reload?: boolean;
    /**
     * Paths that hold generated files, such as the `src/gql` directory a Dashboard Vite plugin
     * writes GraphQL codegen output into. A change under one of these paths never restarts the
     * server or the worker, so codegen triggered by an earlier source change does not cause a
     * second restart of its own.
     *
     * A relative path is resolved against the project directory.
     */
    reloadIgnoredPaths?: string[];
}

/**
 * Where a dev run writes what a person reads: the output of its processes, its status lines and
 * its messages. The host gives the command its own, so the run never writes to the terminal itself.
 */
export interface DevIo {
    /** Text from a process, or a status line, for stdout or stderr as it came. */
    write(stream: 'stdout' | 'stderr', text: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

/** The terminal, for a caller that runs `dev` outside the command host. */
export const terminalDevIo: DevIo = {
    write: (stream, text) => (stream === 'stderr' ? process.stderr : process.stdout).write(text),
    info: message => log.info(message),
    warn: message => log.warn(message),
    error: message => log.error(message),
};

/** How a dev run ended. */
export interface DevRunResult {
    exitCode: number;
    /** The run was stopped from outside, by Ctrl+C, a signal or `signal`, not by a process ending. */
    stopped: boolean;
    /** Why the run could not start, such as a missing entry file. No process was started. */
    startError?: string;
}

export interface RunDevOptions {
    io?: DevIo;
    /**
     * Stops the run when it aborts, as Ctrl+C does. Without it, the run stops on SIGINT and SIGTERM
     * itself.
     */
    signal?: AbortSignal;
}

const validTargets: DevTarget[] = ['all', 'server', 'worker', 'dashboard'];
const DEFAULT_INSPECT_PORT = 9229;
const reloadDebounceMs = 100;
const restartShutdownGraceMs = 5000;
const reloadFileExtensions = new Set(['.cts', '.mts', '.ts']);
const reloadIgnoredDirectories = new Set([
    '.git',
    // The state file and the dev log of the run itself.
    '.vendure',
    '.vendure-dashboard-temp',
    '.vite',
    'build',
    'coverage',
    'dist',
    'node_modules',
]);
const reloadIgnoredFileNames = new Set([
    'vite.config.cjs',
    'vite.config.cts',
    'vite.config.js',
    'vite.config.mjs',
    'vite.config.mts',
    'vite.config.ts',
]);

/** Runs `vendure dev` on the terminal, as it ran before the command host. */
export async function devCommand(targetArg?: string, options: DevOptions = {}): Promise<number> {
    const result = await runDev(targetArg, options);
    if (result.stopped) {
        showStarPromptOnce();
    }
    return result.exitCode;
}

/** Runs the dev processes of a project until they end or the run is stopped. */
export async function runDev(
    targetArg?: string,
    options: DevOptions = {},
    { io = terminalDevIo, signal }: RunDevOptions = {},
): Promise<DevRunResult> {
    try {
        const target = normalizeDevTarget(targetArg);
        const projectDir = resolveVendureProjectDirectory(process.cwd(), options.project);
        const devProcessDefinitions = getDevProcessDefinitions(options, target);
        const processes =
            target === 'all'
                ? (['server', 'worker', 'dashboard'] as const).map(t => devProcessDefinitions[t])
                : [devProcessDefinitions[target]];
        const prefixOutput = processes.length > 1;
        const reloadIgnoredPaths = resolveReloadIgnoredPaths(projectDir, options);
        const runsServer = processes.some(processDefinition => processDefinition.target === 'server');

        validateProjectFiles(projectDir, processes);
        // Once per process start. File-watcher restarts happen inside startDevProcess.
        showConsoleHintIfUnlinked(projectDir, message => io.info(message));

        // A run started by `vendure devserver start` writes to a file, not a terminal, and the dev
        // log already holds its processes' output.
        const detached = process.env[DEVSERVER_DETACHED_ENV_VAR] === '1';
        // Only a run that starts the server writes the state file and the dev log, so a second
        // terminal running `vendure dev dashboard` leaves them alone. It refuses to start while
        // another live run holds the state file.
        const run = new DevRun({
            projectDir,
            targets: processes.map(processDefinition => processDefinition.target),
            writeState: runsServer,
            requireStateFile: detached,
            warn: message => io.warn(message),
            print: (processTarget, stream, text) => {
                if (!detached) {
                    printChildOutput(
                        devProcessDefinitions[processTarget as keyof typeof devProcessDefinitions],
                        { stream, text, prefixOutput },
                        io,
                    );
                }
            },
        });
        try {
            const children = processes.map(processDefinition =>
                startDevProcess(projectDir, processDefinition, {
                    prefixOutput,
                    reload: options.reload !== false && processDefinition.reloadOnChange,
                    reloadIgnoredPaths,
                    env: run.childEnv(processDefinition.target),
                    monitor: run.monitor(processDefinition.target),
                    io,
                }),
            );
            let shutdownSignal: NodeJS.Signals | undefined;
            const exitCode = await waitForDevProcesses(children, {
                onError: error => io.error(error.message),
                onShutdownSignal: received => (shutdownSignal = received),
                signal,
            });
            return { exitCode, stopped: shutdownSignal === 'SIGINT' };
        } finally {
            run.end();
        }
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        // A caller with its own io reports the error itself, as a coded error.
        if (io === terminalDevIo) {
            io.error(message);
        }
        return { exitCode: 1, stopped: false, startError: message };
    }
}

/**
 * The paths whose changes never restart the server or the worker: the paths the caller passes,
 * and the GraphQL output directory that the project's Dashboard Vite config writes generated files
 * into. Relative paths are resolved against the project directory.
 */
export function resolveReloadIgnoredPaths(projectDir: string, options: DevOptions = {}): string[] {
    const paths = [...(options.reloadIgnoredPaths ?? []), ...discoverGeneratedPaths(projectDir, options)];
    return [...new Set(paths.map(ignoredPath => path.resolve(projectDir, ignoredPath)))];
}

const defaultViteConfigFileNames = [
    'vite.config.mts',
    'vite.config.ts',
    'vite.config.mjs',
    'vite.config.js',
    'vite.config.cts',
    'vite.config.cjs',
];

/**
 * Reads the `gqlOutputPath` option of the Dashboard Vite plugin from the project's Vite config.
 * The plugin writes `graphql.ts` there when the Dashboard starts, inside the watched source tree.
 */
function discoverGeneratedPaths(projectDir: string, options: DevOptions): string[] {
    const configPath = options.viteConfig
        ? path.resolve(projectDir, options.viteConfig)
        : defaultViteConfigFileNames
              .map(fileName => path.join(projectDir, fileName))
              .find(filePath => existsSync(filePath));
    if (!configPath) {
        return [];
    }
    let source: string;
    try {
        source = readFileSync(configPath, 'utf-8');
    } catch {
        return [];
    }
    const sourceFile = ts.createSourceFile(configPath, source, ts.ScriptTarget.Latest, true);
    const paths: string[] = [];
    const visit = (node: ts.Node) => {
        if (
            ts.isPropertyAssignment(node) &&
            getPropertyName(node.name) === 'gqlOutputPath' &&
            isStringLiteralLike(node.initializer)
        ) {
            paths.push(node.initializer.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return paths;
}

function printChildOutput(
    processDefinition: DevProcessDefinition,
    { stream, text, prefixOutput }: { stream: 'stdout' | 'stderr'; text: string; prefixOutput: boolean },
    io: DevIo,
) {
    const prefix = prefixOutput ? `${getProcessPrefix(processDefinition)} ` : '';
    writePrefixedLines({ write: (chunk: string) => io.write(stream, chunk) }, prefix, text);
}

export function getDevProcessDefinitions(
    options: DevOptions = {},
    target: DevTarget = 'all',
): Record<Exclude<DevTarget, 'all'>, DevProcessDefinition> {
    const serverEntry = options.serverEntry ?? './src/index.ts';
    const workerEntry = options.workerEntry ?? './src/index-worker.ts';
    const dashboardArgs = ['--clearScreen', 'false'];
    if (options.viteConfig) {
        dashboardArgs.push('--config', options.viteConfig);
    }

    return {
        server: {
            target: 'server',
            packageName: 'ts-node',
            binName: 'ts-node',
            nodeArgs: getInspectArgs(options, target, 'server'),
            args: [serverEntry],
            requiredFile: serverEntry,
            reloadOnChange: true,
            color: pc.blue,
        },
        worker: {
            target: 'worker',
            packageName: 'ts-node',
            binName: 'ts-node',
            nodeArgs: getInspectArgs(options, target, 'worker'),
            args: [workerEntry],
            requiredFile: workerEntry,
            reloadOnChange: true,
            color: pc.cyan,
        },
        dashboard: {
            target: 'dashboard',
            packageName: 'vite',
            binName: 'vite',
            nodeArgs: [],
            args: dashboardArgs,
            requiredFile: options.viteConfig,
            reloadOnChange: false,
            color: pc.magenta,
        },
    };
}

export function normalizeDevTarget(targetArg?: string): DevTarget {
    const target = (targetArg ?? 'all').trim();
    if (validTargets.includes(target as DevTarget)) {
        return target as DevTarget;
    }
    throw new Error(`Unknown dev target "${target}". Expected one of: ${validTargets.join(', ')}`);
}

export function resolveVendureProjectDirectory(cwd: string, project?: string): string {
    return resolveCoreProjectDirectory(cwd, project, '--dir');
}

interface DevChildOptions {
    prefixOutput: boolean;
    /** The environment of the child. Defaults to the environment of this process. */
    env?: NodeJS.ProcessEnv;
    /**
     * Receives what happens to the child. The child's output is piped to it line by line, and the
     * monitor decides what reaches the terminal.
     */
    monitor: DevChildMonitor;
    /** Where status lines go. Defaults to the terminal. */
    io?: DevIo;
}

function startDevProcess(
    projectDir: string,
    processDefinition: DevProcessDefinition,
    options: DevChildOptions & { reload: boolean; reloadIgnoredPaths: string[] },
): ManagedDevProcess {
    const binPath = resolvePackageBin(processDefinition.packageName, processDefinition.binName, projectDir);
    return options.reload
        ? startSupervisedDevProcess(projectDir, processDefinition, binPath, options)
        : startPlainDevProcess(projectDir, processDefinition, binPath, options);
}

function spawnDevChild(
    projectDir: string,
    processDefinition: DevProcessDefinition,
    binPath: string,
    options: DevChildOptions,
): ChildProcess {
    const baseEnv = options.env ?? process.env;
    const stdinMode = options.prefixOutput ? 'ignore' : 'inherit';
    const child = spawn(
        process.execPath,
        [...processDefinition.nodeArgs, binPath, ...processDefinition.args],
        {
            cwd: projectDir,
            env: {
                ...baseEnv,
                FORCE_COLOR: baseEnv.FORCE_COLOR ?? '1',
            },
            stdio: [stdinMode, 'pipe', 'pipe'],
        },
    );
    forEachLine(child.stdout, line => options.monitor.onOutput('stdout', line));
    forEachLine(child.stderr, line => options.monitor.onOutput('stderr', line));
    return child;
}

function startPlainDevProcess(
    projectDir: string,
    processDefinition: DevProcessDefinition,
    binPath: string,
    options: DevChildOptions,
): ManagedDevProcess {
    options.monitor.onSpawn(false);
    const child = spawnDevChild(projectDir, processDefinition, binPath, options);
    const runningProcess = new ManagedDevProcess(signal => {
        stopChildWithGrace(child, signal, restartShutdownGraceMs);
    });

    child.once('error', error => runningProcess.emit('error', error));
    child.once('close', (code, signal) => runningProcess.emitClose(code, signal));

    return runningProcess;
}

export interface SupervisedDevProcessOptions extends DevChildOptions {
    reloadIgnoredPaths: string[];
    // Tests pass a fake child process here, to drive the supervisor without spawning anything.
    spawnChild?: typeof spawnDevChild;
}

export function startSupervisedDevProcess(
    projectDir: string,
    processDefinition: DevProcessDefinition,
    binPath: string,
    options: SupervisedDevProcessOptions,
): ManagedDevProcess {
    const spawnChild = options.spawnChild ?? spawnDevChild;
    let dashboardExtensionDirectories = discoverDashboardExtensionDirectories(projectDir);
    let child: ChildProcess | undefined;
    let crashExitCode: number | undefined;
    let restartTimer: NodeJS.Timeout | undefined;
    let restarting = false;
    let stopping = false;
    const reloadPathScope = (): ReloadPathScope => ({
        dashboardExtensionDirectories,
        reloadIgnoredPaths: options.reloadIgnoredPaths,
    });
    const watcher = chokidar.watch(projectDir, {
        ignoreInitial: true,
        ignored: (filePath: string) => isAlwaysIgnoredReloadPath(filePath, projectDir, reloadPathScope()),
    });

    const runningProcess = new ManagedDevProcess(signal => {
        stopping = true;
        if (restartTimer) {
            clearTimeout(restartTimer);
        }
        closeWatcher();
        if (child) {
            stopChildWithGrace(child, signal, restartShutdownGraceMs);
        } else {
            // The child crashed, and the close handler left the watcher open so a later file change
            // could respawn it. Nothing will respawn it now, so report the process closed, carrying
            // the code the child crashed with. Without this, `waitForDevProcesses` waits forever for
            // a child that no longer exists.
            runningProcess.emitClose(crashExitCode ?? 0, null);
        }
    });

    const startChild = (restart: boolean) => {
        crashExitCode = undefined;
        options.monitor.onSpawn(restart);
        const startedChild = spawnChild(projectDir, processDefinition, binPath, options);
        child = startedChild;
        startedChild.once('error', error => runningProcess.emit('error', error));
        startedChild.once('close', (code, signal) => {
            // Node fires `exit` (which is what `isChildRunning` reads) before `close`, so a file
            // change between the two can already see this child as not running and start its
            // replacement directly, ahead of this handler. `child` will have moved on to that
            // replacement by the time this late `close` arrives; without this check, restarting
            // below would take it right back off the current child and leave the replacement
            // running unwatched, the two of them apparently competing for the same port.
            if (child !== startedChild) {
                return;
            }
            if (restarting && !stopping) {
                restarting = false;
                startChild(true);
                return;
            }
            // A process that reported a startup error failed to start, even with a code 0 exit.
            const failedToStart = !stopping && signal === null && options.monitor.hasStartupError();
            if (!failedToStart && !isRecoverableChildExit(code, signal, stopping)) {
                closeWatcher();
                runningProcess.emitClose(code, signal);
                return;
            }
            // Leave the other supervised processes running, and leave the watcher open so that the
            // next relevant file change respawns this one. Remember the exit code: if the run ends
            // before the watcher respawns this process, the run failed.
            // A failed start that exited with code 0 still fails the run if nothing restarts it.
            const exitCode = code || 1;
            child = undefined;
            crashExitCode = exitCode;
            writeDevStatus(
                processDefinition,
                `${options.monitor.onRecoverableExit(exitCode)}. Waiting for a file change to restart it.`,
                options,
            );
        });
    };

    function closeWatcher() {
        void watcher.close().catch(error => runningProcess.emit('error', error));
    }

    const restartChild = (changedFile: string) => {
        // A change that arrives while the child is still shutting down for an earlier change is
        // part of that restart: the replacement starts once the old child has closed, and it reads
        // the files as they are then.
        if (stopping || runningProcess.hasClosed || restarting) {
            return;
        }
        const runningChild = child && isChildRunning(child) ? child : undefined;
        const action = runningChild ? 'Restarting' : 'Starting';
        writeDevStatus(
            processDefinition,
            `Change detected in ${path.relative(projectDir, changedFile)}. ${action} the ${processDefinition.target}...`,
            options,
        );
        dashboardExtensionDirectories = discoverDashboardExtensionDirectories(projectDir);
        if (!runningChild) {
            startChild(true);
            return;
        }
        restarting = true;
        stopChildWithGrace(runningChild, 'SIGTERM', restartShutdownGraceMs);
    };

    watcher.on('all', (_event, filePath) => {
        if (stopping || !shouldRestartOnFileChange(filePath, projectDir, reloadPathScope())) {
            return;
        }
        // Report the restart as soon as the change is seen, so that the state does not say `ready`
        // or `failed` for the old process during the debounce and while it shuts down.
        options.monitor.onChangeDetected();
        if (restartTimer) {
            clearTimeout(restartTimer);
        }
        restartTimer = setTimeout(() => restartChild(filePath), reloadDebounceMs);
    });
    watcher.once('error', error => runningProcess.emit('error', error));

    startChild(false);
    return runningProcess;
}

interface WaitForDevProcessesOptions {
    onError?: (error: Error) => void;
    onShutdownSignal?: (signal: NodeJS.Signals) => void;
    /**
     * Stops the processes when it aborts, as SIGINT does. With it, the run leaves SIGINT and
     * SIGTERM to its caller, such as the command host, which aborts it on either.
     */
    signal?: AbortSignal;
}

export function waitForDevProcesses(
    children: ManagedDevProcess[],
    options: WaitForDevProcessesOptions = {},
): Promise<number> {
    if (children.length === 0) {
        return Promise.resolve(0);
    }

    return new Promise(resolve => {
        let resolved = false;
        let shutdownRequested = false;
        let shutdownExitCode: number | undefined;
        let remainingChildren = children.length;
        let firstNonZeroExitCode = 0;
        const settledChildren = new Set<ManagedDevProcess>();

        const cleanup = () => {
            process.off('SIGINT', handleSigint);
            process.off('SIGTERM', handleSigterm);
            options.signal?.removeEventListener('abort', handleSigint);
        };
        const resolveOnce = (code: number) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(code);
            }
        };
        const stopChildren = (signal: NodeJS.Signals, exitCode?: number) => {
            shutdownRequested = true;
            shutdownExitCode ??= exitCode;
            for (const child of children) {
                if (!settledChildren.has(child)) {
                    child.stop(signal);
                }
            }
        };
        const runExitCode = (lastExitCode: number): number => {
            // A signal delivered to the whole run decides the exit code, so Ctrl+C reports 130 even
            // when a supervised process had crashed and not been respawned.
            if (shutdownExitCode) {
                return shutdownExitCode;
            }
            // Otherwise the first child to fail on its own decides the exit code. A supervised
            // process that crashed earlier fails the run this way, when another process then exits
            // cleanly and ends the run.
            if (firstNonZeroExitCode) {
                return firstNonZeroExitCode;
            }
            return shutdownExitCode ?? lastExitCode;
        };
        // `isOwnFailure` marks an exit code that the child chose for itself, rather than one it was
        // given by the shutdown. Such a code is recorded even once a shutdown is under way. A
        // supervised process that crashed earlier reports that crash only when another process ends
        // the run, by which point the shutdown has already started.
        const completeChild = (child: ManagedDevProcess, exitCode: number, isOwnFailure: boolean) => {
            if (settledChildren.has(child)) {
                return;
            }
            settledChildren.add(child);
            remainingChildren--;
            if (isOwnFailure && exitCode !== 0 && firstNonZeroExitCode === 0) {
                firstNonZeroExitCode = exitCode;
            }
            if (!shutdownRequested) {
                stopChildren('SIGTERM', exitCode);
            }
            if (remainingChildren === 0) {
                resolveOnce(runExitCode(exitCode));
            }
        };
        const handleSignal = (signal: NodeJS.Signals) => {
            options.onShutdownSignal?.(signal);
            stopChildren(signal, signalToExitCode(signal));
        };
        const handleSigint = () => handleSignal('SIGINT');
        const handleSigterm = () => handleSignal('SIGTERM');

        if (options.signal) {
            if (options.signal.aborted) {
                handleSigint();
            } else {
                options.signal.addEventListener('abort', handleSigint, { once: true });
            }
        } else {
            process.once('SIGINT', handleSigint);
            process.once('SIGTERM', handleSigterm);
        }

        for (const child of children) {
            child.once('error', error => {
                options.onError?.(error);
                completeChild(child, 1, !shutdownRequested);
            });
            child.once('close', (code, signal) => {
                completeChild(
                    child,
                    code ?? signalToExitCode(signal) ?? (shutdownRequested ? 0 : 1),
                    signal === null,
                );
            });
        }
    });
}

export class ManagedDevProcess extends EventEmitter {
    private closed = false;

    constructor(private readonly stopFn: (signal: NodeJS.Signals) => void) {
        super();
    }

    get hasClosed(): boolean {
        return this.closed;
    }

    stop(signal: NodeJS.Signals): void {
        if (!this.closed) {
            this.stopFn(signal);
        }
    }

    emitClose(code: number | null, signal: NodeJS.Signals | null): void {
        if (!this.closed) {
            this.closed = true;
            this.emit('close', code, signal);
        }
    }
}

function writeDevStatus(
    processDefinition: DevProcessDefinition,
    message: string,
    options: { prefixOutput: boolean; io?: DevIo },
) {
    const io = options.io ?? terminalDevIo;
    if (options.prefixOutput) {
        io.write('stdout', `${getProcessPrefix(processDefinition)} ${message}\n`);
    } else {
        io.info(message);
    }
}

function stopChildWithGrace(child: ChildProcess, signal: NodeJS.Signals, graceMs: number): void {
    if (!isChildRunning(child)) {
        return;
    }
    const forceKillTimer = setTimeout(() => {
        if (isChildRunning(child)) {
            child.kill('SIGKILL');
        }
    }, graceMs);
    child.once('close', () => clearTimeout(forceKillTimer));
    child.kill(signal);
}

function isChildRunning(child: ChildProcess): boolean {
    return child.exitCode === null && child.signalCode === null;
}

// Whether a supervised child that just closed should be left for the watcher to respawn, rather
// than treated as the whole `dev` run ending. Only a non-zero exit code the child chose for itself
// qualifies, such as ts-node failing to compile after an edit. A signal means `kill` or a process
// manager decided the process should stop. A later file change fixes none of the other cases: a
// zero exit, a close carrying neither a code nor a signal, or a shutdown in progress.
export function isRecoverableChildExit(
    code: number | null,
    signal: NodeJS.Signals | null,
    stopping: boolean,
): code is number {
    return !stopping && signal === null && code !== null && code !== 0;
}

export interface ReloadPathScope {
    // Vite reloads these on its own.
    dashboardExtensionDirectories?: string[];
    // Already resolved to absolute paths by `devCommand`.
    reloadIgnoredPaths?: string[];
}

export function shouldRestartOnFileChange(
    filePath: string,
    projectDir: string,
    scope: ReloadPathScope = {},
): boolean {
    if (isAlwaysIgnoredReloadPath(filePath, projectDir, scope)) {
        return false;
    }
    const fileName = path.basename(filePath);
    if (reloadIgnoredFileNames.has(fileName)) {
        return false;
    }
    // Declaration files have no runtime effect, so generated types should not churn process restarts.
    if (isTypeDeclarationFile(fileName)) {
        return false;
    }
    if (fileName === '.env' || fileName.startsWith('.env.')) {
        return true;
    }
    return reloadFileExtensions.has(path.extname(fileName));
}

function isAlwaysIgnoredReloadPath(filePath: string, projectDir: string, scope: ReloadPathScope): boolean {
    const relativePath = path.relative(projectDir, filePath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return true;
    }
    const normalizedRelativePath = normalizePath(relativePath);
    const parts = normalizedRelativePath.split('/');
    if (parts.some(part => reloadIgnoredDirectories.has(part) || part === '__data__')) {
        return true;
    }
    if (scope.dashboardExtensionDirectories?.some(dir => isPathInside(filePath, dir))) {
        return true;
    }
    return scope.reloadIgnoredPaths?.some(ignoredPath => isPathInside(filePath, ignoredPath)) ?? false;
}

export function discoverDashboardExtensionDirectories(projectDir: string): string[] {
    const directories = new Set<string>();
    for (const filePath of findDashboardMetadataCandidateFiles(projectDir)) {
        let contents: string;
        try {
            contents = readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }
        for (const dashboardEntryPath of getDashboardEntryPathsFromSource(contents, filePath)) {
            const resolvedPath = path.isAbsolute(dashboardEntryPath)
                ? dashboardEntryPath
                : path.resolve(path.dirname(filePath), dashboardEntryPath);
            directories.add(path.extname(resolvedPath) ? path.dirname(resolvedPath) : resolvedPath);
        }
    }
    return [...directories];
}

function findDashboardMetadataCandidateFiles(projectDir: string): string[] {
    const files: string[] = [];

    const visit = (dir: string) => {
        let entries: Dirent[];
        try {
            entries = readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const filePath = path.join(dir, entry.name);
            if (isAlwaysIgnoredReloadPath(filePath, projectDir, {})) {
                continue;
            }
            if (entry.isDirectory()) {
                visit(filePath);
            } else if (
                reloadFileExtensions.has(path.extname(entry.name)) &&
                !isTypeDeclarationFile(entry.name)
            ) {
                files.push(filePath);
            }
        }
    };

    visit(projectDir);
    return files;
}

function getDashboardEntryPathsFromSource(source: string, filePath: string): string[] {
    const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
    const dashboardEntryPaths: string[] = [];

    const visit = (node: ts.Node) => {
        if (ts.isClassDeclaration(node)) {
            const decorators = ts.canHaveDecorators(node) ? (ts.getDecorators(node) ?? []) : [];
            for (const decorator of decorators) {
                const expression = decorator.expression;
                if (!ts.isCallExpression(expression) || !isVendurePluginDecoratorCall(expression)) {
                    continue;
                }
                const metadata = expression.arguments[0];
                if (!metadata || !ts.isObjectLiteralExpression(metadata)) {
                    continue;
                }
                const dashboardEntryPath = getDashboardEntryPathFromMetadata(metadata);
                if (dashboardEntryPath) {
                    dashboardEntryPaths.push(dashboardEntryPath);
                }
            }
        }
        ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return dashboardEntryPaths;
}

function isVendurePluginDecoratorCall(callExpression: ts.CallExpression): boolean {
    const expression = callExpression.expression;
    if (ts.isIdentifier(expression)) {
        return expression.text === 'VendurePlugin';
    }
    if (ts.isPropertyAccessExpression(expression)) {
        return expression.name.text === 'VendurePlugin';
    }
    return false;
}

function getDashboardEntryPathFromMetadata(metadata: ts.ObjectLiteralExpression): string | undefined {
    const dashboardProperty = metadata.properties.find(
        property => ts.isPropertyAssignment(property) && getPropertyName(property.name) === 'dashboard',
    );
    if (!dashboardProperty || !ts.isPropertyAssignment(dashboardProperty)) {
        return;
    }
    const initializer = dashboardProperty.initializer;
    if (isStringLiteralLike(initializer)) {
        return initializer.text;
    }
    if (ts.isObjectLiteralExpression(initializer)) {
        const locationProperty = initializer.properties.find(
            property => ts.isPropertyAssignment(property) && getPropertyName(property.name) === 'location',
        );
        if (locationProperty && ts.isPropertyAssignment(locationProperty)) {
            const locationInitializer = locationProperty.initializer;
            if (isStringLiteralLike(locationInitializer)) {
                return locationInitializer.text;
            }
        }
    }
}

function getPropertyName(propertyName: ts.PropertyName): string | undefined {
    if (
        ts.isIdentifier(propertyName) ||
        ts.isStringLiteral(propertyName) ||
        ts.isNumericLiteral(propertyName)
    ) {
        return propertyName.text;
    }
}

function isStringLiteralLike(node: ts.Node): node is ts.StringLiteral | ts.NoSubstitutionTemplateLiteral {
    return ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
}

function isPathInside(filePath: string, parentPath: string): boolean {
    const relativePath = path.relative(parentPath, filePath);
    return (
        relativePath === '' ||
        (!!relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath))
    );
}

function normalizePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

function isTypeDeclarationFile(fileName: string): boolean {
    return /\.d\.[cm]?ts$/.test(fileName);
}

function getInspectArgs(
    options: DevOptions,
    commandTarget: DevTarget,
    processTarget: Exclude<DevTarget, 'all' | 'dashboard'>,
): string[] {
    if (options.inspect && options.inspectBrk) {
        throw new Error('Use either --inspect or --inspect-brk, not both.');
    }
    const inspectValue = options.inspectBrk ?? options.inspect;
    if (inspectValue == null || inspectValue === false) {
        return [];
    }
    if (commandTarget === 'dashboard') {
        throw new Error('--inspect can only be used with the server or worker dev targets.');
    }
    const inspectFlag = options.inspectBrk ? '--inspect-brk' : '--inspect';
    if (commandTarget === 'all') {
        return [`${inspectFlag}=${resolveInspectAddress(inspectValue, processTarget === 'server' ? 0 : 1)}`];
    }
    if (inspectValue === true) {
        return [inspectFlag];
    }
    return [`${inspectFlag}=${inspectValue}`];
}

function resolveInspectAddress(inspectValue: true | string, portOffset: number): string {
    if (inspectValue === true) {
        return String(DEFAULT_INSPECT_PORT + portOffset);
    }
    const match = /^(.*:)?(\d+)$/.exec(inspectValue);
    if (!match) {
        throw new Error('When using --inspect with "dev all", pass a numeric port or host:port value.');
    }
    const host = match[1] ?? '';
    const port = Number(match[2]);
    return `${host}${port + portOffset}`;
}

function validateProjectFiles(projectDir: string, processes: DevProcessDefinition[]) {
    for (const processDefinition of processes) {
        if (processDefinition.requiredFile) {
            assertFileExists(projectDir, processDefinition.requiredFile);
        }
    }
}

function assertFileExists(projectDir: string, relativePath: string) {
    if (!existsSync(path.join(projectDir, relativePath))) {
        throw new Error(
            `Could not find ${relativePath}. Run this command from a Vendure server project root.`,
        );
    }
}
