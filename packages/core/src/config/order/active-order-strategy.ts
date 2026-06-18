import { DocumentNode } from 'graphql';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';

export const ACTIVE_ORDER_INPUT_FIELD_NAME = 'activeOrderInput';

/**
 * @description
 * This strategy is used to determine the active Order for all order-related operations in
 * the Shop API. By default, all the Shop API operations that relate to the active Order (e.g.
 * `activeOrder`, `addItemToOrder`, `applyCouponCode` etc.) will implicitly create a new Order
 * and set it on the current Session, and then read the session to obtain the active Order.
 * This behaviour is defined by the {@link DefaultActiveOrderStrategy}.
 *
 * The `InputType` generic argument should correspond to the input type defined by the
 * `defineInputType()` method.
 *
 * When `defineInputType()` is used, then the following Shop API operations will receive an additional
 * `activeOrderInput` argument allowing the active order input to be specified:
 *
 * - `activeOrder`
 * - `eligibleShippingMethods`
 * - `eligiblePaymentMethods`
 * - `nextOrderStates`
 * - `addItemToOrder`
 * - `adjustOrderLine`
 * - `removeOrderLine`
 * - `removeAllOrderLines`
 * - `applyCouponCode`
 * - `removeCouponCode`
 * - `addPaymentToOrder`
 * - `setCustomerForOrder`
 * - `setOrderShippingAddress`
 * - `setOrderBillingAddress`
 * - `setOrderShippingMethod`
 * - `setOrderCustomFields`
 * - `transitionOrderToState`
 *
 * @example
 * ```GraphQL {hl_lines=[5]}
 * mutation AddItemToOrder {
 *   addItemToOrder(
 *     productVariantId: 42,
 *     quantity: 1,
 *     activeOrderInput: { token: "123456" }
 *   ) {
 *     ...on Order {
 *       id
 *       # ...etc
 *     }
 *   }
 * }
 * ```
 *
 * @example
 * ```ts
 * import { ID } from '\@vendure/common/lib/shared-types';
 * import {
 *   ActiveOrderStrategy,
 *   CustomerService,
 *   idsAreEqual,
 *   Injector,
 *   Order,
 *   OrderService,
 *   RequestContext,
 *   TransactionalConnection,
 * } from '\@vendure/core';
 * import gql from 'graphql-tag';
 *
 * // This strategy assumes a "orderToken" custom field is defined on the Order
 * // entity, and uses that token to perform a lookup to determine the active Order.
 * //
 * // Additionally, it does _not_ define a `createActiveOrder()` method, which
 * // means that a custom mutation would be required to create the initial Order in
 * // the first place and set the "orderToken" custom field.
 * class TokenActiveOrderStrategy implements ActiveOrderStrategy<{ token: string }> {
 *   readonly name = 'orderToken';
 *
 *   private connection: TransactionalConnection;
 *   private orderService: OrderService;
 *
 *   init(injector: Injector) {
 *     this.connection = injector.get(TransactionalConnection);
 *     this.orderService = injector.get(OrderService);
 *   }
 *
 *   defineInputType = () => gql`
 *     input OrderTokenActiveOrderInput {
 *       token: String
 *     }
 *   `;
 *
 *   async determineActiveOrder(ctx: RequestContext, input: { token: string }) {
 *     const qb = this.connection
 *       .getRepository(ctx, Order)
 *       .createQueryBuilder('order')
 *       .leftJoinAndSelect('order.customer', 'customer')
 *       .leftJoinAndSelect('customer.user', 'user')
 *       .where('order.customFields.orderToken = :orderToken', { orderToken: input.token });
 *
 *     const order = await qb.getOne();
 *     if (!order) {
 *       return;
 *     }
 *     // Ensure the active user is the owner of this Order
 *     const orderUserId = order.customer && order.customer.user && order.customer.user.id;
 *     if (order.customer && idsAreEqual(orderUserId, ctx.activeUserId)) {
 *       return order;
 *     }
 *   }
 * }
 *
 * // in vendure-config.ts
 * export const config = {
 *   // ...
 *   orderOptions: {
 *     activeOrderStrategy: new TokenActiveOrderStrategy(),
 *   },
 * }
 * ```
 *
 * @since 1.9.0
 * @docsCategory orders
 */
export interface ActiveOrderStrategy<InputType extends Record<string, any> | void = void>
    extends InjectableStrategy {
    /**
     * @description
     * The name of the strategy, e.g. "orderByToken", which will also be used as the
     * field name in the ActiveOrderInput type.
     */
    readonly name: string;

    /**
     * @description
     * Defines the type of the GraphQL Input object expected by the `activeOrderInput`
     * input argument.
     *
     * @example
     * For example, given the following:
     *
     * ```ts
     * defineInputType() {
     *   return gql`
     *      input OrderTokenInput {
     *        token: String!
     *      }
     *   `;
     * }
     * ```
     *
     * assuming the strategy name is "orderByToken", then the resulting call to `activeOrder` (or any of the other
     * affected Shop API operations) would look like:
     *
     * ```GraphQL
     * activeOrder(activeOrderInput: {
     *   orderByToken: {
     *     token: "foo"
     *   }
     * }) {
     *   # ...
     * }
     * ```
     *
     * **Note:** if more than one graphql `input` type is being defined (as in a nested input type), then
     * the _first_ input will be assumed to be the top-level input.
     */
    defineInputType?: () => DocumentNode;

    /**
     * @description
     * Certain mutations such as `addItemToOrder` can automatically create a new Order if one does not exist.
     * In these cases, this method will be called to create the new Order.
     *
     * If automatic creation of an Order does not make sense in your strategy, then leave this method
     * undefined. You'll then need to take care of creating an order manually by defining a custom mutation.
     */
    createActiveOrder?: (ctx: RequestContext, input: InputType) => Promise<Order>;

    /**
     * @description
     * This method is used to determine the active Order based on the current RequestContext in addition to any
     * input values provided, as defined by the `defineInputType` method of this strategy.
     *
     * Note that this method is invoked frequently, so you should aim to keep it efficient. The returned Order,
     * for example, does not need to have its various relations joined.
     */
    determineActiveOrder(ctx: RequestContext, input: InputType): Promise<Order | undefined>;
}
