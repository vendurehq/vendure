import { log } from '@clack/prompts';
import { ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';

import { pipePrefixedOutput, waitForChildProcesses } from '../../shared/cli-process-utils';
import { resolveVendureProjectDirectory } from '../dev/dev';

export type StartTarget = 'all' | 'server' | 'worker';

interface StartProcessDefinition {
    target: Exclude<StartTarget, 'all'>;
    args: string[];
    requiredFile: string;
    color: (text: string) => string;
}

export interface StartOptions {
    serverEntry?: string;
    workerEntry?: string;
}

const validTargets: StartTarget[] = ['all', 'server', 'worker'];

export async function startCommand(targetArg?: string, options: StartOptions = {}): Promise<number> {
    try {
        const target = normalizeStartTarget(targetArg);
        const projectDir = resolveVendureProjectDirectory(process.cwd());
        const startProcessDefinitions = getStartProcessDefinitions(options);
        const processes = getStartProcessesForTarget(target, startProcessDefinitions);
        const prefixOutput = processes.length > 1;

        validateProjectFiles(projectDir, processes);

        const children = processes.map(processDefinition =>
            startProcess(projectDir, processDefinition, { prefixOutput }),
        );
        return await waitForChildProcesses(children, {
            onError: error => log.error(error.message),
        });
    } catch (e: unknown) {
        log.error(e instanceof Error ? e.message : String(e));
        return 1;
    }
}

export function getStartProcessDefinitions(
    options: StartOptions = {},
): Record<Exclude<StartTarget, 'all'>, StartProcessDefinition> {
    const serverEntry = options.serverEntry ?? './dist/index.js';
    const workerEntry = options.workerEntry ?? './dist/index-worker.js';

    return {
        server: {
            target: 'server',
            args: [serverEntry],
            requiredFile: serverEntry,
            color: pc.blue,
        },
        worker: {
            target: 'worker',
            args: [workerEntry],
            requiredFile: workerEntry,
            color: pc.cyan,
        },
    };
}

export function getStartProcessesForTarget(
    target: StartTarget,
    startProcessDefinitions: Record<Exclude<StartTarget, 'all'>, StartProcessDefinition>,
): StartProcessDefinition[] {
    if (target === 'all') {
        return [startProcessDefinitions.server, startProcessDefinitions.worker];
    }
    return [startProcessDefinitions[target]];
}

export function normalizeStartTarget(targetArg?: string): StartTarget {
    const target = (targetArg ?? 'all').trim();
    if (validTargets.includes(target as StartTarget)) {
        return target as StartTarget;
    }
    throw new Error(`Unknown start target "${target}". Expected one of: ${validTargets.join(', ')}`);
}

function startProcess(
    projectDir: string,
    processDefinition: StartProcessDefinition,
    options: { prefixOutput: boolean },
): ChildProcess {
    const child = spawn(process.execPath, processDefinition.args, {
        cwd: projectDir,
        env: {
            ...process.env,
            FORCE_COLOR: process.env.FORCE_COLOR ?? '1',
        },
        stdio: options.prefixOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
    });
    if (options.prefixOutput) {
        pipePrefixedOutput(child.stdout, process.stdout, processDefinition);
        pipePrefixedOutput(child.stderr, process.stderr, processDefinition);
    }
    return child;
}

function validateProjectFiles(projectDir: string, processes: StartProcessDefinition[]) {
    for (const processDefinition of processes) {
        assertFileExists(projectDir, processDefinition.requiredFile);
    }
}

function assertFileExists(projectDir: string, relativePath: string) {
    if (!existsSync(path.join(projectDir, relativePath))) {
        throw new Error(
            `Could not find ${relativePath}. Run this command after building your Vendure server project.`,
        );
    }
}
