import { log, spinner } from '@clack/prompts';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import ts from 'typescript';

import {
    getProcessPrefix,
    pipePrefixedOutput,
    resolvePackageBin,
    signalToExitCode,
} from '../../shared/cli-process-utils';
import { resolveVendureProjectDirectory } from '../dev/dev';

export type BuildTarget = 'all' | 'server' | 'worker' | 'dashboard';

export interface BuildProcessDefinition {
    target: Exclude<BuildTarget, 'all'>;
    displayLabel?: string;
    prefixLabel?: string;
    tsconfig?: string;
    packageName: string;
    binName: string;
    args: string[];
    captureOutput: boolean;
    color: (text: string) => string;
}

interface RunningBuildProcess {
    child: ChildProcess;
    processDefinition: BuildProcessDefinition;
    prefixOutput: boolean;
    startedAt: number;
    spinner?: ReturnType<typeof spinner>;
    output?: CapturedBuildOutput;
}

interface CapturedBuildOutput {
    stdout: string;
    stderr: string;
}

interface WaitForBuildProcessesOptions {
    progressRenderer?: BuildProgressRenderer;
}

interface BuildProcessGroupsForTargetOptions {
    runDashboardFirst?: boolean;
}

interface BuildProgressRenderer {
    start(buildProcesses: RunningBuildProcess[]): void;
    complete(buildProcess: RunningBuildProcess): void;
    fail(buildProcess: RunningBuildProcess, message: string): void;
    stop(): void;
}

export interface BuildOptions {
    tsconfig?: string;
    workerTsconfig?: string;
    viteConfig?: string;
    experimentalTsgo?: boolean;
    clean?: boolean;
    progress?: boolean;
    noProgress?: boolean;
    verbose?: boolean;
    watch?: boolean;
}

export interface BuildTsConfigPaths {
    serverTsconfig: string;
    workerTsconfig: string;
}

const validTargets: BuildTarget[] = ['all', 'server', 'worker', 'dashboard'];
const serverTsConfigCandidates = ['./tsconfig.server.json', './tsconfig.build.json', './tsconfig.json'];
const workerTsConfigCandidates = ['./tsconfig.worker.json', './tsconfig.build.json', './tsconfig.json'];

export async function buildCommand(targetArg?: string, options: BuildOptions = {}): Promise<number> {
    try {
        const target = normalizeBuildTarget(targetArg);
        const projectDir = resolveVendureProjectDirectory(process.cwd());
        const tsconfigs = resolveBuildTsConfigs(projectDir, options);

        for (const tsconfig of getBuildTsConfigsForTarget(target, tsconfigs)) {
            validateTsConfig(projectDir, tsconfig);
        }

        if (options.clean) {
            cleanBuildOutputs(projectDir, target, tsconfigs);
        }

        const buildProcessDefinitions = getBuildProcessDefinitions(options, tsconfigs);
        const safeBuildProcessDefinitions = disableDashboardEmptyOutDirForParallelWatchBuilds(
            target,
            options,
            buildProcessDefinitions,
        );
        const useProgress = shouldUseProgress(options);
        const processGroups = getBuildProcessGroupsForTarget(target, safeBuildProcessDefinitions, {
            runDashboardFirst: !options.watch,
        });

        for (const processes of processGroups) {
            const prefixOutput = processes.length > 1;
            const progressRenderer =
                useProgress && shouldUseMultiBuildSpinner(processes)
                    ? createBuildProgressRenderer()
                    : undefined;

            try {
                const children = processes.map(processDefinition =>
                    startBuildProcess(projectDir, processDefinition, {
                        prefixOutput,
                        disableSpinner: !useProgress,
                        suppressStatus: progressRenderer != null,
                    }),
                );
                progressRenderer?.start(children);
                const exitCode = await waitForBuildProcesses(children, {
                    progressRenderer,
                });
                if (exitCode !== 0) {
                    return exitCode;
                }
            } catch (e: unknown) {
                progressRenderer?.stop();
                throw e;
            }
        }
        return 0;
    } catch (e: unknown) {
        log.error(e instanceof Error ? e.message : String(e));
        return 1;
    }
}

export function getBuildProcessDefinitions(
    options: BuildOptions = {},
    tsconfigs: BuildTsConfigPaths = resolveBuildTsConfigs(process.cwd(), options),
): Record<Exclude<BuildTarget, 'all'>, BuildProcessDefinition> {
    const compilerPackageName = options.experimentalTsgo ? '@typescript/native-preview' : 'typescript';
    const compilerBinName = options.experimentalTsgo ? 'tsgo' : 'tsc';
    const dashboardArgs = ['build'];
    if (options.watch) {
        dashboardArgs.push('--watch');
    }
    if (options.viteConfig) {
        dashboardArgs.push('--config', options.viteConfig);
    }
    if (options.clean) {
        dashboardArgs.push('--emptyOutDir');
    }
    if (!options.verbose) {
        dashboardArgs.push('--logLevel', 'warn');
    }
    const compilerArgs = (tsconfig: string) => {
        const args = ['-p', tsconfig, '--noEmitOnError'];
        if (options.watch) {
            args.push('--watch');
        }
        return args;
    };

    return {
        server: {
            target: 'server',
            tsconfig: tsconfigs.serverTsconfig,
            packageName: compilerPackageName,
            binName: compilerBinName,
            args: compilerArgs(tsconfigs.serverTsconfig),
            captureOutput: !options.verbose && !options.watch,
            color: pc.blue,
        },
        worker: {
            target: 'worker',
            tsconfig: tsconfigs.workerTsconfig,
            packageName: compilerPackageName,
            binName: compilerBinName,
            args: compilerArgs(tsconfigs.workerTsconfig),
            captureOutput: !options.verbose && !options.watch,
            color: pc.cyan,
        },
        dashboard: {
            target: 'dashboard',
            packageName: 'vite',
            binName: 'vite',
            args: dashboardArgs,
            captureOutput: !options.verbose && !options.watch,
            color: pc.magenta,
        },
    };
}

export function getBuildProcessesForTarget(
    target: BuildTarget,
    buildProcessDefinitions: Record<Exclude<BuildTarget, 'all'>, BuildProcessDefinition>,
): BuildProcessDefinition[] {
    if (target === 'all') {
        if (buildProcessDefinitions.server.tsconfig !== buildProcessDefinitions.worker.tsconfig) {
            return [
                buildProcessDefinitions.server,
                buildProcessDefinitions.worker,
                buildProcessDefinitions.dashboard,
            ];
        }
        return [
            {
                ...buildProcessDefinitions.server,
                displayLabel: 'server and worker',
                prefixLabel: 'server/worker',
            },
            buildProcessDefinitions.dashboard,
        ];
    }
    return [buildProcessDefinitions[target]];
}

export function getBuildProcessGroupsForTarget(
    target: BuildTarget,
    buildProcessDefinitions: Record<Exclude<BuildTarget, 'all'>, BuildProcessDefinition>,
    options: BuildProcessGroupsForTargetOptions = {},
): BuildProcessDefinition[][] {
    const processes = getBuildProcessesForTarget(target, buildProcessDefinitions);
    if (target !== 'all' || options.runDashboardFirst === false) {
        return [processes];
    }

    const dashboardProcess = processes.find(processDefinition => processDefinition.target === 'dashboard');
    if (!dashboardProcess) {
        return [processes];
    }

    const serverProcesses = processes.filter(processDefinition => processDefinition.target !== 'dashboard');
    if (serverProcesses.length === 0) {
        return [[dashboardProcess]];
    }
    // Vite empties its outDir at build start, so run it before TypeScript can emit server files.
    return [[dashboardProcess], serverProcesses];
}

function disableDashboardEmptyOutDirForParallelWatchBuilds(
    target: BuildTarget,
    options: BuildOptions,
    buildProcessDefinitions: Record<Exclude<BuildTarget, 'all'>, BuildProcessDefinition>,
): Record<Exclude<BuildTarget, 'all'>, BuildProcessDefinition> {
    if (target !== 'all' || !options.watch) {
        return buildProcessDefinitions;
    }
    // Watch builds must run in parallel, so prevent Vite from emptying a shared outDir.
    return {
        ...buildProcessDefinitions,
        dashboard: {
            ...buildProcessDefinitions.dashboard,
            args: [...buildProcessDefinitions.dashboard.args, '--no-emptyOutDir'],
        },
    };
}

export function resolveBuildTsConfigs(projectDir: string, options: BuildOptions = {}): BuildTsConfigPaths {
    const serverTsconfig = options.tsconfig ?? discoverTsConfig(projectDir, serverTsConfigCandidates);
    const workerTsconfig =
        options.workerTsconfig ?? options.tsconfig ?? discoverTsConfig(projectDir, workerTsConfigCandidates);
    return { serverTsconfig, workerTsconfig };
}

export function getBuildTsConfigsForTarget(target: BuildTarget, tsconfigs: BuildTsConfigPaths): string[] {
    if (target === 'dashboard') {
        return [];
    }
    if (target === 'worker') {
        return [tsconfigs.workerTsconfig];
    }
    if (target === 'all') {
        return Array.from(new Set([tsconfigs.serverTsconfig, tsconfigs.workerTsconfig]));
    }
    return [tsconfigs.serverTsconfig];
}

export function shouldUseMultiBuildSpinner(processes: BuildProcessDefinition[]): boolean {
    return processes.length > 1 && processes.every(processDefinition => processDefinition.captureOutput);
}

export function getBuildCleanPathsForTarget(
    projectDir: string,
    target: BuildTarget,
    tsconfigs: BuildTsConfigPaths,
): string[] {
    const cleanPaths = getBuildTsConfigsForTarget(target, tsconfigs)
        .map(tsconfig => getTsConfigOutDir(projectDir, tsconfig))
        .filter((outDir): outDir is string => outDir != null);
    return Array.from(new Set(cleanPaths));
}

export function getTsConfigOutDir(projectDir: string, tsconfig: string): string | undefined {
    const parsed = parseTsConfig(projectDir, tsconfig);
    const outDir = parsed.options.outDir;
    if (!outDir) {
        return;
    }
    return path.isAbsolute(outDir) ? outDir : path.resolve(projectDir, outDir);
}

export function normalizeBuildTarget(targetArg?: string): BuildTarget {
    const target = (targetArg ?? 'all').trim();
    if (validTargets.includes(target as BuildTarget)) {
        return target as BuildTarget;
    }
    throw new Error(`Unknown build target "${target}". Expected one of: ${validTargets.join(', ')}`);
}

export function validateTsConfig(projectDir: string, tsconfig: string = './tsconfig.json') {
    parseTsConfig(projectDir, tsconfig);
}

function parseTsConfig(projectDir: string, tsconfig: string = './tsconfig.json'): ts.ParsedCommandLine {
    const tsconfigPath = path.resolve(projectDir, tsconfig);
    if (!existsSync(tsconfigPath)) {
        throw new Error(`Could not find TypeScript config file: ${tsconfig}`);
    }

    const readResult = ts.readConfigFile(tsconfigPath, fileName => ts.sys.readFile(fileName));
    if (readResult.error) {
        throw new Error(formatTsDiagnostics([readResult.error]));
    }

    const parsed = ts.parseJsonConfigFileContent(
        readResult.config,
        ts.sys,
        path.dirname(tsconfigPath),
        undefined,
        tsconfigPath,
    );
    if (parsed.errors.length) {
        throw new Error(formatTsDiagnostics(parsed.errors));
    }
    return parsed;
}

function discoverTsConfig(projectDir: string, candidates: string[]): string {
    return candidates.find(candidate => existsSync(path.resolve(projectDir, candidate))) ?? './tsconfig.json';
}

function cleanBuildOutputs(projectDir: string, target: BuildTarget, tsconfigs: BuildTsConfigPaths) {
    const cleanPaths = getBuildCleanPathsForTarget(projectDir, target, tsconfigs);
    for (const cleanPath of cleanPaths) {
        assertSafeCleanPath(projectDir, cleanPath);
        rmSync(cleanPath, { recursive: true, force: true });
        log.info(`Cleaned ${path.relative(projectDir, cleanPath)}`);
    }
}

function assertSafeCleanPath(projectDir: string, cleanPath: string) {
    const relativePath = path.relative(projectDir, cleanPath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        throw new Error(`Refusing to clean output directory outside the project: ${cleanPath}`);
    }
}

function startBuildProcess(
    projectDir: string,
    processDefinition: BuildProcessDefinition,
    options: { prefixOutput: boolean; disableSpinner?: boolean; suppressStatus?: boolean },
): RunningBuildProcess {
    const installHint =
        processDefinition.packageName === '@typescript/native-preview'
            ? 'Install @typescript/native-preview to use --experimental-tsgo.'
            : undefined;
    const binPath = resolvePackageBin(
        processDefinition.packageName,
        processDefinition.binName,
        projectDir,
        installHint,
    );
    const buildSpinner =
        !options.disableSpinner && shouldUseSpinner(processDefinition, options.prefixOutput)
            ? spinner()
            : undefined;
    const shouldPipeOutput = options.prefixOutput && !processDefinition.captureOutput;
    const buildLabel = getBuildProcessLabel(processDefinition);
    if (buildSpinner) {
        buildSpinner.start(`Building ${buildLabel} with ${processDefinition.binName}...`);
    } else if (!options.suppressStatus) {
        writeBuildStatus(
            processDefinition,
            options.prefixOutput,
            `Building ${buildLabel} with ${processDefinition.binName}...`,
        );
    }
    const startedAt = Date.now();
    const output: CapturedBuildOutput | undefined = processDefinition.captureOutput
        ? { stdout: '', stderr: '' }
        : undefined;
    const child = spawn(process.execPath, [binPath, ...processDefinition.args], {
        cwd: projectDir,
        env: getChildProcessEnv(),
        stdio: shouldPipeOutput || output ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
    if (shouldPipeOutput) {
        pipePrefixedOutput(child.stdout, process.stdout, processDefinition);
        pipePrefixedOutput(child.stderr, process.stderr, processDefinition);
    } else if (output) {
        captureBuildOutput(child.stdout, 'stdout', output);
        captureBuildOutput(child.stderr, 'stderr', output);
    }
    return {
        child,
        processDefinition,
        prefixOutput: options.prefixOutput,
        startedAt,
        spinner: buildSpinner,
        output,
    };
}

function waitForBuildProcesses(
    buildProcesses: RunningBuildProcess[],
    options: WaitForBuildProcessesOptions = {},
): Promise<number> {
    if (buildProcesses.length === 0) {
        return Promise.resolve(0);
    }

    return new Promise(resolve => {
        let resolved = false;
        let shutdownRequested = false;
        let shutdownExitCode: number | undefined;
        let progressRendererStopped = false;
        let remainingChildren = buildProcesses.length;
        let firstNonZeroExitCode = 0;

        const cleanup = () => {
            process.off('SIGINT', handleSigint);
            process.off('SIGTERM', handleSigterm);
        };
        const resolveOnce = (code: number) => {
            if (!resolved) {
                resolved = true;
                cleanup();
                resolve(code);
            }
        };
        const stopProgressRenderer = () => {
            if (!progressRendererStopped) {
                options.progressRenderer?.stop();
                progressRendererStopped = true;
            }
        };
        const stopChildren = (signal: NodeJS.Signals = 'SIGTERM', exitCode?: number) => {
            shutdownRequested = true;
            shutdownExitCode ??= exitCode;
            for (const { child } of buildProcesses) {
                if (!child.killed && child.exitCode === null) {
                    child.kill(signal);
                }
            }
        };
        const handleSigint = () => stopChildren('SIGINT', signalToExitCode('SIGINT'));
        const handleSigterm = () => stopChildren('SIGTERM', signalToExitCode('SIGTERM'));

        process.once('SIGINT', handleSigint);
        process.once('SIGTERM', handleSigterm);

        for (const buildProcess of buildProcesses) {
            const {
                child,
                processDefinition,
                prefixOutput,
                startedAt,
                output,
                spinner: buildSpinner,
            } = buildProcess;
            child.once('error', error => {
                stopBuildSpinner(buildSpinner, error.message, 1);
                options.progressRenderer?.fail(buildProcess, error.message);
                stopProgressRenderer();
                if (!buildSpinner && !options.progressRenderer) {
                    writeBuildStatus(processDefinition, prefixOutput, error.message, process.stderr);
                }
                stopChildren('SIGTERM');
                resolveOnce(1);
            });
            child.once('close', (code, signal) => {
                remainingChildren--;
                const exitCode = code ?? signalToExitCode(signal) ?? 0;
                if (shutdownRequested) {
                    if (remainingChildren === 0) {
                        stopProgressRenderer();
                        resolveOnce(firstNonZeroExitCode || (shutdownExitCode ?? exitCode));
                    }
                    return;
                }
                if (exitCode !== 0) {
                    firstNonZeroExitCode = exitCode;
                    const message = `Failed to build ${getBuildProcessLabel(processDefinition)} after ${formatDuration(
                        startedAt,
                    )}.`;
                    stopBuildSpinner(buildSpinner, message, 1);
                    options.progressRenderer?.fail(buildProcess, message);
                    stopProgressRenderer();
                    flushCapturedOutput(output, processDefinition, prefixOutput);
                    if (!buildSpinner && !options.progressRenderer) {
                        writeBuildStatus(processDefinition, prefixOutput, message, process.stderr);
                    }
                    stopChildren('SIGTERM');
                } else if (firstNonZeroExitCode === 0) {
                    const message = pc.green(
                        `Built ${getBuildProcessLabel(processDefinition)} successfully in ${formatDuration(
                            startedAt,
                        )}.`,
                    );
                    stopBuildSpinner(buildSpinner, message);
                    options.progressRenderer?.complete(buildProcess);
                    if (!buildSpinner && !options.progressRenderer) {
                        writeBuildStatus(processDefinition, prefixOutput, message);
                    }
                }
                if (remainingChildren === 0) {
                    stopProgressRenderer();
                    resolveOnce(firstNonZeroExitCode);
                }
            });
        }
    });
}

function getChildProcessEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (!env.NO_COLOR && !env.FORCE_COLOR) {
        env.FORCE_COLOR = '1';
    }
    return env;
}

function shouldUseSpinner(processDefinition: BuildProcessDefinition, prefixOutput: boolean): boolean {
    return !prefixOutput && processDefinition.captureOutput;
}

export function shouldUseProgress(options: BuildOptions): boolean {
    const progressEnabled = options.progress !== false && options.noProgress !== true;
    const ciValue = process.env.CI?.trim().toLowerCase();
    const isCi = ciValue != null && ciValue !== '' && ciValue !== 'false';
    return progressEnabled && !options.watch && process.stdout.isTTY === true && !isCi;
}

function stopBuildSpinner(
    buildSpinner: ReturnType<typeof spinner> | undefined,
    message: string,
    code?: number,
) {
    if (buildSpinner) {
        buildSpinner.stop(message, code);
    }
}

function captureBuildOutput(
    stream: NodeJS.ReadableStream | null,
    streamName: keyof CapturedBuildOutput,
    output: CapturedBuildOutput,
) {
    stream?.on('data', data => {
        output[streamName] += data.toString();
    });
}

function flushCapturedOutput(
    output: CapturedBuildOutput | undefined,
    processDefinition: BuildProcessDefinition,
    prefixOutput: boolean,
) {
    if (!output) {
        return;
    }
    if (output.stdout.length) {
        writeCapturedOutput(output.stdout, process.stdout, processDefinition, prefixOutput);
    }
    if (output.stderr.length) {
        writeCapturedOutput(output.stderr, process.stderr, processDefinition, prefixOutput);
    }
}

function writeCapturedOutput(
    output: string,
    stream: NodeJS.WriteStream,
    processDefinition: BuildProcessDefinition,
    prefixOutput: boolean,
) {
    if (!prefixOutput) {
        stream.write(output);
        return;
    }

    const prefix = getProcessPrefix(processDefinition);
    for (const line of output.split(/\r?\n/)) {
        if (line.length) {
            stream.write(`${prefix} ${line}\n`);
        }
    }
}

function writeBuildStatus(
    processDefinition: BuildProcessDefinition,
    prefixOutput: boolean,
    message: string,
    output: NodeJS.WriteStream = process.stdout,
) {
    const prefix = getProcessPrefix(processDefinition);
    output.write(prefixOutput ? `${prefix} ${message}\n` : `${message}\n`);
}

function getBuildProcessLabel(processDefinition: BuildProcessDefinition): string {
    return processDefinition.displayLabel ?? processDefinition.target;
}

function createBuildProgressRenderer(output: NodeJS.WriteStream = process.stdout): BuildProgressRenderer {
    const frames = ['-', '\\', '|', '/'];
    const isInteractive = output.isTTY === true;
    const items = new Map<RunningBuildProcess, BuildProgressItem>();
    let frameIndex = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    let renderedLines = 0;
    let stopped = false;

    const render = () => {
        if (!isInteractive || stopped) {
            return;
        }
        const lines = Array.from(items.values()).map(item =>
            formatBuildProgressLine(item, frames[frameIndex % frames.length]),
        );
        frameIndex++;
        if (renderedLines > 0) {
            output.write(`\x1b[${renderedLines}A`);
        }
        for (const line of lines) {
            output.write(`\x1b[2K\r${line}\n`);
        }
        renderedLines = lines.length;
    };

    return {
        start(buildProcesses) {
            for (const buildProcess of buildProcesses) {
                items.set(buildProcess, {
                    buildProcess,
                    status: 'running',
                    startedAt: buildProcess.startedAt,
                });
            }
            if (isInteractive) {
                output.write('\x1b[?25l');
                render();
                interval = setInterval(render, 100);
            } else {
                for (const item of items.values()) {
                    output.write(`${formatBuildProgressStartLine(item)}\n`);
                }
            }
        },
        complete(buildProcess) {
            const item = items.get(buildProcess);
            if (item?.status !== 'running') {
                return;
            }
            item.status = 'success';
            item.finishedAt = Date.now();
            if (isInteractive) {
                render();
            } else {
                output.write(`${formatBuildProgressLine(item, '')}\n`);
            }
        },
        fail(buildProcess, message) {
            const item = items.get(buildProcess);
            if (!item) {
                return;
            }
            if (item.status === 'failure') {
                return;
            }
            item.status = 'failure';
            item.finishedAt = Date.now();
            item.message = message;
            if (isInteractive) {
                render();
            } else {
                output.write(`${formatBuildProgressLine(item, '')}\n`);
            }
        },
        stop() {
            if (stopped) {
                return;
            }
            stopped = true;
            if (interval) {
                clearInterval(interval);
            }
            if (isInteractive) {
                const lines = Array.from(items.values()).map(item => formatBuildProgressLine(item, ''));
                if (renderedLines > 0) {
                    output.write(`\x1b[${renderedLines}A`);
                }
                for (const line of lines) {
                    output.write(`\x1b[2K\r${line}\n`);
                }
                output.write('\x1b[?25h');
            }
        },
    };
}

interface BuildProgressItem {
    buildProcess: RunningBuildProcess;
    status: 'running' | 'success' | 'failure';
    startedAt: number;
    finishedAt?: number;
    message?: string;
}

function formatBuildProgressStartLine(item: BuildProgressItem): string {
    const { processDefinition } = item.buildProcess;
    return `${getProcessPrefix(processDefinition)} Building ${getBuildProcessLabel(
        processDefinition,
    )} with ${processDefinition.binName}...`;
}

function formatBuildProgressLine(item: BuildProgressItem, frame: string): string {
    const { processDefinition } = item.buildProcess;
    const label = getBuildProcessLabel(processDefinition);
    const elapsed = pc.dim(`(${formatDuration(item.startedAt, item.finishedAt)})`);
    const prefix = getProcessPrefix(processDefinition);

    if (item.status === 'success') {
        return `${prefix} ${pc.green('OK')} Built ${label} with ${processDefinition.binName} ${elapsed}`;
    }
    if (item.status === 'failure') {
        return `${prefix} ${pc.red('ERR')} Failed to build ${label} with ${processDefinition.binName} ${elapsed}`;
    }
    return `${prefix} ${frame} Building ${label} with ${processDefinition.binName} ${elapsed}`;
}

function formatDuration(startedAt: number, finishedAt: number = Date.now()): string {
    const duration = finishedAt - startedAt;
    if (duration < 1000) {
        return `${duration}ms`;
    }
    return `${(duration / 1000).toFixed(1)}s`;
}

function formatTsDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
    return ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: fileName => fileName,
        getCurrentDirectory: () => process.cwd(),
        getNewLine: () => '\n',
    });
}
