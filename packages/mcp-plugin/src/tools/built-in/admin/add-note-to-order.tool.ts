import { Injectable } from '@nestjs/common';
import { ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { booleanProp, idProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { orderSummary } from '../serializers';

interface AddNoteToOrderToolInput {
    id: ID;
    note: string;
    isPublic?: boolean;
}

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
    inputSchema: objectSchema({
        id: idProp('Order ID.'),
        note: stringProp('Note text.'),
        isPublic: optional(booleanProp('Whether the note is visible to the customer. Defaults to false.')),
    }),
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
