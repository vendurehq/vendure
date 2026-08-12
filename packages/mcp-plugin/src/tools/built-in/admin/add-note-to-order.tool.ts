import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { orderSummary } from '../serializers';

const addNoteToOrderInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Order ID.'),
    note: z.string().describe('Note text.'),
    isPublic: z
        .boolean()
        .describe('Whether the note is visible to the customer. Defaults to false.')
        .optional(),
});

type AddNoteToOrderToolInput = z.infer<typeof addNoteToOrderInput>;

@McpTool({
    name: 'add_note_to_order',
    toolset: 'admin',
    description: 'Add an internal or public note to an order timeline.',
    keywords: [
        'leave a comment on an order',
        'add a remark to the order timeline',
        'annotate this order',
        'log an internal message on the order',
        'write a note customers can see',
        'record a memo on the order',
    ],
    permissions: [Permission.UpdateOrder],
    behavior: 'mutating',
    inputSchema: addNoteToOrderInput,
})
@Injectable()
export class AddNoteToOrderTool implements McpToolHandler<AddNoteToOrderToolInput> {
    constructor(private orderService: OrderService) {}

    async execute(ctx: RequestContext, input: AddNoteToOrderToolInput) {
        return {
            order: orderSummary(
                await this.orderService.addNoteToOrder(ctx, {
                    id: input.id,
                    note: input.note,
                    isPublic: input.isPublic ?? false,
                }),
            ),
        };
    }
}
