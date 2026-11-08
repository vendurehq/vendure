import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import {
    ID,
    idsAreEqual,
    Injector,
    ListQueryBuilder,
    ListQueryOptions,
    Logger,
    Order,
    OrderService,
    PaginatedList,
    Payment,
    PaymentMethod,
    PaymentService,
    Refund,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';

import { sendScheduleNotice } from './notification';
import { tryGetProvider } from './payment-schedule-runtime';
import { loggerCtx } from './constants';
import { OrderPaymentSchedule } from './order-payment-schedule.entity';
import { OrderScheduleItem } from './order-schedule-item.entity';
import {
    COD_ALLOWED_KINDS,
    computeDueAt,
    DepositRule,
    earnestRefundAmount,
    ItemKind,
    lateFeeAccrued,
    parseDepositRule,
    parseTrigger,
    ScheduleStatus,
    ScheduleTrigger,
} from './schedule-config';

export interface CreateScheduleItemInput {
    seq: number;
    kind: ItemKind;
    amount: number;
    allowCod?: boolean;
    trigger: ScheduleTrigger;
    graceHours?: number;
    lateFeeRule?: { dailyRate: number } | null;
}

export interface CreateScheduleInput {
    orderId: ID;
    scenario: 'presale' | 'installment' | 'rental';
    deliveryGate: 'all_paid' | 'first_period' | 'deposit_paid';
    depositRule?: DepositRule | null;
    agreementVersion: string;
    shipDeadline?: Date | null;
    /** 场景扩展快照（租赁买断等），原样落库到实体 meta 列 */
    meta?: Record<string, unknown> | null;
    items: CreateScheduleItemInput[];
}

export interface ScheduleWithItems {
    schedule: OrderPaymentSchedule;
    items: OrderScheduleItem[];
}

// PaymentSettled：租赁买断场景——期次付清→completed→追加买断项拉回 in_progress 后仍需可付（Task 18）
const PAYABLE_SOURCE_STATES = ['ArrangingPayment', 'Deposited', 'PartiallyPaid', 'PaymentSettled'];
const OPEN_SCHEDULE_STATUSES: ReadonlyArray<ScheduleStatus> = ['pending', 'in_progress'];
const TERMINAL_ITEM_STATUSES = ['paid', 'refunded', 'waived', 'forfeited'];

/** 无原路退款能力的处理器：货到付款的现金已由骑手/门店收走，网关退不了，只能人工现金退还 */
const NO_REFUND_HANDLER_CODES = ['cash-on-delivery'];
/** 退款单结算失败终态（不计入已退总额，保留审计痕迹） */
const REFUND_FAILED_STATE = 'Failed';

@Injectable()
export class PaymentScheduleService {
    constructor(
        private connection: TransactionalConnection,
        private listQueryBuilder: ListQueryBuilder,
        private orderService: OrderService,
        private paymentService: PaymentService,
    ) {}

    init(_injector: Injector): void {
        // 运行时连接/注入器由 plugin.onApplicationBootstrap 写入 payment-schedule-runtime
    }

    /* ------------------------- 仓储工具 ------------------------- */

    private scheduleRepo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, OrderPaymentSchedule);
    }

    private itemRepo(ctx: RequestContext) {
        return this.connection.getRepository(ctx, OrderScheduleItem);
    }

    private async findItems(ctx: RequestContext, scheduleId: number): Promise<OrderScheduleItem[]> {
        return this.itemRepo(ctx).find({ where: { scheduleId }, order: { seq: 'ASC' } });
    }

    private async orderWithPayments(ctx: RequestContext, orderId: ID): Promise<Order> {
        const order = await this.connection.getRepository(ctx, Order).findOne({
            where: { id: orderId as any },
            relations: ['payments', 'payments.refunds'],
        });
        if (!order) {
            throw new UserInputError(`Order ${orderId} not found`);
        }
        return order;
    }

    private assertOrderOwner(ctx: RequestContext, order: Order): void {
        if ((order as any)?.customer?.user?.id !== ctx.activeUserId) {
            throw new UserInputError('You can only access your own order schedule');
        }
    }

    /* ------------------------- 创建（场景插件调用） ------------------------- */

    async createSchedule(ctx: RequestContext, input: CreateScheduleInput): Promise<OrderPaymentSchedule> {
        const order = await this.orderService.findOne(ctx, input.orderId);
        if (!order) {
            throw new UserInputError(`Order ${input.orderId} not found`);
        }
        const existing = (order.customFields as any)?.paymentScheduleId;
        if (existing) {
            throw new UserInputError(`Order already has a payment schedule (${existing})`);
        }
        if (!input.items.length) {
            throw new UserInputError('Schedule requires at least one item');
        }
        const sorted = [...input.items].sort((a, b) => a.seq - b.seq);
        sorted.forEach((item, i) => {
            if (!(item.amount >= 0)) {
                throw new UserInputError('Item amount must be >= 0');
            }
            if (item.allowCod && !COD_ALLOWED_KINDS.includes(item.kind)) {
                throw new UserInputError(`COD is not allowed for kind ${item.kind} (only balance/installment/rent)`);
            }
            if (i > 0 && item.seq <= sorted[i - 1].seq) {
                throw new UserInputError('Item seq must be strictly increasing');
            }
        });

        const now = new Date();
        const schedule = new OrderPaymentSchedule({
            orderId: Number(input.orderId),
            channelId: ctx.channelId as number,
            scenario: input.scenario,
            deliveryGate: input.deliveryGate,
            depositRule: input.depositRule ?? null,
            agreementVersion: input.agreementVersion,
            shipDeadline: input.shipDeadline ?? undefined,
            meta: (input.meta ?? null) as any,
            status: 'pending',
        });
        schedule.channels = [ctx.channel];
        const savedSchedule = await this.scheduleRepo(ctx).save(schedule);

        const itemEntities = sorted.map((item, idx) => {
            const trigger = item.trigger;
            return new OrderScheduleItem({
                scheduleId: savedSchedule.id as number,
                seq: item.seq,
                kind: item.kind,
                amount: item.amount,
                allowCod: item.allowCod ?? false,
                trigger,
                dueAt: computeDueAt(trigger, now) ?? undefined,
                graceHours: item.graceHours ?? 0,
                lateFeeRule: item.lateFeeRule ?? null,
                // 首期立即可付（首笔款），其余锁定等触发
                status: idx === 0 ? 'payable' : 'locked',
                paidAt: undefined,
                paymentId: null,
                groupBuyActivityId: trigger.type === 'group_buy' ? trigger.groupBuyActivityId : null,
            });
        });
        await this.itemRepo(ctx).save(itemEntities);

        await this.orderService.updateCustomFields(ctx, order.id, { paymentScheduleId: savedSchedule.id });
        Logger.info(
            `PaymentSchedule ${savedSchedule.id} created for order ${order.code} (${input.scenario}, ${itemEntities.length} items)`,
            loggerCtx,
        );
        return savedSchedule;
    }

    /** 追加期次（租赁买断场景；调度须为 rental 且尚无买断项） */
    async addScheduleItem(
        ctx: RequestContext,
        scheduleId: number,
        input: { kind: ItemKind; amount: number; trigger?: ScheduleTrigger },
    ): Promise<ScheduleWithItems> {
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) {
            throw new UserInputError(`PaymentSchedule ${scheduleId} not found`);
        }
        if (schedule.scenario !== 'rental') {
            throw new UserInputError('Only rental schedules can accept appended items');
        }
        const items = await this.findItems(ctx, scheduleId);
        if (input.kind === 'buyout' && items.some(i => i.kind === 'buyout')) {
            throw new UserInputError('Buyout item already exists');
        }
        if (items.some(i => TERMINAL_ITEM_STATUSES.includes(i.status))) {
            // 已有完结期次（租金付清→completed）时允许追加买断并把调度拉回进行中
        }
        const item = new OrderScheduleItem({
            scheduleId,
            seq: Math.max(0, ...items.map(i => i.seq)) + 1,
            kind: input.kind,
            amount: input.amount,
            allowCod: false,
            trigger: input.trigger ?? { type: 'manual' },
            dueAt: new Date(),
            graceHours: 0,
            lateFeeRule: null,
            status: 'payable',
            paidAt: undefined,
            paymentId: null,
            groupBuyActivityId: null,
        });
        await this.itemRepo(ctx).save(item);
        if (schedule.status === 'completed') {
            schedule.status = 'in_progress';
            await this.scheduleRepo(ctx).save(schedule);
        }
        return this.getScheduleForOrder(ctx, schedule.orderId) as Promise<ScheduleWithItems>;
    }

    /* ------------------------- 查询 ------------------------- */

    async getScheduleForOrder(
        ctx: RequestContext,
        orderId: ID,
        opts?: { requireOwner?: boolean },
    ): Promise<ScheduleWithItems | null> {
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new UserInputError(`Order ${orderId} not found`);
        }
        if (opts?.requireOwner) {
            this.assertOrderOwner(ctx, order);
        }
        const scheduleId = ((order.customFields as any)?.paymentScheduleId as number | undefined) ?? null;
        return this.getScheduleById(ctx, scheduleId, opts);
    }

    async getScheduleById(
        ctx: RequestContext,
        scheduleId: number | null,
        opts?: { requireOwner?: boolean },
    ): Promise<ScheduleWithItems | null> {
        if (!scheduleId) return null;
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) return null;
        const items = await this.findItems(ctx, schedule.id as number);
        if (opts?.requireOwner) {
            const order = await this.orderService.findOne(ctx, schedule.orderId, ['customer', 'customer.user']);
            if (!order) {
                throw new UserInputError(`Order ${schedule.orderId} not found`);
            }
            this.assertOrderOwner(ctx, order);
        }
        return { schedule, items };
    }

    async listSchedules(ctx: RequestContext, options?: ListQueryOptions<OrderPaymentSchedule>): Promise<PaginatedList<OrderPaymentSchedule>> {
        return this.listQueryBuilder
            .build(OrderPaymentSchedule, options, {
                ctx,
                channelId: ctx.channelId,
                relations: ['channels'],
            })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }

    /** GraphQL 呈现（滞纳金/已付统计现算，不落库） */
    presentSchedule(withItems: ScheduleWithItems, now = new Date()) {
        const { schedule, items } = withItems;
        return {
            ...schedule,
            items: items.map(i => ({
                ...i,
                trigger: i.trigger,
                paidAmount: i.status === 'paid' ? i.amount : 0,
                lateFeeAccrued: lateFeeAccrued(i, now),
            })),
            paidTotal: items.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0),
            totalAmount: items.reduce((s, i) => s + i.amount, 0),
        };
    }

    /** Admin 列表批量取期次（供 resolver 组装 present） */
    async findItemsForPresent(ctx: RequestContext, scheduleId: number) {
        return this.findItems(ctx, scheduleId);
    }

    /* ------------------------- 支付 ------------------------- */

    /**
     * 付任意期次（在线/COD 均经此）。
     * Settled → item paid + 推进订单状态；Authorized（COD handler）→ item 留待 confirmCodReceived。
     */
    async paySchedulePeriod(ctx: RequestContext, orderId: ID, seq: number, method: string): Promise<ScheduleWithItems> {
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new UserInputError(`Order ${orderId} not found`);
        }
        this.assertOrderOwner(ctx, order);
        if (!PAYABLE_SOURCE_STATES.includes(order.state)) {
            throw new UserInputError(`Order state ${order.state} does not allow period payment`);
        }
        const scheduleId = (order.customFields as any)?.paymentScheduleId;
        const withItems = await this.getScheduleById(ctx, scheduleId);
        if (!withItems) {
            throw new UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        if (!OPEN_SCHEDULE_STATUSES.includes(schedule.status)) {
            throw new UserInputError(`Schedule status ${schedule.status} does not allow payment`);
        }
        const item = items.find(i => i.seq === Number(seq));
        if (!item) {
            throw new UserInputError(`Schedule period ${seq} not found`);
        }
        if (item.status === 'paid' || item.paidAt) {
            throw new UserInputError(`Period ${seq} is already paid`);
        }
        if (!['payable', 'overdue', 'locked'].includes(item.status)) {
            throw new UserInputError(`Period ${seq} is not payable (status: ${item.status})`);
        }
        if (item.status === 'locked' && !this.unlockByTrigger(item, new Date())) {
            throw new UserInputError(`Period ${seq} is locked (trigger not satisfied)`);
        }
        const payment = await this.paymentService.createPayment(ctx, order, item.amount, method, {
            scheduleId: schedule.id,
            seq: item.seq,
        });
        if (payment instanceof Error || (payment as any).errorCode) {
            throw new UserInputError(
                `Payment failed: ${(payment as any).message ?? (payment as any).errorCode ?? 'unknown'}`,
            );
        }
        const state = (payment as Payment).state;
        if (state !== 'Settled' && state !== 'Authorized') {
            throw new UserInputError(`Unexpected payment state: ${state}`);
        }
        if (state === 'Settled') {
            item.status = 'paid';
            item.paidAt = new Date();
        }
        item.paymentId = (payment as Payment).id as number;
        await this.itemRepo(ctx).save(item);

        await this.afterItemPaymentRecorded(ctx, order, schedule, items, state);
        const after = await this.getScheduleById(ctx, schedule.id as number);
        return after as ScheduleWithItems;
    }

    /** locked 期次在支付时刻补偿触发（补偿扫描任务最长 1 分钟延迟）：date 到点 / interval 到点 */
    private unlockByTrigger(item: OrderScheduleItem, now: Date): boolean {
        const trigger = parseTrigger(item.trigger);
        if (trigger?.type === 'date' && trigger.at && now >= new Date(trigger.at)) {
            item.status = 'payable';
            if (!item.dueAt) item.dueAt = new Date(trigger.at);
            return true;
        }
        if (trigger?.type === 'interval' && item.dueAt && now >= item.dueAt) {
            item.status = 'payable';
            return true;
        }
        return false;
    }

    private async afterItemPaymentRecorded(
        ctx: RequestContext,
        order: Order,
        schedule: OrderPaymentSchedule,
        items: OrderScheduleItem[],
        paymentState: 'Settled' | 'Authorized',
    ): Promise<void> {
        if (OPEN_SCHEDULE_STATUSES.includes(schedule.status) && items.some(i => i.status === 'paid')) {
            schedule.status = 'in_progress';
            await this.scheduleRepo(ctx).save(schedule);
        }
        const allTerminal = items.every(i => TERMINAL_ITEM_STATUSES.includes(i.status));
        if (allTerminal && !['breached', 'cancelled'].includes(schedule.status)) {
            schedule.status = 'completed';
            await this.scheduleRepo(ctx).save(schedule);
        }
        if (paymentState !== 'Settled') {
            return; // COD 授权：不动订单状态，等 confirmCodReceived
        }
        const fresh = await this.orderService.findOne(ctx, order.id);
        if (!fresh) return;
        if (allTerminal) {
            if (fresh.state !== 'PaymentSettled') {
                await this.transition(ctx, order.id, 'PaymentSettled');
            }
            return;
        }
        if (fresh.state === 'ArrangingPayment') {
            // 迁移期双读：预订旧语义订单继续走 Deposited；新场景统一 PartiallyPaid
            const legacy = !!(fresh.customFields as any)?.preSaleActivityId;
            await this.transition(ctx, order.id, legacy ? 'Deposited' : 'PartiallyPaid');
        }
    }

    /** COD 环收尾：签收后管理员确认 → settle 授权支付 → item paid → 可能 PaymentSettled */
    async confirmCodReceived(ctx: RequestContext, orderId: ID): Promise<ScheduleWithItems> {
        const withItems = await this.getScheduleForOrder(ctx, orderId);
        if (!withItems) {
            throw new UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        const pendingCod = items.filter(i => i.status === 'payable' && i.paymentId);
        if (!pendingCod.length) {
            throw new UserInputError('No pending COD payments to confirm');
        }
        for (const item of pendingCod) {
            const result = await this.paymentService.settlePayment(ctx, item.paymentId as number);
            if ((result as any)?.errorCode) {
                throw new UserInputError(`Settle payment failed: ${(result as any).message ?? (result as any).errorCode}`);
            }
            item.status = 'paid';
            item.paidAt = new Date();
            await this.itemRepo(ctx).save(item);
        }
        const order = await this.orderService.findOne(ctx, schedule.orderId);
        if (!order) {
            throw new UserInputError(`Order ${schedule.orderId} not found`);
        }
        const refreshed = await this.findItems(ctx, schedule.id as number);
        await this.afterItemPaymentRecorded(ctx, order, schedule, refreshed, 'Settled');
        return (await this.getScheduleById(ctx, schedule.id as number)) as ScheduleWithItems;
    }

    /**
     * 薄壳桥专用：预售尾款窗口已开（窗口校验由 pre-sale-plugin 负责）→ 强制解锁 locked 尾款期。
     * 属 legacy 兼容通道（旧 API 语义：到货+窗口 ⇒ 尾款可付），优先级高于期次 trigger。
     */
    async unlockTailForOrder(ctx: RequestContext, orderId: ID): Promise<void> {
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order) return;
        const scheduleId = (order.customFields as any)?.paymentScheduleId;
        const withItems = await this.getScheduleById(ctx, scheduleId);
        if (!withItems) return;
        const tail = withItems.items.find(i => i.kind === 'balance' && i.status === 'locked');
        if (!tail) return;
        tail.status = 'payable';
        if (!tail.dueAt) tail.dueAt = new Date();
        await this.itemRepo(ctx).save(tail);
        Logger.info(`Tail item ${tail.id} unlocked for order ${order.code} (legacy tail window open)`, loggerCtx);
    }

    /* ------------------------- 取消 / 违约 ------------------------- */

    /**
     * 买家主动取消：
     * - legal_deposit：须 confirmForfeit=true，定金没收（forfeited），其余已付期次全退
     * - earnest：按 earnestRefundPolicy 退（默认全额）
     * - 其他（首付/押金语义）：已付期次全退
     * 未支付期次 → waived；调度 → cancelled；订单 → Cancelled（库存经各插件 Cancelled 订阅释放）。
     */
    async cancelSchedule(ctx: RequestContext, orderId: ID, confirmForfeit: boolean): Promise<ScheduleWithItems> {
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new UserInputError(`Order ${orderId} not found`);
        }
        this.assertOrderOwner(ctx, order);
        if (!['AddingItems', 'ArrangingPayment', 'Deposited', 'PartiallyPaid'].includes(order.state)) {
            throw new UserInputError(`Order state ${order.state} does not allow cancellation`);
        }
        const withItems = await this.getScheduleForOrder(ctx, orderId);
        if (!withItems) {
            throw new UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        if (!OPEN_SCHEDULE_STATUSES.includes(schedule.status)) {
            throw new UserInputError(`Schedule cannot be cancelled from status ${schedule.status}`);
        }
        const rule = parseDepositRule(schedule.depositRule);
        const isLegalDeposit = rule?.kind === 'legal_deposit';
        if (isLegalDeposit && !confirmForfeit) {
            throw new UserInputError('legal deposit is non-refundable; pass confirmForfeit=true to accept the penalty');
        }
        const payments = await this.orderService.getOrderPayments(ctx, order.id);
        for (const item of items) {
            if (item.status === 'paid') {
                const payment = payments.find(p => idsAreEqual(p.id, item.paymentId) && p.state === 'Settled');
                let refundAmount = 0;
                if (!isLegalDeposit) {
                    refundAmount =
                        item.kind === 'deposit' && rule?.kind === 'earnest'
                            ? earnestRefundAmount(item, rule)
                            : item.amount;
                }
                if (payment && refundAmount > 0) {
                    const ok = await this.refundPaymentOnce(ctx, order, payment, refundAmount, 'payment schedule cancelled');
                    item.status = ok ? 'refunded' : 'paid';
                    if (!ok) {
                        Logger.warn(`Refund failed for item ${item.id}, kept as paid for manual handling`, loggerCtx);
                    }
                } else if (isLegalDeposit && item.kind === 'deposit') {
                    item.status = 'forfeited';
                } else {
                    item.status = 'refunded';
                }
                continue;
            }
            if (['locked', 'payable', 'overdue'].includes(item.status)) {
                item.status = 'waived';
            }
        }
        await this.itemRepo(ctx).save(items);
        schedule.status = 'cancelled';
        await this.scheduleRepo(ctx).save(schedule);
        await this.cancelOrderSafe(ctx, order.id, 'payment schedule cancelled by buyer');
        return (await this.getScheduleById(ctx, schedule.id as number)) as ScheduleWithItems;
    }

    /* ------------------------- 调度扫描（ScheduledTask / Admin runScheduleScan 共用） ------------------------- */

    private async channelScheduleIds(ctx: RequestContext): Promise<number[]> {
        const rows = await this.scheduleRepo(ctx)
            .createQueryBuilder('s')
            .innerJoin('s.channels', 'channel', 'channel.id = :cid', { cid: ctx.channelId })
            .getMany();
        return rows.map(r => r.id as number);
    }

    /** 单条计划是否属于指定渠道（默认取当前请求渠道；事件路径须显式传入活动所属渠道） */
    private async isScheduleInChannel(
        ctx: RequestContext,
        scheduleId: number,
        channelId: ID = ctx.channelId,
    ): Promise<boolean> {
        const count = await this.scheduleRepo(ctx)
            .createQueryBuilder('s')
            .innerJoin('s.channels', 'channel', 'channel.id = :cid', { cid: channelId })
            .where('s.id = :id', { id: scheduleId })
            .getCount();
        return count > 0;
    }

    /** 触发扫描：locked → payable（date 到点 / interval 到点 / group_buy 活动完成或失败） */
    async processTriggers(ctx: RequestContext, now = new Date()): Promise<{ activated: number; failedSchedules: number }> {
        const ids = await this.channelScheduleIds(ctx);
        if (!ids.length) return { activated: 0, failedSchedules: 0 };
        const items = await this.itemRepo(ctx).find({ where: { scheduleId: In(ids), status: 'locked' } });
        let activated = 0;
        let failedSchedules = 0;
        for (const item of items) {
            const trigger = parseTrigger(item.trigger);
            if (!trigger) continue;
            if (trigger.type === 'group_buy') {
                const handled = await this.handleGroupBuyTrigger(ctx, item, trigger.groupBuyActivityId, now);
                if (handled === 'failed') failedSchedules++;
                if (handled === 'activated') activated++;
                continue;
            }
            if (trigger.type === 'date' && trigger.at && now >= new Date(trigger.at)) {
                item.status = 'payable';
                if (!item.dueAt) item.dueAt = new Date(trigger.at);
                await this.itemRepo(ctx).save(item);
                await this.notifyTailOpened(ctx, item);
                activated++;
                continue;
            }
            if (trigger.type === 'interval' && item.dueAt && now >= item.dueAt) {
                item.status = 'payable';
                await this.itemRepo(ctx).save(item);
                await this.notifyTailOpened(ctx, item);
                activated++;
            }
        }
        return { activated, failedSchedules };
    }

    /** group_buy 触发器：软依赖团购活动状态（completed→解锁；expired/过期→按不成团处理） */
    private async handleGroupBuyTrigger(
        ctx: RequestContext,
        item: OrderScheduleItem,
        activityId: number,
        now: Date,
    ): Promise<'activated' | 'failed' | 'none'> {
        const activity = await this.findGroupBuyActivity(activityId);
        if (!activity) return 'none';
        const failed =
            (activity as any).status === 'expired' ||
            ((activity as any).status === 'active' && new Date((activity as any).endAt) < now);
        if (failed) {
            await this.failSchedulesForGroupBuy(ctx, activityId, now);
            return 'failed';
        }
        if ((activity as any).status === 'completed') {
            item.status = 'payable';
            item.dueAt = new Date();
            await this.itemRepo(ctx).save(item);
            await this.notifyTailOpened(ctx, item);
            return 'activated';
        }
        return 'none';
    }

    private async findGroupBuyActivity(activityId: number): Promise<any | null> {
        try {
            const { GroupBuyActivity } = require('@vendure/group-buy-plugin');
            return await this.connection.rawConnection.getRepository(GroupBuyActivity).findOne({
                where: { id: activityId },
                relations: { channels: true },
            });
        } catch {
            return null;
        }
    }

    /** 活动所属渠道 id 列表（事件路径没有可靠的 ctx.channelId，以活动自身关联为准） */
    private async activityChannelIds(activityId: number): Promise<number[]> {
        const activity = await this.findGroupBuyActivity(activityId);
        return (activity?.channels ?? []).map((c: any) => Number(c.id));
    }

    /** 团购不成团：已付期次全额原路退，未付 → waived，调度 breached(group_buy_failed)，订单取消 */
    async failSchedulesForGroupBuy(ctx: RequestContext, activityId: number, now = new Date()): Promise<number> {
        const items = await this.itemRepo(ctx).find({ where: { groupBuyActivityId: Number(activityId) } });
        const scheduleIds = Array.from(new Set(items.map(i => i.scheduleId)));
        let count = 0;
        for (const scheduleId of scheduleIds) {
            const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
            if (!schedule || !OPEN_SCHEDULE_STATUSES.includes(schedule.status)) continue;
            // 渠道约束：本方法可能被当前渠道的扫描触发（handleGroupBuyTrigger），
            // 团购活动失败的连带退款必须限定在 ctx.channelId 内，避免跨渠道误退款。
            if (!(await this.isScheduleInChannel(ctx, scheduleId))) continue;
            const all = await this.findItems(ctx, scheduleId);
            const order = await this.orderWithPayments(ctx, schedule.orderId);
            for (const it of all) {
                if (it.status === 'paid') {
                    const payment = (order.payments ?? []).find(
                        p => idsAreEqual(p.id, it.paymentId) && p.state === 'Settled',
                    );
                    let refunded = true;
                    if (payment) {
                        refunded = await this.refundPaymentOnce(ctx, order, payment, it.amount, 'group buy failed refund');
                        if (!refunded) {
                            Logger.warn(`Group buy refund failed for item ${it.id}, kept as paid for manual handling`, loggerCtx);
                        }
                    }
                    it.status = refunded ? 'refunded' : 'paid';
                } else if (['locked', 'payable', 'overdue'].includes(it.status)) {
                    it.status = 'waived';
                }
            }
            await this.itemRepo(ctx).save(all);
            schedule.breachType = 'group_buy_failed';
            schedule.status = 'breached';
            await this.scheduleRepo(ctx).save(schedule);
            const plain = await this.orderService.findOne(ctx, schedule.orderId);
            if (plain) {
                await sendScheduleNotice(ctx, plain, 'scheduleBreachNoticeTemplateId', {
                    orderNo: { value: String(plain.code) },
                    reason: { value: 'group buy failed' },
                });
            }
            await this.cancelOrderSafe(ctx, schedule.orderId, 'group buy failed');
            count++;
            Logger.info(`PaymentSchedule ${scheduleId} failed by group buy ${activityId}`, loggerCtx);
        }
        return count;
    }

    /** 事件入口：团购成团（事件与扫描双通道，事件先行即时解锁） */
    async handleGroupBuyCompleted(ctx: RequestContext, activityId: number): Promise<number> {
        // 事件路径不依赖 ctx.channelId：以活动自身关联渠道为准，只解锁该渠道的期次
        const channelIds = await this.activityChannelIds(activityId);
        if (channelIds.length !== 1) {
            Logger.warn(
                `GroupBuyActivity ${activityId} is associated with ${channelIds.length} channels; skip auto-activation to avoid cross-channel writes`,
                loggerCtx,
            );
            return 0;
        }
        const channelId = channelIds[0];
        const items = await this.itemRepo(ctx).find({ where: { groupBuyActivityId: Number(activityId), status: 'locked' } });
        let n = 0;
        for (const item of items) {
            if (!(await this.isScheduleInChannel(ctx, item.scheduleId, channelId))) {
                continue;
            }
            item.status = 'payable';
            item.dueAt = new Date();
            await this.itemRepo(ctx).save(item);
            await this.notifyTailOpened(ctx, item);
            n++;
        }
        return n;
    }

    /** 事件入口：团购失败 */
    async handleGroupBuyFailed(ctx: RequestContext, activityId: number): Promise<number> {
        return this.failSchedulesForGroupBuy(ctx, activityId);
    }

    /** 逾期扫描：payable 超 dueAt+graceHours → overdue + 违约动作（仅作用于本次转 overdue 期） */
    async processOverdue(ctx: RequestContext, now = new Date()): Promise<{ overdue: number; cancelledOrders: number }> {
        const ids = await this.channelScheduleIds(ctx);
        if (!ids.length) return { overdue: 0, cancelledOrders: 0 };
        const items = await this.itemRepo(ctx).find({ where: { scheduleId: In(ids), status: 'payable' } });
        let overdue = 0;
        let cancelledOrders = 0;
        for (const item of items) {
            if (!item.dueAt) continue;
            const deadline = new Date(item.dueAt.getTime() + item.graceHours * 3600 * 1000);
            if (now <= deadline) continue;
            const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: item.scheduleId } });
            if (!schedule || !OPEN_SCHEDULE_STATUSES.includes(schedule.status)) continue;
            item.status = 'overdue';
            await this.itemRepo(ctx).save(item);
            overdue++;
            const acted = await this.applyBreachAction(ctx, schedule, item);
            if (acted) cancelledOrders++;
        }
        return { overdue, cancelledOrders };
    }

    /** 违约矩阵（设计 §7）——只对逾期期执行 */
    private async applyBreachAction(ctx: RequestContext, schedule: OrderPaymentSchedule, item: OrderScheduleItem): Promise<boolean> {
        const rule = parseDepositRule(schedule.depositRule);
        const order = await this.orderService.findOne(ctx, schedule.orderId, ['customer', 'customer.user']);

        // 买家超时未付定金
        if (item.kind === 'deposit' && rule?.kind === 'legal_deposit') {
            item.status = 'forfeited';
            await this.itemRepo(ctx).save(item);
            schedule.breachType = 'buyer_timeout';
            schedule.status = 'breached';
            await this.scheduleRepo(ctx).save(schedule);
            if (order) {
                await sendScheduleNotice(ctx, order, 'scheduleBreachNoticeTemplateId', {
                    orderNo: { value: String(order.code) },
                    reason: { value: 'legal deposit forfeited (buyer timeout)' },
                });
                await this.cancelOrderSafe(ctx, order.id, 'legal deposit forfeited (buyer timeout)');
            }
            Logger.info(`PaymentSchedule ${schedule.id}: legal deposit forfeited (buyer timeout)`, loggerCtx);
            return true;
        }
        // 买家超时未付订金：按策略退
        if (item.kind === 'deposit' && rule?.kind === 'earnest') {
            const refundAmount = earnestRefundAmount(item, rule);
            if (order && refundAmount > 0) {
                const payments = await this.orderWithPayments(ctx, order.id);
                const payment = (payments.payments ?? []).find(
                    p => idsAreEqual(p.id, item.paymentId) && p.state === 'Settled',
                );
                if (payment) {
                    const ok = await this.refundPaymentOnce(ctx, payments, payment, refundAmount, 'earnest refunded on timeout per policy');
                    if (ok) {
                        item.status = 'refunded';
                        await this.itemRepo(ctx).save(item);
                        await sendScheduleNotice(ctx, order, 'scheduleRefundTemplateId', {
                            orderNo: { value: String(order.code) },
                            amount: { value: String(Math.floor(refundAmount / 100)) },
                        });
                    }
                }
            }
            schedule.breachType = 'buyer_timeout';
            schedule.status = 'cancelled';
            await this.scheduleRepo(ctx).save(schedule);
            if (order) {
                await this.cancelOrderSafe(ctx, order.id, 'earnest refunded (buyer timeout)');
            }
            return true;
        }
        // 分期/租金/尾款逾期：仅标记 + 催收提醒（止付/收回/扣押金由管理员执行）
        if (order) {
            await sendScheduleNotice(ctx, order, 'scheduleOverdueTemplateId', {
                orderNo: { value: String(order.code) },
                seq: { value: String(item.seq) },
            });
        }
        Logger.info(`PaymentSchedule ${schedule.id} item ${item.seq} overdue (reminder sent)`, loggerCtx);
        return false;
    }

    /** 发货超期扫描：超过发货承诺未发货 → 标记 seller_breach 待管理员确认 */
    async processShipDeadlines(ctx: RequestContext, now = new Date()): Promise<number> {
        const ids = await this.channelScheduleIds(ctx);
        if (!ids.length) return 0;
        const schedules = await this.scheduleRepo(ctx)
            .createQueryBuilder('s')
            .where('s.id IN (:...ids)', { ids })
            .andWhere('s.shipDeadline IS NOT NULL')
            .andWhere('s.shipDeadline < :now', { now })
            .andWhere('s.status IN (:...statuses)', { statuses: [...OPEN_SCHEDULE_STATUSES] })
            .andWhere('s.breachType IS NULL')
            .getMany();
        let marked = 0;
        for (const schedule of schedules) {
            const items = await this.findItems(ctx, schedule.id as number);
            if (!items.some(i => i.status === 'paid')) continue;
            schedule.breachType = 'seller_breach';
            await this.scheduleRepo(ctx).save(schedule);
            const order = await this.orderService.findOne(ctx, schedule.orderId);
            if (order) {
                await sendScheduleNotice(ctx, order, 'scheduleBreachNoticeTemplateId', {
                    orderNo: { value: String(order.code) },
                    reason: { value: 'seller ship deadline breached' },
                });
            }
            Logger.warn(
                `PaymentSchedule ${schedule.id} marked seller_breach (ship deadline missed) — awaiting admin confirmation`,
                loggerCtx,
            );
            marked++;
        }
        return marked;
    }

    /**
     * 卖家违约确认（管理员）：
     * - legal_deposit 定金：双倍返还（本金 refund + 等额赔偿 refund，两笔留痕）
     * - 其余已付期次：全额退
     * 未付期次 → waived；调度 → cancelled；订单取消。
     */
    async confirmSellerBreach(ctx: RequestContext, scheduleId: number): Promise<ScheduleWithItems> {
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) {
            throw new UserInputError(`PaymentSchedule ${scheduleId} not found`);
        }
        if (schedule.breachType !== 'seller_breach') {
            throw new UserInputError('Schedule is not marked as seller breach');
        }
        const order = await this.orderWithPayments(ctx, schedule.orderId);
        const items = await this.findItems(ctx, scheduleId);
        const rule = parseDepositRule(schedule.depositRule);
        const depositItem = items.find(i => i.kind === 'deposit' && i.status === 'paid');
        for (const item of items) {
            if (item.status !== 'paid') {
                if (['locked', 'payable', 'overdue'].includes(item.status)) item.status = 'waived';
                continue;
            }
            const payment = (order.payments ?? []).find(p => idsAreEqual(p.id, item.paymentId) && p.state === 'Settled');
            if (!payment) continue;
            const isLegalDepositItem = !!depositItem && idsAreEqual(item.id, depositItem.id) && rule?.kind === 'legal_deposit';
            const ok = await this.refundPaymentOnce(
                ctx,
                order,
                payment,
                item.amount,
                isLegalDepositItem ? 'seller breach: principal refund' : 'seller breach: full refund',
            );
            if (!ok) {
                Logger.warn(`Seller breach refund failed for item ${item.id}, kept as paid for manual handling`, loggerCtx);
                continue;
            }
            if (isLegalDepositItem) {
                await this.recordCompensationRefund(
                    ctx,
                    payment,
                    item.amount,
                    'seller breach: statutory compensation (double refund)',
                );
            }
            item.status = 'refunded';
        }
        await this.itemRepo(ctx).save(items);
        schedule.status = 'cancelled';
        await this.scheduleRepo(ctx).save(schedule);
        await this.cancelOrderSafe(ctx, order.id, 'seller breach confirmed');
        return (await this.getScheduleById(ctx, scheduleId)) as ScheduleWithItems;
    }

    /** 手动开启尾款窗口（manual/group_buy 期次 → payable） */
    async openTailWindow(ctx: RequestContext, scheduleId: number): Promise<ScheduleWithItems> {
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) {
            throw new UserInputError(`PaymentSchedule ${scheduleId} not found`);
        }
        if (!OPEN_SCHEDULE_STATUSES.includes(schedule.status)) {
            throw new UserInputError(`Schedule status ${schedule.status} does not allow opening tail window`);
        }
        const items = await this.findItems(ctx, scheduleId);
        let opened = 0;
        for (const item of items) {
            if (item.status !== 'locked') continue;
            const trigger = parseTrigger(item.trigger);
            if (trigger?.type !== 'manual' && trigger?.type !== 'group_buy') continue;
            item.status = 'payable';
            item.dueAt = new Date();
            await this.itemRepo(ctx).save(item);
            opened++;
        }
        if (opened === 0) {
            throw new UserInputError('No locked manual/group_buy periods to open');
        }
        const order = await this.orderService.findOne(ctx, schedule.orderId);
        if (order) {
            await this.notifyTailOpened(ctx, items.find(i => i.status === 'payable') as OrderScheduleItem);
        }
        return (await this.getScheduleById(ctx, scheduleId)) as ScheduleWithItems;
    }

    /** 租赁还物退押（管理员）：押金期已付 → 全额原路退 → refunded */
    async releaseDepositForRental(ctx: RequestContext, orderId: ID): Promise<ScheduleWithItems> {
        const withItems = await this.getScheduleForOrder(ctx, orderId);
        if (!withItems) {
            throw new UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        if (schedule.scenario !== 'rental') {
            throw new UserInputError('Not a rental schedule');
        }
        const depositItem = items.find(i => i.kind === 'deposit');
        if (!depositItem || depositItem.status !== 'paid') {
            throw new UserInputError('Deposit is not paid / not refundable');
        }
        const order = await this.orderWithPayments(ctx, schedule.orderId);
        const payment = (order.payments ?? []).find(
            p => idsAreEqual(p.id, depositItem.paymentId) && p.state === 'Settled',
        );
        if (!payment) {
            throw new UserInputError('Deposit payment not found');
        }
        const ok = await this.refundPaymentOnce(ctx, order, payment, depositItem.amount, 'rental deposit released');
        if (!ok) {
            throw new UserInputError('Refund failed');
        }
        depositItem.status = 'refunded';
        await this.itemRepo(ctx).save(depositItem);
        const all = await this.findItems(ctx, schedule.id as number);
        if (all.every(i => TERMINAL_ITEM_STATUSES.includes(i.status)) && !['breached', 'cancelled'].includes(schedule.status)) {
            schedule.status = 'completed';
            await this.scheduleRepo(ctx).save(schedule);
        }
        return (await this.getScheduleById(ctx, schedule.id as number)) as ScheduleWithItems;
    }

    /* ------------------------- 订单取消联动 ------------------------- */

    async handleOrderCancelled(ctx: RequestContext, orderId: ID): Promise<void> {
        const scheduleId = (await this.readOrderScheduleId(ctx, orderId));
        if (!scheduleId) return;
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) return;
        if (['breached', 'cancelled', 'completed'].includes(schedule.status)) return;
        schedule.status = 'cancelled';
        await this.scheduleRepo(ctx).save(schedule);
        const items = await this.findItems(ctx, schedule.id as number);
        for (const item of items) {
            if (['locked', 'payable', 'overdue'].includes(item.status)) {
                item.status = 'waived';
            }
        }
        await this.itemRepo(ctx).save(items);
    }

    /* ------------------------- 私有工具 ------------------------- */

    private async readOrderScheduleId(ctx: RequestContext, orderId: ID): Promise<number | null> {
        const order = await this.orderService.findOne(ctx, orderId);
        return ((order?.customFields as any)?.paymentScheduleId as number | undefined) ?? null;
    }

    private async notifyTailOpened(ctx: RequestContext, item: OrderScheduleItem): Promise<void> {
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: item.scheduleId } });
        if (!schedule) return;
        const order = await this.orderService.findOne(ctx, schedule.orderId);
        if (!order) return;
        await sendScheduleNotice(ctx, order, 'scheduleTailOpenedTemplateId', {
            orderNo: { value: String(order.code) },
            seq: { value: String(item.seq) },
        });
    }

    private async transition(ctx: RequestContext, orderId: ID, state: string): Promise<void> {
        const result = await this.orderService.transitionToState(ctx, orderId, state as any);
        const err = result as any;
        if (err instanceof Error || err.errorCode) {
            const reason = err.transitionError ?? err.message ?? err.errorCode ?? 'unknown';
            throw new UserInputError(`Transition to ${state} failed: ${reason}`);
        }
    }

    private async cancelOrderSafe(ctx: RequestContext, orderId: ID, reason: string): Promise<void> {
        try {
            const result = await this.orderService.cancelOrder(ctx, { orderId, reason } as any);
            const err = result as any;
            if (err?.errorCode) {
                Logger.warn(`Cancel order ${orderId} failed: ${err.message ?? err.errorCode}`, loggerCtx);
            }
        } catch (e: any) {
            Logger.warn(`Cancel order ${orderId} failed: ${e?.message ?? e}`, loggerCtx);
        }
    }

    /**
     * 退款（能力闸门 + 立即结算）。原先只 createRefund 不 settleRefund，退款单永远停在 Pending：
     * - 货到付款等无原路退能力的方式：不建待退款单，改落人工现金退还工单（含订单号/金额/原因）；
     * - 有退款能力：建单后立即 settleRefund 真实打款，并回读终态；
     *   结算抛错或回读未达 Settled → 退款单置 Failed（保留审计痕迹）并告警，返回 false 交上层人工处理。
     */
    private async refundPayment(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        amount: number,
        reason: string,
    ): Promise<boolean> {
        if (!(await this.paymentSupportsRefund(ctx, payment))) {
            await this.createManualCashRefundTask(ctx, order, payment, amount, reason);
            return false;
        }
        try {
            const result = await this.paymentService.createRefund(
                ctx,
                { paymentId: payment.id, amount, reason, shipping: 0, adjustment: 0 } as any,
                order,
                payment,
            );
            if (result instanceof Error) {
                Logger.warn(`Refund for payment ${payment.id} returned error: ${result.message}`, loggerCtx);
                return false;
            }
            if ((result as any)?.errorCode) {
                Logger.warn(`Refund for payment ${payment.id} failed: ${(result as any).message}`, loggerCtx);
                return false;
            }
            return await this.settleRefundAndVerify(ctx, result as Refund, payment);
        } catch (e: any) {
            Logger.error(`Failed to refund payment ${payment.id}: ${e?.message ?? e}`, loggerCtx);
            return false;
        }
    }

    /** 支付方式是否具备原路退款能力（按处理器 handler code 判定；查不到方式时按具备处理，保持原行为） */
    private async paymentSupportsRefund(ctx: RequestContext, payment: Payment): Promise<boolean> {
        try {
            const methods = await this.connection
                .getRepository(ctx, PaymentMethod)
                .find({ where: { code: payment.method } as any });
            const handlerCode = (methods[0] as any)?.handler?.code;
            if (!handlerCode) {
                Logger.warn(`Payment method ${payment.method} not found, assume refundable`, loggerCtx);
                return true;
            }
            return !NO_REFUND_HANDLER_CODES.includes(String(handlerCode));
        } catch (e: any) {
            Logger.warn(`Resolve payment method ${payment.method} failed: ${e?.message ?? e}`, loggerCtx);
            return true;
        }
    }

    /** settleRefund 打款 + 回读终态（与 campus settleRefundOrMarkFailed 同口径） */
    private async settleRefundAndVerify(ctx: RequestContext, refund: Refund, payment: Payment): Promise<boolean> {
        try {
            await this.orderService.settleRefund(ctx, { id: refund.id, transactionId: payment.id as any });
            const fresh = await this.connection.getRepository(ctx, Refund).findOne({ where: { id: refund.id } as any });
            if (String((fresh as any)?.state) === 'Settled') {
                return true;
            }
            await this.markRefundFailed(
                ctx,
                refund.id,
                `settle returned state ${(fresh as any)?.state ?? 'missing'}`,
            );
            return false;
        } catch (e: any) {
            await this.markRefundFailed(ctx, refund.id, e?.message ?? String(e));
            return false;
        }
    }

    private async markRefundFailed(ctx: RequestContext, refundId: ID, reason: string): Promise<void> {
        Logger.error(`Refund ${refundId} settle failed: ${reason} (order needs manual handling)`, loggerCtx);
        await this.connection
            .getRepository(ctx, Refund)
            .update(refundId as any, { state: REFUND_FAILED_STATE } as any)
            .catch(() => undefined);
    }

    /** 无退款能力方式（货到付款）：落人工现金退还工单（软依赖 campus SupportService，未安装时只告警） */
    private async createManualCashRefundTask(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        amount: number,
        reason: string,
    ): Promise<void> {
        const detail = `货到付款订单需人工现金退还：订单 ${order.code}，支付单 ${payment.id}，金额 ${amount} 分，原因：${reason}`;
        Logger.warn(detail, loggerCtx);
        try {
            const { SupportService } = require('@vendure/campus-delivery-plugin');
            const svc = tryGetProvider<any>(SupportService);
            if (!svc?.createSystemTicket) {
                Logger.warn('campus SupportService unavailable, manual cash refund left to alarm only', loggerCtx);
                return;
            }
            const ticket = await svc.createSystemTicket(ctx, {
                dedupeKey: `payment-schedule:cash-refund:${payment.id}:${amount}`,
                orderCode: String(order.code),
                orderId: Number(order.id),
                category: 'refund_manual_cash',
                source: 'payment-schedule',
                content: detail,
                channelId: ctx.channelId,
            });
            Logger.warn(`${detail} → 工单 ${ticket?.id ?? 'n/a'}`, loggerCtx);
        } catch (e: any) {
            Logger.warn(`${detail}（人工任务落库失败：${e?.message ?? e}）`, loggerCtx);
        }
    }

    /** 幂等退款：已 Settled 退款合计 + 本次 > 支付额 时拒绝（防团购与调度双通道重复退款） */
    private async refundPaymentOnce(
        ctx: RequestContext,
        order: Order,
        payment: Payment,
        amount: number,
        reason: string,
    ): Promise<boolean> {
        const settled = ((payment as any).refunds ?? [])
            .filter((r: any) => r.state === 'Settled')
            .reduce((s: number, r: any) => s + r.amount, 0);
        if (settled + amount > payment.amount) {
            Logger.warn(
                `Refund skipped for payment ${payment.id}: settled ${settled} + ${amount} exceeds ${payment.amount}`,
                loggerCtx,
            );
            return false;
        }
        return this.refundPayment(ctx, order, payment, amount, reason);
    }

    /**
     * 双倍返还的「等额赔偿」笔：本金退完后 createRefund 的可退余额为 0（Vendure 对超额退款
     * 恒返 RefundAmountError），赔偿属平台法定赔付留痕（设计 §7：本金 refund + 等额赔偿 refund），
     * 直接落一条 Settled Refund 记录，不经网关、不受可退余额约束。
     */
    private async recordCompensationRefund(
        ctx: RequestContext,
        payment: Payment,
        amount: number,
        reason: string,
    ): Promise<boolean> {
        try {
            await this.connection.getRepository(ctx, Refund).save(
                new Refund({
                    payment,
                    total: amount,
                    reason,
                    method: payment.method,
                    state: 'Settled',
                    metadata: { statutoryCompensation: true },
                    items: 0,
                    shipping: 0,
                    adjustment: 0,
                } as any),
            );
            return true;
        } catch (e: any) {
            Logger.error(`Failed to record compensation refund for payment ${payment.id}: ${e?.message ?? e}`, loggerCtx);
            return false;
        }
    }
}
