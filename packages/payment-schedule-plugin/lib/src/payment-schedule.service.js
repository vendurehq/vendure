"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PaymentScheduleService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("typeorm");
const core_1 = require("@vendure/core");
const notification_1 = require("./notification");
const payment_schedule_runtime_1 = require("./payment-schedule-runtime");
const constants_1 = require("./constants");
const order_payment_schedule_entity_1 = require("./order-payment-schedule.entity");
const order_schedule_item_entity_1 = require("./order-schedule-item.entity");
const schedule_config_1 = require("./schedule-config");
/** 软依赖解析 COD 退款闸门端口（cjk-plugin 未安装时返回 null，COD 一律不可退）。 */
function resolveCodRefundPolicy() {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = require('@vendure/cjk-plugin');
        return typeof (mod === null || mod === void 0 ? void 0 : mod.getCodRefundPolicyPort) === 'function' ? mod.getCodRefundPolicyPort() : null;
    }
    catch (_a) {
        return null;
    }
}
// PaymentSettled：租赁买断场景——期次付清→completed→追加买断项拉回 in_progress 后仍需可付（Task 18）
const PAYABLE_SOURCE_STATES = ['ArrangingPayment', 'Deposited', 'PartiallyPaid', 'PaymentSettled'];
const OPEN_SCHEDULE_STATUSES = ['pending', 'in_progress'];
const TERMINAL_ITEM_STATUSES = ['paid', 'refunded', 'waived', 'forfeited'];
/** 无原路退款能力的处理器：货到付款的现金已由骑手/门店收走，网关退不了，只能人工现金退还 */
const NO_REFUND_HANDLER_CODES = ['cash-on-delivery'];
/** 退款单结算失败终态（不计入已退总额，保留审计痕迹） */
const REFUND_FAILED_STATE = 'Failed';
let PaymentScheduleService = class PaymentScheduleService {
    constructor(connection, listQueryBuilder, orderService, paymentService) {
        this.connection = connection;
        this.listQueryBuilder = listQueryBuilder;
        this.orderService = orderService;
        this.paymentService = paymentService;
    }
    init(_injector) {
        // 运行时连接/注入器由 plugin.onApplicationBootstrap 写入 payment-schedule-runtime
    }
    /* ------------------------- 仓储工具 ------------------------- */
    scheduleRepo(ctx) {
        return this.connection.getRepository(ctx, order_payment_schedule_entity_1.OrderPaymentSchedule);
    }
    itemRepo(ctx) {
        return this.connection.getRepository(ctx, order_schedule_item_entity_1.OrderScheduleItem);
    }
    async findItems(ctx, scheduleId) {
        return this.itemRepo(ctx).find({ where: { scheduleId }, order: { seq: 'ASC' } });
    }
    async orderWithPayments(ctx, orderId) {
        const order = await this.connection.getRepository(ctx, core_1.Order).findOne({
            where: { id: orderId },
            relations: ['payments', 'payments.refunds'],
        });
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        return order;
    }
    assertOrderOwner(ctx, order) {
        var _a, _b;
        if (((_b = (_a = order === null || order === void 0 ? void 0 : order.customer) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id) !== ctx.activeUserId) {
            throw new core_1.UserInputError('You can only access your own order schedule');
        }
    }
    /* ------------------------- 创建（场景插件调用） ------------------------- */
    async createSchedule(ctx, input) {
        var _a, _b, _c, _d;
        const order = await this.orderService.findOne(ctx, input.orderId);
        if (!order) {
            throw new core_1.UserInputError(`Order ${input.orderId} not found`);
        }
        const existing = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.paymentScheduleId;
        if (existing) {
            throw new core_1.UserInputError(`Order already has a payment schedule (${existing})`);
        }
        if (!input.items.length) {
            throw new core_1.UserInputError('Schedule requires at least one item');
        }
        const sorted = [...input.items].sort((a, b) => a.seq - b.seq);
        sorted.forEach((item, i) => {
            if (!(item.amount >= 0)) {
                throw new core_1.UserInputError('Item amount must be >= 0');
            }
            if (item.allowCod && !schedule_config_1.COD_ALLOWED_KINDS.includes(item.kind)) {
                throw new core_1.UserInputError(`COD is not allowed for kind ${item.kind} (only balance/installment/rent)`);
            }
            if (i > 0 && item.seq <= sorted[i - 1].seq) {
                throw new core_1.UserInputError('Item seq must be strictly increasing');
            }
        });
        const now = new Date();
        const schedule = new order_payment_schedule_entity_1.OrderPaymentSchedule({
            orderId: Number(input.orderId),
            channelId: ctx.channelId,
            scenario: input.scenario,
            deliveryGate: input.deliveryGate,
            depositRule: (_b = input.depositRule) !== null && _b !== void 0 ? _b : null,
            agreementVersion: input.agreementVersion,
            shipDeadline: (_c = input.shipDeadline) !== null && _c !== void 0 ? _c : undefined,
            meta: ((_d = input.meta) !== null && _d !== void 0 ? _d : null),
            status: 'pending',
        });
        schedule.channels = [ctx.channel];
        const savedSchedule = await this.scheduleRepo(ctx).save(schedule);
        const itemEntities = sorted.map((item, idx) => {
            var _a, _b, _c, _d;
            const trigger = item.trigger;
            return new order_schedule_item_entity_1.OrderScheduleItem({
                scheduleId: savedSchedule.id,
                seq: item.seq,
                kind: item.kind,
                amount: item.amount,
                allowCod: (_a = item.allowCod) !== null && _a !== void 0 ? _a : false,
                trigger,
                dueAt: (_b = (0, schedule_config_1.computeDueAt)(trigger, now)) !== null && _b !== void 0 ? _b : undefined,
                graceHours: (_c = item.graceHours) !== null && _c !== void 0 ? _c : 0,
                lateFeeRule: (_d = item.lateFeeRule) !== null && _d !== void 0 ? _d : null,
                // 首期立即可付（首笔款），其余锁定等触发
                status: idx === 0 ? 'payable' : 'locked',
                paidAt: undefined,
                paymentId: null,
                groupBuyActivityId: trigger.type === 'group_buy' ? trigger.groupBuyActivityId : null,
            });
        });
        await this.itemRepo(ctx).save(itemEntities);
        await this.orderService.updateCustomFields(ctx, order.id, { paymentScheduleId: savedSchedule.id });
        core_1.Logger.info(`PaymentSchedule ${savedSchedule.id} created for order ${order.code} (${input.scenario}, ${itemEntities.length} items)`, constants_1.loggerCtx);
        return savedSchedule;
    }
    /** 追加期次（租赁买断场景；调度须为 rental 且尚无买断项） */
    async addScheduleItem(ctx, scheduleId, input) {
        var _a;
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) {
            throw new core_1.UserInputError(`PaymentSchedule ${scheduleId} not found`);
        }
        if (schedule.scenario !== 'rental') {
            throw new core_1.UserInputError('Only rental schedules can accept appended items');
        }
        const items = await this.findItems(ctx, scheduleId);
        if (input.kind === 'buyout' && items.some(i => i.kind === 'buyout')) {
            throw new core_1.UserInputError('Buyout item already exists');
        }
        if (items.some(i => TERMINAL_ITEM_STATUSES.includes(i.status))) {
            // 已有完结期次（租金付清→completed）时允许追加买断并把调度拉回进行中
        }
        const item = new order_schedule_item_entity_1.OrderScheduleItem({
            scheduleId,
            seq: Math.max(0, ...items.map(i => i.seq)) + 1,
            kind: input.kind,
            amount: input.amount,
            allowCod: false,
            trigger: (_a = input.trigger) !== null && _a !== void 0 ? _a : { type: 'manual' },
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
        return this.getScheduleForOrder(ctx, schedule.orderId);
    }
    /* ------------------------- 查询 ------------------------- */
    async getScheduleForOrder(ctx, orderId, opts) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        if (opts === null || opts === void 0 ? void 0 : opts.requireOwner) {
            this.assertOrderOwner(ctx, order);
        }
        const scheduleId = (_b = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.paymentScheduleId) !== null && _b !== void 0 ? _b : null;
        return this.getScheduleById(ctx, scheduleId, opts);
    }
    async getScheduleById(ctx, scheduleId, opts) {
        if (!scheduleId)
            return null;
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule)
            return null;
        const items = await this.findItems(ctx, schedule.id);
        if (opts === null || opts === void 0 ? void 0 : opts.requireOwner) {
            const order = await this.orderService.findOne(ctx, schedule.orderId, ['customer', 'customer.user']);
            if (!order) {
                throw new core_1.UserInputError(`Order ${schedule.orderId} not found`);
            }
            this.assertOrderOwner(ctx, order);
        }
        return { schedule, items };
    }
    async listSchedules(ctx, options) {
        return this.listQueryBuilder
            .build(order_payment_schedule_entity_1.OrderPaymentSchedule, options, {
            ctx,
            channelId: ctx.channelId,
            relations: ['channels'],
        })
            .getManyAndCount()
            .then(([items, totalItems]) => ({ items, totalItems }));
    }
    /** GraphQL 呈现（滞纳金/已付统计现算，不落库） */
    presentSchedule(withItems, now = new Date()) {
        const { schedule, items } = withItems;
        return Object.assign(Object.assign({}, schedule), { items: items.map(i => (Object.assign(Object.assign({}, i), { trigger: i.trigger, paidAmount: i.status === 'paid' ? i.amount : 0, lateFeeAccrued: (0, schedule_config_1.lateFeeAccrued)(i, now) }))), paidTotal: items.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0), totalAmount: items.reduce((s, i) => s + i.amount, 0) });
    }
    /** Admin 列表批量取期次（供 resolver 组装 present） */
    async findItemsForPresent(ctx, scheduleId) {
        return this.findItems(ctx, scheduleId);
    }
    /* ------------------------- 支付 ------------------------- */
    /**
     * 付任意期次（在线/COD 均经此）。
     * Settled → item paid + 推进订单状态；Authorized（COD handler）→ item 留待 confirmCodReceived。
     */
    async paySchedulePeriod(ctx, orderId, seq, method) {
        var _a, _b, _c;
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        this.assertOrderOwner(ctx, order);
        if (!PAYABLE_SOURCE_STATES.includes(order.state)) {
            throw new core_1.UserInputError(`Order state ${order.state} does not allow period payment`);
        }
        const scheduleId = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.paymentScheduleId;
        const withItems = await this.getScheduleById(ctx, scheduleId);
        if (!withItems) {
            throw new core_1.UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        if (!OPEN_SCHEDULE_STATUSES.includes(schedule.status)) {
            throw new core_1.UserInputError(`Schedule status ${schedule.status} does not allow payment`);
        }
        const item = items.find(i => i.seq === Number(seq));
        if (!item) {
            throw new core_1.UserInputError(`Schedule period ${seq} not found`);
        }
        if (item.status === 'paid' || item.paidAt) {
            throw new core_1.UserInputError(`Period ${seq} is already paid`);
        }
        if (!['payable', 'overdue', 'locked'].includes(item.status)) {
            throw new core_1.UserInputError(`Period ${seq} is not payable (status: ${item.status})`);
        }
        if (item.status === 'locked' && !this.unlockByTrigger(item, new Date())) {
            throw new core_1.UserInputError(`Period ${seq} is locked (trigger not satisfied)`);
        }
        const payment = await this.paymentService.createPayment(ctx, order, item.amount, method, {
            scheduleId: schedule.id,
            seq: item.seq,
        });
        if (payment instanceof Error || payment.errorCode) {
            throw new core_1.UserInputError(`Payment failed: ${(_c = (_b = payment.message) !== null && _b !== void 0 ? _b : payment.errorCode) !== null && _c !== void 0 ? _c : 'unknown'}`);
        }
        const state = payment.state;
        if (state !== 'Settled' && state !== 'Authorized') {
            throw new core_1.UserInputError(`Unexpected payment state: ${state}`);
        }
        if (state === 'Settled') {
            item.status = 'paid';
            item.paidAt = new Date();
        }
        item.paymentId = payment.id;
        await this.itemRepo(ctx).save(item);
        await this.afterItemPaymentRecorded(ctx, order, schedule, items, state);
        const after = await this.getScheduleById(ctx, schedule.id);
        return after;
    }
    /** locked 期次在支付时刻补偿触发（补偿扫描任务最长 1 分钟延迟）：date 到点 / interval 到点 */
    unlockByTrigger(item, now) {
        const trigger = (0, schedule_config_1.parseTrigger)(item.trigger);
        if ((trigger === null || trigger === void 0 ? void 0 : trigger.type) === 'date' && trigger.at && now >= new Date(trigger.at)) {
            item.status = 'payable';
            if (!item.dueAt)
                item.dueAt = new Date(trigger.at);
            return true;
        }
        if ((trigger === null || trigger === void 0 ? void 0 : trigger.type) === 'interval' && item.dueAt && now >= item.dueAt) {
            item.status = 'payable';
            return true;
        }
        return false;
    }
    async afterItemPaymentRecorded(ctx, order, schedule, items, paymentState) {
        var _a;
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
        if (!fresh)
            return;
        if (allTerminal) {
            if (fresh.state !== 'PaymentSettled') {
                await this.transition(ctx, order.id, 'PaymentSettled');
            }
            return;
        }
        if (fresh.state === 'ArrangingPayment') {
            // 迁移期双读：预订旧语义订单继续走 Deposited；新场景统一 PartiallyPaid
            const legacy = !!((_a = fresh.customFields) === null || _a === void 0 ? void 0 : _a.preSaleActivityId);
            await this.transition(ctx, order.id, legacy ? 'Deposited' : 'PartiallyPaid');
        }
    }
    /** COD 环收尾：签收后管理员确认 → settle 授权支付 → item paid → 可能 PaymentSettled */
    async confirmCodReceived(ctx, orderId) {
        var _a;
        const withItems = await this.getScheduleForOrder(ctx, orderId);
        if (!withItems) {
            throw new core_1.UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        const pendingCod = items.filter(i => i.status === 'payable' && i.paymentId);
        if (!pendingCod.length) {
            throw new core_1.UserInputError('No pending COD payments to confirm');
        }
        for (const item of pendingCod) {
            const result = await this.paymentService.settlePayment(ctx, item.paymentId);
            if (result === null || result === void 0 ? void 0 : result.errorCode) {
                throw new core_1.UserInputError(`Settle payment failed: ${(_a = result.message) !== null && _a !== void 0 ? _a : result.errorCode}`);
            }
            item.status = 'paid';
            item.paidAt = new Date();
            await this.itemRepo(ctx).save(item);
        }
        const order = await this.orderService.findOne(ctx, schedule.orderId);
        if (!order) {
            throw new core_1.UserInputError(`Order ${schedule.orderId} not found`);
        }
        const refreshed = await this.findItems(ctx, schedule.id);
        await this.afterItemPaymentRecorded(ctx, order, schedule, refreshed, 'Settled');
        return (await this.getScheduleById(ctx, schedule.id));
    }
    /**
     * 薄壳桥专用：预售尾款窗口已开（窗口校验由 pre-sale-plugin 负责）→ 强制解锁 locked 尾款期。
     * 属 legacy 兼容通道（旧 API 语义：到货+窗口 ⇒ 尾款可付），优先级高于期次 trigger。
     */
    async unlockTailForOrder(ctx, orderId) {
        var _a;
        const order = await this.orderService.findOne(ctx, orderId);
        if (!order)
            return;
        const scheduleId = (_a = order.customFields) === null || _a === void 0 ? void 0 : _a.paymentScheduleId;
        const withItems = await this.getScheduleById(ctx, scheduleId);
        if (!withItems)
            return;
        const tail = withItems.items.find(i => i.kind === 'balance' && i.status === 'locked');
        if (!tail)
            return;
        tail.status = 'payable';
        if (!tail.dueAt)
            tail.dueAt = new Date();
        await this.itemRepo(ctx).save(tail);
        core_1.Logger.info(`Tail item ${tail.id} unlocked for order ${order.code} (legacy tail window open)`, constants_1.loggerCtx);
    }
    /* ------------------------- 取消 / 违约 ------------------------- */
    /**
     * 买家主动取消：
     * - legal_deposit：须 confirmForfeit=true，定金没收（forfeited），其余已付期次全退
     * - earnest：按 earnestRefundPolicy 退（默认全额）
     * - 其他（首付/押金语义）：已付期次全退
     * 未支付期次 → waived；调度 → cancelled；订单 → Cancelled（库存经各插件 Cancelled 订阅释放）。
     */
    async cancelSchedule(ctx, orderId, confirmForfeit) {
        const order = await this.orderService.findOne(ctx, orderId, ['customer', 'customer.user']);
        if (!order) {
            throw new core_1.UserInputError(`Order ${orderId} not found`);
        }
        this.assertOrderOwner(ctx, order);
        if (!['AddingItems', 'ArrangingPayment', 'Deposited', 'PartiallyPaid'].includes(order.state)) {
            throw new core_1.UserInputError(`Order state ${order.state} does not allow cancellation`);
        }
        const withItems = await this.getScheduleForOrder(ctx, orderId);
        if (!withItems) {
            throw new core_1.UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        if (!OPEN_SCHEDULE_STATUSES.includes(schedule.status)) {
            throw new core_1.UserInputError(`Schedule cannot be cancelled from status ${schedule.status}`);
        }
        const rule = (0, schedule_config_1.parseDepositRule)(schedule.depositRule);
        const isLegalDeposit = (rule === null || rule === void 0 ? void 0 : rule.kind) === 'legal_deposit';
        if (isLegalDeposit && !confirmForfeit) {
            throw new core_1.UserInputError('legal deposit is non-refundable; pass confirmForfeit=true to accept the penalty');
        }
        const payments = await this.orderService.getOrderPayments(ctx, order.id);
        for (const item of items) {
            if (item.status === 'paid') {
                const payment = payments.find(p => (0, core_1.idsAreEqual)(p.id, item.paymentId) && p.state === 'Settled');
                let refundAmount = 0;
                if (!isLegalDeposit) {
                    refundAmount =
                        item.kind === 'deposit' && (rule === null || rule === void 0 ? void 0 : rule.kind) === 'earnest'
                            ? (0, schedule_config_1.earnestRefundAmount)(item, rule)
                            : item.amount;
                }
                if (payment && refundAmount > 0) {
                    const ok = await this.refundPaymentOnce(ctx, order, payment, refundAmount, 'payment schedule cancelled');
                    item.status = ok ? 'refunded' : 'paid';
                    if (!ok) {
                        core_1.Logger.warn(`Refund failed for item ${item.id}, kept as paid for manual handling`, constants_1.loggerCtx);
                    }
                }
                else if (isLegalDeposit && item.kind === 'deposit') {
                    item.status = 'forfeited';
                }
                else {
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
        return (await this.getScheduleById(ctx, schedule.id));
    }
    /* ------------------------- 调度扫描（ScheduledTask / Admin runScheduleScan 共用） ------------------------- */
    async channelScheduleIds(ctx) {
        const rows = await this.scheduleRepo(ctx)
            .createQueryBuilder('s')
            .innerJoin('s.channels', 'channel', 'channel.id = :cid', { cid: ctx.channelId })
            .getMany();
        return rows.map(r => r.id);
    }
    /** 单条计划是否属于指定渠道（默认取当前请求渠道；事件路径须显式传入活动所属渠道） */
    async isScheduleInChannel(ctx, scheduleId, channelId = ctx.channelId) {
        const count = await this.scheduleRepo(ctx)
            .createQueryBuilder('s')
            .innerJoin('s.channels', 'channel', 'channel.id = :cid', { cid: channelId })
            .where('s.id = :id', { id: scheduleId })
            .getCount();
        return count > 0;
    }
    /** 触发扫描：locked → payable（date 到点 / interval 到点 / group_buy 活动完成或失败） */
    async processTriggers(ctx, now = new Date()) {
        const ids = await this.channelScheduleIds(ctx);
        if (!ids.length)
            return { activated: 0, failedSchedules: 0 };
        const items = await this.itemRepo(ctx).find({ where: { scheduleId: (0, typeorm_1.In)(ids), status: 'locked' } });
        let activated = 0;
        let failedSchedules = 0;
        for (const item of items) {
            const trigger = (0, schedule_config_1.parseTrigger)(item.trigger);
            if (!trigger)
                continue;
            if (trigger.type === 'group_buy') {
                const handled = await this.handleGroupBuyTrigger(ctx, item, trigger.groupBuyActivityId, now);
                if (handled === 'failed')
                    failedSchedules++;
                if (handled === 'activated')
                    activated++;
                continue;
            }
            if (trigger.type === 'date' && trigger.at && now >= new Date(trigger.at)) {
                item.status = 'payable';
                if (!item.dueAt)
                    item.dueAt = new Date(trigger.at);
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
    async handleGroupBuyTrigger(ctx, item, activityId, now) {
        const activity = await this.findGroupBuyActivity(activityId);
        if (!activity)
            return 'none';
        const failed = activity.status === 'expired' ||
            (activity.status === 'active' && new Date(activity.endAt) < now);
        if (failed) {
            await this.failSchedulesForGroupBuy(ctx, activityId, now);
            return 'failed';
        }
        if (activity.status === 'completed') {
            item.status = 'payable';
            item.dueAt = new Date();
            await this.itemRepo(ctx).save(item);
            await this.notifyTailOpened(ctx, item);
            return 'activated';
        }
        return 'none';
    }
    async findGroupBuyActivity(activityId) {
        try {
            const { GroupBuyActivity } = require('@vendure/group-buy-plugin');
            return await this.connection.rawConnection.getRepository(GroupBuyActivity).findOne({
                where: { id: activityId },
                relations: { channels: true },
            });
        }
        catch (_a) {
            return null;
        }
    }
    /** 活动所属渠道 id 列表（事件路径没有可靠的 ctx.channelId，以活动自身关联为准） */
    async activityChannelIds(activityId) {
        var _a;
        const activity = await this.findGroupBuyActivity(activityId);
        return ((_a = activity === null || activity === void 0 ? void 0 : activity.channels) !== null && _a !== void 0 ? _a : []).map((c) => Number(c.id));
    }
    /** 团购不成团：已付期次全额原路退，未付 → waived，调度 breached(group_buy_failed)，订单取消 */
    async failSchedulesForGroupBuy(ctx, activityId, now = new Date()) {
        var _a;
        const items = await this.itemRepo(ctx).find({ where: { groupBuyActivityId: Number(activityId) } });
        const scheduleIds = Array.from(new Set(items.map(i => i.scheduleId)));
        let count = 0;
        for (const scheduleId of scheduleIds) {
            const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
            if (!schedule || !OPEN_SCHEDULE_STATUSES.includes(schedule.status))
                continue;
            // 渠道约束：本方法可能被当前渠道的扫描触发（handleGroupBuyTrigger），
            // 团购活动失败的连带退款必须限定在 ctx.channelId 内，避免跨渠道误退款。
            if (!(await this.isScheduleInChannel(ctx, scheduleId)))
                continue;
            const all = await this.findItems(ctx, scheduleId);
            const order = await this.orderWithPayments(ctx, schedule.orderId);
            for (const it of all) {
                if (it.status === 'paid') {
                    const payment = ((_a = order.payments) !== null && _a !== void 0 ? _a : []).find(p => (0, core_1.idsAreEqual)(p.id, it.paymentId) && p.state === 'Settled');
                    let refunded = true;
                    if (payment) {
                        refunded = await this.refundPaymentOnce(ctx, order, payment, it.amount, 'group buy failed refund');
                        if (!refunded) {
                            core_1.Logger.warn(`Group buy refund failed for item ${it.id}, kept as paid for manual handling`, constants_1.loggerCtx);
                        }
                    }
                    it.status = refunded ? 'refunded' : 'paid';
                }
                else if (['locked', 'payable', 'overdue'].includes(it.status)) {
                    it.status = 'waived';
                }
            }
            await this.itemRepo(ctx).save(all);
            schedule.breachType = 'group_buy_failed';
            schedule.status = 'breached';
            await this.scheduleRepo(ctx).save(schedule);
            const plain = await this.orderService.findOne(ctx, schedule.orderId);
            if (plain) {
                await (0, notification_1.sendScheduleNotice)(ctx, plain, 'scheduleBreachNoticeTemplateId', {
                    orderNo: { value: String(plain.code) },
                    reason: { value: 'group buy failed' },
                });
            }
            await this.cancelOrderSafe(ctx, schedule.orderId, 'group buy failed');
            count++;
            core_1.Logger.info(`PaymentSchedule ${scheduleId} failed by group buy ${activityId}`, constants_1.loggerCtx);
        }
        return count;
    }
    /** 事件入口：团购成团（事件与扫描双通道，事件先行即时解锁） */
    async handleGroupBuyCompleted(ctx, activityId) {
        // 事件路径不依赖 ctx.channelId：以活动自身关联渠道为准，只解锁该渠道的期次
        const channelIds = await this.activityChannelIds(activityId);
        if (channelIds.length !== 1) {
            core_1.Logger.warn(`GroupBuyActivity ${activityId} is associated with ${channelIds.length} channels; skip auto-activation to avoid cross-channel writes`, constants_1.loggerCtx);
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
    async handleGroupBuyFailed(ctx, activityId) {
        return this.failSchedulesForGroupBuy(ctx, activityId);
    }
    /** 逾期扫描：payable 超 dueAt+graceHours → overdue + 违约动作（仅作用于本次转 overdue 期） */
    async processOverdue(ctx, now = new Date()) {
        const ids = await this.channelScheduleIds(ctx);
        if (!ids.length)
            return { overdue: 0, cancelledOrders: 0 };
        const items = await this.itemRepo(ctx).find({ where: { scheduleId: (0, typeorm_1.In)(ids), status: 'payable' } });
        let overdue = 0;
        let cancelledOrders = 0;
        for (const item of items) {
            if (!item.dueAt)
                continue;
            const deadline = new Date(item.dueAt.getTime() + item.graceHours * 3600 * 1000);
            if (now <= deadline)
                continue;
            const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: item.scheduleId } });
            if (!schedule || !OPEN_SCHEDULE_STATUSES.includes(schedule.status))
                continue;
            item.status = 'overdue';
            await this.itemRepo(ctx).save(item);
            overdue++;
            const acted = await this.applyBreachAction(ctx, schedule, item);
            if (acted)
                cancelledOrders++;
        }
        return { overdue, cancelledOrders };
    }
    /** 违约矩阵（设计 §7）——只对逾期期执行 */
    async applyBreachAction(ctx, schedule, item) {
        var _a;
        const rule = (0, schedule_config_1.parseDepositRule)(schedule.depositRule);
        const order = await this.orderService.findOne(ctx, schedule.orderId, ['customer', 'customer.user']);
        // 买家超时未付定金
        if (item.kind === 'deposit' && (rule === null || rule === void 0 ? void 0 : rule.kind) === 'legal_deposit') {
            item.status = 'forfeited';
            await this.itemRepo(ctx).save(item);
            schedule.breachType = 'buyer_timeout';
            schedule.status = 'breached';
            await this.scheduleRepo(ctx).save(schedule);
            if (order) {
                await (0, notification_1.sendScheduleNotice)(ctx, order, 'scheduleBreachNoticeTemplateId', {
                    orderNo: { value: String(order.code) },
                    reason: { value: 'legal deposit forfeited (buyer timeout)' },
                });
                await this.cancelOrderSafe(ctx, order.id, 'legal deposit forfeited (buyer timeout)');
            }
            core_1.Logger.info(`PaymentSchedule ${schedule.id}: legal deposit forfeited (buyer timeout)`, constants_1.loggerCtx);
            return true;
        }
        // 买家超时未付订金：按策略退
        if (item.kind === 'deposit' && (rule === null || rule === void 0 ? void 0 : rule.kind) === 'earnest') {
            const refundAmount = (0, schedule_config_1.earnestRefundAmount)(item, rule);
            if (order && refundAmount > 0) {
                const payments = await this.orderWithPayments(ctx, order.id);
                const payment = ((_a = payments.payments) !== null && _a !== void 0 ? _a : []).find(p => (0, core_1.idsAreEqual)(p.id, item.paymentId) && p.state === 'Settled');
                if (payment) {
                    const ok = await this.refundPaymentOnce(ctx, payments, payment, refundAmount, 'earnest refunded on timeout per policy');
                    if (ok) {
                        item.status = 'refunded';
                        await this.itemRepo(ctx).save(item);
                        await (0, notification_1.sendScheduleNotice)(ctx, order, 'scheduleRefundTemplateId', {
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
            await (0, notification_1.sendScheduleNotice)(ctx, order, 'scheduleOverdueTemplateId', {
                orderNo: { value: String(order.code) },
                seq: { value: String(item.seq) },
            });
        }
        core_1.Logger.info(`PaymentSchedule ${schedule.id} item ${item.seq} overdue (reminder sent)`, constants_1.loggerCtx);
        return false;
    }
    /** 发货超期扫描：超过发货承诺未发货 → 标记 seller_breach 待管理员确认 */
    async processShipDeadlines(ctx, now = new Date()) {
        const ids = await this.channelScheduleIds(ctx);
        if (!ids.length)
            return 0;
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
            const items = await this.findItems(ctx, schedule.id);
            if (!items.some(i => i.status === 'paid'))
                continue;
            schedule.breachType = 'seller_breach';
            await this.scheduleRepo(ctx).save(schedule);
            const order = await this.orderService.findOne(ctx, schedule.orderId);
            if (order) {
                await (0, notification_1.sendScheduleNotice)(ctx, order, 'scheduleBreachNoticeTemplateId', {
                    orderNo: { value: String(order.code) },
                    reason: { value: 'seller ship deadline breached' },
                });
            }
            core_1.Logger.warn(`PaymentSchedule ${schedule.id} marked seller_breach (ship deadline missed) — awaiting admin confirmation`, constants_1.loggerCtx);
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
    async confirmSellerBreach(ctx, scheduleId) {
        var _a;
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) {
            throw new core_1.UserInputError(`PaymentSchedule ${scheduleId} not found`);
        }
        if (schedule.breachType !== 'seller_breach') {
            throw new core_1.UserInputError('Schedule is not marked as seller breach');
        }
        const order = await this.orderWithPayments(ctx, schedule.orderId);
        const items = await this.findItems(ctx, scheduleId);
        const rule = (0, schedule_config_1.parseDepositRule)(schedule.depositRule);
        const depositItem = items.find(i => i.kind === 'deposit' && i.status === 'paid');
        for (const item of items) {
            if (item.status !== 'paid') {
                if (['locked', 'payable', 'overdue'].includes(item.status))
                    item.status = 'waived';
                continue;
            }
            const payment = ((_a = order.payments) !== null && _a !== void 0 ? _a : []).find(p => (0, core_1.idsAreEqual)(p.id, item.paymentId) && p.state === 'Settled');
            if (!payment)
                continue;
            const isLegalDepositItem = !!depositItem && (0, core_1.idsAreEqual)(item.id, depositItem.id) && (rule === null || rule === void 0 ? void 0 : rule.kind) === 'legal_deposit';
            const ok = await this.refundPaymentOnce(ctx, order, payment, item.amount, isLegalDepositItem ? 'seller breach: principal refund' : 'seller breach: full refund');
            if (!ok) {
                core_1.Logger.warn(`Seller breach refund failed for item ${item.id}, kept as paid for manual handling`, constants_1.loggerCtx);
                continue;
            }
            if (isLegalDepositItem) {
                await this.recordCompensationRefund(ctx, payment, item.amount, 'seller breach: statutory compensation (double refund)');
            }
            item.status = 'refunded';
        }
        await this.itemRepo(ctx).save(items);
        schedule.status = 'cancelled';
        await this.scheduleRepo(ctx).save(schedule);
        await this.cancelOrderSafe(ctx, order.id, 'seller breach confirmed');
        return (await this.getScheduleById(ctx, scheduleId));
    }
    /** 手动开启尾款窗口（manual/group_buy 期次 → payable） */
    async openTailWindow(ctx, scheduleId) {
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule) {
            throw new core_1.UserInputError(`PaymentSchedule ${scheduleId} not found`);
        }
        if (!OPEN_SCHEDULE_STATUSES.includes(schedule.status)) {
            throw new core_1.UserInputError(`Schedule status ${schedule.status} does not allow opening tail window`);
        }
        const items = await this.findItems(ctx, scheduleId);
        let opened = 0;
        for (const item of items) {
            if (item.status !== 'locked')
                continue;
            const trigger = (0, schedule_config_1.parseTrigger)(item.trigger);
            if ((trigger === null || trigger === void 0 ? void 0 : trigger.type) !== 'manual' && (trigger === null || trigger === void 0 ? void 0 : trigger.type) !== 'group_buy')
                continue;
            item.status = 'payable';
            item.dueAt = new Date();
            await this.itemRepo(ctx).save(item);
            opened++;
        }
        if (opened === 0) {
            throw new core_1.UserInputError('No locked manual/group_buy periods to open');
        }
        const order = await this.orderService.findOne(ctx, schedule.orderId);
        if (order) {
            await this.notifyTailOpened(ctx, items.find(i => i.status === 'payable'));
        }
        return (await this.getScheduleById(ctx, scheduleId));
    }
    /** 租赁还物退押（管理员）：押金期已付 → 全额原路退 → refunded */
    async releaseDepositForRental(ctx, orderId) {
        var _a;
        const withItems = await this.getScheduleForOrder(ctx, orderId);
        if (!withItems) {
            throw new core_1.UserInputError('Order has no payment schedule');
        }
        const { schedule, items } = withItems;
        if (schedule.scenario !== 'rental') {
            throw new core_1.UserInputError('Not a rental schedule');
        }
        const depositItem = items.find(i => i.kind === 'deposit');
        if (!depositItem || depositItem.status !== 'paid') {
            throw new core_1.UserInputError('Deposit is not paid / not refundable');
        }
        const order = await this.orderWithPayments(ctx, schedule.orderId);
        const payment = ((_a = order.payments) !== null && _a !== void 0 ? _a : []).find(p => (0, core_1.idsAreEqual)(p.id, depositItem.paymentId) && p.state === 'Settled');
        if (!payment) {
            throw new core_1.UserInputError('Deposit payment not found');
        }
        const ok = await this.refundPaymentOnce(ctx, order, payment, depositItem.amount, 'rental deposit released');
        if (!ok) {
            throw new core_1.UserInputError('Refund failed');
        }
        depositItem.status = 'refunded';
        await this.itemRepo(ctx).save(depositItem);
        const all = await this.findItems(ctx, schedule.id);
        if (all.every(i => TERMINAL_ITEM_STATUSES.includes(i.status)) && !['breached', 'cancelled'].includes(schedule.status)) {
            schedule.status = 'completed';
            await this.scheduleRepo(ctx).save(schedule);
        }
        return (await this.getScheduleById(ctx, schedule.id));
    }
    /* ------------------------- 订单取消联动 ------------------------- */
    async handleOrderCancelled(ctx, orderId) {
        const scheduleId = (await this.readOrderScheduleId(ctx, orderId));
        if (!scheduleId)
            return;
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: scheduleId } });
        if (!schedule)
            return;
        if (['breached', 'cancelled', 'completed'].includes(schedule.status))
            return;
        schedule.status = 'cancelled';
        await this.scheduleRepo(ctx).save(schedule);
        const items = await this.findItems(ctx, schedule.id);
        for (const item of items) {
            if (['locked', 'payable', 'overdue'].includes(item.status)) {
                item.status = 'waived';
            }
        }
        await this.itemRepo(ctx).save(items);
    }
    /* ------------------------- 私有工具 ------------------------- */
    async readOrderScheduleId(ctx, orderId) {
        var _a, _b;
        const order = await this.orderService.findOne(ctx, orderId);
        return (_b = (_a = order === null || order === void 0 ? void 0 : order.customFields) === null || _a === void 0 ? void 0 : _a.paymentScheduleId) !== null && _b !== void 0 ? _b : null;
    }
    async notifyTailOpened(ctx, item) {
        const schedule = await this.scheduleRepo(ctx).findOne({ where: { id: item.scheduleId } });
        if (!schedule)
            return;
        const order = await this.orderService.findOne(ctx, schedule.orderId);
        if (!order)
            return;
        await (0, notification_1.sendScheduleNotice)(ctx, order, 'scheduleTailOpenedTemplateId', {
            orderNo: { value: String(order.code) },
            seq: { value: String(item.seq) },
        });
    }
    async transition(ctx, orderId, state) {
        var _a, _b, _c;
        const result = await this.orderService.transitionToState(ctx, orderId, state);
        const err = result;
        if (err instanceof Error || err.errorCode) {
            const reason = (_c = (_b = (_a = err.transitionError) !== null && _a !== void 0 ? _a : err.message) !== null && _b !== void 0 ? _b : err.errorCode) !== null && _c !== void 0 ? _c : 'unknown';
            throw new core_1.UserInputError(`Transition to ${state} failed: ${reason}`);
        }
    }
    async cancelOrderSafe(ctx, orderId, reason) {
        var _a, _b;
        try {
            const result = await this.orderService.cancelOrder(ctx, { orderId, reason });
            const err = result;
            if (err === null || err === void 0 ? void 0 : err.errorCode) {
                core_1.Logger.warn(`Cancel order ${orderId} failed: ${(_a = err.message) !== null && _a !== void 0 ? _a : err.errorCode}`, constants_1.loggerCtx);
            }
        }
        catch (e) {
            core_1.Logger.warn(`Cancel order ${orderId} failed: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, constants_1.loggerCtx);
        }
    }
    /**
     * 退款（能力闸门 + 立即结算）。原先只 createRefund 不 settleRefund，退款单永远停在 Pending：
     * - 货到付款等无原路退能力的方式：不建待退款单，改落人工现金退还工单（含订单号/金额/原因）；
     * - 有退款能力：建单后立即 settleRefund 真实打款，并回读终态；
     *   结算抛错或回读未达 Settled → 退款单置 Failed（保留审计痕迹）并告警，返回 false 交上层人工处理。
     */
    async refundPayment(ctx, order, payment, amount, reason) {
        var _a, _b, _c;
        if (!(await this.paymentSupportsRefund(ctx, payment))) {
            if (String(payment.method) === 'cash-on-delivery') {
                // COD 无收款记录：不建退款单、不发现金工单（未收款无可退）；退款侧只认 confirmed 收款
                core_1.Logger.warn(`COD payment ${payment.id} has no confirmed receipt, skip refund for order ${order.code}`, constants_1.loggerCtx);
                return false;
            }
            await this.createManualCashRefundTask(ctx, order, payment, amount, reason);
            return false;
        }
        if (String(payment.method) === 'cash-on-delivery') {
            // COD 有收款记录：统一走 campus 闸门（锁收款、校验额度、建单即 Settled）
            const policy = resolveCodRefundPolicy();
            if (!policy) {
                core_1.Logger.error(`COD refund gate unavailable, refuse refund for payment ${payment.id}`, constants_1.loggerCtx);
                return false;
            }
            try {
                const result = await policy.createRefund(ctx, {
                    orderId: order.id,
                    paymentId: payment.id,
                    amount,
                    reason,
                });
                if (result instanceof Error || (result === null || result === void 0 ? void 0 : result.errorCode)) {
                    core_1.Logger.warn(`COD refund payment ${payment.id} failed: ${(_a = result === null || result === void 0 ? void 0 : result.message) !== null && _a !== void 0 ? _a : result}`, constants_1.loggerCtx);
                    return false;
                }
                if (String(result === null || result === void 0 ? void 0 : result.state) === 'Settled') {
                    return true;
                }
                return await this.settleRefundAndVerify(ctx, result, payment);
            }
            catch (e) {
                core_1.Logger.error(`Failed to refund COD payment ${payment.id}: ${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}`, constants_1.loggerCtx);
                return false;
            }
        }
        try {
            const result = await this.paymentService.createRefund(ctx, { paymentId: payment.id, amount, reason, shipping: 0, adjustment: 0 }, order, payment);
            if (result instanceof Error) {
                core_1.Logger.warn(`Refund for payment ${payment.id} returned error: ${result.message}`, constants_1.loggerCtx);
                return false;
            }
            if (result === null || result === void 0 ? void 0 : result.errorCode) {
                core_1.Logger.warn(`Refund for payment ${payment.id} failed: ${result.message}`, constants_1.loggerCtx);
                return false;
            }
            return await this.settleRefundAndVerify(ctx, result, payment);
        }
        catch (e) {
            core_1.Logger.error(`Failed to refund payment ${payment.id}: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, constants_1.loggerCtx);
            return false;
        }
    }
    /** 支付方式是否具备原路退款能力（按处理器 handler code 判定；查不到方式时按具备处理，保持原行为） */
    async paymentSupportsRefund(ctx, payment) {
        var _a, _b, _c;
        try {
            const methods = await this.connection
                .getRepository(ctx, core_1.PaymentMethod)
                .find({ where: { code: payment.method } });
            const handlerCode = (_b = (_a = methods[0]) === null || _a === void 0 ? void 0 : _a.handler) === null || _b === void 0 ? void 0 : _b.code;
            if (!handlerCode) {
                core_1.Logger.warn(`Payment method ${payment.method} not found, assume refundable`, constants_1.loggerCtx);
                return true;
            }
            if (String(handlerCode) === 'cash-on-delivery') {
                // 单一政策：COD 是否可退 = 是否有 confirmed 收款记录（不再按静态 code 名单一刀切）
                const policy = resolveCodRefundPolicy();
                if (!policy) {
                    core_1.Logger.warn(`COD refund gate not registered, treat payment ${payment.id} as non-refundable`, constants_1.loggerCtx);
                    return false;
                }
                return policy.hasConfirmedReceipt(ctx, payment.id);
            }
            return !NO_REFUND_HANDLER_CODES.includes(String(handlerCode));
        }
        catch (e) {
            core_1.Logger.warn(`Resolve payment method ${payment.method} failed: ${(_c = e === null || e === void 0 ? void 0 : e.message) !== null && _c !== void 0 ? _c : e}`, constants_1.loggerCtx);
            return true;
        }
    }
    /** settleRefund 打款 + 回读终态（与 campus settleRefundOrMarkFailed 同口径） */
    async settleRefundAndVerify(ctx, refund, payment) {
        var _a, _b;
        try {
            await this.orderService.settleRefund(ctx, { id: refund.id, transactionId: payment.id });
            const fresh = await this.connection.getRepository(ctx, core_1.Refund).findOne({ where: { id: refund.id } });
            if (String(fresh === null || fresh === void 0 ? void 0 : fresh.state) === 'Settled') {
                return true;
            }
            await this.markRefundFailed(ctx, refund.id, `settle returned state ${(_a = fresh === null || fresh === void 0 ? void 0 : fresh.state) !== null && _a !== void 0 ? _a : 'missing'}`);
            return false;
        }
        catch (e) {
            await this.markRefundFailed(ctx, refund.id, (_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : String(e));
            return false;
        }
    }
    async markRefundFailed(ctx, refundId, reason) {
        core_1.Logger.error(`Refund ${refundId} settle failed: ${reason} (order needs manual handling)`, constants_1.loggerCtx);
        await this.connection
            .getRepository(ctx, core_1.Refund)
            .update(refundId, { state: REFUND_FAILED_STATE })
            .catch(() => undefined);
    }
    /** 无退款能力方式（货到付款）：落人工现金退还工单（软依赖 campus SupportService，未安装时只告警） */
    async createManualCashRefundTask(ctx, order, payment, amount, reason) {
        var _a, _b;
        const detail = `货到付款订单需人工现金退还：订单 ${order.code}，支付单 ${payment.id}，金额 ${amount} 分，原因：${reason}`;
        core_1.Logger.warn(detail, constants_1.loggerCtx);
        try {
            const { SupportService } = require('@vendure/campus-delivery-plugin');
            const svc = (0, payment_schedule_runtime_1.tryGetProvider)(SupportService);
            if (!(svc === null || svc === void 0 ? void 0 : svc.createSystemTicket)) {
                core_1.Logger.warn('campus SupportService unavailable, manual cash refund left to alarm only', constants_1.loggerCtx);
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
            core_1.Logger.warn(`${detail} → 工单 ${(_a = ticket === null || ticket === void 0 ? void 0 : ticket.id) !== null && _a !== void 0 ? _a : 'n/a'}`, constants_1.loggerCtx);
        }
        catch (e) {
            core_1.Logger.warn(`${detail}（人工任务落库失败：${(_b = e === null || e === void 0 ? void 0 : e.message) !== null && _b !== void 0 ? _b : e}）`, constants_1.loggerCtx);
        }
    }
    /** 幂等退款：已 Settled 退款合计 + 本次 > 支付额 时拒绝（防团购与调度双通道重复退款） */
    async refundPaymentOnce(ctx, order, payment, amount, reason) {
        var _a;
        const settled = ((_a = payment.refunds) !== null && _a !== void 0 ? _a : [])
            .filter((r) => r.state === 'Settled')
            .reduce((s, r) => s + r.amount, 0);
        if (settled + amount > payment.amount) {
            core_1.Logger.warn(`Refund skipped for payment ${payment.id}: settled ${settled} + ${amount} exceeds ${payment.amount}`, constants_1.loggerCtx);
            return false;
        }
        return this.refundPayment(ctx, order, payment, amount, reason);
    }
    /**
     * 双倍返还的「等额赔偿」笔：本金退完后 createRefund 的可退余额为 0（Vendure 对超额退款
     * 恒返 RefundAmountError），赔偿属平台法定赔付留痕（设计 §7：本金 refund + 等额赔偿 refund），
     * 直接落一条 Settled Refund 记录，不经网关、不受可退余额约束。
     */
    async recordCompensationRefund(ctx, payment, amount, reason) {
        var _a;
        try {
            await this.connection.getRepository(ctx, core_1.Refund).save(new core_1.Refund({
                payment,
                total: amount,
                reason,
                method: payment.method,
                state: 'Settled',
                metadata: { statutoryCompensation: true },
                items: 0,
                shipping: 0,
                adjustment: 0,
            }));
            return true;
        }
        catch (e) {
            core_1.Logger.error(`Failed to record compensation refund for payment ${payment.id}: ${(_a = e === null || e === void 0 ? void 0 : e.message) !== null && _a !== void 0 ? _a : e}`, constants_1.loggerCtx);
            return false;
        }
    }
};
exports.PaymentScheduleService = PaymentScheduleService;
exports.PaymentScheduleService = PaymentScheduleService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.TransactionalConnection,
        core_1.ListQueryBuilder,
        core_1.OrderService,
        core_1.PaymentService])
], PaymentScheduleService);
