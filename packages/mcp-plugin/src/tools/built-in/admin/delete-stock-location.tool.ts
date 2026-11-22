import { Injectable } from '@nestjs/common';
import {
    EntityNotFoundError,
    idsAreEqual,
    Permission,
    RequestContext,
    StockLocation,
    StockLocationService,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { channelList, deletionResult } from './deletion-result';

const deleteStockLocationInput = z.strictObject({
    id: idSchema.describe('Stock location ID.'),
    transferToLocationId: idSchema
        .describe(
            'Move the stock levels of the deleted location to this location of the active channel first.',
        )
        .optional(),
});

type DeleteStockLocationToolInput = z.infer<typeof deleteStockLocationInput>;

@McpTool({
    name: 'delete_stock_location',
    toolset: 'admin',
    description:
        'Delete a stock location of the active channel, optionally moving its stock to another location of the ' +
        'channel first. It is removed from every channel it is assigned to. The last stock location cannot be deleted.',
    keywords: [
        'delete a warehouse',
        'remove a depot for good',
        'delete an inventory location',
        'move stock and delete a location',
        'drop a stock location',
        'delete a stock location',
    ],
    permissions: [Permission.DeleteStockLocation],
    behavior: 'destructive',
    inputSchema: deleteStockLocationInput,
})
@Injectable()
export class DeleteStockLocationTool implements McpToolHandler<DeleteStockLocationToolInput> {
    constructor(
        private readonly stockLocationService: StockLocationService,
        private readonly connection: TransactionalConnection,
    ) {}

    async describe(ctx: RequestContext, input: DeleteStockLocationToolInput) {
        const { location, target } = await this.resolve(ctx, input);
        const withChannels = await this.connection
            .getRepository(ctx, StockLocation)
            .findOne({ where: { id: location.id }, relations: { channels: true } });
        const transfer = target
            ? ` Its stock moves to location "${target.name}" (id ${target.id}).`
            : ' Its stock levels are deleted.';
        return (
            `Delete stock location "${location.name}" (id ${location.id}).${transfer} ` +
            `It is removed from ${channelList(withChannels?.channels ?? [])}.`
        );
    }

    async execute(ctx: RequestContext, input: DeleteStockLocationToolInput) {
        await this.resolve(ctx, input);
        return deletionResult(
            await this.stockLocationService.delete(ctx, {
                id: input.id,
                transferToLocationId: input.transferToLocationId,
            }),
            `Stock location ${input.id}`,
        );
    }

    /** Both locations must be in the active channel, and stock cannot move to the location being deleted. */
    private async resolve(ctx: RequestContext, input: DeleteStockLocationToolInput) {
        const location = await this.stockLocationService.findOne(ctx, input.id);
        if (!location) {
            throw new EntityNotFoundError('StockLocation', input.id);
        }
        if (input.transferToLocationId === undefined) {
            return { location, target: undefined };
        }
        if (idsAreEqual(input.transferToLocationId, input.id)) {
            throw new UserInputError('Stock cannot move to the location that is being deleted.');
        }
        const target = await this.stockLocationService.findOne(ctx, input.transferToLocationId);
        if (!target) {
            throw new EntityNotFoundError('StockLocation', input.transferToLocationId);
        }
        return { location, target };
    }
}
