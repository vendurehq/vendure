import { RequestContext, VendureEvent } from '@vendure/core';

import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';

/**
 * @description
 * Fires once an executed MCP tool call has been recorded, whether it succeeded or failed, and
 * for both the shop and admin toolsets. The event carries `ctx`, the context the call ran under,
 * and `entry`, the saved {@link McpToolCallLog} row. Use it to build audit trails, metrics, or
 * alerts.
 *
 * A call refused before the tool runs, for example by a permission check or a rate limit, is
 * never recorded and fires no event. A call that runs but whose log row fails to save also
 * fires no event.
 *
 * The log row always holds the call metadata: tool name, actor, status, duration, and IDs. It
 * holds the call's `input` and `output` only when `logging.capture` is set to `'full'`, and
 * those bodies pass through `logging.redact` only when you supply that function.
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
