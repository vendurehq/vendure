import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, Permission, RequestContext, StockLocationService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deleteStockLocationInput = z.strictObject({
    id: idSchema.describe('Stock location ID.'),
    transferToLocationId: idSchema
        .describe('Move the stock levels of the deleted location to this location.')
        .optional(),
});

type DeleteStockLocationToolInput = z.infer<typeof deleteStockLocationInput>;

@McpTool({
    name: 'delete_stock_location',
    toolset: 'admin',
    description:
        'Delete a stock location of the active channel, optionally moving its stock to another location first. The last stock location cannot be deleted.',
    keywords: [
        'remove a warehouse',
        'close a depot',
        'delete an inventory location',
        'move stock and delete a location',
        'drop a stock location',
        'shut a warehouse',
    ],
    permissions: [Permission.DeleteStockLocation],
    behavior: 'destructive',
    inputSchema: deleteStockLocationInput,
})
@Injectable()
export class DeleteStockLocationTool implements McpToolHandler<DeleteStockLocationToolInput> {
    constructor(private readonly stockLocationService: StockLocationService) {}

    async describe(ctx: RequestContext, input: DeleteStockLocationToolInput) {
        const location = await this.stockLocationService.findOne(ctx, input.id);
        if (!location) {
            throw new EntityNotFoundError('StockLocation', input.id);
        }
        const transfer = input.transferToLocationId
            ? ` Its stock moves to location ${String(input.transferToLocationId)}.`
            : ' Its stock levels are deleted.';
        return `Delete stock location "${location.name}" (id ${location.id}).${transfer}`;
    }

    async execute(ctx: RequestContext, input: DeleteStockLocationToolInput) {
        return deletionResult(
            await this.stockLocationService.delete(ctx, {
                id: input.id,
                transferToLocationId: input.transferToLocationId,
            }),
            `Stock location ${input.id}`,
        );
    }
}
