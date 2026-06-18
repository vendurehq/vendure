import {
    ActiveOrderStrategy,
    idsAreEqual,
    Injector,
    Order,
    OrderService,
    RequestContext,
    TransactionalConnection,
    VendurePlugin,
} from '@vendure/core';
import { CustomOrderFields } from '@vendure/core/dist/entity/custom-entity-fields';
import gql from 'graphql-tag';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        orderToken: string;
    }
}

class TokenActiveOrderStrategy implements ActiveOrderStrategy {
    readonly name = 'orderToken';

    private connection: TransactionalConnection;
    private orderService: OrderService;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.orderService = injector.get(OrderService);
    }

    defineInputType = () => gql`
        input CustomActiveOrderInput {
            orderToken: String
        }
    `;

    async determineActiveOrder(ctx: RequestContext, input: { orderToken: string }) {
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .where('order.customFields.orderToken = :orderToken', { orderToken: input.orderToken });

        const order = await qb.getOne();
        if (!order) {
            return;
        }
        return order;
        // const orderUserId = order.customer && order.customer.user && order.customer.user.id;
        // if (idsAreEqual(ctx.activeUserId, orderUserId)) {
        //     return order;
        // } else {
        //     return;
        // }
    }

    // async createActiveOrder(ctx: RequestContext) {
    //     const order = await this.orderService.create(ctx, ctx.activeUserId);
    //     order.customFields.orderToken = Math.random().toString(36).substr(5);
    //     await this.connection.getRepository(ctx, Order).save(order);
    //     return order;
    // }
}

@VendurePlugin({
    configuration: config => {
        config.customFields.Order.push({
            name: 'orderToken',
            type: 'string',
            internal: true,
        });
        config.orderOptions.activeOrderStrategy = new TokenActiveOrderStrategy();
        return config;
    },
})
export class CustomActiveOrderPlugin {}
