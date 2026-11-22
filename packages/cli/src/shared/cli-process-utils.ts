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
    const prefix = getProcessPrefix(processDefinition);
    forEachLine(stream, line => writePrefixedLines(output, `${prefix} `, line));
}

/**
 * Calls `onLine` for each line of a stream, without the line ending, and for the last line when
 * the stream ends without one. The stream is read as UTF-8, so a character split across two chunks
 * stays whole.
 */
export function forEachLine(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void) {
    if (!stream) {
        return;
    }
    stream.setEncoding('utf8');
    let buffered = '';
    stream.on('data', (data: string) => {
        buffered += data;
        const lines = buffered.split(/\r?\n/);
        buffered = lines.pop() ?? '';
        for (const line of lines) {
            onLine(line);
        }
    });
    stream.on('end', () => {
        if (buffered.length) {
            onLine(buffered);
            buffered = '';
        }
    });
}

/**
 * Writes each line of `text` to `output` with `prefix` in front of it. An empty line is written
 * without the prefix.
 */
export function writePrefixedLines(output: NodeJS.WritableStream, prefix: string, text: string) {
    for (const line of text.split('\n')) {
        output.write(line.length ? `${prefix}${line}\n` : '\n');
    }
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
        ...(createRequire(import.meta.url).resolve.paths(packageJsonRequest) ?? []),
    ];

    for (const lookupPath of Array.from(new Set(lookupPaths))) {
        const packageJsonPath = path.join(lookupPath, packageJsonRequest);
        if (existsSync(packageJsonPath)) {
            return packageJsonPath;
        }
    }

    throw new Error(`Could not find "${packageName}". ${installHint}`);
}
