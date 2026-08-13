import { ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

interface PrefixedProcessDefinition {
    target: string;
    prefixLabel?: string;
    color: (text: string) => string;
}

interface WaitForChildProcessesOptions {
    onError?: (error: Error) => void;
}

export function resolvePackageBin(
    packageName: string,
    binName: string,
    projectDir: string,
    installHint: string = `Make sure "${packageName}" is installed.`,
): string {
    const packageJsonPath = resolvePackageJsonPath(packageName, projectDir, installHint);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as {
        bin?: string | Record<string, string>;
    };
    const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.[binName];

    if (!bin) {
        throw new Error(`Could not find the "${binName}" binary in "${packageName}".`);
    }
    return path.resolve(path.dirname(packageJsonPath), bin);
}

export function getProcessPrefix(processDefinition: PrefixedProcessDefinition): string {
    return processDefinition.color(`[${processDefinition.prefixLabel ?? processDefinition.target}]`);
}

export function pipePrefixedOutput(
    stream: NodeJS.ReadableStream | null,
    output: NodeJS.WriteStream,
    processDefinition: PrefixedProcessDefinition,
) {
    if (!stream) {
        return;
    }
    let buffered = '';
    const prefix = getProcessPrefix(processDefinition);
    stream.on('data', data => {
        buffered += data.toString();
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            output.write(line.length ? `${prefix} ${line}\n` : '\n');
        }
    });
    stream.on('end', () => {
        if (buffered.length) {
            output.write(`${prefix} ${buffered}\n`);
        }
    });
}

export function waitForChildProcesses(
    children: ChildProcess[],
    options: WaitForChildProcessesOptions = {},
): Promise<number> {
    if (children.length === 0) {
        return Promise.resolve(0);
    }

    return new Promise(resolve => {
        let resolved = false;
        let shutdownRequested = false;
        let shutdownExitCode: number | undefined;
        let remainingChildren = children.length;
        const settledChildren = new Set<ChildProcess>();

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
        const stopChildren = (signal: NodeJS.Signals, exitCode?: number) => {
            shutdownRequested = true;
            shutdownExitCode ??= exitCode;
            for (const child of children) {
                if (!settledChildren.has(child) && !child.killed && child.exitCode === null) {
                    child.kill(signal);
                }
            }
        };
        const completeChild = (child: ChildProcess, exitCode: number) => {
            if (settledChildren.has(child)) {
                return;
            }
            settledChildren.add(child);
            remainingChildren--;
            if (!shutdownRequested) {
                stopChildren('SIGTERM', exitCode);
            }
            if (remainingChildren === 0) {
                resolveOnce(shutdownExitCode ?? exitCode);
            }
        };
        const handleSigint = () => stopChildren('SIGINT', signalToExitCode('SIGINT'));
        const handleSigterm = () => stopChildren('SIGTERM', signalToExitCode('SIGTERM'));

        process.once('SIGINT', handleSigint);
        process.once('SIGTERM', handleSigterm);

        for (const child of children) {
            child.once('error', error => {
                options.onError?.(error);
                completeChild(child, 1);
            });
            child.once('close', (code, signal) => {
                completeChild(child, code ?? signalToExitCode(signal) ?? (shutdownRequested ? 0 : 1));
            });
        }
    });
}

export function signalToExitCode(signal: NodeJS.Signals | null): number | undefined {
    if (signal === 'SIGINT') {
        return 130;
    }
    if (signal === 'SIGTERM') {
        return 143;
    }
}

function resolvePackageJsonPath(packageName: string, projectDir: string, installHint: string): string {
    const packageJsonRequest = `${packageName}/package.json`;
    const requireFromProject = createRequire(path.join(projectDir, 'package.json'));
    const lookupPaths = [
        ...(requireFromProject.resolve.paths(packageJsonRequest) ?? []),
        ...(require.resolve.paths(packageJsonRequest) ?? []),
    ];

    for (const lookupPath of Array.from(new Set(lookupPaths))) {
        const packageJsonPath = path.join(lookupPath, packageJsonRequest);
        if (existsSync(packageJsonPath)) {
            return packageJsonPath;
        }
    }

    throw new Error(`Could not find "${packageName}". ${installHint}`);
}
