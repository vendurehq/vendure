import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, ShippingMethodService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deleteShippingMethodInput = z.strictObject({
    id: idSchema.describe('Shipping method ID.'),
});

type DeleteShippingMethodToolInput = z.infer<typeof deleteShippingMethodInput>;

@McpTool({
    name: 'delete_shipping_method',
    toolset: 'admin',
    description:
        'Delete a shipping method of the active channel. Orders that used it keep their shipping lines.',
    keywords: [
        'remove a delivery option',
        'stop offering express shipping',
        'delete a shipping rate',
        'drop a courier',
        'remove postage option',
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
        const shippingMethod = await this.shippingMethodService.findOne(ctx, input.id);
        if (!shippingMethod) {
            throw new EntityNotFoundError('ShippingMethod', input.id);
        }
        return `Delete shipping method "${shippingMethod.name}" (code ${shippingMethod.code}, id ${shippingMethod.id}).`;
    }

    async execute(ctx: RequestContext, input: DeleteShippingMethodToolInput) {
        return deletionResult(
            await this.shippingMethodService.softDelete(ctx, input.id),
            `Shipping method ${input.id}`,
        );
    }
}
