import { Injectable } from '@nestjs/common';
import {
    ID,
    Injector,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    Order,
    OrderService,
    PaginatedList,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { loggerCtx } from './constants';
import { FlashSaleActivity } from './flash-sale-activity.entity';
import { setFlashSaleConnection } from './flash-sale-runtime';

/**
 * update() 允许写入的字段白名单。
 * 显式过滤 soldCount/status 等敏感字段，避免被外部 input 篡改。
 */
const UPDATE_ALLOWED_FIELDS: ReadonlyArray<keyof FlashSaleActivity> = [
    'name',
    'startAt',
    'endAt',
    'flashPrice',
    'totalStock',
    'limitPerUser',
    'productId',
    'variantId',
];

@Injectable()
export class FlashSaleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private orderService: OrderService,
    ) {}

    private stockReserveService: any = null;

    init(injector: Injector): void {
        // 供 Promotion 条件/动作在结算期动态取活动配置
        setFlashSaleConnection(this.connection);
        try {
            const { StockReserveService } = require('@vendure/redis-stock-plugin');
            this.stockReserveService = injector.get(StockReserveService);
        } catch {
            // RedisStockPlugin not installed, use DB fallback
        }
    }

    /* ------------------------- 活动管理 ------------------------- */

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<FlashSaleActivity>,
    ): Promise<PaginatedList<FlashSaleActivity>> {
        return this.listQueryBuilder
            .build(FlashSaleActivity, options, {
                ctx,
                channelId: ctx.channelId,
                relations: ['channels'],
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    async findOne(ctx: RequestContext, id: ID): Promise<FlashSaleActivity | undefined> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        const result = await repo.findOne({
            where: { id: id as any },
            relations: { channels: true },
        });
        return result ?? undefined;
    }

    async create(ctx: RequestContext, input: Partial<FlashSaleActivity>): Promise<FlashSaleActivity> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        // B2：创建强制落到调用者当前渠道，忽略前端传入的 channels/channelId
        const safeInput = { ...(input as any) };
        delete safeInput.channels;
        delete safeInput.channelId;
        const activity = new FlashSaleActivity(safeInput);
        activity.channels = [ctx.channel];
        const now = new Date();
        if (activity.startAt && now >= activity.startAt) {
            activity.status = 'active';
        } else {
            activity.status = 'upcoming';
        }
        return repo.save(activity);
    }

    async update(ctx: RequestContext, input: any): Promise<FlashSaleActivity> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        const activity = await repo.findOne({ where: { id: input.id } });
        if (!activity) {
            throw new UserInputError(`FlashSaleActivity with id ${input.id} not found`);
        }
        // 字段白名单：禁止外部 input 篡改 soldCount/status 等内部字段
        for (const key of UPDATE_ALLOWED_FIELDS) {
            if (key in input) {
                (activity as any)[key] = input[key];
            }
        }
        return repo.save(activity);
    }

    async delete(ctx: RequestContext, id: ID): Promise<void> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        await repo.delete(id);
    }

    /* ------------------------- 抢购（闭环核心） ------------------------- */

    /**
     * 抢购一体：
     * 1. 取当前登录用户的 activeOrder（校验归属：order.customer.user.id === ctx.activeUserId）
     * 2. 校验活动：存在、status=active、窗口内
     * 3. 校验订单含秒杀变体行；qty = 秒杀变体行总件数
     * 4. 限购校验：同客户该活动非取消订单累计秒杀件数 + qty <= limitPerUser
     * 5. 原子占用库存（防超卖）：DB UPDATE soldCount+=qty WHERE soldCount+qty<=totalStock；失败即售罄
     * 6. 写订单 customFields（flashSaleActivityId + startAt/endAt 快照）并重算价格 → 秒杀价立即生效
     * 7. soldCount >= totalStock → 活动即时置 ended
     */
    async applyFlashSale(ctx: RequestContext, activityId: ID): Promise<Order> {
        const userId = ctx.activeUserId;
        if (!userId) {
            throw new UserInputError('Not authenticated');
        }
        const order = await this.orderService.getActiveOrderForUser(ctx, userId);
        if (!order) {
            throw new UserInputError('No active order found');
        }
        if ((order as any)?.customer?.user?.id !== userId) {
            throw new UserInputError('You can only apply flash sale to your own order');
        }

        const activity = await this.findOne(ctx, activityId);
        if (!activity) {
            throw new UserInputError(`FlashSaleActivity with id ${activityId} not found`);
        }

        const now = new Date();
        if (activity.status !== 'active') {
            throw new UserInputError('Activity is not active');
        }
        if (activity.startAt && now < activity.startAt) {
            throw new UserInputError('Activity has not started');
        }
        if (activity.endAt && now > activity.endAt) {
            throw new UserInputError('Activity has ended');
        }

        // 订单须包含秒杀变体行
        const lines = (order as any)?.lines ?? [];
        const flashLines = lines.filter(
            (l: any) => l?.productVariant && String(l.productVariant.id) === String(activity.variantId),
        );
        if (!flashLines.length) {
            throw new UserInputError('Order does not contain the flash sale variant');
        }
        const qty = flashLines.reduce((sum: number, l: any) => sum + l.quantity, 0);

        // 限购校验（含本次 qty）
        await this.assertPurchaseLimit(ctx, order, activity, qty);

        // 写订单自定义字段 → 触发秒杀价 Promotion 生效。
        // 先写字段+重算价格、后原子占库存：重算时 soldCount 尚未占用，
        // 即使本次抢购是「最后一单」（占满 totalStock）也能享到秒杀价；
        // 占库存失败抛错时整体回滚（resolver @Transaction 原子提交）。
        const updatedOrder = await this.orderService.updateCustomFields(ctx, order.id, {
            flashSaleActivityId: Number(activityId),
            flashSaleStartAt: activity.startAt,
            flashSaleEndAt: activity.endAt,
        });
        await this.orderService.applyPriceAdjustments(ctx, updatedOrder);

        // 原子占用库存（防超卖）
        await this.reserveStock(ctx, activityId, qty, activity);

        // 售罄即时置 ended
        const fresh = await this.findOne(ctx, activityId);
        if (fresh && fresh.soldCount >= fresh.totalStock) {
            fresh.status = 'ended';
            await this.connection.getRepository(ctx, FlashSaleActivity).save(fresh);
            Logger.info(`FlashSaleActivity ${activityId} ended due to stock depletion`, loggerCtx);
        }

        return this.orderService.findOne(ctx, order.id, ['lines', 'lines.productVariant']) as Promise<Order>;
    }

    /* ------------------------- 查询 ------------------------- */

    async findActive(ctx: RequestContext): Promise<FlashSaleActivity[]> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        const now = new Date();
        return repo
            .createQueryBuilder('fsa')
            .innerJoin('fsa.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('fsa.status = :status', { status: 'active' })
            .andWhere('fsa.startAt <= :now', { now })
            .andWhere('fsa.endAt >= :now', { now })
            .getMany();
    }

    async findActiveByVariant(ctx: RequestContext, variantId: ID): Promise<FlashSaleActivity | undefined> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        const now = new Date();
        const result = await repo
            .createQueryBuilder('fsa')
            .innerJoin('fsa.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('fsa.variantId = :variantId', { variantId: variantId as any })
            .andWhere('fsa.status = :status', { status: 'active' })
            .andWhere('fsa.startAt <= :now', { now })
            .andWhere('fsa.endAt >= :now', { now })
            .getOne();
        return result ?? undefined;
    }

    /* ------------------------- 库存占用 / 回滚 ------------------------- */

    /**
     * 订单取消时回滚占用库存：Redis 路径走 StockReserveService，DB 路径走原子 UPDATE。
     * quantity 为订单内秒杀变体行总件数（修正原先固定 1 件）。
     */
    async releaseStock(ctx: RequestContext, activityId: ID, quantity: number): Promise<void> {
        if (this.stockReserveService?.isAvailable) {
            await this.stockReserveService.releaseStock(`flash-sale:${activityId}`, quantity);
            await this.restoreActiveIfPossible(ctx, activityId);
        } else {
            await this.releaseStockAtomic(ctx, activityId, quantity);
        }
    }

    /**
     * 订单取消时按订单内秒杀行实际件数回滚预占库存。
     * 由 plugin 的 OrderStateTransitionEvent 处理器调用（替代原先固定 1 件）。
     */
    async releaseStockForOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const order = await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
        ]);
        if (!order) return;
        const activityId = (order as any)?.customFields?.flashSaleActivityId;
        if (!activityId) return;
        const activity = await this.findOne(ctx, activityId);
        if (!activity) return;
        const lines = (order as any)?.lines ?? [];
        const qty = lines
            .filter(
                (l: any) => l?.productVariant && String(l.productVariant.id) === String(activity.variantId),
            )
            .reduce((sum: number, l: any) => sum + l.quantity, 0);
        if (qty <= 0) return;
        await this.releaseStock(ctx, activityId, qty);
    }

    /* ------------------------- 私有工具 ------------------------- */

    /**
     * 限购校验：同客户该活动非取消订单累计秒杀件数 + 本次 qty <= limitPerUser。
     */
    private async assertPurchaseLimit(
        ctx: RequestContext,
        order: Order,
        activity: FlashSaleActivity,
        qty: number,
    ): Promise<void> {
        const customerId = (order as any)?.customer?.id;
        if (customerId == null) return;
        const { items } = await this.orderService.findByCustomerId(
            ctx,
            customerId,
            { take: 100 },
            ['lines', 'lines.productVariant'],
        );
        let existingQty = 0;
        for (const o of items) {
            if (o.state === 'Cancelled') continue;
            if ((o as any).customFields?.flashSaleActivityId !== Number(activity.id)) continue;
            const oLines = (o as any)?.lines ?? [];
            existingQty += oLines
                .filter((l: any) => String(l.productVariant?.id) === String(activity.variantId))
                .reduce((sum: number, l: any) => sum + l.quantity, 0);
        }
        if (existingQty + qty > activity.limitPerUser) {
            throw new UserInputError('Purchase limit exceeded');
        }
    }

    /**
     * 原子占用库存：DB 路径 UPDATE ... SET soldCount += qty
     * WHERE id = ? AND soldCount + qty <= totalStock；受影响=0 即售罄。
     */
    private async reserveStock(
        ctx: RequestContext,
        activityId: ID,
        qty: number,
        activity: FlashSaleActivity,
    ): Promise<void> {
        if (this.stockReserveService?.isAvailable) {
            const remaining = await this.stockReserveService.reserveStock(`flash-sale:${activityId}`, qty);
            if (remaining < 0) {
                throw new UserInputError('Sold out');
            }
            return;
        }
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        const result = await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount + ${qty}` })
            .where('id = :id AND soldCount + :qty <= totalStock', {
                id: activityId as any,
                qty,
            })
            .execute();
        if ((result.affected ?? 0) === 0) {
            throw new UserInputError('Sold out');
        }
        Logger.info(
            `FlashSaleActivity ${activityId}: reserved ${qty} (sold ${activity.soldCount + qty}/${activity.totalStock})`,
            loggerCtx,
        );
    }

    /**
     * DB fallback 原子回滚：订单取消时回滚预占库存。
     * 使用 WHERE soldCount - quantity >= 0 防止负数。
     * 回滚后若活动曾因售罄置 ended、仍在时间窗口内且未占满，恢复为 active。
     */
    private async releaseStockAtomic(
        ctx: RequestContext,
        activityId: ID,
        quantity: number,
    ): Promise<void> {
        const repo = this.connection.getRepository(ctx, FlashSaleActivity);
        await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount - ${quantity}` })
            .where('id = :id AND soldCount - :qty >= 0', { id: activityId as any, qty: quantity })
            .execute();
        await this.restoreActiveIfPossible(ctx, activityId);
    }

    /**
     * Redis 路径回滚后同样恢复状态（与 DB 路径语义一致）。
     */
    private async restoreActiveIfPossible(ctx: RequestContext, activityId: ID): Promise<void> {
        const activity = await this.findOne(ctx, activityId);
        if (!activity) return;
        if (activity.status !== 'ended') return;
        const now = new Date();
        const inWindow =
            (!activity.startAt || now >= activity.startAt) && (!activity.endAt || now <= activity.endAt);
        if (inWindow && activity.soldCount < activity.totalStock) {
            activity.status = 'active';
            await this.connection.getRepository(ctx, FlashSaleActivity).save(activity);
            Logger.info(
                `FlashSaleActivity ${activityId} restored to active after stock release (sold ${activity.soldCount}/${activity.totalStock})`,
                loggerCtx,
            );
        }
    }
}