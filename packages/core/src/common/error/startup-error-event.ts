import type { StartupErrorEvent } from '@vendure/common/lib/log';

import { I18nError } from '../../i18n/i18n-error';
import { UNEXPECTED_VENDURE_CODE } from '../../i18n/vendure-code';
import { writeEventLine } from '../event-line';

import { VendureErrorFix, VendureStartupError } from './vendure-startup-error';

// The event line which {@link writeStartupErrorEvent} writes to stderr. Its type is shared with the
// CLI, which reads it.
export type { StartupErrorEvent } from '@vendure/common/lib/log';

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

/**
 * Writes the startup-error event for the error as one line of JSON to stderr. The write is synchronous,
 * so the line is complete even when the caller exits the process straight after.
 */
export function writeStartupErrorEvent(error: unknown): void {
    writeEventLine(toStartupErrorEvent(error));
}
