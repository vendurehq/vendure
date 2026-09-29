import { RequestContext, VendureEvent } from '@vendure/core';

import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';

/**
 * @description
 * Fired after a tool call is executed and its log entry is saved.
 *
 * Carries the request context and the persisted log entry.
 * Only emitted for calls that actually ran.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export class McpToolCallEvent extends VendureEvent {
    constructor(
        public ctx: RequestContext,
        public entry: McpToolCallLog,
    ) {
        super();
    }
}
