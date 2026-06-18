import { Args, Mutation, Resolver } from '@nestjs/graphql';
import {
    Ctx,
    Customer,
    HistoryService,
    ID,
    Order,
    PluginCommonModule,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

import { CUSTOM_TYPE } from './types';

@Resolver()
class AddHistoryEntryResolver {
    constructor(private connection: TransactionalConnection, private historyService: HistoryService) {}

    @Mutation()
    async addCustomOrderHistoryEntry(
        @Ctx() ctx: RequestContext,
        @Args() args: { orderId: ID; message: string },
    ) {
        const order = await this.connection.getEntityOrThrow(ctx, Order, args.orderId);

        await this.historyService.createHistoryEntryForOrder({
            orderId: order.id,
            ctx,
            type: CUSTOM_TYPE,
            data: { message: args.message },
        });
        return order;
    }

    @Mutation()
    async addCustomCustomerHistoryEntry(
        @Ctx() ctx: RequestContext,
        @Args() args: { customerId: ID; name: string },
    ) {
        const customer = await this.connection.getEntityOrThrow(ctx, Customer, args.customerId);

        await this.historyService.createHistoryEntryForCustomer({
            customerId: customer.id,
            ctx,
            type: CUSTOM_TYPE,
            data: { name: args.name },
        });
        return customer;
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
                addCustomCustomerHistoryEntry(customerId: ID!, name: String!): Customer!
            }
        `,
        resolvers: [AddHistoryEntryResolver],
    },
    configuration: config => {
        return config;
    },
})
export class CustomHistoryEntryPlugin {}
