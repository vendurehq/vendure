import {
    ConfigService,
    EntityHydrator,
    ID,
    Injector,
    Order,
    OrderService,
    RequestContext,
    ShippingLine,
    TransactionalConnection,
} from '@vendure/core';

import { OrderEmailTarget } from '../define-email';

/**
 * @description
 * Loads an order with everything the default order emails use: lines with variant names and
 * absolute image URLs, the customer, shipping lines with their method, payments with refunds, and
 * fulfillments.
 *
 * @docsCategory core plugins/Email
 * @docsPage Order email helpers
 * @since 4.0.0
 */
export async function loadOrderForEmail(ctx: RequestContext, injector: Injector, orderId: ID): Promise<Order> {
    const order = await injector.get(OrderService).findOne(ctx, orderId);
    if (!order) {
        throw new Error(`No order with id "${String(orderId)}"`);
    }
    await injector.get(EntityHydrator).hydrate(ctx, order, {
        relations: [
            'lines.featuredAsset',
            'shippingLines.shippingMethod',
            'payments',
            'payments.refunds',
            'fulfillments',
            'fulfillments.lines',
        ],
    });
    toAbsoluteAssetUrls(ctx, order, injector);
    return order;
}

/**
 * @description
 * The shipping lines of an order that have a shipping method.
 *
 * @docsCategory core plugins/Email
 * @docsPage Order email helpers
 * @since 4.0.0
 */
export function shippingLinesWithMethod(order: Order): ShippingLine[] {
    return (order.shippingLines ?? []).filter(line => !!line.shippingMethod);
}

/**
 * @description
 * Makes the order line image URLs absolute, so they load in an email client.
 *
 * @docsCategory core plugins/Email
 * @docsPage Order email helpers
 * @since 4.0.0
 */
export function toAbsoluteAssetUrls(ctx: RequestContext, order: Order, injector: Injector): Order {
    const { assetStorageStrategy } = injector.get(ConfigService).assetOptions;
    if (assetStorageStrategy.toAbsoluteUrl && ctx.req) {
        const toAbsoluteUrl = assetStorageStrategy.toAbsoluteUrl.bind(assetStorageStrategy);
        for (const line of order.lines ?? []) {
            if (line.featuredAsset?.preview && !/^https?:\/\//.test(line.featuredAsset.preview)) {
                line.featuredAsset.preview = toAbsoluteUrl(ctx.req, line.featuredAsset.preview);
            }
        }
    }
    return order;
}

/**
 * Finds the most recent placed order with a customer in the context's channel, or the order with the
 * given code or id. Used by the sample events.
 */
export async function findSampleOrder(
    ctx: RequestContext,
    injector: Injector,
    args: Record<string, string>,
    where?: { states?: string[] },
): Promise<Order | undefined> {
    const orderService = injector.get(OrderService);
    if (args.order) {
        const found =
            (await orderService.findOneByCode(ctx, args.order)) ?? (await orderService.findOne(ctx, args.order));
        return found ? loadOrderForEmail(ctx, injector, found.id) : undefined;
    }
    const qb = injector
        .get(TransactionalConnection)
        .getRepository(ctx, Order)
        .createQueryBuilder('order')
        .innerJoin('order.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
        .where('order.orderPlacedAt IS NOT NULL')
        .andWhere('order.customerId IS NOT NULL')
        .orderBy('order.orderPlacedAt', 'DESC')
        .select(['order.id']);
    if (where?.states?.length) {
        qb.andWhere('order.state IN (:...states)', { states: where.states });
    }
    const latest = await qb.getOne();
    return latest ? loadOrderForEmail(ctx, injector, latest.id) : undefined;
}

/**
 * Finds a recent order with at least one eligible target for an order email, for previews.
 */
export async function findSampleOrderWithTarget(
    ctx: RequestContext,
    injector: Injector,
    args: Record<string, string>,
    targets: (order: Order) => OrderEmailTarget[],
): Promise<{ order: Order; targetId: string } | undefined> {
    const pick = (order: Order, anyState: boolean) => {
        const all = targets(order);
        const fallback = anyState ? all[0] : undefined;
        const wanted = args.target ? all.find(t => t.id === args.target) : (all.find(t => t.eligible) ?? fallback);
        return wanted ? { order, targetId: wanted.id } : undefined;
    };
    if (args.order) {
        // The caller chose this order, so preview it even when its state wouldn't allow sending,
        // e.g. the payment failed email for a paid order. Sending from the order page still checks.
        const order = await findSampleOrder(ctx, injector, args);
        return order ? pick(order, true) : undefined;
    }
    const recent = await injector
        .get(TransactionalConnection)
        .getRepository(ctx, Order)
        .createQueryBuilder('order')
        .innerJoin('order.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
        .where('order.customerId IS NOT NULL')
        .orderBy('order.updatedAt', 'DESC')
        .select(['order.id'])
        .limit(50)
        .getMany();
    for (const { id } of recent) {
        const order = await loadOrderForEmail(ctx, injector, id);
        const result = pick(order, false);
        if (result) {
            return result;
        }
    }
    return undefined;
}
