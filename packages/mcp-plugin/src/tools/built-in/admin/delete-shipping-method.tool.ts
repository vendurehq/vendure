import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, ShippingMethodService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';
import { channelList } from './preview-text';

const deleteShippingMethodInput = z.strictObject({
    id: idSchema.describe('Shipping method ID.'),
});

type DeleteShippingMethodToolInput = z.infer<typeof deleteShippingMethodInput>;

@McpTool({
    name: 'delete_shipping_method',
    toolset: 'admin',
    description:
        'Delete a shipping method of the active channel. It is removed from every channel it is assigned to. ' +
        'Orders that used it keep their shipping lines.',
    keywords: [
        'delete a delivery option',
        'remove a shipping method for good',
        'delete a shipping rate',
        'drop a courier option',
        'delete postage option',
        'delete a shipping method',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeleteShippingMethod],
    behavior: 'destructive',
    inputSchema: deleteShippingMethodInput,
})
@Injectable()
export class DeleteShippingMethodTool implements McpToolHandler<DeleteShippingMethodToolInput> {
    constructor(private readonly shippingMethodService: ShippingMethodService) {}

    async describe(ctx: RequestContext, input: DeleteShippingMethodToolInput) {
        const method = await this.shippingMethodService.findOne(ctx, input.id, false, ['channels']);
        if (!method) {
            throw new EntityNotFoundError('ShippingMethod', input.id);
        }
        return (
            `Delete shipping method "${method.name}" (code ${method.code}, id ${method.id}). ` +
            `It is removed from ${channelList(method.channels)}.`
        );
    }

    async execute(ctx: RequestContext, input: DeleteShippingMethodToolInput) {
        return deletionResult(
            await this.shippingMethodService.softDelete(ctx, input.id),
            `Shipping method ${input.id}`,
        );
    }
}
