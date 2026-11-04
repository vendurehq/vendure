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
    PaymentService,
    ProductVariantService,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { LEGAL_DEPOSIT_CAP_RATIO, loggerCtx } from './constants';
import { createScheduleForOrder, payTailViaSchedule, payViaSchedule } from './payment-schedule-bridge';
import { PreSaleActivity } from './pre-sale-activity.entity';
import { setPreSaleConnection, setPreSaleInjector, getPreSaleInjector } from './pre-sale-runtime';

/**
 * update() 允许写入的字段白名单。
 * 显式过滤 soldCount/status 等敏感字段，避免被外部 input 篡改。
 */
const UPDATE_ALLOWED_FIELDS: ReadonlyArray<keyof PreSaleActivity> = [
    'name',
    'mode',
    'startAt',
    'endAt',
    'releaseAt',
    'tailStartAt',
    'tailEndAt',
    'presalePrice',
    'depositAmount',
    'totalStock',
    'limitPerUser',
    'productId',
    'variantId',
    'depositKind',
    'tailTriggerType',
    'groupBuyActivityId',
    'tailWindowHours',
    'graceHours',
    'earnestRefundPolicy',
    'shipDeadlineAt',
    'agreementVersion',
];

@Injectable()
export class PreSaleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private orderService: OrderService,
        private paymentService: PaymentService,
        private productVariantService: ProductVariantService,
    ) {}

    init(injector: Injector): void {
        // 供 Promotion 条件/动作在结算期动态取活动配置；供软依赖桥取跨插件服务
        setPreSaleConnection(this.connection);
        setPreSaleInjector(injector);
    }

    /* ------------------------- 活动管理 ------------------------- */

    async findAll(
        ctx: RequestContext,
        options?: ListQueryOptions<PreSaleActivity>,
    ): Promise<PaginatedList<PreSaleActivity>> {
        return this.listQueryBuilder
            .build(PreSaleActivity, options, {
                ctx,
                channelId: ctx.channelId,
                relations: ['channels'],
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    async findOne(ctx: RequestContext, id: ID): Promise<PreSaleActivity | undefined> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        const result = await repo.findOne({
            where: { id: id as any },
            relations: { channels: true },
        });
        return result ?? undefined;
    }

    async create(ctx: RequestContext, input: Partial<PreSaleActivity>): Promise<PreSaleActivity> {
        await this.assertLegalDepositCap(ctx, input);
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        // B2：创建强制落到调用者当前渠道，忽略前端传入的 channels/channelId
        const safeInput = { ...(input as any) };
        delete safeInput.channels;
        delete safeInput.channelId;
        const activity = new PreSaleActivity(safeInput);
        activity.channels = [ctx.channel];
        activity.channelId = ctx.channelId as number;
        const now = new Date();
        if (activity.startAt && now >= activity.startAt) {
            activity.status = 'active';
        } else {
            activity.status = 'upcoming';
        }
        return repo.save(activity);
    }

    async update(ctx: RequestContext, input: any): Promise<PreSaleActivity> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        const activity = await repo.findOne({ where: { id: input.id } });
        if (!activity) {
            throw new UserInputError(`PreSaleActivity with id ${input.id} not found`);
        }
        // 定金 20% 硬校验：以「既有值 + 本次 input」合并后的生效配置为准（input 未带 mode/depositAmount 等字段时兜底活动既有值）
        await this.assertLegalDepositCap(ctx, { ...activity, ...input });
        // 字段白名单：禁止外部 input 篡改 soldCount/status 等内部字段
        for (const key of UPDATE_ALLOWED_FIELDS) {
            if (key in input) {
                (activity as any)[key] = input[key];
            }
        }
        return repo.save(activity);
    }

    async delete(ctx: RequestContext, id: ID): Promise<void> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        await repo.delete(id);
    }

    /* ------------------------- 到货 Release ------------------------- */

    /**
     * 到货：active → delivered。
     * 到货即开启尾款窗口（deposit 模式把 tailStartAt 落到 releaseAt）。
     */
    async deliverPreSale(ctx: RequestContext, id: ID): Promise<PreSaleActivity> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        const activity = await repo.findOne({ where: { id: id as any } });
        if (!activity) {
            throw new UserInputError(`PreSaleActivity with id ${id} not found`);
        }
        if (activity.status !== 'active' && activity.status !== 'upcoming') {
            // 已到货/已结束不应被重复置为 delivered
            throw new UserInputError(`PreSaleActivity with id ${id} cannot be delivered from ${activity.status}`);
        }
        activity.status = 'delivered';
        activity.releaseAt = activity.releaseAt ?? new Date();
        if (activity.mode === 'deposit' && !activity.tailStartAt) {
            activity.tailStartAt = activity.releaseAt;
        }
        return repo.save(activity);
    }

    /* ------------------------- 抢购（applyPreSale 一体） ------------------------- */

    /**
     * 抢购一体：
     * 1. 取当前登录用户的 activeOrder（校验归属：order.customer.user.id === ctx.activeUserId）
     * 2. 校验活动：存在、status=active、窗口内、未售罄
     * 3. 校验订单含预售变体行；qty = 预售变体行总件数
     * 4. 限购校验：同客户该活动非取消订单累计预售件数 + qty <= limitPerUser
     * 5. 原子锁定库存（防超卖）：DB UPDATE soldCount+=qty WHERE soldCount+qty<=totalStock；失败即售罄
     * 6. 写订单 customFields（preSaleActivityId + mode + depositTotal + releaseAt 快照）+ 若 presalePrice>0 重算价格打折
     * 7. soldCount >= totalStock → 活动即时置 ended
     */
    async applyPreSale(ctx: RequestContext, activityId: ID): Promise<Order> {
        const userId = ctx.activeUserId;
        if (!userId) {
            throw new UserInputError('Not authenticated');
        }
        const order = await this.orderService.getActiveOrderForUser(ctx, userId);
        if (!order) {
            throw new UserInputError('No active order found');
        }
        if ((order as any)?.customer?.user?.id !== userId) {
            throw new UserInputError('You can only apply pre-sale to your own order');
        }

        const activity = await this.findOne(ctx, activityId);
        if (!activity) {
            throw new UserInputError(`PreSaleActivity with id ${activityId} not found`);
        }

        const now = new Date();
        // 售罄优先于通用状态检查（售罄时applyPreSale已把活动置 ended，需给出明确"已售罄"而非"活动未激活"）
        if (activity.soldCount >= activity.totalStock) {
            throw new UserInputError('已售罄');
        }
        if (activity.status !== 'active') {
            throw new UserInputError('Activity is not active');
        }
        if (activity.startAt && now < activity.startAt) {
            throw new UserInputError('Activity has not started');
        }
        if (activity.endAt && now > activity.endAt) {
            throw new UserInputError('Activity has ended');
        }

        // 订单须包含预售变体行
        const lines = (order as any)?.lines ?? [];
        const preSaleLines = lines.filter(
            (l: any) => l?.productVariant && String(l.productVariant.id) === String(activity.variantId),
        );
        if (!preSaleLines.length) {
            throw new UserInputError('Order does not contain the pre-sale variant');
        }
        const qty = preSaleLines.reduce((sum: number, l: any) => sum + l.quantity, 0);

        // 限购校验（含本次 qty）
        await this.assertPurchaseLimit(ctx, order, activity, qty);

        const depositTotal = activity.mode === 'deposit' ? activity.depositAmount : 0;

        // 写订单自定义字段 + 重算价格（presalePrice>0 才打折；否则保持原价）
        const updatedOrder = await this.orderService.updateCustomFields(ctx, order.id, {
            preSaleActivityId: Number(activityId),
            preSaleMode: activity.mode,
            preSaleDepositTotal: depositTotal,
            preSaleReleaseAt: activity.releaseAt ?? activity.endAt,
        });
        if (activity.presalePrice > 0) {
            await this.orderService.applyPriceAdjustments(ctx, updatedOrder);
        }

        // 原子锁定库存（防超卖）
        await this.reserveStock(ctx, activityId, qty, activity);

        // 售罄即时置 ended
        const fresh = await this.findOne(ctx, activityId);
        if (fresh && fresh.soldCount >= fresh.totalStock) {
            fresh.status = 'ended';
            await this.connection.getRepository(ctx, PreSaleActivity).save(fresh);
            Logger.info(`PreSaleActivity ${activityId} ended due to stock depletion`, loggerCtx);
        }

        // 生成期次实例（软依赖 payment-schedule-plugin；未启用时跳过，薄壳回退旧路径）。
        // 重新取价格重算后的订单（Promotion 预售价此时已生效）。
        const pricedOrder = await this.orderService.findOne(ctx, order.id);
        if (pricedOrder) {
            await createScheduleForOrder(ctx, getPreSaleInjector(), pricedOrder, activity);
        }

        return this.orderService.findOne(ctx, order.id, ['lines', 'lines.productVariant']) as Promise<Order>;
    }

    /* ------------------------- 两阶段支付 ------------------------- */

    /**
     * 全款预售：一次收清。
     * 新路径：期次实例存在 → paySchedulePeriod(seq=1)；否则旧路径直接收全额。
     */
    async payPreSaleFull(ctx: RequestContext, orderId: ID, method: string): Promise<Order> {
        const order = await this.requirePreSaleOrder(ctx, orderId);
        const activity = await this.requireActiveActivity(ctx, order);
        if (activity.mode !== 'full') {
            throw new UserInputError('This activity requires deposit pre-sale payment flow');
        }
        if (await payViaSchedule(ctx, getPreSaleInjector(), order, 1, method)) {
            return this.reload(ctx, orderId);
        }
        await this.createSettledPayment(ctx, order, order.totalWithTax, method);
        return this.reload(ctx, orderId);
    }

    /**
     * 定金预售：付定金。
     * 新路径：期次实例存在 → paySchedulePeriod(seq=1)（内部负责 ArrangingPayment→Deposited）；
     * 旧路径：createSettledPayment + 手动转 Deposited。
     */
    async payPreSaleDeposit(ctx: RequestContext, orderId: ID, method: string): Promise<Order> {
        const order = await this.requirePreSaleOrder(ctx, orderId);
        if (order.state !== 'ArrangingPayment') {
            throw new UserInputError('Order must be in ArrangingPayment state to pay deposit');
        }
        const activity = await this.requireActiveActivity(ctx, order);
        if (activity.mode !== 'deposit') {
            throw new UserInputError('This activity requires full pre-sale payment flow');
        }
        if (await payViaSchedule(ctx, getPreSaleInjector(), order, 1, method)) {
            return this.reload(ctx, orderId);
        }
        const depositTotal = (order as any).customFields?.preSaleDepositTotal ?? activity.depositAmount;
        if (!(depositTotal > 0)) {
            throw new UserInputError('Deposit amount must be greater than zero');
        }
        await this.createSettledPayment(ctx, order, depositTotal, method);
        await this.transition(ctx, orderId, 'Deposited');
        return this.reload(ctx, orderId);
    }

    /**
     * 定金预售：付尾款。
     * 校验状态 Deposited + 活动已到货 + 尾款窗口内（旧语义保留）。
     * 新路径：unlockTailForOrder + paySchedulePeriod（尾款期）；旧路径按剩余金额收款。
     */
    async payPreSaleTail(ctx: RequestContext, orderId: ID, method: string): Promise<Order> {
        const order = await this.requirePreSaleOrder(ctx, orderId);
        if (order.state !== 'Deposited') {
            throw new UserInputError('Order must be in Deposited state to pay tail');
        }
        const activityId = (order.customFields as any)?.preSaleActivityId;
        const activity = await this.findOne(ctx, activityId);
        if (!activity || activity.mode !== 'deposit') {
            throw new UserInputError('Pre-sale deposit activity not found');
        }
        if (activity.status !== 'delivered') {
            throw new UserInputError('Activity has not been delivered yet, tail payment not opened');
        }
        const now = new Date();
        if (activity.tailStartAt && now < activity.tailStartAt) {
            throw new UserInputError('Tail payment window has not started');
        }
        if (activity.tailEndAt && now > activity.tailEndAt) {
            throw new UserInputError('Tail payment window has ended');
        }
        if (await payTailViaSchedule(ctx, getPreSaleInjector(), order, method)) {
            return this.reload(ctx, orderId);
        }
        const covered = await this.settledCovered(ctx, order.id);
        const tailAmount = order.totalWithTax - covered;
        if (tailAmount <= 0) {
            throw new UserInputError('Order already fully paid');
        }
        await this.createSettledPayment(ctx, order, tailAmount, method);
        return this.reload(ctx, orderId);
    }

    /* ------------------------- 查询 ------------------------- */

    async findActive(ctx: RequestContext): Promise<PreSaleActivity[]> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        const now = new Date();
        return repo
            .createQueryBuilder('psa')
            .innerJoin('psa.channels', 'channel', 'channel.id = :channelId', { channelId: ctx.channelId })
            .where('psa.status IN (:...statuses)', { statuses: ['active', 'delivered'] })
            .andWhere('psa.startAt <= :now', { now })
            .andWhere('psa.endAt >= :now', { now })
            .getMany();
    }

    /* ------------------------- 库存锁定 / 回滚 ------------------------- */

    /**
     * 订单取消时按订单内预售行实际件数回滚锁定库存。
     */
    async releaseStockForOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const order = await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
        ]);
        if (!order) return;
        const activityId = (order as any)?.customFields?.preSaleActivityId;
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
        await this.releaseStockAtomic(ctx, activityId, qty);
    }

    /* ------------------------- 私有工具 ------------------------- */

    /**
     * 定金 20% 法定上限硬校验（设计 §10 合规硬点 1：超出拒绝保存）。
     * 基准价：presalePrice > 0 ? presalePrice : variant.priceWithTax（原价）。
     * 注：ProductVariant.priceWithTax 是运行时计算值（依赖 listPrice/taxRateApplied），
     * 裸 repository.findOne 不会填充（恒为 0），故经 ProductVariantService.findOne
     * 取已应用渠道价格/税的变体；变体不存在时返回 undefined（与计划的容错语义一致）。
     */
    private async assertLegalDepositCap(ctx: RequestContext, input: Partial<PreSaleActivity>): Promise<void> {
        const mode = input.mode;
        const depositAmount = Number(input.depositAmount ?? 0);
        if (mode !== 'deposit' || !(depositAmount > 0)) return;
        let base = Number(input.presalePrice ?? 0);
        if (!(base > 0) && input.variantId != null) {
            const variant = await this.productVariantService.findOne(ctx, input.variantId as any);
            if (variant) base = variant.priceWithTax;
        }
        if (!(base > 0)) {
            throw new UserInputError('Cannot validate deposit cap: base price unknown (set presalePrice or ensure variant exists)');
        }
        const cap = Math.floor(base * LEGAL_DEPOSIT_CAP_RATIO);
        if (depositAmount > cap) {
            throw new UserInputError(`Deposit ${depositAmount} exceeds legal cap ${cap} (20% of base price ${base})`);
        }
    }

    /**
     * 校验订单已绑定预售活动，并返回重载后的订单（含 lines.productVariant）。
     */
    private async requirePreSaleOrder(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.orderService.findOne(ctx, orderId, [
            'customer',
            'lines',
            'lines.productVariant',
        ]);
        if (!order) {
            throw new UserInputError(`Order ${orderId} not found`);
        }
        if (!(order as any).customFields?.preSaleActivityId) {
            throw new UserInputError('Order is not bound to a pre-sale activity');
        }
        return order as Order;
    }

    /**
     * 校验订单关联活动存在且处于可支付窗口（active/delivered + 窗口内）。
     */
    private async requireActiveActivity(ctx: RequestContext, order: Order): Promise<PreSaleActivity> {
        const activity = await this.findOne(ctx, (order as any).customFields?.preSaleActivityId);
        if (!activity) {
            throw new UserInputError('Pre-sale activity not found');
        }
        if (activity.status !== 'active' && activity.status !== 'delivered') {
            throw new UserInputError('Pre-sale activity is not payable now');
        }
        const now = new Date();
        if (activity.startAt && now < activity.startAt) {
            throw new UserInputError('Activity has not started');
        }
        if (activity.endAt && now > activity.endAt) {
            throw new UserInputError('Activity has ended');
        }
        return activity;
    }

    /**
     * 创建一笔已 Settled 的指定金额 Payment 并挂到订单。
     * 指定金额由调用方给出（定金=depositTotal，尾款=剩余，全款=totalWithTax），
     * 不走原生 addPaymentToOrder（那是一次收全额剩余，无法表达定金中间态）。
     */
    private async createSettledPayment(
        ctx: RequestContext,
        order: Order,
        amount: number,
        method: string,
    ): Promise<void> {
        const payment = await this.paymentService.createPayment(ctx, order, amount, method, {});
        if (payment instanceof Error || (payment as any).errorCode) {
            throw new UserInputError(
                `Payment failed: ${(payment as any).message ?? (payment as any).errorCode ?? 'unknown'}`,
            );
        }
        const settledPayment = payment as unknown as { state: string };
        if (settledPayment.state !== 'Settled') {
            throw new UserInputError(`Payment not settled (state: ${settledPayment.state})`);
        }
    }

    /**
     * 订单状态转移（幂等失败抛出）。
     */
    private async transition(ctx: RequestContext, orderId: ID, state: string): Promise<void> {
        const result = await this.orderService.transitionToState(ctx, orderId, state as any);
        const err = result as any;
        if (err instanceof Error || err.errorCode) {
            const reason = err.transitionError ?? err.message ?? err.errorCode ?? 'unknown';
            throw new UserInputError(`Transition to ${state} failed: ${reason}`);
        }
    }

    private async reload(ctx: RequestContext, orderId: ID): Promise<Order> {
        return (await this.orderService.findOne(ctx, orderId, [
            'lines',
            'lines.productVariant',
        ])) as Order;
    }

    /** 已 Settled 支付累计金额 */
    private async settledCovered(ctx: RequestContext, orderId: ID): Promise<number> {
        const payments = await this.orderService.getOrderPayments(ctx, orderId);
        return payments.reduce((sum, p) => (p.state === 'Settled' ? sum + p.amount : sum), 0);
    }

    /**
     * 限购校验：同客户该活动非取消订单累计预售件数 + 本次 qty <= limitPerUser。
     */
    private async assertPurchaseLimit(
        ctx: RequestContext,
        order: Order,
        activity: PreSaleActivity,
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
            if ((o as any).customFields?.preSaleActivityId !== Number(activity.id)) continue;
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
     * 原子锁定库存：DB UPDATE soldCount += qty
     * WHERE id = ? AND soldCount + qty <= totalStock；受影响=0 即售罄。
     */
    private async reserveStock(
        ctx: RequestContext,
        activityId: ID,
        qty: number,
        activity: PreSaleActivity,
    ): Promise<void> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
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
            `PreSaleActivity ${activityId}: locked ${qty} (sold ${activity.soldCount + qty}/${activity.totalStock})`,
            loggerCtx,
        );
    }

    /**
     * 订单取消时原子回滚锁定库存。WHERE soldCount - qty >= 0 防负数。
     * 回滚后若活动曾因售罄置 ended、仍在窗口内且未占满，恢复为 active。
     */
    private async releaseStockAtomic(ctx: RequestContext, activityId: ID, quantity: number): Promise<void> {
        const repo = this.connection.getRepository(ctx, PreSaleActivity);
        await repo
            .createQueryBuilder()
            .update()
            .set({ soldCount: () => `soldCount - ${quantity}` })
            .where('id = :id AND soldCount - :qty >= 0', { id: activityId as any, qty: quantity })
            .execute();
        await this.restoreActiveIfPossible(ctx, activityId);
    }

    private async restoreActiveIfPossible(ctx: RequestContext, activityId: ID): Promise<void> {
        const activity = await this.findOne(ctx, activityId);
        if (!activity) return;
        if (activity.status !== 'ended') return;
        const now = new Date();
        const inWindow =
            (!activity.startAt || now >= activity.startAt) && (!activity.endAt || now <= activity.endAt);
        if (inWindow && activity.soldCount < activity.totalStock) {
            activity.status = 'active';
            await this.connection.getRepository(ctx, PreSaleActivity).save(activity);
            Logger.info(
                `PreSaleActivity ${activityId} restored to active after stock release (sold ${activity.soldCount}/${activity.totalStock})`,
                loggerCtx,
            );
        }
    }
}