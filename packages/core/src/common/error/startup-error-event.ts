import { writeSync } from 'node:fs';

import { I18nError } from '../../i18n/i18n-error';
import { UNEXPECTED_VENDURE_CODE } from '../../i18n/vendure-code';

import { VendureErrorFix, VendureStartupError } from './vendure-startup-error';

/**
 * The event line which {@link writeStartupErrorEvent} writes to stderr.
 */
export interface StartupErrorEvent {
    vendure: 'event';
    event: 'startup-error';
    code: string;
    message: string;
    fix: VendureErrorFix[];
}

/**
 * Returns the startup-error event for any error thrown while the server or worker starts. An error which
 * is not a {@link VendureStartupError} has no fixes, and its code comes from its `vendureCode` when it is
 * an {@link I18nError}.
 */
export function toStartupErrorEvent(error: unknown): StartupErrorEvent {
    let code = UNEXPECTED_VENDURE_CODE;
    let fix: VendureErrorFix[] = [];
    if (error instanceof VendureStartupError) {
        code = error.vendureCode;
        fix = error.fix;
    } else if (error instanceof I18nError) {
        code = error.vendureCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    return { vendure: 'event', event: 'startup-error', code, message, fix };
}

const MAX_EAGAIN_RETRIES = 1000;

/**
 * Writes the startup-error event for the error as one line of JSON to stderr. The write is synchronous,
 * so the line is complete even when the caller exits the process straight after.
 */
export function writeStartupErrorEvent(error: unknown): void {
    const line = Buffer.from(JSON.stringify(toStartupErrorEvent(error)) + '\n');
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
