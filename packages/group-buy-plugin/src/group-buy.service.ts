import { Injectable } from '@nestjs/common';
import {
    ChannelService,
    CustomerService,
    EventBus,
    ID,
    Injector,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    Order,
    OrderService,
    PaginatedList,
    PaymentService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { In } from 'typeorm';

import { loggerCtx } from './constants';
import { GroupBuyActivity } from './group-buy-activity.entity';
import { GroupBuyOrder } from './group-buy-order.entity';
import { GroupBuyCompletedEvent, GroupBuyFailedEvent } from './events';
import { setGroupBuyConnection } from './group-buy-runtime';
import {
    instantToPlatformWall,
    PLATFORM_TIME_ZONE,
    platformNowMs,
    wallClockMs,
} from './platform-time';

const ALLOWED_UPDATE_FIELDS = [
    'name',
    'description',
    'startAt',
    'endAt',
    'targetCount',
    'maxCount',
    'groupPrice',
    'leaderDiscount',
    'leaderRewardType',
    'productId',
    'variantId',
    'autoConfirm',
    'allowJoinAfterComplete',
    'status',
] as const;

export interface MyGroupBuyOrder {
    id: string;
    orderId: string;
    orderCode?: string;
    groupBuyActivityId: string;
    isLeader: boolean;
    status: string;
    activity?: GroupBuyActivity;
}

@Injectable()
export class GroupBuyService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private channelService: ChannelService,
        private customerService: CustomerService,
        private orderService: OrderService,
        private paymentService: PaymentService,
        private eventBus: EventBus,
    ) {}

    private stockReserveService: any = null;
    private stockPrewarmService: any = null;

    init(injector: Injector): void {
        // 供 Promotion 条件/动作在结算期动态取活动配置
        setGroupBuyConnection(this.connection);
        try {
            const { StockReserveService, StockPrewarmService } = require('@vendure/redis-stock-plugin');
            this.stockReserveService = injector.get(StockReserveService);
            this.stockPrewarmService = injector.get(StockPrewarmService);
        } catch {
            // RedisStockPlugin not installed, use DB fallback
        }
    }

    /* ------------------------- 活动管理 ------------------------- */

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<GroupBuyActivity>,
    ): Promise<PaginatedList<GroupBuyActivity>> {
        return this.listQueryBuilder
            .build(GroupBuyActivity, options, {
                ctx,
                relations: ['channels'],
                channelId: ctx.channelId,
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    async findOne(ctx: RequestContext, id: ID): Promise<GroupBuyActivity | undefined> {
        const result = await this.connection.getRepository(ctx, GroupBuyActivity).findOne({
            where: { id: id as any },
            relations: { channels: true },
        });
        return result ?? undefined;
    }

    async create(ctx: RequestContext, input: Partial<GroupBuyActivity>): Promise<GroupBuyActivity> {
        const repo = this.connection.getRepository(ctx, GroupBuyActivity);
        // B2：创建强制落到调用者当前渠道，忽略前端传入的 channels/channelId
        const safeInput = { ...(input as any) };
        delete safeInput.channels;
        delete safeInput.channelId;
        const activity = new GroupBuyActivity(safeInput);
        activity.channels = [ctx.channel];
        // 入参是绝对时刻，落库前显式转成平台墙上时间（列类型为 timestamp，不随进程 TZ 漂移）
        if (activity.startAt) activity.startAt = instantToPlatformWall(activity.startAt);
        if (activity.endAt) activity.endAt = instantToPlatformWall(activity.endAt);
        const saved = await repo.save(activity);
        if (this.stockPrewarmService && saved.status === 'active') {
            await this.stockPrewarmService.prewarm(`group-buy:${saved.id}`, saved.targetCount - saved.currentCount);
        }
        return saved;
    }

    async update(ctx: RequestContext, input: any): Promise<GroupBuyActivity> {
        const repo = this.connection.getRepository(ctx, GroupBuyActivity);
        const activity = await repo.findOne({ where: { id: input.id } });
        if (!activity) {
            throw new UserInputError(`GroupBuyActivity with id ${input.id} not found`);
        }
        const patch: Record<string, unknown> = {};
        for (const key of ALLOWED_UPDATE_FIELDS) {
            if (input[key] !== undefined) {
                patch[key] = input[key];
            }
        }
        Object.assign(activity, patch);
        // 入参是绝对时刻，落库前显式转成平台墙上时间（列类型为 timestamp）
        if (patch.startAt) activity.startAt = instantToPlatformWall(new Date(patch.startAt as any));
        if (patch.endAt) activity.endAt = instantToPlatformWall(new Date(patch.endAt as any));
        return repo.save(activity);
    }

    async delete(ctx: RequestContext, id: ID): Promise<void> {
        const repo = this.connection.getRepository(ctx, GroupBuyActivity);
        await repo.delete(id);
    }

    /* ------------------------- 开团 / 参团（闭环核心） ------------------------- */

    /**
     * 开团/参团一体：
     * 1. 校验订单归属（customer.user.id，勿用 customer.id）
     * 2. 校验活动：存在、非 expired、窗口内、可参（未满 / 已成团且允许续参）
     * 3. 校验订单包含拼团变体行
     * 4. 原子递增 currentCount（防超员，受影响=0 即满员/不可参）
     * 5. 写订单 customFields（groupBuyActivityId + groupBuyIsLeader）并重算价格 → 拼团价立即生效
     * 6. 登记/更新参团记录（同一 orderId 幂等，不重复递增）
     * 7. 达 targetCount → 活动 completed + 全部 pending 参团记录置 success
     */
    async joinGroupBuy(
        ctx: RequestContext,
        activityId: ID,
        orderId: ID,
        isLeader: boolean,
    ): Promise<GroupBuyOrder> {
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'customer.user',
            'lines',
            'lines.productVariant',
        ]);
        if (!order) {
            throw new UserInputError(`Order ${orderId} not found`);
        }
        // 归属校验：登录 User 主键 vs order.customer.user.id
        if ((order as any)?.customer?.user?.id !== ctx.activeUserId) {
            throw new UserInputError('You can only join a group buy with your own order');
        }

        const activityRepo = this.connection.getRepository(ctx, GroupBuyActivity);
        const activity = await activityRepo.findOne({ where: { id: activityId as any } });
        if (!activity) {
            throw new UserInputError(`GroupBuyActivity with id ${activityId} not found`);
        }

        const nowMs = platformNowMs();
        if (activity.status === 'expired') {
            throw new UserInputError('Activity has expired');
        }
        if (activity.status !== 'active' && !activity.allowJoinAfterComplete) {
            throw new UserInputError('Activity is not joinable');
        }
        if (activity.startAt && nowMs < wallClockMs(activity.startAt)) {
            throw new UserInputError('Group buy activity has not started yet');
        }
        if (activity.endAt && nowMs > wallClockMs(activity.endAt)) {
            throw new UserInputError('Group buy activity has ended');
        }

        // 订单须包含拼团变体行
        const hasVariant = (order as any)?.lines?.some(
            (l: any) => l?.productVariant && String(l.productVariant.id) === String(activity.variantId),
        );
        if (!hasVariant) {
            throw new UserInputError('Order does not contain the group buy variant');
        }

        const orderRepo = this.connection.getRepository(ctx, GroupBuyOrder);
        const existing = await orderRepo.findOne({ where: { orderId: String(orderId) } });
        const alreadyJoined = !!existing;

        if (!alreadyJoined) {
            // 原子递增（权威防超员/防续参条件）
            const incResult = await activityRepo
                .createQueryBuilder()
                .update()
                .set({ currentCount: () => 'currentCount + 1' })
                .where('id = :id', { id: activity.id })
                .andWhere(
                    '(status = :active OR (status = :completed AND :allowJoin = true))',
                    {
                        active: 'active',
                        completed: 'completed',
                        allowJoin: activity.allowJoinAfterComplete,
                    },
                )
                .andWhere('startAt <= (now() AT TIME ZONE :platformTz)', {
                    platformTz: PLATFORM_TIME_ZONE,
                })
                .andWhere('endAt >= (now() AT TIME ZONE :platformTz)', {
                    platformTz: PLATFORM_TIME_ZONE,
                })
                .andWhere('(maxCount = 0 OR currentCount < maxCount)')
                .execute();
            if ((incResult.affected ?? 0) === 0) {
                throw new UserInputError('Activity is already full or not joinable');
            }
        }

        // 写订单自定义字段 → 触发拼团价 Promotion 生效
        const updatedOrder = await this.orderService.updateCustomFields(ctx, orderId, {
            groupBuyActivityId: Number(activityId),
            groupBuyIsLeader: isLeader,
        });
        await this.orderService.applyPriceAdjustments(ctx, updatedOrder);

        // 登记/更新参团记录（幂等：已存在则只更新 isLeader）
        let groupBuyOrder: GroupBuyOrder;
        if (alreadyJoined && existing) {
            existing.isLeader = isLeader;
            groupBuyOrder = await orderRepo.save(existing);
        } else {
            const status: 'pending' | 'success' =
                activity.status === 'completed' ? 'success' : 'pending';
            groupBuyOrder = new GroupBuyOrder({
                groupBuyActivityId: String(activity.id),
                orderId: String(orderId),
                isLeader,
                status,
            });
            groupBuyOrder = await orderRepo.save(groupBuyOrder);
        }

        // 成团联动：当前人数达到目标 → 活动 completed + 全部 pending 参团记录 success
        if (!alreadyJoined && activity.status === 'active') {
            const fresh = await activityRepo.findOne({ where: { id: activity.id } });
            if (fresh && fresh.currentCount >= fresh.targetCount) {
                fresh.status = 'completed';
                await activityRepo.save(fresh);
                await this.markAllSuccess(ctx, activity.id);
                // 成团领域事件（供支付计划等下游订阅）
                const joined = await orderRepo.find({ where: { groupBuyActivityId: String(activity.id) } });
                this.eventBus.publish(new GroupBuyCompletedEvent(ctx, Number(activity.id), joined.map(j => j.orderId)));
            }
        }

        Logger.info(
            `User ${ctx.activeUserId} ${isLeader ? 'opened' : 'joined'} group buy ${activity.id} on order ${orderId} (count ${activity.currentCount + (alreadyJoined ? 0 : 1)})`,
            loggerCtx,
        );
        return groupBuyOrder;
    }

    /* ------------------------- 过期检查（定时任务 + 手动触发共用） ------------------------- */

    /**
     * 处理已过 endAt 且仍 active 的活动：
     * - 已成团（currentCount >= targetCount）→ 置 completed（兜底，通常 join 时已处理）
     * - 未成团 → 置 expired，并取消+退款全部 pending 参团订单，参团记录置 failed
     * 返回处理过的活动，便于调用方清理 prewarm 库存。
     */
    async processExpired(ctx: RequestContext): Promise<GroupBuyActivity[]> {
        const activityRepo = this.connection.getRepository(ctx, GroupBuyActivity);
        const orderRepo = this.connection.getRepository(ctx, GroupBuyOrder);

        const expiredActivities = await activityRepo
            .createQueryBuilder('gba')
            .innerJoin('gba.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('gba.endAt < (now() AT TIME ZONE :platformTz)', {
                platformTz: PLATFORM_TIME_ZONE,
            })
            .andWhere('gba.status = :status', { status: 'active' })
            .getMany();

        const processed: GroupBuyActivity[] = [];
        for (const activity of expiredActivities) {
            if (activity.currentCount >= activity.targetCount) {
                activity.status = 'completed';
            } else {
                activity.status = 'expired';
            }
            await activityRepo.save(activity);
            processed.push(activity);

            if (activity.status === 'expired') {
                const pendingOrders = await orderRepo.find({
                    where: { groupBuyActivityId: String(activity.id), status: 'pending' as any },
                });
                for (const gbo of pendingOrders) {
                    try {
                        await this.orderService.cancelOrder(ctx, { orderId: gbo.orderId as any });
                        await this.refundOrderPayments(ctx, gbo.orderId);
                        gbo.status = 'failed';
                        await orderRepo.save(gbo);
                        Logger.info(
                            `Cancelled and refunded group buy order ${gbo.orderId} for expired activity ${activity.id}`,
                            loggerCtx,
                        );
                    } catch (e: any) {
                        Logger.error(
                            `Failed to cancel group buy order ${gbo.orderId}: ${e.message}`,
                            loggerCtx,
                        );
                    }
                }
                // 不成团领域事件（供支付计划等下游订阅）
                const allJoined = await orderRepo.find({ where: { groupBuyActivityId: String(activity.id) } });
                this.eventBus.publish(new GroupBuyFailedEvent(ctx, Number(activity.id), allJoined.map(j => j.orderId)));
            }
            Logger.info(`Activity ${activity.id} status changed to ${activity.status}`, loggerCtx);
        }
        return processed;
    }

    /* ------------------------- 查询 ------------------------- */

    async findActiveByVariant(ctx: RequestContext, variantId: ID): Promise<GroupBuyActivity[]> {
        const repo = this.connection.getRepository(ctx, GroupBuyActivity);
        const qb = repo.createQueryBuilder('gba');
        qb.innerJoin('gba.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId });
        qb.where('gba.variantId = :variantId', { variantId: variantId as any });
        qb.andWhere('gba.status = :status', { status: 'active' });
        return qb.getMany();
    }

    async findActive(ctx: RequestContext): Promise<GroupBuyActivity[]> {
        const repo = this.connection.getRepository(ctx, GroupBuyActivity);
        return repo
            .createQueryBuilder('gba')
            .innerJoin('gba.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('gba.status = :status', { status: 'active' })
            .andWhere('gba.startAt <= (now() AT TIME ZONE :platformTz)', {
                platformTz: PLATFORM_TIME_ZONE,
            })
            .andWhere('gba.endAt >= (now() AT TIME ZONE :platformTz)', {
                platformTz: PLATFORM_TIME_ZONE,
            })
            .getMany();
    }

    /**
     * Shop API 专用：「我的开团 / 我的参团」。
     * GroupBuyOrder 没有 customerId 列，归属只能经 orderId 关联 Order.customerId 反查
     * （参考 after-sales-plugin 的 resolveCustomerId 桥接思路）。
     * 先取当前渠道下该客户的订单 id，再按 orderId 反查拼团记录 —— 不用原生 join 条件，
     * 因为 orderId 是 varchar 而 Order.id 是 int，Postgres 下 `int = varchar` 会直接报错。
     * 渠道过滤走订单的 channels 关联：GroupBuyOrder.channels 在 joinGroupBuy 里从未写入，不能当过滤条件。
     */
    async findMyOrders(ctx: RequestContext, isLeader: boolean): Promise<MyGroupBuyOrder[]> {
        if (!ctx.activeUserId) {
            return [];
        }
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) {
            return [];
        }

        const orders = await this.connection
            .getRepository(ctx, Order)
            .createQueryBuilder('ord')
            .innerJoin('ord.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('ord.customerId = :customerId', { customerId: Number(customer.id) })
            .select(['ord.id', 'ord.code'])
            .getMany();
        if (orders.length === 0) {
            return [];
        }
        const orderCodeMap = new Map(orders.map(o => [String(o.id), o.code]));

        const rows = await this.connection.getRepository(ctx, GroupBuyOrder).find({
            where: { orderId: In(orders.map(o => String(o.id))), isLeader },
            order: { createdAt: 'DESC' },
        });
        if (rows.length === 0) {
            return [];
        }

        // 二次批量取活动详情：GroupBuyOrder 与 GroupBuyActivity 之间没有 ORM 关联
        const activityRows = await this.connection
            .getRepository(ctx, GroupBuyActivity)
            .find({ where: { id: In(Array.from(new Set(rows.map(r => Number(r.groupBuyActivityId))))) as any } });
        const activityMap = new Map(activityRows.map(a => [String(a.id), a]));

        return rows.map(r => ({
            id: String(r.id),
            orderId: String(r.orderId),
            orderCode: orderCodeMap.get(String(r.orderId)),
            groupBuyActivityId: String(r.groupBuyActivityId),
            isLeader: r.isLeader,
            status: r.status,
            activity: activityMap.get(String(r.groupBuyActivityId)),
        }));
    }

    /* ------------------------- 私有工具 ------------------------- */

    /** 活动成团后，把该活动全部 pending 参团记录置 success */
    private async markAllSuccess(ctx: RequestContext, activityId: ID): Promise<void> {
        const orderRepo = this.connection.getRepository(ctx, GroupBuyOrder);
        await orderRepo
            .createQueryBuilder()
            .update()
            .set({ status: 'success' })
            .where('groupBuyActivityId = :activityId', { activityId: String(activityId) })
            .andWhere('status = :pending', { pending: 'pending' })
            .execute();
    }

    /** 对订单的 Settled 支付逐个退款（拼团失败/过期） */
    private async refundOrderPayments(ctx: RequestContext, orderId: string): Promise<void> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any },
            relations: ['payments'],
        });
        if (!order?.payments?.length) {
            return;
        }
        for (const payment of order.payments) {
            if ((payment.state as string) === 'Settled') {
                try {
                    const result = await this.paymentService.createRefund(
                        ctx,
                        {
                            paymentId: payment.id,
                            amount: payment.amount,
                            reason: 'Group buy failed/expired',
                            // Refund.shipping / Refund.adjustment 为 NOT NULL 列，必须显式置 0
                            // （否则 sqljs 报 NOT NULL constraint failed: refund.shipping）
                            shipping: 0,
                            adjustment: 0,
                        },
                        order,
                        payment,
                    );
                    if (result instanceof Error) {
                        Logger.warn(`Refund for payment ${payment.id} returned error: ${result.message}`, loggerCtx);
                    }
                } catch (e: any) {
                    Logger.error(`Failed to refund payment ${payment.id} for order ${orderId}: ${e.message}`, loggerCtx);
                }
            }
        }
    }
}
