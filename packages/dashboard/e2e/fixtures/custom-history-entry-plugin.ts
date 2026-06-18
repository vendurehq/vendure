/**
 * Registers a CUSTOM_TYPE order history entry and exposes a mutation
 * to create one. Used to test the fallback renderer for unrecognized
 * history entry types in the dashboard.
 *
 * NOTE: This file uses NestJS parameter decorators and must be
 * compiled with SWC (which supports emitDecoratorMetadata).
 * The global-setup.ts handles this automatically.
 */
import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    HistoryService,
    ID,
    Order,
    PluginCommonModule,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

const CUSTOM_TYPE = 'CUSTOM_TYPE';

@Resolver()
class AddHistoryEntryResolver {
    constructor(
        private connection: TransactionalConnection,
        private historyService: HistoryService,
    ) {}

    @Mutation()
    async addCustomOrderHistoryEntry(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderId: ID; message: string },
    ) {
        const order = await this.connection.getEntityOrThrow(ctx, Order, args.orderId);
        await this.historyService.createHistoryEntryForOrder({
            orderId: order.id,
            ctx,
            type: CUSTOM_TYPE as any,
            data: { message: args.message },
        });
        return order;
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    adminApiExtensions: {
        schema: gql`
            extend enum HistoryEntryType {
                CUSTOM_TYPE
            }
            extend type Mutation {
                addCustomOrderHistoryEntry(orderId: ID!, message: String!): Order!
            }
        `,
        resolvers: [AddHistoryEntryResolver],
    },
})
export class CustomHistoryEntryPlugin {}
