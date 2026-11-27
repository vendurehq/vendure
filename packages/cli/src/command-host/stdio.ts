import type { CommandEnvelope, CommandEvent } from '@vendure/common/lib/command';

/**
 * What the host needs to write the one document and the events of a `--json` run. Everything else
 * that reaches stdout while the command runs, from `console.log` or from a library, goes to
 * stderr, so the document is the only thing on stdout.
 */
export interface JsonOutput {
    writeEnvelope(envelope: CommandEnvelope): Promise<void>;
    writeEvent(event: CommandEvent): void;
}

/**
 * Sends writes to `process.stdout` to `process.stderr` and returns a handle that still reaches
 * the real stdout. Call it once, before the command runs.
 */
export function redirectStdoutToStderr(): JsonOutput {
    const realWrite = process.stdout.write.bind(process.stdout) as (
        chunk: string,
        callback: (error?: Error | null) => void,
    ) => boolean;
    process.stdout.write = (chunk: unknown, ...args: unknown[]) =>
        (process.stderr.write as (...a: unknown[]) => boolean).call(process.stderr, chunk, ...args);
    return {
        writeEnvelope: envelope =>
            new Promise<void>(resolve => {
                realWrite(`${JSON.stringify(envelope)}\n`, () => resolve());
            }),
        writeEvent: event => {
            process.stderr.write(`${JSON.stringify(event)}\n`);
        },
    };
}
