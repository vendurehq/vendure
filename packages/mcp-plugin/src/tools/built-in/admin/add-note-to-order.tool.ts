import { Injectable } from '@nestjs/common';
import { HistoryEntryType } from '@vendure/common/lib/generated-types';
import { HistoryService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { findOrderOrThrow, ORDER_DETAIL_RELATIONS } from '../order-list-helpers';
import { McpToolSerializerService } from '../serializer.service';
import { longText } from '../string-schemas';

const addNoteToOrderInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
    note: longText.describe('Note text.'),
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
    constructor(
        private orderService: OrderService,
        private historyService: HistoryService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: AddNoteToOrderToolInput) {
        const order = await findOrderOrThrow(this.orderService, ctx, input.id, ORDER_DETAIL_RELATIONS);

        const note = await this.historyService.createHistoryEntryForOrder(
            { ctx, orderId: order.id, type: HistoryEntryType.ORDER_NOTE, data: { note: input.note } },
            input.isPublic ?? false,
        );
        return { order: this.serializer.order(order), note: this.serializer.orderNote(note) };
    }
}
