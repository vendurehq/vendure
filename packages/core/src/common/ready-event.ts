import type { ReadyEvent } from '@vendure/common/lib/log';

import { writeEventLine } from './event-line';

/**
 * Writes the `ready` event line to stderr once the server is listening or the worker is ready.
 * The server's line carries the URLs of the Shop and Admin APIs.
 */
export function writeReadyEvent(process: ReadyEvent['process'], urls?: ReadyEvent['urls']): void {
    const event: ReadyEvent = { vendure: 'event', event: 'ready', process, ...(urls ? { urls } : {}) };
    writeEventLine(event);
}
