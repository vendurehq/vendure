/**
 * Internal control-flow signal used to stop a command without terminating the
 * Node.js process. Command definitions translate it into an exit code so a
 * plugin can run cleanup or post-processing after invoking a built-in action.
 */
export class CliCommandExit extends Error {
    constructor(readonly exitCode: number) {
        super(`CLI command requested exit code ${exitCode}`);
        this.name = 'CliCommandExit';
    }
}

export function exitCliCommand(exitCode: number): never {
    throw new CliCommandExit(exitCode);
}

export function rethrowCliCommandExit(error: unknown): void {
    if (error instanceof CliCommandExit) {
        throw error;
    }
}

export async function runCliCommand(action: () => Promise<void | number>): Promise<number> {
    try {
        return (await action()) ?? 0;
    } catch (error) {
        if (error instanceof CliCommandExit) {
            return error.exitCode;
        }
        throw error;
    }
}
