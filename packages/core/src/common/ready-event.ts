import type { ReadyEvent } from '@vendure/common/lib/log';

import { writeEventLine } from './event-line';

/**
 * Writes the `ready` event line to stderr once the server is listening or the worker is ready.
 * The server's line carries the URLs of the Shop and Admin APIs, and of the routes that plugins
 * register, such as the Dashboard.
 */
export function writeReadyEvent(
    processName: ReadyEvent['process'],
    urls?: ReadyEvent['urls'],
    routes?: ReadyEvent['routes'],
): void {
    const event: ReadyEvent = {
        vendure: 'event',
        event: 'ready',
        process: processName,
        ...(urls ? { urls } : {}),
        ...(routes?.length ? { routes } : {}),
    };
    writeEventLine(event);
}
