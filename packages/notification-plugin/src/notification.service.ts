import { Injectable, Inject } from '@nestjs/common';
import {
    Administrator,
    CustomerService,
    EntityNotFoundError,
    EventBus,
    ID,
    Logger,
    OrderService,
    Product,
    RequestContext,
    TransactionalConnection,
    UnauthorizedError,
} from '@vendure/core';
import { In } from 'typeorm';

import { AfterSalesRequest } from '@vendure/after-sales-plugin';
import { CouponExpireRemindEvent } from '@vendure/coupon-plugin';
import { Shop } from '@vendure/shop-plugin';

import { loggerCtx, NOTIFICATION_PLUGIN_OPTIONS } from './constants';
import { AdminNotifyEvent } from './admin-notify.event';
import { InboxMessage } from './inbox-message.entity';
import { NotifierProvider } from './notifier/notifier-provider';
import { InboxMessageListOptions, NotificationFrame, NotificationPluginOptions } from './types';

/**
 * 消息触达编排与站内信存储。
 * deliver(frame)：站内信真实落库（inboxEnabled 开关），再经 notifier 外发（微信，失败不阻断）。
 */
@Injectable()
export class NotificationService {
    private notifier: NotifierProvider;

    constructor(
        @Inject(NOTIFICATION_PLUGIN_OPTIONS) private options: NotificationPluginOptions,
        private connection: TransactionalConnection,
        private orderService: OrderService,
        private customerService: CustomerService,
        private eventBus: EventBus,
    ) {
        this.notifier = {} as NotifierProvider;
    }

    /** 由插件 onApplicationBootstrap 注入 notifier（避免 DI 环）。 */
    init(notifier: NotifierProvider): void {
        this.notifier = notifier;
    }

    // ---------- 站内信存储 ----------

    /** 写一条站内信，返回落库实体。 */
    createInbox(ctx: RequestContext, frame: NotificationFrame, opts: {
        recipientType: 'customer' | 'admin';
        customerId?: number;
        administratorId?: number;
    }): Promise<InboxMessage> {
        const msg = new InboxMessage({
            channelId: ctx.channelId as number,
            recipientType: opts.recipientType,
            customerId: opts.customerId ?? null,
            administratorId: opts.administratorId ?? null,
            scene: frame.scene,
            title: frame.title,
            content: frame.content,
            link: frame.link ?? null,
            isRead: false,
        } as any);
        return this.connection.getRepository(ctx, InboxMessage).save(msg);
    }

    /** C 端收件箱：当前顾客的站内信（按 id 倒序）。 */
    async listCustomerInbox(ctx: RequestContext, options?: InboxMessageListOptions): Promise<{ items: InboxMessage[]; totalItems: number }> {
        const customer = await this.requireCustomer(ctx);
        const skip = options?.skip ?? 0;
        const take = options?.take ?? 50;
        const where = { customerId: customer.id, channelId: ctx.channelId as number } as any;
        const [items, totalItems] = await this.connection.getRepository(ctx, InboxMessage).findAndCount({
            where, order: { id: 'DESC' }, skip, take,
        });
        return { items, totalItems };
    }

    /** 店主/平台收件箱：当前登录管理员。 */
    async listAdminInbox(ctx: RequestContext, options?: InboxMessageListOptions): Promise<{ items: InboxMessage[]; totalItems: number }> {
        if (!ctx.activeUserId) throw new UnauthorizedError();
        const admin = await this.administratorForUser(ctx.activeUserId);
        const skip = options?.skip ?? 0;
        const take = options?.take ?? 50;
        const where = { administratorId: admin.id, channelId: ctx.channelId as number } as any;
        const [items, totalItems] = await this.connection.getRepository(ctx, InboxMessage).findAndCount({
            where, order: { id: 'DESC' }, skip, take,
        });
        return { items, totalItems };
    }

    /** 未读数。 */
    async unreadCount(ctx: RequestContext, t: 'customer' | 'admin' = 'customer'): Promise<number> {
        if (t === 'customer') {
            const c = await this.requireCustomer(ctx);
            return this.connection.getRepository(ctx, InboxMessage).count({
                where: { customerId: c.id, isRead: false, channelId: ctx.channelId as number } as any,
            });
        }
        if (!ctx.activeUserId) throw new UnauthorizedError();
        const admin = await this.administratorForUser(ctx.activeUserId);
        return this.connection.getRepository(ctx, InboxMessage).count({
            where: { administratorId: admin.id, isRead: false, channelId: ctx.channelId as number } as any,
        });
    }

    /** 置已读（仅本人）。 */
    async markRead(ctx: RequestContext, id: ID, t: 'customer' | 'admin'): Promise<InboxMessage> {
        const msg = await this.connection.getRepository(ctx, InboxMessage).findOne({
            where: { id: Number(id) } as any,
        });
        if (!msg) throw new EntityNotFoundError('InboxMessage', id);
        if (t === 'customer') {
            const c = await this.requireCustomer(ctx);
            if (msg.customerId !== c.id) throw new EntityNotFoundError('InboxMessage', id);
        } else {
            if (!ctx.activeUserId) throw new UnauthorizedError();
            const admin = await this.administratorForUser(ctx.activeUserId);
            if (msg.administratorId !== admin.id) throw new EntityNotFoundError('InboxMessage', id);
        }
        msg.isRead = true;
        msg.readAt = new Date();
        return this.connection.getRepository(ctx, InboxMessage).save(msg);
    }

    // ---------- 触发场景 ----------

    /** 订单状态迁移 → 买家/店主站内信 + 微信。 */
    async onOrderStateTransition(ctx: RequestContext, orderId: ID, toState: string): Promise<void> {
        const sceneMap: Record<string, string> = {
            PaymentSettled: 'order_paid',
            Shipped: 'order_shipped',
            Delivered: 'order_delivered',
            Completed: 'order_completed',
        };
        const scene = sceneMap[toState];
        if (!scene) return;

        // 传 relations 会覆盖默认值，必须显式带上 lines + lines.productVariant，
        // 否则 order.lines 为空，getOrderShopIds 无法反查到商品归属店铺（shop_new_order 永不触发）。
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer', 'customFields', 'lines', 'lines.productVariant',
        ] as any);
        if (!order) return;
        const title = this.titleFor(scene);
        const content = `您的订单 ${order.code} ${this.descFor(scene)}。`;

        if (order.customer?.id) {
            const frame: NotificationFrame = {
                scene, title, content, recipientType: 'customer',
                customerId: order.customer.id, templateParams: { orderCode: order.code },
            };
            await this.deliver(ctx, frame);
        }
        if (toState === 'PaymentSettled') {
            await this.notifyShopOwners(ctx, order, `新订单 ${order.code}`, `您有一笔新订单 ${order.code}，请尽快处理。`);
        }
    }

    /** 退款 Settled → 买家到账通知。 */
    async onRefundSettled(ctx: RequestContext, orderId: ID, refundTotalWithTax: number): Promise<void> {
        const order = await this.orderService.findOne(ctx, orderId, ['customer'] as any);
        if (!order || !order.customer?.id) return;
        await this.deliver(ctx, {
            scene: 'refund_settled',
            title: '退款到账',
            content: `订单 ${order.code} 退款 ¥${(refundTotalWithTax / 100).toFixed(2)} 已到账。`,
            recipientType: 'customer',
            customerId: order.customer.id,
            templateParams: { orderCode: order.code, amount: String(refundTotalWithTax) },
        });
    }

    // ---------- 券过期提醒（FR-A2，事件来自 coupon-plugin 定时扫描） ----------

    /**
     * R4 防骚扰：同用户同券同阶段 7 天内最多 1 次。
     * 去重锚点 = scene + 渠道 + 顾客 + 阶段标题 + 券码（content LIKE）；
     * 同模板多实例只提醒一次（文案一致），不同券各提醒一次。
     * 微信通道未配置时 deliver 自动降级为仅站内信（WechatNotifierProvider 返回 false）。
     */
    async onCouponExpireRemind(event: CouponExpireRemindEvent): Promise<void> {
        try {
            const { ctx, payload } = event;
            const title = payload.stage === '1d' ? '优惠券明天过期' : '优惠券 3 天后过期';
            const d = payload.expiresAt instanceof Date ? payload.expiresAt : new Date(payload.expiresAt);
            const dateText = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const content = `您的优惠券「${payload.templateName}」（券码 ${payload.couponCode}）将于 ${dateText} 过期，记得使用哦。`;
            const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
            const dup = await this.connection
                .getRepository(ctx, InboxMessage)
                .createQueryBuilder('m')
                .where('m.scene = :scene', { scene: 'coupon_expire' })
                .andWhere('m.channelId = :channelId', { channelId: ctx.channelId as number })
                .andWhere('m.customerId = :customerId', { customerId: Number(payload.customerId) })
                .andWhere('m.title = :title', { title })
                .andWhere('m.content LIKE :pat', { pat: `%${payload.couponCode}%` })
                .andWhere('m.createdAt >= :since', { since })
                .getOne();
            if (dup) return;
            await this.deliver(ctx, {
                scene: 'coupon_expire',
                title,
                content,
                recipientType: 'customer',
                customerId: payload.customerId,
                link: '/coupon',
                templateParams: {
                    couponCode: payload.couponCode,
                    couponName: payload.templateName,
                    expiresAt: d.toISOString(),
                    stage: payload.stage,
                },
            });
        } catch (err: any) {
            Logger.warn(`onCouponExpireRemind failed: ${err?.message ?? err}`, loggerCtx);
        }
    }

    // ---------- 工具 ----------

    private async deliver(ctx: RequestContext, frame: NotificationFrame): Promise<void> {
        if (frame.recipientType === 'customer') {
            if (this.options.inboxEnabled !== false && frame.customerId) {
                await this.createInbox(ctx, frame, { recipientType: 'customer', customerId: Number(frame.customerId) });
            }
        }
        try {
            if (this.notifier.send) {
                await this.notifier.send(frame);
            }
        } catch (e: any) {
            Logger.warn(`notifier error: ${e?.message}`, loggerCtx);
        }
    }

    /** 涉及店铺的店主收件箱推送（沿 Product.shopId → Shop.administratorId）。 */
    private async notifyShopOwners(ctx: RequestContext, order: any, title: string, content: string): Promise<void> {
        const shopIds = await this.getOrderShopIds(ctx, order);
        if (shopIds.length === 0) return;
        const shops = await this.connection.getRepository(ctx, Shop).find({
            where: { id: In(shopIds) } as any,
        });
        for (const shop of shops) {
            if (shop.administratorId == null) continue;
            await this.createInbox(ctx, { scene: 'shop_new_order', title, content, recipientType: 'admin' }, {
                recipientType: 'admin', administratorId: shop.administratorId,
            });
        }
        // 管理侧外发钩子（飞书等）：订阅方决定是否推送，失败不影响站内信
        try {
            await this.eventBus.publish(
                new AdminNotifyEvent(ctx, 'shop_new_order', title, content, order.id, order.code, shopIds[0]),
            );
        } catch (e: any) {
            Logger.warn(`admin notify publish failed: ${e?.message}`, loggerCtx);
        }
    }

    /** 订单行 → productVariant.productId → Product.shopId 反查去重（对齐 address-plugin getOrderShopIds）。 */
    private async getOrderShopIds(ctx: RequestContext, order: any): Promise<number[]> {
        const productIds = [...new Set(
            (order.lines ?? [])
                .map((l: any) => Number(l.productVariant?.productId) || Number(l.productId))
                .filter((id: number) => id > 0),
        )];
        if (productIds.length === 0) return [];
        const products = await this.connection.getRepository(ctx, Product).find({
            where: { id: In(productIds) } as any,
        });
        return [...new Set(products.map((p: any) => Number(p.customFields?.shopId)).filter((id: number) => id > 0))];
    }

    /**
     * 商家收件人解析（§126）：优先商品归属（Product.shopId）；
     * 校园商品大多未配置 shopId，回退到渠道维度（Shop.channelId = 当前渠道），
     * 避免售后提醒因解析为空而静默丢弃。
     */
    private async resolveMerchantShopIds(ctx: RequestContext, order: any): Promise<number[]> {
        const productShopIds = await this.getOrderShopIds(ctx, order);
        if (productShopIds.length > 0) return productShopIds;
        const channelId = Number(ctx.channelId ?? order?.channelId);
        if (!channelId) return [];
        // 用裸连接查询：Shop 实现 ChannelAware，按 ctx 渠道过滤会漏掉未挂 channels 关联的店铺
        const shops = await this.connection.rawConnection.getRepository(Shop).find({
            where: { channelId } as any,
        });
        return [...new Set(shops.map((s: any) => Number(s.id)).filter((id: number) => id > 0))];
    }

    private titleFor(scene: string): string {
        const m: Record<string, string> = {
            order_paid: '支付成功', order_shipped: '订单已发货', order_delivered: '订单已送达', order_completed: '交易完成',
        };
        return m[scene] ?? '订单通知';
    }

    private descFor(scene: string): string {
        const m: Record<string, string> = {
            order_paid: '已支付成功', order_shipped: '已发货', order_delivered: '已送达', order_completed: '已完成',
        };
        return m[scene] ?? '状态已更新';
    }

    private async requireCustomer(ctx: RequestContext): Promise<any> {
        if (!ctx.activeUserId) throw new UnauthorizedError();
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) throw new EntityNotFoundError('Customer', ctx.activeUserId);
        return customer;
    }

    /** 按登录 User 主键反查 Administrator（Administrator.user 关系）。 */
    private async administratorForUser(userId: ID): Promise<any> {
        const repo = this.connection.rawConnection.getRepository(Administrator);
        const a = await repo.findOne({ where: { user: { id: Number(userId) } } } as any);
        if (!a) throw new EntityNotFoundError('Administrator', userId);
        return a;
    }

    // ---------- 售后状态通知（迭代三期，通知矩阵见三期设计 §一） ----------

    /** 售后状态迁移 → 顾客/商家站内信。任何失败仅告警，绝不阻断主流程。 */
    async onAfterSalesStateTransition(ctx: RequestContext, e: {
        requestId: number;
        orderId: number;
        type: string;
        fromState: string | null;
        toState: string;
        customerId: number | null;
        orderCode?: string | null;
    }): Promise<void> {
        try {
            const customerLink = `/account/after-sales/${e.requestId}`;
            const cTitles: Record<string, string> = {
                Approved: '售后审核通过',
                Received: '商家已收货',
                Refunded: '退款已到账',
                RefundFailed: '退款异常',
            };
            const cContents: Record<string, string> = {
                Approved: '您的售后申请已审核通过，请按寄回地址寄回商品。',
                Received: '商家已确认收到您的退货，退款将原路退回。',
                Refunded: '您的退款已原路退回，请留意账户变动。',
                RefundFailed: '退款处理出现异常，商家正在处理，请耐心等待。',
            };
            // ---- 顾客侧 ----
            if (e.customerId != null) {
                if (e.toState === 'Rejected') {
                    const req = await this.afterSalesRequestRow(e.requestId);
                    const reason = (req?.rejectReason ?? '').slice(0, 50);
                    await this.deliver(ctx, {
                        scene: 'after_sales', title: '售后被拒绝',
                        content: `您的售后申请被拒绝${reason ? '：' + reason : '。'}`,
                        recipientType: 'customer', customerId: e.customerId, link: customerLink,
                    });
                } else if (e.toState === 'ExchangeShipped') {
                    const req = await this.afterSalesRequestRow(e.requestId);
                    await this.deliver(ctx, {
                        scene: 'after_sales', title: '换货已发货',
                        content: `商家已寄出换货新品${req?.exchangeTrackingNo ? `（运单号 ${req.exchangeTrackingNo}）` : ''}，请确认收货。`,
                        recipientType: 'customer', customerId: e.customerId, link: customerLink,
                    });
                } else if (e.toState === 'Closed' && e.fromState === 'ExchangeShipped') {
                    await this.deliver(ctx, {
                        scene: 'after_sales', title: '换货完成',
                        content: '换货已完成，感谢您的耐心等待。',
                        recipientType: 'customer', customerId: e.customerId, link: customerLink,
                    });
                } else if (e.toState === 'Closed' && e.fromState === 'Pending') {
                    // 商家关闭重复/误申请（adminCancelRequest）：告知原因，避免顾客反复追问
                    const req = await this.afterSalesRequestRow(e.requestId);
                    const reason = (req?.rejectReason ?? '').slice(0, 50);
                    await this.deliver(ctx, {
                        scene: 'after_sales', title: '售后申请已关闭',
                        content: `您的售后申请已关闭${reason ? '：' + reason : '。'}`,
                        recipientType: 'customer', customerId: e.customerId, link: customerLink,
                    });
                } else if (cTitles[e.toState]) {
                    await this.deliver(ctx, {
                        scene: 'after_sales', title: cTitles[e.toState], content: cContents[e.toState],
                        recipientType: 'customer', customerId: e.customerId, link: customerLink,
                    });
                }
            }
            // ---- 商家侧（商品归属店铺管理员）----
            if (e.toState === 'Pending' && e.fromState === null) {
                await this.notifyAfterSalesMerchant(ctx, e.requestId, '新售后待处理',
                    `您有一笔新的售后申请（订单 ${e.orderCode ?? e.orderId}），请及时处理。`);
            } else if (e.toState === 'Returning') {
                await this.notifyAfterSalesMerchant(ctx, e.requestId, '顾客已寄回',
                    `顾客已填写退货物流（订单 ${e.orderCode ?? e.orderId}），请尽快确认收货。`);
            } else if (e.toState === 'Appealed') {
                await this.notifyAfterSalesMerchant(ctx, e.requestId, '顾客已申诉',
                    `顾客对售后处理结果提出申诉（订单 ${e.orderCode ?? e.orderId}），请重新审核。`);
            }
        } catch (err: any) {
            Logger.warn(`onAfterSalesStateTransition failed: ${err?.message ?? err}`, loggerCtx);
        }
    }

    /** 商家（商品归属店铺 administratorId）售后站内信；无店铺归属（自营）则不落。 */
    async notifyAfterSalesMerchant(ctx: RequestContext, requestId: number, title: string, content: string): Promise<void> {
        try {
            const request = await this.connection.rawConnection.getRepository(AfterSalesRequest).findOne({
                where: { id: requestId as any },
                relations: { order: { lines: { productVariant: true } } } as any,
            });
            if (!request?.order) return;
            const shopIds = await this.resolveMerchantShopIds(ctx, request.order);
            if (shopIds.length === 0) return;
            const shops = await this.connection.rawConnection.getRepository(Shop).find({ where: { id: In(shopIds) } as any });
            for (const shop of shops) {
                if (shop.administratorId == null) continue;
                await this.createInbox(ctx, {
                    scene: 'after_sales', title, content, recipientType: 'admin',
                    link: `/after-sale/detail?id=${requestId}`,
                }, { recipientType: 'admin', administratorId: shop.administratorId });
            }
            try {
                await this.eventBus.publish(
                    new AdminNotifyEvent(ctx, 'after_sales', title, content, request.order.id, request.order.code, shopIds[0], `/after-sale/detail?id=${requestId}`),
                );
            } catch (e: any) {
                Logger.warn(`admin notify publish failed: ${e?.message}`, loggerCtx);
            }
        } catch (err: any) {
            Logger.warn(`notifyAfterSalesMerchant failed: ${err?.message ?? err}`, loggerCtx);
        }
    }

    /** 商家催办顾客（§84）：站内信提醒顾客处理售后事项（商家主动触发，非状态变更） */
    async onAfterSalesCustomerRemind(ctx: RequestContext, e: {
        requestId: number;
        customerId: number | null;
        title: string;
        content: string;
    }): Promise<void> {
        if (e.customerId == null) return;
        try {
            await this.deliver(ctx, {
                scene: 'after_sales',
                title: e.title,
                content: e.content,
                recipientType: 'customer',
                customerId: e.customerId,
                link: `/account/after-sales/${e.requestId}`,
            });
        } catch (err: any) {
            Logger.warn(`onAfterSalesCustomerRemind failed: ${err?.message ?? err}`, loggerCtx);
        }
    }

    private async afterSalesRequestRow(id: number): Promise<AfterSalesRequest | null> {
        return this.connection.rawConnection.getRepository(AfterSalesRequest).findOne({ where: { id: id as any } });
    }
}