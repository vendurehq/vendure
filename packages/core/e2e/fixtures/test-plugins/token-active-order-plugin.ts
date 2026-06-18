import { Args, Mutation, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ID } from '@vendure/common/lib/shared-types';
import {
    ActiveOrderStrategy,
    Ctx,
    CustomerService,
    idsAreEqual,
    Injector,
    Order,
    OrderService,
    PluginCommonModule,
    RequestContext,
    Transaction,
    TransactionalConnection,
    UserInputError,
    VendurePlugin,
} from '@vendure/core';
import gql from 'graphql-tag';

declare module '@vendure/core/dist/entity/custom-entity-fields' {
    interface CustomOrderFields {
        orderToken: string;
    }
}

class TokenActiveOrderStrategy implements ActiveOrderStrategy<{ token: string }> {
    readonly name = 'orderToken';

    private connection: TransactionalConnection;
    private orderService: OrderService;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.orderService = injector.get(OrderService);
    }

    defineInputType = () => gql`
        input OrderTokenActiveOrderInput {
            token: String
        }
    `;

    async determineActiveOrder(ctx: RequestContext, input: { token: string }) {
        const qb = this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('order')
            .leftJoinAndSelect('order.customer', 'customer')
            .leftJoinAndSelect('customer.user', 'user')
            .where('order.customFields.orderToken = :orderToken', { orderToken: input.token });

        const order = await qb.getOne();
        if (!order) {
            return;
        }
        const orderUserId = order.customer && order.customer.user && order.customer.user.id;
        if (order.customer && idsAreEqual(orderUserId, ctx.activeUserId)) {
            return order;
        }
    }
}

@Resolver('Order')
export class OrderTokenResolver {
    @ResolveField()
    orderToken(@Parent() order: Order) {
        return order.customFields.orderToken;
    }
}

@Resolver()
export class CreateOrderResolver {
    constructor(private orderService: OrderService, private customerService: CustomerService) {}

    @Mutation()
    @Transaction()
    async createOrder(@Ctx() ctx: RequestContext, @Args() args: { customerId: ID }) {
        const customer = await this.customerService.findOne(ctx, args.customerId);
        if (!customer) {
            throw new UserInputError('No customer found');
        }
        const order = await this.orderService.create(ctx, customer.user?.id);
        return this.orderService.updateCustomFields(ctx, order.id, {
            orderToken: `token-${args.customerId}`,
        });
    }
}

@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        config.customFields.Order.push({
            name: 'orderToken',
            type: 'string',
            internal: true,
        });
        config.orderOptions.activeOrderStrategy = new TokenActiveOrderStrategy();
        return config;
    },
    shopApiExtensions: {
        schema: gql`
            extend type Mutation {
                createOrder(customerId: ID!): Order!
            }

            extend type Order {
                orderToken: String!
            }
        `,
        resolvers: [OrderTokenResolver, CreateOrderResolver],
    },
})
export class TokenActiveOrderPlugin {}
