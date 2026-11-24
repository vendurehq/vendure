import { writeSync } from 'node:fs';

const MAX_EAGAIN_RETRIES = 1000;

/**
 * Writes an event as one line of JSON to stderr, for a supervising process such as the `vendure`
 * CLI. The write is synchronous, so the line is complete even when the caller exits the process
 * straight after.
 */
export function writeEventLine(event: object): void {
    const line = Buffer.from(JSON.stringify(event) + '\n');
    let offset = 0;
    let retries = 0;
    while (offset < line.length) {
        try {
            // A write to a pipe can be partial, so write the rest until the whole line is out.
            offset += writeSync(process.stderr.fd, line, offset);
        } catch (e: any) {
            // A non-blocking stderr pipe refuses a synchronous write with EAGAIN while it is full.
            if (e?.code === 'EAGAIN' && retries++ < MAX_EAGAIN_RETRIES) {
                continue;
            }
            // Hand the rest of the line to the stream, which writes it when the pipe drains.
            process.stderr.write(line.subarray(offset));
            return;
        }
    }
}
